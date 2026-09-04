begin;

-- Release an area's allocation without cancelling the shared room availability.
-- This makes the released time/room immediately claimable by other areas.
create or replace function public.release_area_allocation(p_allocation_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_allocation public.area_allocations%rowtype;
  v_area_id uuid;
  v_campaign_id uuid;
  v_session_id uuid;
  v_booking_count integer;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  select * into strict v_allocation
  from public.area_allocations
  where id = p_allocation_id
  for update;

  if not private.can_manage_campaign_area(v_allocation.campaign_area_id) then
    raise exception 'FORBIDDEN';
  end if;

  if v_allocation.status <> 'active' then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  select ca.area_id, ca.campaign_id
    into v_area_id, v_campaign_id
  from public.campaign_areas ca
  where ca.id = v_allocation.campaign_area_id;

  select s.id into v_session_id
  from public.interview_sessions s
  where s.allocation_id = p_allocation_id
    and s.deleted_at is null
  order by s.created_at desc
  limit 1;

  if v_session_id is not null then
    select count(*)::integer into v_booking_count
    from public.slots sl
    join public.bookings b on b.slot_id = sl.id and b.status = 'confirmed'
    where sl.session_id = v_session_id;

    if v_booking_count > 0 then
      raise exception 'ALLOCATION_HAS_BOOKINGS:%', v_booking_count;
    end if;

    update public.booking_links
    set status = 'revoked', revoked_at = pg_catalog.now()
    where session_id = v_session_id and status = 'active';

    update public.slots
    set status = 'disabled',
        deleted_at = coalesce(deleted_at, pg_catalog.now()),
        deleted_from_status = coalesce(deleted_from_status, status)
    where session_id = v_session_id;

    update public.interview_sessions
    set status = 'cancelled',
        deleted_at = coalesce(deleted_at, pg_catalog.now()),
        deleted_from_status = coalesce(deleted_from_status, status)
    where id = v_session_id;
  end if;

  update public.area_allocations
  set status = 'cancelled',
      cancelled_by = auth.uid(),
      cancelled_at = pg_catalog.now()
  where id = p_allocation_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'allocation.released', 'area_allocation', p_allocation_id,
    v_campaign_id, v_area_id,
    pg_catalog.jsonb_build_object('status', 'cancelled', 'session_id', v_session_id)
  );
end;
$$;

revoke all on function public.release_area_allocation(uuid) from public, anon, authenticated;
grant execute on function public.release_area_allocation(uuid) to authenticated;

commit;
