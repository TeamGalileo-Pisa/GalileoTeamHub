begin;
create table private.staff_operations(user_id uuid primary key references public.profiles(id) on delete cascade,token uuid not null,expires_at timestamptz not null);
revoke all on private.staff_operations from public,anon,authenticated,service_role;
create function public.acquire_staff_operation(p_actor uuid,p_user uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_token uuid;
begin
  if not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id=p_actor and p.status='active' and not p.must_change_password) then raise exception 'FORBIDDEN'; end if;
  insert into private.staff_operations(user_id,token,expires_at) values(p_user,gen_random_uuid(),now()+interval '2 minutes')
    on conflict(user_id) do update set token=excluded.token,expires_at=excluded.expires_at where staff_operations.expires_at<now()
    returning token into v_token;
  if v_token is null then raise exception 'ACCOUNT_BUSY'; end if;
  return v_token;
end;
$$;
create function public.release_staff_operation(p_user uuid,p_token uuid)
returns void language sql security definer set search_path = '' as $$
  delete from private.staff_operations where user_id=p_user and token=p_token;
$$;
-- The transient operation lease is not historical data.
create or replace function private.guard_profile_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if private.has_references('public.profiles',old.id,array['public.system_roles','system_roles','private.staff_operations'])
    or exists(select 1 from public.audit_logs where actor_user_id=old.id or (entity_type='profile' and entity_id=old.id)) then raise exception 'HAS_HISTORY'; end if;
  if exists(select 1 from public.system_roles where user_id=old.id) and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id<>old.id and p.status='active') then raise exception 'LAST_ACTIVE_ADMIN'; end if;
  return old;
end;
$$;
create function public.check_staff_deletion(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if private.has_references('public.profiles',p_id,array['public.system_roles','system_roles','private.staff_operations'])
    or exists(select 1 from public.audit_logs where actor_user_id=p_id or (entity_type='profile' and entity_id=p_id)) then raise exception 'HAS_HISTORY'; end if;
  if exists(select 1 from public.system_roles where user_id=p_id) and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id<>p_id and p.status='active') then raise exception 'LAST_ACTIVE_ADMIN'; end if;
end;
$$;
revoke all on function public.acquire_staff_operation(uuid,uuid),public.release_staff_operation(uuid,uuid),public.check_staff_deletion(uuid) from public,anon,authenticated;
grant execute on function public.acquire_staff_operation(uuid,uuid),public.release_staff_operation(uuid,uuid),public.check_staff_deletion(uuid) to service_role;
commit;
