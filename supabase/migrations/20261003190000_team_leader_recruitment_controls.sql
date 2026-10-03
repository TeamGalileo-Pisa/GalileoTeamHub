begin;

create or replace function public.list_recruitment_area_controls()
returns table(
  area_id uuid,
  area_name text,
  area_slug text,
  area_active boolean,
  application_open boolean,
  booking_link text,
  active_campaigns integer
)
language sql
stable
security definer
set search_path=''
as $$
  select
    a.id,
    a.name::text,
    a.slug::text,
    a.active,
    exists(
      select 1 from public.area_booking_links l
      where l.area_id=a.id and l.status='active'
    ),
    (
      select l.token
      from public.area_booking_links l
      where l.area_id=a.id and l.status='active'
      limit 1
    ),
    (
      select count(*)::integer
      from public.campaign_areas ca
      join public.recruitment_campaigns c on c.id=ca.campaign_id
      where ca.area_id=a.id and ca.active and c.status='active'
    )
  from public.areas a
  where private.is_admin()
  order by a.name;
$$;

create or replace function public.set_recruitment_area_open(
  p_area_id uuid,
  p_open boolean
)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_token text;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.areas where id=p_area_id and active) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  if p_open then
    v_token := public.get_area_booking_link(p_area_id);
    return v_token;
  end if;

  perform public.revoke_area_booking_link(p_area_id);
  return null;
end;
$$;

revoke all on function public.list_recruitment_area_controls(),public.set_recruitment_area_open(uuid,boolean) from public,anon;
grant execute on function public.list_recruitment_area_controls(),public.set_recruitment_area_open(uuid,boolean) to authenticated;

commit;
