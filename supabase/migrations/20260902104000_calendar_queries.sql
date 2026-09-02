begin;
create function public.list_calendar_bookings(p_start timestamptz,p_end timestamptz,p_area_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  if not private.staff_ready() then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '367 days' then raise exception 'INVALID_TIME_RANGE'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('bookingId',b.id,'candidateName',c.first_name||' '||c.last_name,
    'candidateEmail',c.email::text,'areaName',ar.name::text,'areaId',ar.id,'roomName',r.name::text,
    'startsAt',sl.starts_at,'endsAt',sl.ends_at,'status',b.status,'campaignId',ca.campaign_id) order by sl.starts_at),'[]'::jsonb)
    into v_result
  from public.bookings b join public.candidates c on c.id=b.candidate_id join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id join public.area_allocations a on a.id=s.allocation_id
    join public.room_availabilities ra on ra.id=a.room_availability_id join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=a.campaign_area_id join public.areas ar on ar.id=ca.area_id
  where sl.starts_at<p_end and sl.ends_at>p_start and (p_area_id is null or ar.id=p_area_id) and private.can_manage_session(s.id);
  return v_result;
end;
$$;
create function public.list_booking_destinations(p_booking_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_campaign uuid; v_area uuid; v_result jsonb;
begin
  select ca.campaign_id,ca.area_id into v_campaign,v_area from public.bookings b join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id join public.area_allocations a on a.id=s.allocation_id
    join public.campaign_areas ca on ca.id=a.campaign_area_id
    where b.id=p_booking_id and b.status='confirmed' and private.can_manage_session(s.id);
  if v_campaign is null then raise exception 'FORBIDDEN'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',sl.id,'startsAt',sl.starts_at,'endsAt',sl.ends_at,'roomName',r.name::text,'areaName',ar.name::text) order by sl.starts_at),'[]'::jsonb)
    into v_result from public.slots sl join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations a on a.id=s.allocation_id join public.room_availabilities ra on ra.id=a.room_availability_id
    join public.rooms r on r.id=ra.room_id join public.campaign_areas ca on ca.id=a.campaign_area_id
    join public.recruitment_campaigns campaign on campaign.id=ca.campaign_id join public.areas ar on ar.id=ca.area_id
    where ca.campaign_id=v_campaign and (private.is_admin() or ca.area_id=v_area) and private.can_manage_session(s.id)
    and s.status in ('draft','published') and a.status='active' and ra.status='active' and campaign.status='active' and ca.active and ar.active
    and sl.status='available' and sl.starts_at>now() and not exists(select 1 from public.bookings where slot_id=sl.id and status='confirmed');
  return v_result;
end;
$$;
revoke all on function public.list_calendar_bookings(timestamptz,timestamptz,uuid),public.list_booking_destinations(uuid) from public,anon;
grant execute on function public.list_calendar_bookings(timestamptz,timestamptz,uuid),public.list_booking_destinations(uuid) to authenticated;
commit;
