begin;

create or replace function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.system_roles role_assignment
    where role_assignment.user_id = (select auth.uid())
      and role_assignment.role = 'admin'
  );
$$;

create or replace function private.user_area_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select membership.area_id
  from public.area_memberships membership
  where membership.user_id = (select auth.uid())
    and membership.role = 'area_lead'
    and membership.ended_at is null;
$$;

create or replace function private.can_manage_area(p_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or p_area_id in (select private.user_area_ids());
$$;

create or replace function private.can_manage_campaign_area(p_campaign_area_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or exists (
      select 1
      from public.campaign_areas campaign_area
      where campaign_area.id = p_campaign_area_id
        and campaign_area.active
        and campaign_area.area_id in (select private.user_area_ids())
    );
$$;

create or replace function private.can_manage_allocation(p_allocation_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or exists (
      select 1
      from public.area_allocations allocation
      join public.campaign_areas campaign_area
        on campaign_area.id = allocation.campaign_area_id
      where allocation.id = p_allocation_id
        and campaign_area.area_id in (select private.user_area_ids())
    );
$$;

create or replace function private.can_manage_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_admin()
    or exists (
      select 1
      from public.interview_sessions session_record
      join public.area_allocations allocation
        on allocation.id = session_record.allocation_id
      join public.campaign_areas campaign_area
        on campaign_area.id = allocation.campaign_area_id
      where session_record.id = p_session_id
        and campaign_area.area_id in (select private.user_area_ids())
    );
$$;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

revoke execute on function private.is_admin() from public, anon;
revoke execute on function private.user_area_ids() from public, anon;
revoke execute on function private.can_manage_area(uuid) from public, anon;
revoke execute on function private.can_manage_campaign_area(uuid) from public, anon;
revoke execute on function private.can_manage_allocation(uuid) from public, anon;
revoke execute on function private.can_manage_session(uuid) from public, anon;

grant execute on function private.is_admin() to authenticated, service_role;
grant execute on function private.user_area_ids() to authenticated, service_role;
grant execute on function private.can_manage_area(uuid) to authenticated, service_role;
grant execute on function private.can_manage_campaign_area(uuid) to authenticated, service_role;
grant execute on function private.can_manage_allocation(uuid) to authenticated, service_role;
grant execute on function private.can_manage_session(uuid) to authenticated, service_role;

alter table public.profiles enable row level security;
alter table public.system_roles enable row level security;
alter table public.areas enable row level security;
alter table public.area_memberships enable row level security;
alter table public.recruitment_campaigns enable row level security;
alter table public.campaign_areas enable row level security;
alter table public.rooms enable row level security;
alter table public.room_availabilities enable row level security;
alter table public.area_allocations enable row level security;
alter table public.interview_sessions enable row level security;
alter table public.booking_links enable row level security;
alter table public.slots enable row level security;
alter table public.candidates enable row level security;
alter table public.bookings enable row level security;
alter table public.email_deliveries enable row level security;
alter table public.audit_logs enable row level security;

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to authenticated, service_role;
grant usage on type
  public.app_role,
  public.profile_status,
  public.area_membership_role,
  public.campaign_status,
  public.availability_status,
  public.allocation_status,
  public.session_status,
  public.booking_link_status,
  public.slot_status,
  public.booking_status,
  public.email_kind,
  public.delivery_status,
  public.audit_actor_type
to authenticated, service_role;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;
create policy profiles_select_own_or_admin
on public.profiles for select to authenticated
using (id = (select auth.uid()) or (select private.is_admin()));
create policy profiles_update_own_display_name
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

grant select on public.system_roles to authenticated;
create policy system_roles_select_own_or_admin
on public.system_roles for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

grant select, insert, update on public.areas to authenticated;
create policy areas_select_staff
on public.areas for select to authenticated using (true);
create policy areas_insert_admin
on public.areas for insert to authenticated
with check ((select private.is_admin()));
create policy areas_update_admin
on public.areas for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

grant select on public.area_memberships to authenticated;
create policy memberships_select_own_or_admin
on public.area_memberships for select to authenticated
using (user_id = (select auth.uid()) or (select private.is_admin()));

grant select, insert, update on public.recruitment_campaigns to authenticated;
create policy campaigns_select_staff
on public.recruitment_campaigns for select to authenticated using (true);
create policy campaigns_insert_admin
on public.recruitment_campaigns for insert to authenticated
with check ((select private.is_admin()));
create policy campaigns_update_admin
on public.recruitment_campaigns for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

grant select on public.campaign_areas to authenticated;
create policy campaign_areas_select_relevant
on public.campaign_areas for select to authenticated
using (
  (select private.is_admin())
  or area_id in (select private.user_area_ids())
);

grant select, insert, update on public.rooms to authenticated;
create policy rooms_select_staff
on public.rooms for select to authenticated using (true);
create policy rooms_insert_admin
on public.rooms for insert to authenticated
with check ((select private.is_admin()));
create policy rooms_update_admin
on public.rooms for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

grant select on public.room_availabilities to authenticated;
create policy room_availabilities_select_staff
on public.room_availabilities for select to authenticated using (true);

grant select on public.area_allocations to authenticated;
create policy allocations_select_relevant
on public.area_allocations for select to authenticated
using ((select private.can_manage_campaign_area(campaign_area_id)));

grant select on public.interview_sessions to authenticated;
create policy sessions_select_relevant
on public.interview_sessions for select to authenticated
using ((select private.can_manage_allocation(allocation_id)));

grant select on public.booking_links to authenticated;
create policy booking_links_select_relevant
on public.booking_links for select to authenticated
using ((select private.can_manage_session(session_id)));

grant select on public.slots to authenticated;
create policy slots_select_relevant
on public.slots for select to authenticated
using ((select private.can_manage_session(session_id)));

grant select on public.candidates to authenticated;
create policy candidates_select_relevant
on public.candidates for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.bookings booking
    join public.slots slot_record on slot_record.id = booking.slot_id
    join public.interview_sessions session_record on session_record.id = slot_record.session_id
    join public.area_allocations allocation on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
    where booking.candidate_id = candidates.id
      and campaign_area.area_id in (select private.user_area_ids())
  )
);

grant select on public.bookings to authenticated;
create policy bookings_select_relevant
on public.bookings for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.slots slot_record
    join public.interview_sessions session_record on session_record.id = slot_record.session_id
    join public.area_allocations allocation on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
    where slot_record.id = bookings.slot_id
      and campaign_area.area_id in (select private.user_area_ids())
  )
);

grant select on public.email_deliveries to authenticated;
create policy email_deliveries_select_relevant
on public.email_deliveries for select to authenticated
using (
  (select private.is_admin())
  or exists (
    select 1
    from public.bookings booking
    join public.slots slot_record on slot_record.id = booking.slot_id
    join public.interview_sessions session_record on session_record.id = slot_record.session_id
    join public.area_allocations allocation on allocation.id = session_record.allocation_id
    join public.campaign_areas campaign_area on campaign_area.id = allocation.campaign_area_id
    where booking.id = email_deliveries.booking_id
      and campaign_area.area_id in (select private.user_area_ids())
  )
);

grant select on public.audit_logs to authenticated;
create policy audit_logs_select_relevant
on public.audit_logs for select to authenticated
using (
  (select private.is_admin())
  or area_id in (select private.user_area_ids())
);

commit;
