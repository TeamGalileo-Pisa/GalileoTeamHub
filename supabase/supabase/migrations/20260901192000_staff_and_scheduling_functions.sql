begin;

create or replace function private.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_username text;
  v_display_name text;
begin
  v_username := lower(coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'username'), ''),
    split_part(new.email, '@', 1)
  ));
  v_display_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    v_username
  );

  insert into public.profiles (id, username, display_name)
  values (new.id, v_username, v_display_name)
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.handle_new_auth_user();

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

create trigger area_allocations_validate_period
before insert or update of room_availability_id, campaign_area_id, starts_at, ends_at
on public.area_allocations
for each row execute function private.validate_allocation_period();

create or replace function private.validate_slot_period()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_allocation_period tstzrange;
  v_allocation_status public.allocation_status;
begin
  select allocation.period, allocation.status
    into v_allocation_period, v_allocation_status
  from public.interview_sessions session_record
  join public.area_allocations allocation
    on allocation.id = session_record.allocation_id
  where session_record.id = new.session_id;

  if v_allocation_period is null or v_allocation_status <> 'active' then
    raise exception 'ALLOCATION_NOT_ACTIVE';
  end if;

  if not (tstzrange(new.starts_at, new.ends_at, '[)') <@ v_allocation_period) then
    raise exception 'SLOT_OUTSIDE_ALLOCATION';
  end if;

  return new;
end;
$$;

create trigger slots_validate_period
before insert or update of session_id, starts_at, ends_at
on public.slots
for each row execute function private.validate_slot_period();

create or replace function public.activate_campaign(p_campaign_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
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

create or replace function public.create_room_availability(
  p_room_id uuid,
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
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if p_ends_at <= p_starts_at then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  insert into public.room_availabilities (
    room_id, starts_at, ends_at, created_by
  ) values (
    p_room_id, p_starts_at, p_ends_at, auth.uid()
  ) returning id into v_id;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(), 'staff', 'availability.created', 'room_availability', v_id,
    jsonb_build_object(
      'room_id', p_room_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at
    )
  );

  return v_id;
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
begin
  if not private.can_manage_campaign_area(p_campaign_area_id) then
    raise exception 'FORBIDDEN';
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
    jsonb_build_object(
      'availability_id', p_availability_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at
    )
  );

  return v_id;
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
  if not private.can_manage_allocation(p_allocation_id) then
    raise exception 'FORBIDDEN';
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
  if not private.can_manage_session(p_session_id) then
    raise exception 'FORBIDDEN';
  end if;

  if p_duration_minutes < 5 or p_duration_minutes > 180 then
    raise exception 'INVALID_SLOT_DURATION';
  end if;

  if exists (
    select 1 from public.slots
    where session_id = p_session_id and status = 'available'
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
    and session_record.status <> 'cancelled'
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

create or replace function public.get_dashboard_metrics()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with visible_sessions as (
    select session_record.id, campaign_area.area_id
    from public.interview_sessions session_record
    join public.area_allocations allocation
      on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area
      on campaign_area.id = allocation.campaign_area_id
    where private.is_admin()
       or campaign_area.area_id in (select private.user_area_ids())
  ),
  visible_slots as (
    select slot_record.*
    from public.slots slot_record
    join visible_sessions visible_session
      on visible_session.id = slot_record.session_id
    where slot_record.status = 'available'
  ),
  visible_bookings as (
    select booking.*, slot_record.starts_at
    from public.bookings booking
    join visible_slots slot_record on slot_record.id = booking.slot_id
    where booking.status = 'confirmed'
  )
  select jsonb_build_object(
    'interviews_today', (
      select count(*) from visible_bookings
      where (starts_at at time zone 'Europe/Rome')::date
        = (now() at time zone 'Europe/Rome')::date
    ),
    'interviews_this_week', (
      select count(*) from visible_bookings
      where date_trunc('week', starts_at at time zone 'Europe/Rome')
        = date_trunc('week', now() at time zone 'Europe/Rome')
    ),
    'available_slots', (
      select count(*)
      from visible_slots slot_record
      where slot_record.starts_at > now()
        and not exists (
          select 1 from public.bookings booking
          where booking.slot_id = slot_record.id
            and booking.status = 'confirmed'
        )
    ),
    'booked_slots', (select count(*) from visible_bookings),
    'active_areas', (
      case when private.is_admin()
        then (select count(*) from public.areas where active)
        else (select count(*) from private.user_area_ids())
      end
    )
  );
$$;

create or replace function public.list_upcoming_interviews(p_limit integer default 12)
returns table (
  booking_id uuid,
  candidate_name text,
  candidate_email text,
  area_name text,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    booking.id,
    candidate.first_name || ' ' || candidate.last_name,
    candidate.email::text,
    area_record.name::text,
    room.name::text,
    slot_record.starts_at,
    slot_record.ends_at
  from public.bookings booking
  join public.candidates candidate on candidate.id = booking.candidate_id
  join public.slots slot_record on slot_record.id = booking.slot_id
  join public.interview_sessions session_record on session_record.id = slot_record.session_id
  join public.area_allocations allocation on allocation.id = session_record.allocation_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where booking.status = 'confirmed'
    and slot_record.starts_at >= now()
    and (
      private.is_admin()
      or campaign_area.area_id in (select private.user_area_ids())
    )
  order by slot_record.starts_at
  limit greatest(1, least(coalesce(p_limit, 12), 100));
$$;

create or replace function public.list_room_availabilities()
returns table (
  id uuid,
  room_id uuid,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.availability_status,
  booked_interviews integer
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
    availability.starts_at,
    availability.ends_at,
    availability.status,
    case when private.is_admin() then (
      select count(*)::integer
      from public.area_allocations allocation
      join public.interview_sessions session_record on session_record.allocation_id = allocation.id
      join public.slots slot_record on slot_record.session_id = session_record.id
      join public.bookings booking on booking.slot_id = slot_record.id
      where allocation.room_availability_id = availability.id
        and booking.status = 'confirmed'
    ) else 0 end
  from public.room_availabilities availability
  join public.rooms room on room.id = availability.room_id
  where availability.ends_at >= now() - interval '30 days'
    and (private.is_admin() or availability.status = 'active')
  order by availability.starts_at;
$$;

create or replace function public.list_my_campaign_areas()
returns table (
  id uuid,
  campaign_name text,
  area_id uuid,
  area_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    campaign_area.id,
    campaign.name,
    area_record.id,
    area_record.name::text
  from public.campaign_areas campaign_area
  join public.recruitment_campaigns campaign on campaign.id = campaign_area.campaign_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  where campaign_area.active
    and campaign.status = 'active'
    and (
      private.is_admin()
      or campaign_area.area_id in (select private.user_area_ids())
    )
  order by campaign.created_at desc, area_record.name;
$$;

create or replace function public.list_my_allocations()
returns table (
  id uuid,
  campaign_area_id uuid,
  area_name text,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    allocation.id,
    allocation.campaign_area_id,
    area_record.name::text,
    room.name::text,
    allocation.starts_at,
    allocation.ends_at
  from public.area_allocations allocation
  join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
  join public.areas area_record on area_record.id = campaign_area.area_id
  join public.room_availabilities availability on availability.id = allocation.room_availability_id
  join public.rooms room on room.id = availability.room_id
  where allocation.status = 'active'
    and not exists (
      select 1 from public.interview_sessions session_record
      where session_record.allocation_id = allocation.id
    )
    and (
      private.is_admin()
      or campaign_area.area_id in (select private.user_area_ids())
    )
  order by allocation.starts_at;
$$;

create or replace function public.list_interview_sessions()
returns table (
  id uuid,
  name text,
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
      select 1 from public.booking_links link_record
      where link_record.session_id = session_record.id
        and link_record.status = 'active'
        and (link_record.expires_at is null or link_record.expires_at > now())
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

create or replace function public.list_staff_members()
returns table (
  id uuid,
  username text,
  display_name text,
  status public.profile_status,
  is_admin boolean,
  areas jsonb
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  return query
  select
    profile.id,
    profile.username::text,
    profile.display_name,
    profile.status,
    exists (
      select 1 from public.system_roles role_assignment
      where role_assignment.user_id = profile.id
        and role_assignment.role = 'admin'
    ),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', area_record.id,
          'name', area_record.name::text,
          'slug', area_record.slug::text
        ) order by area_record.name
      )
      from public.area_memberships membership
      join public.areas area_record on area_record.id = membership.area_id
      where membership.user_id = profile.id
        and membership.ended_at is null
    ), '[]'::jsonb)
  from public.profiles profile
  order by profile.display_name;
end;
$$;

create or replace function public.complete_password_change()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'UNAUTHORIZED';
  end if;

  update public.profiles
  set must_change_password = false
  where id = auth.uid();

  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;
end;
$$;

revoke all on function public.activate_campaign(uuid) from public, anon;
revoke all on function public.create_room_availability(uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.cancel_room_availability(uuid) from public, anon;
revoke all on function public.claim_room_allocation(uuid, uuid, timestamptz, timestamptz) from public, anon;
revoke all on function public.create_interview_session(uuid, text) from public, anon;
revoke all on function public.generate_session_slots(uuid, integer) from public, anon;
revoke all on function public.get_dashboard_metrics() from public, anon;
revoke all on function public.list_upcoming_interviews(integer) from public, anon;
revoke all on function public.list_room_availabilities() from public, anon;
revoke all on function public.list_my_campaign_areas() from public, anon;
revoke all on function public.list_my_allocations() from public, anon;
revoke all on function public.list_interview_sessions() from public, anon;
revoke all on function public.list_staff_members() from public, anon;
revoke all on function public.complete_password_change() from public, anon;

grant execute on function public.activate_campaign(uuid) to authenticated;
grant execute on function public.create_room_availability(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.cancel_room_availability(uuid) to authenticated;
grant execute on function public.claim_room_allocation(uuid, uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.create_interview_session(uuid, text) to authenticated;
grant execute on function public.generate_session_slots(uuid, integer) to authenticated;
grant execute on function public.get_dashboard_metrics() to authenticated;
grant execute on function public.list_upcoming_interviews(integer) to authenticated;
grant execute on function public.list_room_availabilities() to authenticated;
grant execute on function public.list_my_campaign_areas() to authenticated;
grant execute on function public.list_my_allocations() to authenticated;
grant execute on function public.list_interview_sessions() to authenticated;
grant execute on function public.list_staff_members() to authenticated;
grant execute on function public.complete_password_change() to authenticated;

commit;
