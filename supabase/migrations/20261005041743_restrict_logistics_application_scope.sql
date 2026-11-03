create or replace function public.list_my_open_application_areas()
returns table(area_id uuid, area_name text)
language sql stable security definer set search_path=''
as $$
  select a.id, a.name::text
  from public.areas a
  join public.application_areas c on c.area_id=a.id and c.is_open
  join public.application_settings s on s.id=true and s.is_open
  where a.active and exists(
    select 1 from public.profiles p where p.id=auth.uid()
      and p.status='active' and not p.must_change_password
  ) and (
    private.is_admin()
    or exists(select 1 from public.area_memberships m
      where m.user_id=auth.uid() and m.area_id=a.id and m.role='area_lead'
        and m.ended_at is null)
  )
  order by a.name;
$$;
