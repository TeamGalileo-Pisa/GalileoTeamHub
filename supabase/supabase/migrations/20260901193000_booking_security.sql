begin;

create or replace function public.rotate_booking_link(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_public_id uuid := gen_random_uuid();
  v_secret text := encode(gen_random_bytes(32), 'hex');
  v_expires_at timestamptz;
  v_area_id uuid;
  v_campaign_id uuid;
begin
  if not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN';
  end if;

  select allocation.ends_at, campaign_area.area_id, campaign_area.campaign_id
    into v_expires_at, v_area_id, v_campaign_id
  from public.interview_sessions session_record
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  where session_record.id = p_session_id
    and session_record.status <> 'cancelled'
    and allocation.status = 'active';

  if v_expires_at is null then
    raise exception 'SESSION_NOT_ACTIVE';
  end if;

  update public.booking_links
  set status = 'revoked', revoked_at = now()
  where session_id = p_session_id
    and status = 'active';

  insert into public.booking_links (
    session_id, public_id, secret_hash, expires_at, created_by
  ) values (
    p_session_id,
    v_public_id,
    digest(v_secret, 'sha256'),
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
    jsonb_build_object('public_id', v_public_id, 'expires_at', v_expires_at)
  );

  return v_public_id::text || '.' || v_secret;
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
  if char_length(coalesce(p_token, '')) > 140
     or split_part(p_token, '.', 3) <> '' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  begin
    v_public_id := split_part(p_token, '.', 1)::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_BOOKING_LINK';
  end;

  v_secret := split_part(p_token, '.', 2);
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
    and link_record.secret_hash = digest(v_secret, 'sha256')
    and link_record.status = 'active'
    and (link_record.expires_at is null or link_record.expires_at > now())
    and session_record.status = 'published'
    and allocation.status = 'active';

  if v_session_id is null then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
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
    and slot_record.starts_at > now()
    and not exists (
      select 1
      from public.bookings booking
      where booking.slot_id = slot_record.id
        and booking.status = 'confirmed'
    );

  return jsonb_build_object(
    'area_name', v_area_name,
    'session_name', v_session_name,
    'slots', v_slots
  );
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
  if char_length(coalesce(p_token, '')) > 140
     or split_part(p_token, '.', 3) <> '' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  begin
    v_public_id := split_part(p_token, '.', 1)::uuid;
  exception when invalid_text_representation then
    raise exception 'INVALID_BOOKING_LINK';
  end;

  v_secret := split_part(p_token, '.', 2);
  if v_secret !~ '^[0-9a-f]{64}$' then
    raise exception 'INVALID_BOOKING_LINK';
  end if;

  if char_length(trim(coalesce(p_first_name, ''))) not between 2 and 80
     or char_length(trim(coalesce(p_last_name, ''))) not between 2 and 80 then
    raise exception 'INVALID_CANDIDATE_NAME';
  end if;

  if char_length(trim(coalesce(p_email, ''))) > 254
     or lower(trim(p_email)) !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'INVALID_EMAIL';
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
    and link_record.secret_hash = digest(v_secret, 'sha256')
    and link_record.status = 'active'
    and (link_record.expires_at is null or link_record.expires_at > now())
    and session_record.status = 'published'
    and allocation.status = 'active';

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
    and slot_record.starts_at > now()
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
    lower(trim(p_email))
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
    jsonb_build_object('slot_id', p_slot_id)
  );

  return jsonb_build_object(
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
    p_booking_id::text || ':booking_cancelled:' || extract(epoch from now())::bigint::text
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
    and slot_record.starts_at > now();

  if v_old_session_id is null or v_new_session_id is null
     or not private.can_manage_session(v_old_session_id)
     or not private.can_manage_session(v_new_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  if not private.is_admin() and v_old_area_id <> v_new_area_id then
    raise exception 'AREA_LEAD_CANNOT_MOVE_ACROSS_AREAS';
  end if;

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
    p_booking_id::text || ':booking_changed:' || extract(epoch from now())::bigint::text
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

revoke all on function public.rotate_booking_link(uuid) from public, anon;
revoke all on function public.get_public_booking_availability(text) from public, anon, authenticated;
revoke all on function public.book_public_slot(text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.cancel_booking(uuid) from public, anon;
revoke all on function public.move_booking(uuid, uuid) from public, anon;

grant execute on function public.rotate_booking_link(uuid) to authenticated;
grant execute on function public.get_public_booking_availability(text) to service_role;
grant execute on function public.book_public_slot(text, uuid, text, text, text) to service_role;
grant execute on function public.cancel_booking(uuid) to authenticated;
grant execute on function public.move_booking(uuid, uuid) to authenticated;

commit;
