-- Budget e Ordini disponibili anche a Capo Business e membri Business.
-- Budget: Team Leader, Capo Business (area_lead) e account condivisi dell'area Business.
-- Ordini: Team Leader, Logistica (capo e membri) e Business (capo e membri).
-- Le policy esistenti usano queste funzioni, quindi non vanno modificate.
begin;

create or replace function private.can_manage_budget()
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r
        where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
          and a.slug='business' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and a.slug='business' and a.active)
    );
$$;

create or replace function private.can_manage_team_orders()
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
          and a.slug in ('logistica','business') and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and a.slug in ('logistica','business') and a.active)
    );
$$;

commit;
