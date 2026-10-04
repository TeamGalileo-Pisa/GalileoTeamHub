begin;
grant select(id,kind,recipient,state,attempts,last_error,created_at) on public.community_outbox to authenticated;
create policy community_mail_admin on public.community_outbox for select to authenticated using(private.is_admin());
grant all on public.application_settings,public.application_areas,public.applications,public.membership_invitations,public.membership_submissions,public.area_shared_accounts,public.community_outbox,public.push_devices,public.push_jobs to service_role;
create or replace function public.check_staff_deletion(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if private.has_references(
       'public.profiles',
       p_id,
       array['public.system_roles','system_roles','private.staff_operations','public.area_memberships','public.area_shared_accounts','public.push_devices']
     )
     or exists(
       select 1 from public.area_memberships
       where user_id=p_id and ended_at is not null
     )
     or exists(
       select 1 from public.audit_logs
       where actor_user_id=p_id or (entity_type='profile' and entity_id=p_id)
     )
  then
    raise exception 'HAS_HISTORY';
  end if;

  if exists(
    select 1 from public.system_roles
    where user_id=p_id and role in ('admin','team_leader')
  )
  and not exists(
    select 1
    from public.profiles p
    join public.system_roles r on r.user_id=p.id
    where p.id<>p_id
      and p.status='active'
      and r.role in ('admin','team_leader')
  ) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
end;
$$;


do $repair$ begin
if to_regprocedure('public.list_room_availabilities()') is null then
execute $definition$create or replace function public.list_room_availabilities()
returns table (
  id uuid,
  room_id uuid,
  room_name text,
  room_physical_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.availability_status,
  max_simultaneous_interviews integer,
  simultaneous_usage integer,
  area_note text,
  booked_interviews integer,
  series_id uuid
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
    room.max_simultaneous_interviews_limit,
    availability.starts_at,
    availability.ends_at,
    availability.status,
    availability.max_simultaneous_interviews,
    private.max_allocation_concurrency(
      availability.id,
      availability.starts_at,
      availability.ends_at
    ),
    availability.area_note,
    case when private.is_admin() then (
      select pg_catalog.count(*)::integer
      from public.area_allocations allocation
      join public.interview_sessions session_record
        on session_record.allocation_id = allocation.id
      join public.slots slot_record on slot_record.session_id = session_record.id
      join public.bookings booking on booking.slot_id = slot_record.id
      where allocation.room_availability_id = availability.id
        and booking.status = 'confirmed'
    ) else 0 end,
    availability.series_id
  from public.room_availabilities availability
  join public.rooms room on room.id = availability.room_id
  where private.staff_ready() and availability.ends_at >= pg_catalog.now() - interval '30 days'
    and (private.is_admin() or availability.status = 'active')
      and (to_jsonb(availability)->>'deleted_at') is null
  order by availability.starts_at;
$$;$definition$;
end if;
end $repair$;
revoke all on function public.list_room_availabilities() from public,anon;
grant execute on function public.list_room_availabilities() to authenticated;
commit;
