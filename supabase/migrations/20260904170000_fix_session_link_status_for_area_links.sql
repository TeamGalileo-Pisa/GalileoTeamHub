begin;

-- The public URL is owned by the area, not by an individual session.
-- Keep that area link active while other sessions remain open, but report
-- the per-session link state correctly in the staff session list.
create or replace function public.list_interview_sessions()
returns table(
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
    s.id,
    s.name,
    ca.area_id,
    ar.name::text,
    r.name::text,
    a.starts_at,
    a.ends_at,
    s.status,
    (
      select count(*)::integer
      from public.slots sl
      where sl.session_id = s.id
        and sl.deleted_at is null
        and sl.status = 'available'
        and not exists (
          select 1
          from public.bookings b
          where b.slot_id = sl.id
            and b.status = 'confirmed'
        )
    ),
    (
      select count(*)::integer
      from public.slots sl
      join public.bookings b on b.slot_id = sl.id
      where sl.session_id = s.id
        and sl.deleted_at is null
        and b.status = 'confirmed'
    ),
    (
      s.status in ('draft', 'published')
      and exists (
        select 1
        from public.area_booking_links abl
        where abl.area_id = ca.area_id
          and abl.status = 'active'
      )
    )
  from public.interview_sessions s
  join public.area_allocations a on a.id = s.allocation_id
  join public.room_availabilities ra on ra.id = a.room_availability_id
  join public.rooms r on r.id = ra.room_id
  join public.campaign_areas ca on ca.id = a.campaign_area_id
  join public.areas ar on ar.id = ca.area_id
  where s.deleted_at is null
    and ra.deleted_at is null
    and r.deleted_at is null
    and (
      private.is_admin()
      or ca.area_id in (select private.user_area_ids())
    )
  order by a.starts_at desc;
$$;

commit;
