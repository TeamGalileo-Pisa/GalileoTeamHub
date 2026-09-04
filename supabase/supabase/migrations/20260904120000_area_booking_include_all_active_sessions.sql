begin;

-- The area booking link is the publication mechanism for the area's calendar.
-- Therefore every active session of the area (draft or published) contributes
-- its available slots. Closed/cancelled sessions remain hidden.
create or replace function public.get_public_booking_availability(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_area_id uuid;
  v_area_name text;
  v_slots jsonb;
begin
  select link.area_id, area.name::text
    into v_area_id, v_area_name
  from public.area_booking_links link
  join public.areas area on area.id = link.area_id
  where link.token = p_token
    and link.status = 'active'
    and area.active;

  if v_area_id is null then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'id', slot_record.id,
        'starts_at', slot_record.starts_at,
        'ends_at', slot_record.ends_at,
        'room_name', room.name::text
      )
      order by slot_record.starts_at, room.name::text, slot_record.id
    ),
    '[]'::jsonb
  )
  into v_slots
  from public.slots slot_record
  join public.interview_sessions session_record
    on session_record.id = slot_record.session_id
  join public.area_allocations allocation
    on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area
    on campaign_area.id = allocation.campaign_area_id
  join public.recruitment_campaigns campaign
    on campaign.id = campaign_area.campaign_id
  join public.room_availabilities availability
    on availability.id = allocation.room_availability_id
  join public.rooms room
    on room.id = availability.room_id
  where campaign_area.area_id = v_area_id
    and campaign_area.active
    and campaign.status = 'active'
    and session_record.status in ('draft', 'published')
    and allocation.status = 'active'
    and availability.status = 'active'
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
    'session_name', 'Calendario colloqui dell''area',
    'slots', v_slots
  );
end;
$$;

-- A slot selected from an area link may belong to any active session of that
-- area. Draft sessions are intentionally allowed here because the area link
-- itself is the single publication surface for the area's calendar.
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
  v_area_id uuid;
  v_campaign_id uuid;
  v_area_name text;
  v_room_name text;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_candidate_id uuid;
  v_booking_id uuid;
  v_delivery_id uuid;
  v_is_area_link boolean := false;
  v_public_id uuid;
  v_secret text;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if pg_catalog.char_length(trim(coalesce(p_first_name, ''))) not between 2 and 80
     or pg_catalog.char_length(trim(coalesce(p_last_name, ''))) not between 2 and 80 then
    raise exception 'INVALID_CANDIDATE_NAME';
  end if;

  if pg_catalog.char_length(trim(coalesce(p_email, ''))) > 254
     or pg_catalog.lower(trim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_EMAIL';
  end if;

  select area_booking.area_id
    into v_area_id
  from public.area_booking_links area_booking
  join public.areas area on area.id = area_booking.area_id
  where area_booking.token = p_token
    and area_booking.status = 'active'
    and area.active;

  if v_area_id is not null then
    v_is_area_link := true;
  else
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

    select campaign_area.area_id, campaign_area.campaign_id, area_record.name::text
      into v_area_id, v_campaign_id, v_area_name
    from public.booking_links link_record
    join public.interview_sessions session_record
      on session_record.id = link_record.session_id
    join public.area_allocations allocation
      on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area
      on campaign_area.id = allocation.campaign_area_id
    join public.areas area_record
      on area_record.id = campaign_area.area_id
    where link_record.public_id = v_public_id
      and link_record.secret_hash = extensions.digest(v_secret, 'sha256')
      and link_record.status = 'active'
      and (link_record.expires_at is null or link_record.expires_at > pg_catalog.now())
      and session_record.status = 'published'
      and allocation.status = 'active';

    if v_area_id is null then
      raise exception 'INVALID_BOOKING_LINK';
    end if;
  end if;

  select campaign_area.campaign_id,
         area_record.name::text,
         slot_record.starts_at,
         slot_record.ends_at,
         room.name::text
    into v_campaign_id, v_area_name, v_starts_at, v_ends_at, v_room_name
  from public.slots slot_record
  join public.interview_sessions session_record
    on session_record.id = slot_record.session_id
  join public.area_allocations allocation
    on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area
    on campaign_area.id = allocation.campaign_area_id
  join public.recruitment_campaigns campaign
    on campaign.id = campaign_area.campaign_id
  join public.areas area_record
    on area_record.id = campaign_area.area_id
  join public.room_availabilities availability
    on availability.id = allocation.room_availability_id
  join public.rooms room
    on room.id = availability.room_id
  where slot_record.id = p_slot_id
    and campaign_area.area_id = v_area_id
    and slot_record.status = 'available'
    and slot_record.starts_at > pg_catalog.now()
    and session_record.status in ('draft', 'published')
    and allocation.status = 'active'
    and campaign_area.active
    and campaign.status = 'active'
    and availability.status = 'active'
    and (
      v_is_area_link
      or exists (
        select 1
        from public.booking_links link_record
        join public.interview_sessions linked_session
          on linked_session.id = link_record.session_id
        where link_record.public_id = v_public_id
          and linked_session.id = session_record.id
      )
    )
  for update of slot_record;

  if v_starts_at is null then
    raise exception 'SLOT_UNAVAILABLE';
  end if;

  insert into public.candidates (
    campaign_id, first_name, last_name, email
  ) values (
    v_campaign_id, trim(p_first_name), trim(p_last_name), pg_catalog.lower(trim(p_email))
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

revoke all on function public.get_public_booking_availability(text)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_availability(text)
  to service_role;

revoke all on function public.book_public_slot(text, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.book_public_slot(text, uuid, text, text, text)
  to service_role;

commit;
