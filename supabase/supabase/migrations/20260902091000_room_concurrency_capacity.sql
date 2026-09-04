begin;

alter table public.rooms
  add column max_simultaneous_interviews_limit integer;

alter table public.rooms
  add constraint rooms_physical_capacity_valid
  check (
    max_simultaneous_interviews_limit is null
    or max_simultaneous_interviews_limit between 1 and 100
  );

alter table public.room_availabilities
  add column max_simultaneous_interviews integer not null default 1,
  add column area_note text not null default '';

alter table public.room_availabilities
  add constraint room_availabilities_capacity_valid
    check (max_simultaneous_interviews between 1 and 100),
  add constraint room_availabilities_area_note_length
    check (pg_catalog.char_length(area_note) <= 2000);

comment on column public.room_availabilities.max_simultaneous_interviews is
  'Existing availability windows were migrated to capacity 1, preserving the previous exclusive behavior.';

-- Initial physical limits are data configuration only. The upsert also makes
-- these two confirmed rooms available on fresh installations. All runtime
-- checks use max_simultaneous_interviews_limit and never compare room names.
insert into public.rooms (name, max_simultaneous_interviews_limit)
values ('Riunioni 5067', 1), ('A27', 2)
on conflict (name) do update
set max_simultaneous_interviews_limit = excluded.max_simultaneous_interviews_limit;

alter table public.area_allocations
  drop constraint if exists area_allocations_room_availability_id_period_excl;

create index area_allocations_active_availability_period_idx
  on public.area_allocations using gist (room_availability_id, period)
  where status = 'active';

create or replace function private.max_allocation_concurrency(
  p_availability_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns integer
language sql
stable
set search_path = ''
as $$
  with events as (
    select
      greatest(allocation.starts_at, p_starts_at) as event_at,
      1::integer as delta
    from public.area_allocations allocation
    where allocation.room_availability_id = p_availability_id
      and allocation.status = 'active'
      and allocation.starts_at < p_ends_at
      and allocation.ends_at > p_starts_at

    union all

    select
      least(allocation.ends_at, p_ends_at) as event_at,
      (-1)::integer as delta
    from public.area_allocations allocation
    where allocation.room_availability_id = p_availability_id
      and allocation.status = 'active'
      and allocation.starts_at < p_ends_at
      and allocation.ends_at > p_starts_at
  ), grouped_events as (
    select event_at, pg_catalog.sum(delta)::integer as delta
    from events
    group by event_at
  ), usage_points as (
    select pg_catalog.sum(delta) over (
      order by event_at
      rows between unbounded preceding and current row
    )::integer as concurrent_count
    from grouped_events
  )
  select coalesce(pg_catalog.max(concurrent_count), 0)::integer
  from usage_points;
$$;

create or replace function private.validate_room_availability_capacity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_physical_limit integer;
  v_room_active boolean;
begin
  select room.max_simultaneous_interviews_limit, room.active
    into v_physical_limit, v_room_active
  from public.rooms room
  where room.id = new.room_id;

  if v_room_active is distinct from true then
    raise exception 'ROOM_NOT_ACTIVE';
  end if;

  if v_physical_limit is not null
     and new.max_simultaneous_interviews > v_physical_limit then
    raise exception 'ROOM_PHYSICAL_LIMIT_EXCEEDED:%', v_physical_limit;
  end if;

  return new;
end;
$$;

create trigger room_availabilities_validate_capacity
before insert or update of room_id, max_simultaneous_interviews
on public.room_availabilities
for each row execute function private.validate_room_availability_capacity();

create or replace function private.validate_room_physical_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_highest_window_capacity integer;
begin
  if new.max_simultaneous_interviews_limit is null then
    return new;
  end if;

  select pg_catalog.max(availability.max_simultaneous_interviews)::integer
    into v_highest_window_capacity
  from public.room_availabilities availability
  where availability.room_id = new.id
    and availability.status = 'active';

  if coalesce(v_highest_window_capacity, 0)
     > new.max_simultaneous_interviews_limit then
    raise exception 'ROOM_LIMIT_BELOW_ACTIVE_WINDOW_CAPACITY:%', v_highest_window_capacity;
  end if;

  return new;
end;
$$;

create trigger rooms_validate_physical_limit
before update of max_simultaneous_interviews_limit
on public.rooms
for each row execute function private.validate_room_physical_limit();

revoke all on function public.create_room_availability(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
drop function public.create_room_availability(uuid, timestamptz, timestamptz);

create function public.create_room_availability(
  p_room_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_max_simultaneous_interviews integer,
  p_area_note text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  if p_max_simultaneous_interviews is null
     or p_max_simultaneous_interviews not between 1 and 100 then
    raise exception 'INVALID_ROOM_CAPACITY';
  end if;

  insert into public.room_availabilities (
    room_id,
    starts_at,
    ends_at,
    max_simultaneous_interviews,
    area_note,
    created_by
  ) values (
    p_room_id,
    p_starts_at,
    p_ends_at,
    p_max_simultaneous_interviews,
    trim(coalesce(p_area_note, '')),
    auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(), 'staff', 'availability.created', 'room_availability', v_id,
    pg_catalog.jsonb_build_object(
      'room_id', p_room_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'max_simultaneous_interviews', p_max_simultaneous_interviews,
      'area_note', trim(coalesce(p_area_note, ''))
    )
  );

  return v_id;
end;
$$;

create or replace function public.update_room_availability(
  p_availability_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_max_simultaneous_interviews integer,
  p_area_note text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current public.room_availabilities%rowtype;
  v_existing_peak integer;
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  if p_max_simultaneous_interviews is null
     or p_max_simultaneous_interviews not between 1 and 100 then
    raise exception 'INVALID_ROOM_CAPACITY';
  end if;

  select availability.*
    into v_current
  from public.room_availabilities availability
  where availability.id = p_availability_id
  for update;

  if v_current.id is null or v_current.status <> 'active' then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  if exists (
    select 1
    from public.area_allocations allocation
    where allocation.room_availability_id = p_availability_id
      and allocation.status = 'active'
      and (
        allocation.starts_at < p_starts_at
        or allocation.ends_at > p_ends_at
      )
  ) then
    raise exception 'AVAILABILITY_TIME_EXCLUDES_ALLOCATIONS';
  end if;

  v_existing_peak := private.max_allocation_concurrency(
    p_availability_id,
    p_starts_at,
    p_ends_at
  );

  if p_max_simultaneous_interviews < v_existing_peak then
    raise exception 'ROOM_CAPACITY_BELOW_USAGE:%', v_existing_peak;
  end if;

  update public.room_availabilities
  set starts_at = p_starts_at,
      ends_at = p_ends_at,
      max_simultaneous_interviews = p_max_simultaneous_interviews,
      area_note = trim(coalesce(p_area_note, ''))
  where id = p_availability_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    before_value, after_value
  ) values (
    auth.uid(), 'staff', 'availability.updated', 'room_availability',
    p_availability_id,
    pg_catalog.jsonb_build_object(
      'starts_at', v_current.starts_at,
      'ends_at', v_current.ends_at,
      'max_simultaneous_interviews', v_current.max_simultaneous_interviews,
      'area_note', v_current.area_note
    ),
    pg_catalog.jsonb_build_object(
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'max_simultaneous_interviews', p_max_simultaneous_interviews,
      'area_note', trim(coalesce(p_area_note, ''))
    )
  );
end;
$$;

create or replace function public.claim_room_allocation(
  p_availability_id uuid,
  p_campaign_area_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_area_id uuid;
  v_campaign_id uuid;
  v_availability_starts_at timestamptz;
  v_availability_ends_at timestamptz;
  v_availability_status public.availability_status;
  v_capacity integer;
  v_existing_peak integer;
begin
  if not private.can_manage_campaign_area(p_campaign_area_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  -- Serializes every claim for the same window. The capacity check and insert
  -- therefore execute atomically even when multiple area leads claim at once.
  select
    availability.starts_at,
    availability.ends_at,
    availability.status,
    availability.max_simultaneous_interviews
  into
    v_availability_starts_at,
    v_availability_ends_at,
    v_availability_status,
    v_capacity
  from public.room_availabilities availability
  where availability.id = p_availability_id
  for update;

  if v_availability_status is null or v_availability_status <> 'active' then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  if p_starts_at < v_availability_starts_at
     or p_ends_at > v_availability_ends_at then
    raise exception 'ALLOCATION_OUTSIDE_AVAILABILITY';
  end if;

  v_existing_peak := private.max_allocation_concurrency(
    p_availability_id,
    p_starts_at,
    p_ends_at
  );

  if v_existing_peak + 1 > v_capacity then
    raise exception 'ROOM_CAPACITY_EXCEEDED';
  end if;

  insert into public.area_allocations (
    room_availability_id,
    campaign_area_id,
    starts_at,
    ends_at,
    created_by
  ) values (
    p_availability_id,
    p_campaign_area_id,
    p_starts_at,
    p_ends_at,
    auth.uid()
  ) returning id into v_id;

  select campaign_area.area_id, campaign_area.campaign_id
    into v_area_id, v_campaign_id
  from public.campaign_areas campaign_area
  where campaign_area.id = p_campaign_area_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'allocation.claimed', 'area_allocation', v_id,
    v_campaign_id, v_area_id,
    pg_catalog.jsonb_build_object(
      'availability_id', p_availability_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'capacity', v_capacity
    )
  );

  return v_id;
end;
$$;

revoke all on function public.list_room_availabilities()
  from public, anon, authenticated;
drop function public.list_room_availabilities();

create function public.list_room_availabilities()
returns table (
  id uuid,
  room_id uuid,
  room_name text,
  room_physical_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.availability_status,
  max_simultaneous_interviews integer,
  simultaneous_usage integer,
  area_note text,
  booked_interviews integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    availability.id,
    availability.room_id,
    room.name::text,
    room.max_simultaneous_interviews_limit,
    availability.starts_at,
    availability.ends_at,
    availability.status,
    availability.max_simultaneous_interviews,
    private.max_allocation_concurrency(
      availability.id,
      availability.starts_at,
      availability.ends_at
    ),
    availability.area_note,
    case when private.is_admin() then (
      select pg_catalog.count(*)::integer
      from public.area_allocations allocation
      join public.interview_sessions session_record
        on session_record.allocation_id = allocation.id
      join public.slots slot_record on slot_record.session_id = session_record.id
      join public.bookings booking on booking.slot_id = slot_record.id
      where allocation.room_availability_id = availability.id
        and booking.status = 'confirmed'
    ) else 0 end
  from public.room_availabilities availability
  join public.rooms room on room.id = availability.room_id
  where availability.ends_at >= pg_catalog.now() - interval '30 days'
    and (private.is_admin() or availability.status = 'active')
  order by availability.starts_at;
$$;

create or replace function public.get_room_availability_interval_usage(
  p_availability_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status public.availability_status;
  v_usage integer;
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  select
    availability.max_simultaneous_interviews,
    availability.starts_at,
    availability.ends_at,
    availability.status
  into v_capacity, v_starts_at, v_ends_at, v_status
  from public.room_availabilities availability
  where availability.id = p_availability_id;

  if v_status is null or v_status <> 'active' then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  if p_starts_at is null or p_ends_at is null
     or p_ends_at <= p_starts_at
     or p_starts_at < v_starts_at
     or p_ends_at > v_ends_at then
    raise exception 'ALLOCATION_OUTSIDE_AVAILABILITY';
  end if;

  v_usage := private.max_allocation_concurrency(
    p_availability_id,
    p_starts_at,
    p_ends_at
  );

  return pg_catalog.jsonb_build_object(
    'usage', v_usage,
    'capacity', v_capacity,
    'remaining', greatest(0, v_capacity - v_usage),
    'complete', v_usage >= v_capacity
  );
end;
$$;

revoke all on function private.max_allocation_concurrency(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
revoke all on function public.create_room_availability(uuid, timestamptz, timestamptz, integer, text)
  from public, anon;
revoke all on function public.update_room_availability(uuid, timestamptz, timestamptz, integer, text)
  from public, anon;
revoke all on function public.claim_room_allocation(uuid, uuid, timestamptz, timestamptz)
  from public, anon;
revoke all on function public.list_room_availabilities()
  from public, anon;
revoke all on function public.get_room_availability_interval_usage(uuid, timestamptz, timestamptz)
  from public, anon;

grant execute on function public.create_room_availability(uuid, timestamptz, timestamptz, integer, text)
  to authenticated;
grant execute on function public.update_room_availability(uuid, timestamptz, timestamptz, integer, text)
  to authenticated;
grant execute on function public.claim_room_allocation(uuid, uuid, timestamptz, timestamptz)
  to authenticated;
grant execute on function public.list_room_availabilities()
  to authenticated;
grant execute on function public.get_room_availability_interval_usage(uuid, timestamptz, timestamptz)
  to authenticated;

commit;
