begin;

-- Area public booking: one link exposes every currently bookable slot
-- belonging to the area, across every active campaign, every published
-- session, every day and every room.
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

  /*
   * IMPORTANT:
   * Do not scope this query to a single session, date or room.
   * The area link is the aggregation key. Every eligible slot is returned,
   * ordered chronologically; the room is part of each slot so the candidate
   * can distinguish parallel rooms on the same date/time.
   */
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
    and session_record.status = 'published'
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

revoke all on function public.get_public_booking_availability(text)
  from public, anon, authenticated;
grant execute on function public.get_public_booking_availability(text)
  to service_role;

commit;
