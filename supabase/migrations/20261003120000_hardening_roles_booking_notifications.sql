begin;

alter type public.app_role add value if not exists 'team_leader';

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.system_roles
    where user_id = (select auth.uid())
      and role in ('admin','team_leader')
  );
$$;

create table if not exists public.notifications (
  id uuid primary key default extensions.gen_random_uuid(),
  recipient_user_id uuid not null references public.profiles(id) on delete cascade,
  type text not null,
  title text not null,
  body text not null,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default pg_catalog.now(),
  read_at timestamptz
);
create index if not exists notifications_recipient_created_idx
  on public.notifications(recipient_user_id,created_at desc);
create index if not exists notifications_unread_idx
  on public.notifications(recipient_user_id,created_at desc) where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from public,anon;
grant select,update on public.notifications to authenticated;
create policy notifications_select_own on public.notifications for select to authenticated
  using (recipient_user_id=(select auth.uid()));
create policy notifications_update_own on public.notifications for update to authenticated
  using (recipient_user_id=(select auth.uid()))
  with check (recipient_user_id=(select auth.uid()));

create or replace function public.list_notifications(p_limit integer default 30)
returns table(id uuid,type text,title text,body text,data jsonb,created_at timestamptz,read_at timestamptz)
language sql stable security definer set search_path=''
as $$
  select id,type,title,body,data,created_at,read_at
  from public.notifications
  where recipient_user_id=(select auth.uid())
  order by created_at desc
  limit greatest(1,least(coalesce(p_limit,30),100));
$$;
create or replace function public.get_unread_notification_count()
returns integer language sql stable security definer set search_path=''
as $$
  select count(*)::integer from public.notifications
  where recipient_user_id=(select auth.uid()) and read_at is null;
$$;
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path=''
as $$
  update public.notifications set read_at=coalesce(read_at,pg_catalog.now())
  where id=p_notification_id and recipient_user_id=(select auth.uid());
$$;
revoke all on function public.list_notifications(integer),public.get_unread_notification_count(),public.mark_notification_read(uuid) from public,anon;
grant execute on function public.list_notifications(integer),public.get_unread_notification_count(),public.mark_notification_read(uuid) to authenticated;

create or replace function private.notify_booking_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_area_id uuid;
  v_name text;
  v_starts timestamptz;
  v_room text;
  v_type text;
  v_title text;
  v_body text;
begin
  select ca.area_id,c.first_name||' '||c.last_name,sl.starts_at,r.name::text
    into v_area_id,v_name,v_starts,v_room
  from public.slots sl
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  join public.candidates c on c.id=new.candidate_id
  join public.room_availabilities ra on ra.id=al.room_availability_id
  join public.rooms r on r.id=ra.room_id
  where sl.id=new.slot_id;

  if v_area_id is null then return new; end if;

  if tg_op='INSERT' then
    v_type:='booking.created'; v_title:='Nuova prenotazione';
    v_body:=v_name||' ha prenotato un colloquio per '||
      to_char(v_starts at time zone 'Europe/Rome','DD/MM/YYYY HH24:MI')||' in '||v_room||'.';
  elsif new.status='cancelled' and old.status<>'cancelled' then
    v_type:='booking.cancelled'; v_title:='Prenotazione annullata';
    v_body:=v_name||' ha annullato una prenotazione.';
  elsif new.slot_id<>old.slot_id then
    v_type:='booking.changed'; v_title:='Prenotazione modificata';
    v_body:=v_name||' ha modificato l’orario del colloquio.';
  else return new;
  end if;

  insert into public.notifications(recipient_user_id,type,title,body,data)
  select m.user_id,v_type,v_title,v_body,
    jsonb_build_object('booking_id',new.id,'area_id',v_area_id)
  from public.area_memberships m
  where m.area_id=v_area_id and m.role='area_lead' and m.ended_at is null;
  return new;
end;
$$;

drop trigger if exists bookings_notify_area_leads on public.bookings;
create trigger bookings_notify_area_leads
after insert or update of slot_id,status on public.bookings
for each row execute function private.notify_booking_change();

create or replace function private.notify_announcement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.all_areas then
    insert into public.notifications(recipient_user_id,type,title,body,data)
    select m.user_id,'announcement.created','Nuovo annuncio in bacheca',new.title,
      jsonb_build_object('announcement_id',new.id)
    from public.area_memberships m
    where m.role='area_lead' and m.ended_at is null;
  end if;
  return new;
end;
$$;
drop trigger if exists announcements_notify_area_leads on public.announcements;
create trigger announcements_notify_area_leads
after insert on public.announcements for each row execute function private.notify_announcement();

create or replace function private.notify_targeted_announcement()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_title text;
begin
  select title into v_title from public.announcements where id=new.announcement_id;
  insert into public.notifications(recipient_user_id,type,title,body,data)
  select m.user_id,'announcement.created','Nuovo annuncio in bacheca',v_title,
    jsonb_build_object('announcement_id',new.announcement_id,'area_id',new.area_id)
  from public.area_memberships m
  where m.area_id=new.area_id and m.role='area_lead' and m.ended_at is null;
  return new;
end;
$$;
drop trigger if exists announcement_targets_notify_area_leads on public.announcement_targets;
create trigger announcement_targets_notify_area_leads
after insert on public.announcement_targets for each row execute function private.notify_targeted_announcement();

create or replace function private.guard_one_confirmed_booking_per_candidate()
returns trigger language plpgsql security definer set search_path=''
as $
begin
  if exists(
    select 1 from public.bookings b
    where b.candidate_id=new.candidate_id
      and b.status='confirmed'
      and b.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
  ) then
    raise exception 'CANDIDATE_ALREADY_BOOKED';
  end if;
  return new;
end;
$;
drop trigger if exists bookings_one_confirmed_per_candidate on public.bookings;
create trigger bookings_one_confirmed_per_candidate
before insert on public.bookings
for each row execute function private.guard_one_confirmed_booking_per_candidate();

create or replace function private.guard_public_booking_24h()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if (select auth.uid()) is null and exists(
    select 1 from public.slots s
    where s.id=new.slot_id
      and s.starts_at < pg_catalog.now()+interval '24 hours'
  ) then
    raise exception 'BOOKING_REQUIRES_24_HOURS';
  end if;
  return new;
end;
$$;
drop trigger if exists bookings_public_24h_guard on public.bookings;
create trigger bookings_public_24h_guard
before insert on public.bookings for each row execute function private.guard_public_booking_24h();

revoke all on function private.notify_booking_change(),private.notify_announcement(),private.notify_targeted_announcement(),private.guard_public_booking_24h(),private.guard_one_confirmed_booking_per_candidate() from public,anon;
grant execute on function private.notify_booking_change(),private.notify_announcement(),private.notify_targeted_announcement(),private.guard_public_booking_24h() to authenticated,service_role;


alter table public.email_deliveries
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists public.booking_manage_tokens (
  id uuid primary key default extensions.gen_random_uuid(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  token_hash bytea not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.now()
);
create index if not exists booking_manage_tokens_hash_idx on public.booking_manage_tokens(token_hash);
alter table public.booking_manage_tokens enable row level security;
revoke all on public.booking_manage_tokens from public,anon,authenticated;

create or replace function private.create_booking_manage_token()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_raw text;
  v_starts timestamptz;
  v_public_url text := coalesce(current_setting('app.public_url',true),'https://galileohub.info-teamgalileo.workers.dev');
begin
  if new.kind<>'booking_confirmation' then return new; end if;
  select sl.starts_at into v_starts
  from public.bookings b join public.slots sl on sl.id=b.slot_id
  where b.id=new.booking_id;
  v_raw:=encode(extensions.gen_random_bytes(32),'hex');
  insert into public.booking_manage_tokens(booking_id,token_hash,expires_at)
  values(new.booking_id,extensions.digest(v_raw,'sha256'),v_starts);
  update public.email_deliveries
  set metadata=jsonb_build_object('manage_url',rtrim(v_public_url,'/')||'/manage/'||v_raw)
  where id=new.id;
  return new;
end;
$$;
drop trigger if exists email_delivery_create_manage_token on public.email_deliveries;
create trigger email_delivery_create_manage_token
after insert on public.email_deliveries for each row
execute function private.create_booking_manage_token();

create or replace function public.get_booking_by_manage_token(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_booking uuid; v jsonb;
begin
  select booking_id into v_booking from public.booking_manage_tokens
  where token_hash=extensions.digest(coalesce(p_token,''),'sha256') and expires_at>pg_catalog.now();
  if v_booking is null then raise exception 'INVALID_MANAGE_TOKEN'; end if;
  select jsonb_build_object(
    'booking_id',b.id,'candidate_name',c.first_name||' '||c.last_name,
    'candidate_email',c.email::text,'area_name',ar.name::text,'room_name',r.name::text,
    'starts_at',sl.starts_at,'ends_at',sl.ends_at
  ) into v
  from public.bookings b
  join public.candidates c on c.id=b.candidate_id
  join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  join public.areas ar on ar.id=ca.area_id
  join public.room_availabilities ra on ra.id=al.room_availability_id
  join public.rooms r on r.id=ra.room_id
  where b.id=v_booking and b.status='confirmed';
  if v is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  return v;
end;
$$;

create or replace function public.list_booking_change_slots(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $
declare v_booking uuid; v_session uuid; v_slots jsonb;
begin
  select b.id,s.id into v_booking,v_session
  from public.booking_manage_tokens t
  join public.bookings b on b.id=t.booking_id
  join public.slots old_slot on old_slot.id=b.slot_id
  join public.interview_sessions s on s.id=old_slot.session_id
  where t.token_hash=extensions.digest(coalesce(p_token,''),'sha256')
    and t.expires_at>pg_catalog.now() and b.status='confirmed';
  if v_booking is null then raise exception 'INVALID_MANAGE_TOKEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',sl.id,'starts_at',sl.starts_at,'ends_at',sl.ends_at,'room_name',r.name::text) order by sl.starts_at),'[]'::jsonb)
  into v_slots
  from public.slots sl
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.room_availabilities ra on ra.id=al.room_availability_id
  join public.rooms r on r.id=ra.room_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  where sl.session_id=v_session and sl.status='available'
    and sl.starts_at>=pg_catalog.now()+interval '24 hours'
    and not exists(select 1 from public.bookings b2 where b2.slot_id=sl.id and b2.status='confirmed');
  return v_slots;
end;
$;

revoke all on function public.list_booking_change_slots(text) from public,anon,authenticated;
grant execute on function public.list_booking_change_slots(text) to service_role;

create or replace function public.change_booking_by_manage_token(p_token text,p_new_slot_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  v_booking uuid; v_candidate uuid; v_old_slot uuid; v_new_start timestamptz;
  v_new_end timestamptz; v_area uuid; v_campaign uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select booking_id into v_booking from public.booking_manage_tokens
  where token_hash=extensions.digest(coalesce(p_token,''),'sha256') and expires_at>pg_catalog.now();
  if v_booking is null then raise exception 'INVALID_MANAGE_TOKEN'; end if;
  select b.candidate_id,b.slot_id,ca.area_id,ca.campaign_id
    into v_candidate,v_old_slot,v_area,v_campaign
  from public.bookings b
  join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  where b.id=v_booking and b.status='confirmed';
  if v_candidate is null then raise exception 'BOOKING_NOT_FOUND'; end if;
  select sl.starts_at,sl.ends_at into v_new_start,v_new_end
  from public.slots sl
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  where sl.id=p_new_slot_id and sl.status='available' and sl.starts_at>=pg_catalog.now()+interval '24 hours'
    and ca.campaign_id=v_campaign and ca.area_id=v_area and s.status in ('draft','published')
    and al.status='active' and ca.active;
  if v_new_start is null then raise exception 'SLOT_UNAVAILABLE_OR_LESS_THAN_24H'; end if;
  if p_new_slot_id=v_old_slot then return public.get_booking_by_manage_token(p_token); end if;
  begin
    update public.bookings set slot_id=p_new_slot_id where id=v_booking and status='confirmed';
  exception when unique_violation then raise exception 'SLOT_UNAVAILABLE'; end;
  update public.booking_manage_tokens set expires_at=v_new_start where booking_id=v_booking;
  insert into public.email_deliveries(booking_id,kind,idempotency_key)
  values(v_booking,'booking_changed',v_booking::text||':candidate_changed:'||extensions.gen_random_uuid()::text);
  return public.get_booking_by_manage_token(p_token);
end;
$$;

create or replace function public.cancel_booking_by_manage_token(p_token text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_booking uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select booking_id into v_booking from public.booking_manage_tokens
  where token_hash=extensions.digest(coalesce(p_token,''),'sha256') and expires_at>pg_catalog.now();
  if v_booking is null then raise exception 'INVALID_MANAGE_TOKEN'; end if;
  update public.bookings
  set status='cancelled',cancelled_at=pg_catalog.now()
  where id=v_booking and status='confirmed';
  if not found then raise exception 'BOOKING_NOT_FOUND'; end if;
  insert into public.email_deliveries(booking_id,kind,idempotency_key)
  values(v_booking,'booking_cancelled',v_booking::text||':candidate_cancelled:'||extensions.gen_random_uuid()::text);
end;
$$;

revoke all on function private.create_booking_manage_token() from public,anon,authenticated;
grant execute on function private.create_booking_manage_token() to service_role;
revoke all on function public.get_booking_by_manage_token(text),public.change_booking_by_manage_token(text,uuid),public.cancel_booking_by_manage_token(text) from public,anon,authenticated;
grant execute on function public.get_booking_by_manage_token(text),public.change_booking_by_manage_token(text,uuid),public.cancel_booking_by_manage_token(text) to service_role;

commit;
