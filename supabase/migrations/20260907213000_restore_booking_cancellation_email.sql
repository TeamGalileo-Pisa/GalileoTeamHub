begin;

-- Reassert the single-booking cancellation path and snapshot the appointment
-- before changing its status. This keeps the candidate notification independent
-- from later lifecycle changes and wakes the existing email worker immediately.
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
  v_email_payload jsonb;
  v_delivery_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select
    s.id,
    ca.area_id,
    ca.campaign_id,
    pg_catalog.jsonb_build_object(
      'to_email', c.email::text,
      'candidate_name', c.first_name || ' ' || c.last_name,
      'area_name', ar.name::text,
      'room_name', r.name::text,
      'starts_at', sl.starts_at,
      'ends_at', sl.ends_at
    )
  into v_session_id, v_area_id, v_campaign_id, v_email_payload
  from public.bookings b
  join public.candidates c on c.id = b.candidate_id
  join public.slots sl on sl.id = b.slot_id
  join public.interview_sessions s on s.id = sl.session_id
  join public.area_allocations al on al.id = s.allocation_id
  join public.room_availabilities ra on ra.id = al.room_availability_id
  join public.rooms r on r.id = ra.room_id
  join public.campaign_areas ca on ca.id = al.campaign_area_id
  join public.areas ar on ar.id = ca.area_id
  where b.id = p_booking_id
    and b.status = 'confirmed'
    and b.archived_at is null
    and sl.archived_at is null
    and s.archived_at is null
    and al.archived_at is null
  for update of b;

  if v_session_id is null or not private.can_manage_session(v_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  update public.bookings
  set status = 'cancelled',
      cancelled_at = pg_catalog.now(),
      cancelled_by = auth.uid()
  where id = p_booking_id
    and status = 'confirmed';

  if not found then
    raise exception 'BOOKING_NOT_CONFIRMED';
  end if;

  insert into public.email_deliveries(
    booking_id,
    kind,
    idempotency_key,
    payload
  ) values (
    p_booking_id,
    'booking_cancelled',
    p_booking_id::text || ':booking_cancelled:' || extensions.gen_random_uuid()::text,
    v_email_payload
  )
  returning id into v_delivery_id;

  insert into public.audit_logs(
    actor_user_id,
    actor_type,
    action,
    entity_type,
    entity_id,
    campaign_id,
    area_id,
    after_value
  ) values (
    auth.uid(),
    'staff',
    'booking.cancelled',
    'booking',
    p_booking_id,
    v_campaign_id,
    v_area_id,
    pg_catalog.jsonb_build_object(
      'status', 'cancelled',
      'email_delivery_id', v_delivery_id
    )
  );

  -- pg_net dispatches after the transaction commits; the minute cron remains
  -- as a fallback/retry mechanism exactly as before.
  perform private.dispatch_email_queue();
end;
$$;

revoke all on function public.cancel_booking(uuid) from public, anon;
grant execute on function public.cancel_booking(uuid) to authenticated;

commit;
