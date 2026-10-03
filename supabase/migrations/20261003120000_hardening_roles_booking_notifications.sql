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

  if tg_op='UPDATE' and new.slot_id<>old.slot_id then
    update public.booking_manage_tokens t
    set expires_at=sl.starts_at
    from public.slots sl
    where t.booking_id=new.id and sl.id=new.slot_id;
  end if;

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
as $$
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
$$;
create unique index if not exists bookings_one_confirmed_per_candidate_idx
on public.bookings(candidate_id)
where status='confirmed';

drop trigger if exists bookings_one_confirmed_per_candidate on public.bookings;
create trigger bookings_one_confirmed_per_candidate
before insert or update of candidate_id,status on public.bookings
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
as $$
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
$$;

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





-- Team Leader is a first-class global role and must be editable like Admin.
create or replace function public.list_staff_members()
returns table (
  id uuid,
  username text,
  display_name text,
  status public.profile_status,
  is_admin boolean,
  role public.app_role,
  areas jsonb
)
language plpgsql stable security definer set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query
  select p.id,p.username::text,p.display_name,p.status,
    exists(select 1 from public.system_roles r where r.user_id=p.id and r.role in ('admin','team_leader')),
    coalesce((select r.role from public.system_roles r where r.user_id=p.id order by case when r.role='admin' then 1 when r.role='team_leader' then 2 else 3 end limit 1),'area_lead'::public.app_role),
    coalesce((
      select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name::text,'slug',a.slug::text) order by a.name)
      from public.area_memberships m join public.areas a on a.id=m.area_id
      where m.user_id=p.id and m.ended_at is null
    ),'[]'::jsonb)
  from public.profiles p
  order by p.display_name;
end;
$$;
revoke all on function public.list_staff_members() from public,anon;
grant execute on function public.list_staff_members() to authenticated;

create or replace function public.update_staff_profile(
  p_actor_id uuid,p_id uuid,p_username text,p_display_name text,
  p_is_admin boolean,p_area_id uuid,p_status public.profile_status
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  perform public.update_staff_profile_v2(
    p_actor_id,p_id,p_username,p_display_name,
    case when p_is_admin then 'admin'::public.app_role else 'area_lead'::public.app_role end,
    p_area_id,p_status
  );
end;
$$;

create or replace function public.update_staff_profile_v2(
  p_actor_id uuid,p_id uuid,p_username text,p_display_name text,
  p_role public.app_role,p_area_id uuid,p_status public.profile_status
)
returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.profiles%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if not exists(
    select 1 from public.profiles p
    where p.id=p_actor_id and p.status='active' and not p.must_change_password
      and exists(select 1 from public.system_roles r where r.user_id=p_actor_id and r.role in ('admin','team_leader'))
  ) then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('admin','team_leader','area_lead') then raise exception 'INVALID_STAFF_DATA'; end if;
  select * into strict v_old from public.profiles where id=p_id for update;
  if p_username !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$' then raise exception 'INVALID_STAFF_DATA'; end if;
  if p_role='area_lead' and not exists(
    select 1 from public.areas a where a.id=p_area_id and
      (a.active or exists(select 1 from public.area_memberships m where m.user_id=p_id and m.area_id=a.id and m.ended_at is null))
  ) then raise exception 'INVALID_STAFF_DATA'; end if;
  if exists(select 1 from public.system_roles r where r.user_id=p_id and r.role in ('admin','team_leader'))
     and (p_role='area_lead' or p_status='disabled')
     and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
                    where p.id<>p_id and p.status='active' and r.role in ('admin','team_leader')) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  update public.profiles set username=trim(p_username),display_name=trim(p_display_name),status=p_status where id=p_id;
  if p_role in ('admin','team_leader') then
    if exists(select 1 from public.system_roles where user_id=p_id and role in ('admin','team_leader')) then
      update public.system_roles set role=p_role,granted_by=p_actor_id where user_id=p_id and role in ('admin','team_leader');
    else
      insert into public.system_roles(user_id,role,granted_by) values(p_id,p_role,p_actor_id);
    end if;
    delete from public.system_roles where user_id=p_id and role not in ('admin','team_leader');
    update public.area_memberships set ended_at=greatest(clock_timestamp(),started_at+interval '1 microsecond')
      where user_id=p_id and ended_at is null;
  else
    update public.area_memberships set ended_at=greatest(clock_timestamp(),started_at+interval '1 microsecond')
      where user_id=p_id and ended_at is null and area_id<>p_area_id;
    if not exists(select 1 from public.area_memberships where user_id=p_id and area_id=p_area_id and ended_at is null) then
      insert into public.area_memberships(user_id,area_id,created_by) values(p_id,p_area_id,p_actor_id);
    end if;
  end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value)
    values(p_actor_id,'staff','staff.updated','profile',p_id,to_jsonb(v_old),
      jsonb_build_object('username',p_username,'display_name',p_display_name,'status',p_status,'role',p_role,'area_id',p_area_id));
end;
$$;
revoke all on function public.update_staff_profile_v2(uuid,uuid,text,text,public.app_role,uuid,public.profile_status) from public,anon,authenticated;
grant execute on function public.update_staff_profile_v2(uuid,uuid,text,text,public.app_role,uuid,public.profile_status) to service_role;

create or replace function private.protect_last_admin()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_removes boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if tg_table_name='profiles' then
    v_id:=old.id;
    v_removes:=tg_op='DELETE' or (old.status='active' and new.status='disabled');
  else
    v_id:=old.user_id;
    v_removes:=true;
  end if;
  if v_removes and exists(
    select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id=v_id and p.status='active' and r.role in ('admin','team_leader')
  ) and not exists(
    select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id<>v_id and p.status='active' and r.role in ('admin','team_leader')
  ) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function private.guard_profile_deletion()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if private.has_references('public.profiles',old.id,array['public.system_roles','system_roles','private.staff_operations'])
     or exists(select 1 from public.audit_logs where actor_user_id=old.id or (entity_type='profile' and entity_id=old.id))
  then raise exception 'HAS_HISTORY'; end if;
  if exists(select 1 from public.system_roles where user_id=old.id and role in ('admin','team_leader'))
     and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
       where p.id<>old.id and p.status='active' and r.role in ('admin','team_leader'))
  then raise exception 'LAST_ACTIVE_ADMIN'; end if;
  return old;
end;
$$;

create or replace function public.book_public_slot(
  p_token text,
  p_slot_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_id uuid;
  v_secret text;
  v_session_id uuid;
  v_campaign_id uuid;
  v_area_id uuid;
  v_area_name text;
  v_room_name text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_candidate_id uuid;
  v_booking_id uuid;
  v_delivery_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if pg_catalog.char_length(coalesce(p_token, '')) > 140
     or pg_catalog.split_part(p_token, '.', 3) <> '' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  begin
    v_public_id := pg_catalog.split_part(p_token, '.', 1)::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_BOOKING_LINK';
  end;

  v_secret := pg_catalog.split_part(p_token, '.', 2);
  if v_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  if pg_catalog.char_length(trim(coalesce(p_first_name, ''))) not between 2 and 80
     or pg_catalog.char_length(trim(coalesce(p_last_name, ''))) not between 2 and 80 then
    raise exception 'INVALID_CANDIDATE_NAME';
  end if;

  if p_slot_id is null then raise exception 'INVALID_SLOT'; end if;
  if p_email is null or pg_catalog.char_length(trim(coalesce(p_email, ''))) > 254
     or pg_catalog.lower(trim(p_email)) !~ '^[^[:space:]@]+@studenti\.unipi\.it$' then
    raise exception 'INVALID_STUDENT_EMAIL';
  end if;

  select link_record.session_id,
         campaign_area.campaign_id,
         campaign_area.area_id,
         area_record.name::text
    into v_session_id, v_campaign_id, v_area_id, v_area_name
  from public.booking_links link_record
  join public.interview_sessions session_record on session_record.id = link_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where link_record.public_id = v_public_id
    and link_record.secret_hash = extensions.digest(v_secret, 'sha256')
    and link_record.status = 'active'
    and (link_record.expires_at is null or link_record.expires_at > pg_catalog.now())
    and session_record.status = 'published'
    and allocation.status = 'active' and campaign_area.active and area_record.active
    and exists(select 1 from public.recruitment_campaigns c where c.id=campaign_area.campaign_id and c.status='active');

  if v_session_id is null then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  select slot_record.starts_at, slot_record.ends_at, room.name::text
    into v_starts_at, v_ends_at, v_room_name
  from public.slots slot_record
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  where slot_record.id = p_slot_id
    and slot_record.session_id = v_session_id
    and slot_record.status = 'available'
    and slot_record.starts_at >= pg_catalog.now()+interval '24 hours'
  for update of slot_record;

  if v_starts_at is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  insert into public.candidates (
    campaign_id, first_name, last_name, email
  ) values (
    v_campaign_id,
    trim(p_first_name),
    trim(p_last_name),
    pg_catalog.lower(trim(p_email))
  )
  on conflict (campaign_id, email)
  do update set
    first_name = excluded.first_name,
    last_name = excluded.last_name
  returning id into v_candidate_id;

  begin
    insert into public.bookings (slot_id, candidate_id)
    values (p_slot_id, v_candidate_id)
    returning id into v_booking_id;
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  insert into public.email_deliveries (
    booking_id, kind, idempotency_key
  ) values (
    v_booking_id,
    'booking_confirmation',
    v_booking_id::text || ':booking_confirmation'
  ) returning id into v_delivery_id;

  insert into public.audit_logs (
    actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    'candidate', 'booking.confirmed', 'booking', v_booking_id,
    v_campaign_id, v_area_id,
    pg_catalog.jsonb_build_object('slot_id', p_slot_id)
  );

  return pg_catalog.jsonb_build_object(
    'booking_id', v_booking_id,
    'delivery_id', v_delivery_id,
    'candidate_name', trim(p_first_name) || ' ' || trim(p_last_name),
    'area_name', v_area_name,
    'room_name', v_room_name,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at
  );
end;
$$;


create or replace function public.get_public_booking_availability(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_public_id uuid;
  v_secret text;
  v_session_id uuid;
  v_area_name text;
  v_session_name text;
  v_slots jsonb;
begin
  if pg_catalog.char_length(coalesce(p_token, '')) > 140
     or pg_catalog.split_part(p_token, '.', 3) <> '' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  begin
    v_public_id := pg_catalog.split_part(p_token, '.', 1)::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_BOOKING_LINK';
  end;

  v_secret := pg_catalog.split_part(p_token, '.', 2);
  if v_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  select link_record.session_id, area_record.name::text, session_record.name
    into v_session_id, v_area_name, v_session_name
  from public.booking_links link_record
  join public.interview_sessions session_record on session_record.id = link_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where link_record.public_id = v_public_id
    and link_record.secret_hash = extensions.digest(v_secret, 'sha256')
    and link_record.status = 'active'
    and (link_record.expires_at is null or link_record.expires_at > pg_catalog.now())
    and session_record.status = 'published'
    and allocation.status = 'active' and campaign_area.active and area_record.active
    and exists(select 1 from public.recruitment_campaigns c where c.id=campaign_area.campaign_id and c.status='active');

  if v_session_id is null then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', slot_record.id,
      'starts_at', slot_record.starts_at,
      'ends_at', slot_record.ends_at,
      'room_name', room.name::text
    ) order by slot_record.starts_at
  ), '[]'::jsonb)
  into v_slots
  from public.slots slot_record
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  where slot_record.session_id = v_session_id
    and slot_record.status = 'available'
    and slot_record.starts_at >= pg_catalog.now()+interval '24 hours'
    and not exists (
      select 1
      from public.bookings booking
      where booking.slot_id = slot_record.id
        and booking.status = 'confirmed'
    );

  return pg_catalog.jsonb_build_object(
    'area_name', v_area_name,
    'session_name', v_session_name,
    'slots', v_slots
  );
end;
$$;

drop function public.list_room_availabilities();


create or replace function public.claim_email_delivery(p_delivery_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payload jsonb;
begin
  update public.email_deliveries delivery
  set status='sending',attempt_count=attempt_count+1,last_error=null
  where delivery.id=p_delivery_id
    and delivery.status in ('pending','failed')
    and delivery.next_attempt_at<=now();
  if not found then return null; end if;
  select jsonb_build_object(
    'delivery_id',delivery.id,
    'kind',delivery.kind,
    'to_email',candidate.email::text,
    'candidate_name',candidate.first_name||' '||candidate.last_name,
    'area_name',area_record.name::text,
    'room_name',room.name::text,
    'starts_at',slot_record.starts_at,
    'ends_at',slot_record.ends_at,
    'manage_url',delivery.metadata->>'manage_url'
  )
  into v_payload
  from public.email_deliveries delivery
  join public.bookings booking on booking.id=delivery.booking_id
  join public.candidates candidate on candidate.id=booking.candidate_id
  join public.slots slot_record on slot_record.id=booking.slot_id
  join public.interview_sessions session_record on session_record.id=slot_record.session_id
  join public.area_allocations allocation on allocation.id=session_record.allocation_id
  join public.room_availabilities availability on availability.id=allocation.room_availability_id
  join public.rooms room on room.id=availability.room_id
  join public.campaign_areas campaign_area on campaign_area.id=allocation.campaign_area_id
  join public.areas area_record on area_record.id=campaign_area.area_id
  where delivery.id=p_delivery_id;
  return v_payload;
end;
$$;

commit;
