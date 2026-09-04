begin;

create or replace function public.release_area_allocation_interval(
  p_allocation_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
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
  v_left boolean;
  v_right boolean;
  v_new_id uuid;
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

  if p_starts_at >= p_ends_at
     or p_starts_at < v_allocation.starts_at
     or p_ends_at > v_allocation.ends_at then
    raise exception 'RELEASE_INTERVAL_OUTSIDE_ALLOCATION';
  end if;

  select ca.area_id, ca.campaign_id
    into v_area_id, v_campaign_id
  from public.campaign_areas ca
  where ca.id = v_allocation.campaign_area_id;

  v_left := p_starts_at > v_allocation.starts_at;
  v_right := p_ends_at < v_allocation.ends_at;

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
    where sl.session_id = v_session_id
      and sl.starts_at < p_ends_at
      and sl.ends_at > p_starts_at;

    if v_booking_count > 0 then
      raise exception 'ALLOCATION_HAS_BOOKINGS:%', v_booking_count;
    end if;

    -- A session is tied to one allocation, so with an existing session
    -- only a prefix or suffix can be released without splitting the session.
    if v_left and v_right then
      raise exception 'SESSION_PARTIAL_RELEASE_MUST_TOUCH_EDGE';
    end if;

    update public.slots
    set status = 'disabled',
        deleted_at = coalesce(deleted_at, pg_catalog.now()),
        deleted_from_status = coalesce(deleted_from_status, status)
    where session_id = v_session_id
      and starts_at < p_ends_at
      and ends_at > p_starts_at;

    if not v_left and not v_right then
      update public.booking_links
      set status = 'revoked', revoked_at = pg_catalog.now()
      where session_id = v_session_id and status = 'active';

      update public.interview_sessions
      set status = 'cancelled',
          deleted_at = coalesce(deleted_at, pg_catalog.now()),
          deleted_from_status = coalesce(deleted_from_status, status)
      where id = v_session_id;

      update public.area_allocations
      set status = 'cancelled',
          cancelled_by = auth.uid(),
          cancelled_at = pg_catalog.now()
      where id = p_allocation_id;
    elsif not v_left then
      update public.area_allocations
      set starts_at = p_ends_at,
          period = tstzrange(p_ends_at, ends_at, '[)'),
          updated_at = pg_catalog.now()
      where id = p_allocation_id;
    else
      update public.area_allocations
      set ends_at = p_starts_at,
          period = tstzrange(starts_at, p_starts_at, '[)'),
          updated_at = pg_catalog.now()
      where id = p_allocation_id;
    end if;
  else
    if not v_left and not v_right then
      update public.area_allocations
      set status = 'cancelled',
          cancelled_by = auth.uid(),
          cancelled_at = pg_catalog.now()
      where id = p_allocation_id;
    elsif v_left and v_right then
      update public.area_allocations
      set ends_at = p_starts_at,
          period = tstzrange(starts_at, p_starts_at, '[)'),
          updated_at = pg_catalog.now()
      where id = p_allocation_id;

      insert into public.area_allocations (
        room_availability_id, campaign_area_id, starts_at, ends_at,
        period, status, created_by
      ) values (
        v_allocation.room_availability_id, v_allocation.campaign_area_id,
        p_ends_at, v_allocation.ends_at,
        tstzrange(p_ends_at, v_allocation.ends_at, '[)'),
        'active', v_allocation.created_by
      ) returning id into v_new_id;
    elsif v_left then
      update public.area_allocations
      set ends_at = p_starts_at,
          period = tstzrange(starts_at, p_starts_at, '[)'),
          updated_at = pg_catalog.now()
      where id = p_allocation_id;
    else
      update public.area_allocations
      set starts_at = p_ends_at,
          period = tstzrange(p_ends_at, ends_at, '[)'),
          updated_at = pg_catalog.now()
      where id = p_allocation_id;
    end if;
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id,
    campaign_id, area_id, after_value
  ) values (
    auth.uid(), 'staff', 'allocation.interval_released', 'area_allocation', p_allocation_id,
    v_campaign_id, v_area_id,
    pg_catalog.jsonb_build_object(
      'released_starts_at', p_starts_at,
      'released_ends_at', p_ends_at,
      'session_id', v_session_id,
      'split_allocation_id', v_new_id
    )
  );
end;
$$;

revoke all on function public.release_area_allocation_interval(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.release_area_allocation_interval(uuid, timestamptz, timestamptz) to authenticated;

commit;
