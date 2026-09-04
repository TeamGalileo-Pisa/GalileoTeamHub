begin;

-- Public booking URLs are stable, human-readable and owned by the area.
-- The existing area_booking_links row remains the durable record; only its
-- public token changes from the old random value to `area-<area.slug>`.
-- Existing links therefore keep their public_id and history, while all new
-- links use the same deterministic URL.

update public.area_booking_links link
set token = 'area-' || area.slug::text,
    secret_hash = extensions.digest('area-' || area.slug::text, 'sha256')
from public.areas area
where area.id = link.area_id;

create or replace function public.get_area_booking_link(p_area_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_token text;
  v_area_slug text;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.can_manage_area(p_area_id) then
    raise exception 'FORBIDDEN';
  end if;

  select area.slug::text
    into v_area_slug
  from public.areas area
  where area.id = p_area_id
    and area.active;

  if v_area_slug is null then
    raise exception 'AREA_NOT_ACTIVE';
  end if;

  v_token := 'area-' || v_area_slug;

  select id into v_id
  from public.area_booking_links
  where area_id = p_area_id
  for update;

  if v_id is null then
    insert into public.area_booking_links (
      area_id, public_id, token, secret_hash, status, created_by
    ) values (
      p_area_id,
      extensions.gen_random_uuid(),
      v_token,
      extensions.digest(v_token, 'sha256'),
      'active',
      auth.uid()
    );
  else
    update public.area_booking_links
    set token = v_token,
        secret_hash = extensions.digest(v_token, 'sha256'),
        status = 'active',
        revoked_at = null
    where id = v_id;
  end if;

  return v_token;
end;
$$;

revoke all on function public.get_area_booking_link(uuid) from public, anon;
grant execute on function public.get_area_booking_link(uuid) to authenticated;

commit;
