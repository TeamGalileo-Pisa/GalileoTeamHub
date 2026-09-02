begin;

alter table public.room_availabilities add column series_id uuid;
create index room_availability_series_idx on public.room_availabilities(series_id) where series_id is not null;
comment on column public.room_availabilities.series_id is 'Groups daily windows created atomically. NULL preserves existing/legacy windows.';

create function public.create_daily_availabilities(p_room_id uuid,p_start_date date,p_end_date date,p_start_time time,p_end_time time,p_weekdays integer[],p_capacity integer,p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_date date; v_series uuid:=gen_random_uuid(); v_ids uuid[]:='{}'; v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_start_date is null or p_end_date is null or p_end_date<p_start_date or p_end_date-p_start_date>366
    or p_start_time is null or p_end_time is null or p_end_time<=p_start_time
    or coalesce(cardinality(p_weekdays),0)=0 or not p_weekdays<@array[1,2,3,4,5,6,7] then raise exception 'INVALID_DAILY_PERIOD'; end if;
  for v_date in select d::date from generate_series(p_start_date::timestamp,p_end_date::timestamp,interval '1 day') d
  loop
    if extract(isodow from v_date)::integer=any(p_weekdays) then
      v_id:=public.create_room_availability(p_room_id,(v_date+p_start_time) at time zone 'Europe/Rome',
        (v_date+p_end_time) at time zone 'Europe/Rome',p_capacity,p_note);
      update public.room_availabilities set series_id=v_series where id=v_id;
      v_ids:=array_append(v_ids,v_id);
    end if;
  end loop;
  if cardinality(v_ids)=0 then raise exception 'INVALID_DAILY_PERIOD'; end if;
  return jsonb_build_object('series_id',v_series,'count',cardinality(v_ids),'ids',v_ids);
end;
$$;

create function public.manage_session(p_session_id uuid,p_action text,p_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare s public.interview_sessions%rowtype; v_area uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.can_manage_session(p_session_id) then raise exception 'FORBIDDEN'; end if;
  select * into strict s from public.interview_sessions where id=p_session_id for update;
  select ca.area_id into v_area from public.area_allocations a join public.campaign_areas ca on ca.id=a.campaign_area_id where a.id=s.allocation_id;
  if p_action='rename' then
    update public.interview_sessions set name=trim(p_name) where id=p_session_id;
  elsif p_action in ('close','revoke_link') then
    update public.booking_links set status='revoked',revoked_at=now() where session_id=p_session_id and status='active';
    if p_action='close' then
      update public.interview_sessions set status='closed' where id=p_session_id and status<>'cancelled';
      update public.slots sl set status='disabled' where sl.session_id=p_session_id and not exists
        (select 1 from public.bookings b where b.slot_id=sl.id and b.status='confirmed');
    end if;
  elsif p_action='reopen' then
    if s.status<>'closed' or not exists(select 1 from public.area_allocations a
      join public.campaign_areas ca on ca.id=a.campaign_area_id join public.recruitment_campaigns c on c.id=ca.campaign_id
      join public.areas ar on ar.id=ca.area_id join public.room_availabilities ra on ra.id=a.room_availability_id
      where a.id=s.allocation_id and a.status='active' and a.ends_at>now() and ca.active and ar.active and c.status='active' and ra.status='active') then
      raise exception 'SESSION_NOT_ACTIVE';
    end if;
    update public.interview_sessions set status='draft' where id=p_session_id;
    -- Disabled slots and revoked links stay disabled; reopen individual slots explicitly.
  else raise exception 'INVALID_ACTION'; end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,area_id,before_value,after_value)
    values(auth.uid(),'staff','session.'||p_action,'interview_session',p_session_id,v_area,to_jsonb(s),jsonb_build_object('name',p_name));
end;
$$;

create function public.manage_slot(p_slot_id uuid,p_action text,p_starts_at timestamptz default null,p_ends_at timestamptz default null)
returns void language plpgsql security definer set search_path = '' as $$
declare sl public.slots%rowtype; v_area uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select * into strict sl from public.slots where id=p_slot_id for update;
  if not private.can_manage_session(sl.session_id) then raise exception 'FORBIDDEN'; end if;
  if exists(select 1 from public.bookings where slot_id=p_slot_id and (status='confirmed' or p_action in ('edit','delete'))) then raise exception 'SLOT_HAS_BOOKINGS'; end if;
  select ca.area_id into v_area from public.interview_sessions s join public.area_allocations a on a.id=s.allocation_id
    join public.campaign_areas ca on ca.id=a.campaign_area_id where s.id=sl.session_id;
  if p_action in ('edit','reopen') and not exists(select 1 from public.interview_sessions where id=sl.session_id and status in ('draft','published')) then raise exception 'SESSION_NOT_ACTIVE'; end if;
  if p_action='edit' then
    if p_starts_at is null or p_ends_at is null or p_ends_at<=p_starts_at then raise exception 'INVALID_TIME_RANGE'; end if;
    if exists(select 1 from public.slots other where other.id<>p_slot_id and other.session_id=sl.session_id
      and other.status='available' and other.period && tstzrange(p_starts_at,p_ends_at,'[)')) then raise exception 'SLOT_UNAVAILABLE'; end if;
    update public.slots set starts_at=p_starts_at,ends_at=p_ends_at where id=p_slot_id;
  elsif p_action='close' then update public.slots set status='disabled' where id=p_slot_id;
  elsif p_action='reopen' then update public.slots set status='available' where id=p_slot_id;
  elsif p_action='delete' then delete from public.slots where id=p_slot_id;
  else raise exception 'INVALID_ACTION'; end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,area_id,before_value,after_value)
    values(auth.uid(),'staff','slot.'||p_action,'slot',p_slot_id,v_area,to_jsonb(sl),jsonb_build_object('starts_at',p_starts_at,'ends_at',p_ends_at));
end;
$$;

create function public.list_session_slots(p_session_id uuid)
returns table(id uuid,starts_at timestamptz,ends_at timestamptz,status public.slot_status,booked boolean,has_history boolean)
language sql stable security definer set search_path = '' as $$
  select sl.id,sl.starts_at,sl.ends_at,sl.status,
    exists(select 1 from public.bookings b where b.slot_id=sl.id and b.status='confirmed'),
    exists(select 1 from public.bookings b where b.slot_id=sl.id)
  from public.slots sl where sl.session_id=p_session_id and private.can_manage_session(p_session_id) order by sl.starts_at;
$$;

create function public.create_session_with_slots(p_allocation_id uuid,p_name text,p_duration_minutes integer)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  v_id:=public.create_interview_session(p_allocation_id,p_name);
  perform public.generate_session_slots(v_id,p_duration_minutes);
  return v_id;
end;
$$;

revoke all on function public.create_daily_availabilities(uuid,date,date,time,time,integer[],integer,text) from public,anon;
revoke all on function public.manage_session(uuid,text,text) from public,anon;
revoke all on function public.manage_slot(uuid,text,timestamptz,timestamptz) from public,anon;
revoke all on function public.list_session_slots(uuid) from public,anon;
revoke all on function public.create_session_with_slots(uuid,text,integer) from public,anon;
grant execute on function public.create_daily_availabilities(uuid,date,date,time,time,integer[],integer,text) to authenticated;
grant execute on function public.manage_session(uuid,text,text) to authenticated;
grant execute on function public.manage_slot(uuid,text,timestamptz,timestamptz) to authenticated;
grant execute on function public.list_session_slots(uuid) to authenticated;
grant execute on function public.create_session_with_slots(uuid,text,integer) to authenticated;

commit;
