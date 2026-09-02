begin;
create policy announcements_ready on public.announcements as restrictive for select to authenticated using(private.staff_ready());

create or replace function public.list_announcements()
returns table (
  id uuid,
  title text,
  body text,
  all_areas boolean,
  target_area_ids uuid[],
  target_area_names text[],
  published_at timestamptz,
  expires_at timestamptz,
  important boolean,
  pinned boolean,
  is_active boolean,
  is_read boolean,
  read_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    announcement.id,
    announcement.title,
    announcement.body,
    announcement.all_areas,
    coalesce((
      select pg_catalog.array_agg(target.area_id order by area_record.name)
      from public.announcement_targets target
      join public.areas area_record on area_record.id = target.area_id
      where target.announcement_id = announcement.id
    ), array[]::uuid[]),
    coalesce((
      select pg_catalog.array_agg(area_record.name::text order by area_record.name)
      from public.announcement_targets target
      join public.areas area_record on area_record.id = target.area_id
      where target.announcement_id = announcement.id
    ), array[]::text[]),
    announcement.published_at,
    announcement.expires_at,
    announcement.important,
    announcement.pinned,
    announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now()),
    exists (
      select 1
      from public.announcement_reads read_record
      where read_record.announcement_id = announcement.id
        and read_record.area_id in (select private.user_area_ids())
    ),
    (
      select pg_catalog.count(distinct read_record.area_id)::integer
      from public.announcement_reads read_record
      where read_record.announcement_id = announcement.id
    ),
    announcement.created_at
  from public.announcements announcement
  where private.staff_ready() and (private.is_admin()
     or (
       announcement.published_at <= pg_catalog.now()
       and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
       and (
         announcement.all_areas
         or exists (
           select 1
           from public.announcement_targets target
           where target.announcement_id = announcement.id
             and target.area_id in (select private.user_area_ids())
         )
       )
     )
  )
  order by announcement.pinned desc,
           announcement.important desc,
           announcement.published_at desc;
$$;

create or replace function public.get_unread_announcement_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin() or not private.staff_ready() then 0 else (
    select pg_catalog.count(*)::integer
    from public.announcements announcement
    where announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
      and (
        announcement.all_areas
        or exists (
          select 1
          from public.announcement_targets target
          where target.announcement_id = announcement.id
            and target.area_id in (select private.user_area_ids())
        )
      )
      and not exists (
        select 1
        from public.announcement_reads read_record
        where read_record.announcement_id = announcement.id
          and read_record.area_id in (select private.user_area_ids())
      )
  ) end;
$$;

create or replace function public.get_room_availability_interval_usage(
  p_availability_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_capacity integer;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_status public.availability_status;
  v_usage integer;
begin
  if not private.staff_ready() then
    raise exception 'UNAUTHORIZED';
  end if;

  select
    availability.max_simultaneous_interviews,
    availability.starts_at,
    availability.ends_at,
    availability.status
  into v_capacity, v_starts_at, v_ends_at, v_status
  from public.room_availabilities availability
  where availability.id = p_availability_id;

  if v_status is null or v_status <> 'active' then
    raise exception 'AVAILABILITY_NOT_ACTIVE';
  end if;

  if p_starts_at is null or p_ends_at is null
     or p_ends_at <= p_starts_at
     or p_starts_at < v_starts_at
     or p_ends_at > v_ends_at then
    raise exception 'ALLOCATION_OUTSIDE_AVAILABILITY';
  end if;

  v_usage := private.max_allocation_concurrency(
    p_availability_id,
    p_starts_at,
    p_ends_at
  );

  return pg_catalog.jsonb_build_object(
    'usage', v_usage,
    'capacity', v_capacity,
    'remaining', greatest(0, v_capacity - v_usage),
    'complete', v_usage >= v_capacity
  );
end;
$$;
commit;
