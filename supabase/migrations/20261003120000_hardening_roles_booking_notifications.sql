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

revoke all on function private.notify_booking_change(),private.notify_announcement(),private.notify_targeted_announcement(),private.guard_public_booking_24h() from public,anon;
grant execute on function private.notify_booking_change(),private.notify_announcement(),private.notify_targeted_announcement(),private.guard_public_booking_24h() to authenticated,service_role;

commit;