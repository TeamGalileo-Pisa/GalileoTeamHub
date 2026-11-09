-- Merchandising: per Business solo il Capo (area_lead), non i membri / account condiviso.
create or replace function private.can_manage_merchandising()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.is_admin()
    or private.is_logistics_staff()
    or (
      auth.uid() is not null
      and exists (select 1 from public.profiles p
        where p.id = auth.uid() and p.status = 'active' and not p.must_change_password)
      and exists (
        select 1 from public.area_memberships m
        join public.areas a on a.id = m.area_id
        where m.user_id = auth.uid() and m.role = 'area_lead' and m.ended_at is null
          and a.slug = 'business' and a.active
      )
    );
$$;
