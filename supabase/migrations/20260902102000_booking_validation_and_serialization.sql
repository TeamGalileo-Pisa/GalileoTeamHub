begin;

-- A short transaction-wide scheduling mutex serializes destructive scheduling
-- operations with public booking. No network request is made under this lock.

create or replace function public.activate_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  insert into public.campaign_areas (campaign_id, area_id)
  select p_campaign_id, area_record.id
  from public.areas area_record
  where area_record.active
  on conflict (campaign_id, area_id)
  do update set active = true;

  update public.recruitment_campaigns
  set status = 'active'
  where id = p_campaign_id;

  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, campaign_id,
    after_value
  ) values (
    auth.uid(), 'staff', 'campaign.activated', 'recruitment_campaign',
    p_campaign_id, p_campaign_id, jsonb_build_object('status', 'active')
  );
end;
$$;

create or replace function public.cancel_room_availability(p_availability_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_booking_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  select count(*)::integer
    into v_booking_count
  from public.area_allocations allocation
  join public.interview_sessions session_record
    on session_record.allocation_id = allocation.id
  join public.slots slot_record
    on slot_record.session_id = session_record.id
  join public.bookings booking
    on booking.slot_id = slot_record.id
   and booking.status = 'confirmed'
  where allocation.room_availability_id = p_availability_id;

  if v_booking_count > 0 then
    raise exception 'AVAILABILITY_HAS_BOOKINGS:%', v_booking_count;
  end if;

  update public.booking_links link_record
  set status = 'revoked', revoked_at = now()
  where link_record.status = 'active'
    and link_record.session_id in (
      select session_record.id
      from public.interview_sessions session_record
      join public.area_allocations allocation
        on allocation.id = session_record.allocation_id
      where allocation.room_availability_id = p_availability_id
    );

  update public.slots slot_record
  set status = 'disabled'
  where slot_record.session_id in (
    select session_record.id
    from public.interview_sessions session_record
    join public.area_allocations allocation
      on allocation.id = session_record.allocation_id
    where allocation.room_availability_id = p_availability_id
  );

  update public.interview_sessions session_record
  set status = 'cancelled'
  where session_record.allocation_id in (
    select allocation.id
    from public.area_allocations allocation
    where allocation.room_availability_id = p_availability_id
  );

  update public.area_allocations
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
  where room_availability_id = p_availability_id
    and status = 'active';

  update public.room_availabilities
  set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
  where id = p_availability_id
    and status = 'active';

  if not found then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(), 'staff', 'availability.cancelled', 'room_availability',
    p_availability_id, jsonb_build_object('status', 'cancelled')
  );
end;
$$;

create or replace function public.create_interview_session(
  p_allocation_id uuid,
  p_name text
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
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.can_manage_allocation(p_allocation_id) then
    raise exception 'FORBIDDEN';
  end if;

  if not exists(select 1 from public.area_allocations a
    join public.room_availabilities ra on ra.id=a.room_availability_id
    join public.campaign_areas ca on ca.id=a.campaign_area_id
    join public.recruitment_campaigns c on c.id=ca.campaign_id
    join public.areas ar on ar.id=ca.area_id
    where a.id=p_allocation_id and a.status='active' and ra.status='active'
      and ca.active and ar.active and c.status='active') then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  insert into public.interview_sessions (allocation_id, name, created_by)
  values (p_allocation_id, trim(p_name), auth.uid())
  returning id into v_id;

  select campaign_area.area_id, campaign_area.campaign_id
    into v_area_id, v_campaign_id
  from public.area_allocations allocation
  join public.campaign_areas campaign_area
    on campaign_area.id = allocation.campaign_area_id
  where allocation.id = p_allocation_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'session.created', 'interview_session', v_id,
    v_campaign_id, v_area_id,
    jsonb_build_object('allocation_id', p_allocation_id, 'name', trim(p_name))
  );

  return v_id;
end;
$$;

create or replace function public.generate_session_slots(
  p_session_id uuid,
  p_duration_minutes integer
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_cursor timestamptz;
  v_next timestamptz;
  v_count integer := 0;
  v_area_id uuid;
  v_campaign_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 180 then
    raise exception 'INVALID_SLOT_DURATION';
  end if;

  if exists (
    select 1 from public.slots
    where session_id = p_session_id
  ) then
    raise exception 'SESSION_ALREADY_HAS_SLOTS';
  end if;

  select allocation.starts_at, allocation.ends_at,
         campaign_area.area_id, campaign_area.campaign_id
    into v_starts_at, v_ends_at, v_area_id, v_campaign_id
  from public.interview_sessions session_record
  join public.area_allocations allocation
    on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area
    on campaign_area.id = allocation.campaign_area_id
  where session_record.id = p_session_id
    and session_record.status in ('draft', 'published')
    and allocation.status = 'active';

  if v_starts_at is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  v_cursor := v_starts_at;
  loop
    v_next := v_cursor + make_interval(mins => p_duration_minutes);
    exit when v_next > v_ends_at;

    insert into public.slots (session_id, starts_at, ends_at)
    values (p_session_id, v_cursor, v_next);
    v_count := v_count + 1;
    v_cursor := v_next;
  end loop;

  if v_count = 0 then
    raise exception 'ALLOCATION_TOO_SHORT';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'slots.generated', 'interview_session', p_session_id,
    v_campaign_id, v_area_id,
    jsonb_build_object('duration_minutes', p_duration_minutes, 'count', v_count)
  );

  return v_count;
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
  perform pg_catalog.pg_advisory_xact_lock(706202602);
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
  perform pg_catalog.pg_advisory_xact_lock(706202602);
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

  if (v_current.series_id is not null or
      (v_current.starts_at at time zone 'Europe/Rome')::date=(v_current.ends_at at time zone 'Europe/Rome')::date)
    and (p_starts_at at time zone 'Europe/Rome')::date<>(p_ends_at at time zone 'Europe/Rome')::date then
    raise exception 'INVALID_DAILY_PERIOD';
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

create or replace function public.rotate_booking_link(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_id uuid := extensions.gen_random_uuid();
  v_secret text := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at timestamptz;
  v_area_id uuid;
  v_campaign_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN';
  end if;

  select allocation.ends_at, campaign_area.area_id, campaign_area.campaign_id
    into v_expires_at, v_area_id, v_campaign_id
  from public.interview_sessions session_record
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  where session_record.id = p_session_id
    and session_record.status in ('draft', 'published')
    and allocation.status = 'active'
    and campaign_area.active
    and exists(select 1 from public.areas ar where ar.id=campaign_area.area_id and ar.active)
    and exists(select 1 from public.recruitment_campaigns c where c.id=campaign_area.campaign_id and c.status='active');

  if v_expires_at is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  update public.booking_links
  set status = 'revoked', revoked_at = pg_catalog.now()
  where session_id = p_session_id
    and status = 'active';

  insert into public.booking_links (
    session_id, public_id, secret_hash, expires_at, created_by
  ) values (
    p_session_id,
    v_public_id,
    extensions.digest(v_secret, 'sha256'),
    v_expires_at,
    auth.uid()
  );

  update public.interview_sessions
  set status = 'published'
  where id = p_session_id and status = 'draft';

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'booking_link.rotated', 'interview_session',
    p_session_id, v_campaign_id, v_area_id,
    pg_catalog.jsonb_build_object(
      'public_id', v_public_id,
      'expires_at', v_expires_at
    )
  );

  return v_public_id::text || '.' || v_secret;
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
    and slot_record.starts_at > pg_catalog.now()
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

create or replace function public.cancel_booking(p_booking_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_area_id uuid;
  v_campaign_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select session_record.id, campaign_area.area_id, campaign_area.campaign_id
    into v_session_id, v_area_id, v_campaign_id
  from public.bookings booking
  join public.slots slot_record on slot_record.id = booking.slot_id
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  where booking.id = p_booking_id
    and booking.status = 'confirmed';

  if v_session_id is null or not private.can_manage_session(v_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid()
  where id = p_booking_id and status = 'confirmed';

  insert into public.email_deliveries (
    booking_id, kind, idempotency_key
  ) values (
    p_booking_id,
    'booking_cancelled',
    p_booking_id::text || ':booking_cancelled:' || gen_random_uuid()::text
  );

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'booking.cancelled', 'booking', p_booking_id,
    v_campaign_id, v_area_id, jsonb_build_object('status', 'cancelled')
  );
end;
$$;

create or replace function public.move_booking(
  p_booking_id uuid,
  p_new_slot_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_session_id uuid;
  v_new_session_id uuid;
  v_old_slot_id uuid;
  v_old_area_id uuid;
  v_new_area_id uuid;
  v_campaign_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select booking.slot_id, session_record.id, campaign_area.area_id,
         campaign_area.campaign_id
    into v_old_slot_id, v_old_session_id, v_old_area_id, v_campaign_id
  from public.bookings booking
  join public.slots slot_record on slot_record.id = booking.slot_id
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  where booking.id = p_booking_id
    and booking.status = 'confirmed';

  select session_record.id, campaign_area.area_id
    into v_new_session_id, v_new_area_id
  from public.slots slot_record
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  where slot_record.id = p_new_slot_id
    and slot_record.status = 'available'
    and slot_record.starts_at > now()
    and session_record.status in ('draft','published')
    and allocation.status='active' and campaign_area.active
    and campaign_area.campaign_id=v_campaign_id
    and exists(select 1 from public.recruitment_campaigns c where c.id=v_campaign_id and c.status='active')
    and exists(select 1 from public.areas a where a.id=campaign_area.area_id and a.active);

  if v_old_session_id is null or v_new_session_id is null
     or not private.can_manage_session(v_old_session_id)
     or not private.can_manage_session(v_new_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  if not private.is_admin() and v_old_area_id <> v_new_area_id then
    raise exception 'AREA_LEAD_CANNOT_MOVE_ACROSS_AREAS';
  end if;

  if v_old_slot_id=p_new_slot_id then return; end if;

  begin
    update public.bookings
    set slot_id = p_new_slot_id
    where id = p_booking_id and status = 'confirmed';
  exception when unique_violation then
    raise exception 'SLOT_UNAVAILABLE';
  end;

  insert into public.email_deliveries (
    booking_id, kind, idempotency_key
  ) values (
    p_booking_id,
    'booking_changed',
    p_booking_id::text || ':booking_changed:' || gen_random_uuid()::text
  );

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, before_value, after_value
  ) values (
    auth.uid(), 'staff', 'booking.moved', 'booking', p_booking_id,
    v_campaign_id, v_new_area_id,
    jsonb_build_object('slot_id', v_old_slot_id),
    jsonb_build_object('slot_id', p_new_slot_id)
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
    and slot_record.starts_at > pg_catalog.now()
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
create or replace function public.list_room_availabilities()
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
  booked_interviews integer,
  series_id uuid
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
    ) else 0 end,
    availability.series_id
  from public.room_availabilities availability
  join public.rooms room on room.id = availability.room_id
  where private.staff_ready() and availability.ends_at >= pg_catalog.now() - interval '30 days'
    and (private.is_admin() or availability.status = 'active')
  order by availability.starts_at;
$$;
revoke all on function public.list_room_availabilities() from public,anon;
grant execute on function public.list_room_availabilities() to authenticated;

create or replace function private.validate_allocation_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_availability_period tstzrange;
  v_availability_status public.availability_status;
  v_campaign_active boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select availability.period, availability.status
    into v_availability_period, v_availability_status
  from public.room_availabilities availability
  where availability.id = new.room_availability_id;

  if v_availability_period is null or v_availability_status <> 'active' then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  if not (tstzrange(new.starts_at, new.ends_at, '[)') <@ v_availability_period) then
    raise exception 'ALLOCATION_OUTSIDE_AVAILABILITY';
  end if;

  select campaign_area.active and campaign.status = 'active'
    and exists(select 1 from public.areas ar where ar.id=campaign_area.area_id and ar.active)
    and (campaign.starts_on is null or (new.starts_at at time zone 'Europe/Rome')::date>=campaign.starts_on)
    and (campaign.ends_on is null or (new.ends_at at time zone 'Europe/Rome')::date<=campaign.ends_on)
    into v_campaign_active
  from public.campaign_areas campaign_area
  join public.recruitment_campaigns campaign
    on campaign.id = campaign_area.campaign_id
  where campaign_area.id = new.campaign_area_id;

  if not coalesce(v_campaign_active, false) then
    raise exception 'CAMPAIGN_AREA_NOT_ACTIVE';
  end if;

  return new;
end;
$$;

commit;
