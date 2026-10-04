begin;

create or replace function private.guard_profile_deletion()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);

  -- Current role/membership rows are account configuration, not historical
  -- evidence. Historical (ended) memberships and audit rows still block
  -- permanent deletion.
  if private.has_references(
       'public.profiles',
       old.id,
       array['public.system_roles','system_roles','private.staff_operations','public.area_memberships']
     )
     or exists(
       select 1 from public.area_memberships
       where user_id=old.id and ended_at is not null
     )
     or exists(
       select 1 from public.audit_logs
       where actor_user_id=old.id or (entity_type='profile' and entity_id=old.id)
     )
  then
    raise exception 'HAS_HISTORY';
  end if;

  if exists(
    select 1 from public.system_roles
    where user_id=old.id and role in ('admin','team_leader')
  )
  and not exists(
    select 1
    from public.profiles p
    join public.system_roles r on r.user_id=p.id
    where p.id<>old.id
      and p.status='active'
      and r.role in ('admin','team_leader')
  ) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;

  return old;
end;
$$;

create or replace function public.check_staff_deletion(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if private.has_references(
       'public.profiles',
       p_id,
       array['public.system_roles','system_roles','private.staff_operations','public.area_memberships']
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

create or replace function public.prepare_staff_deletion(p_id uuid)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  perform public.check_staff_deletion(p_id);

  -- Remove only current account configuration. Historical memberships are
  -- blocked above and therefore remain immutable.
  delete from public.area_memberships
  where user_id=p_id and ended_at is null;

  delete from public.system_roles
  where user_id=p_id;
end;
$$;

revoke all on function public.prepare_staff_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_staff_deletion(uuid) to service_role;

commit;
