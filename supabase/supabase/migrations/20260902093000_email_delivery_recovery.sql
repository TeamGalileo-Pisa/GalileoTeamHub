begin;

-- A delivery can remain in "sending" if an Edge Function stops after Gmail
-- accepts the message but before the database acknowledgement. Reclaiming
-- stale rows makes retries possible; the Gmail sender checks Message-ID before
-- sending again, so this does not create duplicate messages.
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
  set status = 'sending',
      attempt_count = delivery.attempt_count + 1,
      last_error = null
  where delivery.id = p_delivery_id
    and (
      (
        delivery.status in ('pending', 'failed')
        and delivery.next_attempt_at <= pg_catalog.now()
      )
      or (
        delivery.status = 'sending'
        and delivery.updated_at <= pg_catalog.now() - interval '10 minutes'
      )
    );

  if not found then
    return null;
  end if;

  select pg_catalog.jsonb_build_object(
    'delivery_id', delivery.id,
    'kind', delivery.kind,
    'to_email', candidate.email::text,
    'candidate_name', candidate.first_name || ' ' || candidate.last_name,
    'area_name', area_record.name::text,
    'room_name', room.name::text,
    'starts_at', slot_record.starts_at,
    'ends_at', slot_record.ends_at
  )
  into v_payload
  from public.email_deliveries delivery
  join public.bookings booking on booking.id = delivery.booking_id
  join public.candidates candidate on candidate.id = booking.candidate_id
  join public.slots slot_record on slot_record.id = booking.slot_id
  join public.interview_sessions session_record
    on session_record.id = slot_record.session_id
  join public.area_allocations allocation
    on allocation.id = session_record.allocation_id
  join public.room_availabilities availability
    on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  join public.campaign_areas campaign_area
    on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where delivery.id = p_delivery_id;

  return v_payload;
end;
$$;

revoke all on function public.claim_email_delivery(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_email_delivery(uuid) to service_role;

commit;
