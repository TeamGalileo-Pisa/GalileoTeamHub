begin;

alter table public.interview_sessions
  add column if not exists deleted_at timestamptz;
alter table public.interview_sessions
  add column if not exists deleted_from_status public.session_status;
alter table public.slots
  add column if not exists deleted_at timestamptz;
alter table public.slots
  add column if not exists deleted_from_status public.slot_status;

create or replace function public.list_calendar_bookings(
  p_start timestamptz,
  p_end timestamptz,
  p_area_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.staff_ready() then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end<=p_start
     or p_end-p_start>interval '367 days' then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      item order by (item->>'startsAt')::timestamptz,item->>'kind'
    ),
    '[]'::jsonb
  )
  into v_result
  from (
    select pg_catalog.jsonb_build_object(
      'kind','booking',
      'bookingId',b.id,
      'slotId',sl.id,
      'sessionId',s.id,
      'candidateName',c.first_name||' '||c.last_name,
      'candidateEmail',c.email::text,
      'areaName',ar.name::text,
      'areaId',ar.id,
      'roomName',r.name::text,
      'startsAt',sl.starts_at,
      'endsAt',sl.ends_at,
      'status',b.status,
      'campaignId',ca.campaign_id,
      'sessionName',s.name
    ) as item
    from public.bookings b
    join public.candidates c on c.id=b.candidate_id
    join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.room_availabilities ra on ra.id=al.room_availability_id
    join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end
      and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and s.deleted_at is null
      and sl.deleted_at is null

    union all

    select pg_catalog.jsonb_build_object(
      'kind','free',
      'bookingId',null,
      'slotId',sl.id,
      'sessionId',s.id,
      'candidateName',null,
      'candidateEmail',null,
      'areaName',ar.name::text,
      'areaId',ar.id,
      'roomName',r.name::text,
      'startsAt',sl.starts_at,
      'endsAt',sl.ends_at,
      'status','available',
      'campaignId',ca.campaign_id,
      'sessionName',s.name
    ) as item
    from public.slots sl
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.room_availabilities ra on ra.id=al.room_availability_id
    join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end
      and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and sl.status='available'
      and s.status in ('draft','published')
      and al.status='active'
      and ra.status='active'
      and ca.active
      and s.deleted_at is null
      and sl.deleted_at is null
      and not exists(
        select 1 from public.bookings b2
        where b2.slot_id=sl.id and b2.status='confirmed'
      )
  ) src;

  return v_result;
end;
$$;

revoke all on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) to authenticated;

create or replace function public.delete_booking_permanently(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_candidate_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select s.id,b.candidate_id
  into v_session_id,v_candidate_id
  from public.bookings b
  join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id
  where b.id=p_booking_id;

  if v_session_id is null or not private.can_manage_session(v_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  delete from public.booking_privacy_consents where booking_id=p_booking_id;
  delete from public.email_deliveries where booking_id=p_booking_id;
  delete from public.audit_logs
    where entity_type='booking' and entity_id=p_booking_id;
  delete from public.bookings where id=p_booking_id;

  if not exists(select 1 from public.bookings where candidate_id=v_candidate_id) then
    delete from public.audit_logs
      where entity_type='candidate' and entity_id=v_candidate_id;
    delete from public.candidates where id=v_candidate_id;
  end if;
end;
$$;

create or replace function public.cancel_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation_id uuid;
  v_area_id uuid;
  v_campaign_id uuid;
  v_cancelled_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select s.allocation_id,ca.area_id,ca.campaign_id
  into v_allocation_id,v_area_id,v_campaign_id
  from public.interview_sessions s
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  where s.id=p_session_id;

  if v_allocation_id is null or not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  update public.booking_links
  set status='revoked',
      revoked_at=coalesce(revoked_at,pg_catalog.now())
  where session_id=p_session_id and status='active';

  with changed as (
    update public.bookings b
    set status='cancelled',
        cancelled_at=pg_catalog.now(),
        cancelled_by=auth.uid()
    where b.status='confirmed'
      and b.slot_id in (
        select id from public.slots where session_id=p_session_id
      )
    returning b.id
  )
  select coalesce(pg_catalog.array_agg(id),array[]::uuid[])
  into v_cancelled_ids
  from changed;

  insert into public.email_deliveries(booking_id,kind,idempotency_key)
  select id,
         'booking_cancelled',
         id::text||':booking_cancelled:'||extensions.gen_random_uuid()::text
  from pg_catalog.unnest(v_cancelled_ids) id;

  update public.slots
  set status='disabled'
  where session_id=p_session_id and status='available';

  update public.interview_sessions
  set status='cancelled'
  where id=p_session_id;

  update public.area_allocations
  set status='cancelled',
      cancelled_by=auth.uid(),
      cancelled_at=pg_catalog.now()
  where id=v_allocation_id and status='active';

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,
    campaign_id,area_id,after_value
  )
  values(
    auth.uid(),'staff','session.cancelled','interview_session',p_session_id,
    v_campaign_id,v_area_id,
    pg_catalog.jsonb_build_object(
      'status','cancelled','allocation_id',v_allocation_id
    )
  );
end;
$$;

create or replace function public.delete_session_permanently(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation_id uuid;
  v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select allocation_id into v_allocation_id
  from public.interview_sessions
  where id=p_session_id;

  if v_allocation_id is null or not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  select coalesce(pg_catalog.array_agg(distinct b.candidate_id),array[]::uuid[])
  into v_candidate_ids
  from public.bookings b
  join public.slots sl on sl.id=b.slot_id
  where sl.session_id=p_session_id;

  delete from public.booking_privacy_consents
  where booking_id in (
    select b.id
    from public.bookings b
    join public.slots sl on sl.id=b.slot_id
    where sl.session_id=p_session_id
  );

  delete from public.email_deliveries
  where booking_id in (
    select b.id
    from public.bookings b
    join public.slots sl on sl.id=b.slot_id
    where sl.session_id=p_session_id
  );

  delete from public.audit_logs
  where (entity_type='booking' and entity_id in (
           select b.id
           from public.bookings b
           join public.slots sl on sl.id=b.slot_id
           where sl.session_id=p_session_id
         ))
     or (entity_type='slot' and entity_id in (
           select id from public.slots where session_id=p_session_id
         ))
     or (entity_type='interview_session' and entity_id=p_session_id)
     or (entity_type='area_allocation' and entity_id=v_allocation_id);

  delete from public.bookings b
  using public.slots sl
  where b.slot_id=sl.id and sl.session_id=p_session_id;

  delete from public.booking_links where session_id=p_session_id;
  delete from public.slots where session_id=p_session_id;
  delete from public.interview_sessions where id=p_session_id;
  delete from public.area_allocations where id=v_allocation_id;

  delete from public.audit_logs al
  where al.entity_type='candidate'
    and al.entity_id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=al.entity_id
    );

  delete from public.candidates c
  where c.id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=c.id
    );
end;
$$;

create or replace function public.delete_area_allocation_permanently(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.can_manage_allocation(p_allocation_id) then
    raise exception 'FORBIDDEN';
  end if;

  select id into v_session_id
  from public.interview_sessions
  where allocation_id=p_allocation_id;

  if v_session_id is not null then
    perform public.delete_session_permanently(v_session_id);
  else
    delete from public.audit_logs
      where entity_type='area_allocation' and entity_id=p_allocation_id;
    delete from public.area_allocations where id=p_allocation_id;
  end if;
end;
$$;

create or replace function public.delete_slot_permanently(p_slot_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select session_id into v_session_id
  from public.slots
  where id=p_slot_id;

  if v_session_id is null or not private.can_manage_session(v_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  if exists(
    select 1 from public.bookings
    where slot_id=p_slot_id and status='confirmed'
  ) then
    raise exception 'SLOT_HAS_BOOKINGS';
  end if;

  select coalesce(pg_catalog.array_agg(distinct candidate_id),array[]::uuid[])
  into v_candidate_ids
  from public.bookings
  where slot_id=p_slot_id;

  delete from public.booking_privacy_consents
    where booking_id in (select id from public.bookings where slot_id=p_slot_id);
  delete from public.email_deliveries
    where booking_id in (select id from public.bookings where slot_id=p_slot_id);
  delete from public.audit_logs
    where (entity_type='booking' and entity_id in (
             select id from public.bookings where slot_id=p_slot_id
           ))
       or (entity_type='slot' and entity_id=p_slot_id);
  delete from public.bookings where slot_id=p_slot_id;
  delete from public.slots where id=p_slot_id;

  delete from public.audit_logs al
  where al.entity_type='candidate'
    and al.entity_id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=al.entity_id
    );

  delete from public.candidates c
  where c.id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=c.id
    );
end;
$$;

create or replace function public.delete_room_availability_permanently(
  p_availability_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists(
    select 1 from public.room_availabilities where id=p_availability_id
  ) then
    raise exception 'AVAILABILITY_NOT_FOUND';
  end if;

  select coalesce(pg_catalog.array_agg(distinct b.candidate_id),array[]::uuid[])
  into v_candidate_ids
  from public.bookings b
  join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  where al.room_availability_id=p_availability_id;

  delete from public.booking_privacy_consents
  where booking_id in (
    select b.id
    from public.bookings b
    join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    where al.room_availability_id=p_availability_id
  );

  delete from public.email_deliveries
  where booking_id in (
    select b.id
    from public.bookings b
    join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    where al.room_availability_id=p_availability_id
  );

  delete from public.audit_logs
  where (entity_type='booking' and entity_id in (
           select b.id
           from public.bookings b
           join public.slots sl on sl.id=b.slot_id
           join public.interview_sessions s on s.id=sl.session_id
           join public.area_allocations al on al.id=s.allocation_id
           where al.room_availability_id=p_availability_id
         ))
     or (entity_type='slot' and entity_id in (
           select sl.id
           from public.slots sl
           join public.interview_sessions s on s.id=sl.session_id
           join public.area_allocations al on al.id=s.allocation_id
           where al.room_availability_id=p_availability_id
         ))
     or (entity_type='interview_session' and entity_id in (
           select s.id
           from public.interview_sessions s
           join public.area_allocations al on al.id=s.allocation_id
           where al.room_availability_id=p_availability_id
         ))
     or (entity_type='area_allocation' and entity_id in (
           select al.id
           from public.area_allocations al
           where al.room_availability_id=p_availability_id
         ))
     or (entity_type='room_availability' and entity_id=p_availability_id);

  delete from public.bookings b
  using public.slots sl, public.interview_sessions s, public.area_allocations al
  where b.slot_id=sl.id
    and sl.session_id=s.id
    and s.allocation_id=al.id
    and al.room_availability_id=p_availability_id;

  delete from public.booking_links bl
  using public.interview_sessions s, public.area_allocations al
  where bl.session_id=s.id
    and s.allocation_id=al.id
    and al.room_availability_id=p_availability_id;

  delete from public.slots sl
  using public.interview_sessions s, public.area_allocations al
  where sl.session_id=s.id
    and s.allocation_id=al.id
    and al.room_availability_id=p_availability_id;

  delete from public.interview_sessions s
  using public.area_allocations al
  where s.allocation_id=al.id
    and al.room_availability_id=p_availability_id;

  delete from public.area_allocations
  where room_availability_id=p_availability_id;

  delete from public.room_availabilities
  where id=p_availability_id;

  delete from public.audit_logs al
  where al.entity_type='candidate'
    and al.entity_id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=al.entity_id
    );

  delete from public.candidates c
  where c.id=any(v_candidate_ids)
    and not exists(
      select 1 from public.bookings b where b.candidate_id=c.id
    );
end;
$$;

revoke all on function public.delete_booking_permanently(uuid) from public, anon;
revoke all on function public.cancel_session(uuid) from public, anon;
revoke all on function public.delete_session_permanently(uuid) from public, anon;
revoke all on function public.delete_area_allocation_permanently(uuid) from public, anon;
revoke all on function public.delete_slot_permanently(uuid) from public, anon;
revoke all on function public.delete_room_availability_permanently(uuid) from public, anon;

grant execute on function public.delete_booking_permanently(uuid) to authenticated;
grant execute on function public.cancel_session(uuid) to authenticated;
grant execute on function public.delete_session_permanently(uuid) to authenticated;
grant execute on function public.delete_area_allocation_permanently(uuid) to authenticated;
grant execute on function public.delete_slot_permanently(uuid) to authenticated;
grant execute on function public.delete_room_availability_permanently(uuid) to authenticated;

commit;
