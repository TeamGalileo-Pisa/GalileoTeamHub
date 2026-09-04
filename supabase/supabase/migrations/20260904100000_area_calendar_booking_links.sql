begin;

-- One persistent public booking link per area.
-- It aggregates every published session/slot belonging to that area.
create table if not exists public.area_booking_links (
  id uuid primary key default extensions.gen_random_uuid(),
  area_id uuid not null unique references public.areas(id) on delete restrict,
  public_id uuid not null unique default extensions.gen_random_uuid(),
  token text not null unique,
  secret_hash bytea not null,
  status public.booking_link_status not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.now(),
  revoked_at timestamptz,
  constraint area_booking_links_secret_hash_length check (octet_length(secret_hash) = 32),
  constraint area_booking_links_revoked_fields check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);

create index if not exists area_booking_links_area_idx
  on public.area_booking_links(area_id)
  where status = 'active';

create or replace function public.get_area_booking_link(p_area_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
  v_public_id uuid;
  v_secret text;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.can_manage_area(p_area_id) then
    raise exception 'FORBIDDEN';
  end if;

  select id, token
    into v_id, v_token
  from public.area_booking_links
  where area_id = p_area_id;

  if v_id is not null and exists (
    select 1 from public.area_booking_links
    where id = v_id and status = 'active'
  ) then
    return v_token;
  end if;

  v_public_id := extensions.gen_random_uuid();
  v_secret := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_token := v_public_id::text || '.' || v_secret;

  if v_id is null then
    insert into public.area_booking_links (
      area_id, public_id, token, secret_hash, created_by
    ) values (
      p_area_id, v_public_id, v_token,
      extensions.digest(v_secret, 'sha256'), auth.uid()
    );
  else
    update public.area_booking_links
    set public_id = v_public_id,
        token = v_token,
        secret_hash = extensions.digest(v_secret, 'sha256'),
        status = 'active',
        revoked_at = null,
        created_by = auth.uid(),
        created_at = pg_catalog.now()
    where id = v_id;
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    area_id, after_value
  ) values (
    auth.uid(), 'staff', 'area_booking_link.created', 'area_booking_link',
    v_public_id, p_area_id,
    pg_catalog.jsonb_build_object('public_id', v_public_id)
  );

  return v_token;
end;
$$;

create or replace function public.revoke_area_booking_link(p_area_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.can_manage_area(p_area_id) then
    raise exception 'FORBIDDEN';
  end if;

  update public.area_booking_links
  set status = 'revoked', revoked_at = pg_catalog.now()
  where area_id = p_area_id
    and status = 'active';

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    area_id, after_value
  ) values (
    auth.uid(), 'staff', 'area_booking_link.revoked', 'area_booking_link',
    null, p_area_id, '{}'::jsonb
  );
end;
$$;

-- The public availability endpoint now treats the area link as the source
-- of truth and aggregates slots from every published session in that area.
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
  v_public_id uuid;
  v_secret text;
  v_session_id uuid;
  v_session_name text;
begin
  -- New persistent area link.
  if pg_catalog.char_length(coalesce(p_token, '')) <= 220 then
    select link.area_id, area.name::text
      into v_area_id, v_area_name
    from public.area_booking_links link
    join public.areas area on area.id = link.area_id
    where link.token = p_token
      and link.status = 'active'
      and area.active;
  end if;

  if v_area_id is not null then
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
    join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
    join public.recruitment_campaigns campaign on campaign.id = campaign_area.campaign_id
    join public.room_availabilities availability on availability.id = allocation.room_availability_id
    join public.rooms room on room.id = availability.room_id
    where campaign_area.area_id = v_area_id
      and session_record.status = 'published'
      and allocation.status = 'active'
      and campaign_area.active
      and campaign.status = 'active'
      and availability.status = 'active'
      and slot_record.status = 'available'
      and slot_record.starts_at > pg_catalog.now()
      and not exists (
        select 1 from public.bookings booking
        where booking.slot_id = slot_record.id
          and booking.status = 'confirmed'
      );

    return pg_catalog.jsonb_build_object(
      'area_name', v_area_name,
      'session_name', 'Calendario colloqui',
      'slots', v_slots
    );
  end if;

  -- Legacy session link compatibility.
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
    and allocation.status = 'active';

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

-- Replace the public booking function so a slot selected through an area
-- link can belong to any active campaign/session of that area.
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
    -- Legacy session-link path.
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
    join public.interview_sessions session_record on session_record.id = link_record.session_id
    join public.area_allocations allocation on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
    join public.areas area_record on area_record.id = campaign_area.area_id
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
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.recruitment_campaigns campaign on campaign.id = campaign_area.campaign_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  where slot_record.id = p_slot_id
    and campaign_area.area_id = v_area_id
    and slot_record.status = 'available'
    and slot_record.starts_at > pg_catalog.now()
    and session_record.status = 'published'
    and allocation.status = 'active'
    and campaign_area.active
    and campaign.status = 'active'
    and availability.status = 'active'
    and (
      v_is_area_link
      or exists (
        select 1
        from public.booking_links link_record
        join public.interview_sessions linked_session on linked_session.id = link_record.session_id
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

revoke all on table public.area_booking_links from public, anon, authenticated;
revoke all on function public.get_area_booking_link(uuid) from public, anon;
revoke all on function public.revoke_area_booking_link(uuid) from public, anon;
revoke all on function public.get_public_booking_availability(text) from public, anon, authenticated;
revoke all on function public.book_public_slot(text, uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.get_area_booking_link(uuid) to authenticated;
grant execute on function public.revoke_area_booking_link(uuid) to authenticated;
grant execute on function public.get_public_booking_availability(text) to service_role;
grant execute on function public.book_public_slot(text, uuid, text, text, text) to service_role;

commit;


drop function if exists public.list_interview_sessions();

create or replace function public.list_interview_sessions()
returns table (
  id uuid,
  name text,
  area_id uuid,
  area_name text,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.session_status,
  available_slots integer,
  booked_slots integer,
  booking_link_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    session_record.id,
    session_record.name,
    campaign_area.area_id,
    area_record.name::text,
    room.name::text,
    allocation.starts_at,
    allocation.ends_at,
    session_record.status,
    (
      select count(*)::integer
      from public.slots slot_record
      where slot_record.session_id = session_record.id
        and slot_record.status = 'available'
        and not exists (
          select 1 from public.bookings booking
          where booking.slot_id = slot_record.id
            and booking.status = 'confirmed'
        )
    ),
    (
      select count(*)::integer
      from public.slots slot_record
      join public.bookings booking on booking.slot_id = slot_record.id
      where slot_record.session_id = session_record.id
        and booking.status = 'confirmed'
    ),
    exists (
      select 1 from public.area_booking_links area_link
      where area_link.area_id = campaign_area.area_id
        and area_link.status = 'active'
    )
  from public.interview_sessions session_record
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where private.is_admin()
     or campaign_area.area_id in (select private.user_area_ids())
  order by allocation.starts_at desc;
$$;

revoke all on function public.list_interview_sessions() from public, anon;
grant execute on function public.list_interview_sessions() to authenticated;
