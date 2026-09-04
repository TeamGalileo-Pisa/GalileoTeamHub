begin;

-- Operational permissions require an enabled account and a changed password.
create or replace function private.staff_ready()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles where id = auth.uid()
    and status = 'active' and not must_change_password
    and (exists(select 1 from public.system_roles where user_id=auth.uid())
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.ended_at is null and a.active)));
$$;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.staff_ready() and exists(select 1 from public.system_roles
    where user_id = auth.uid() and role = 'admin');
$$;
create or replace function private.user_area_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.area_id from public.area_memberships m join public.areas a on a.id=m.area_id
  where m.user_id=auth.uid() and m.ended_at is null and a.active and private.staff_ready();
$$;
revoke all on function private.staff_ready() from public, anon;
grant execute on function private.staff_ready() to authenticated, service_role;

-- Do not let an unchanged initial password be bypassed by calling the RPC.
-- A reset nonce is server-owned app metadata, never user-editable metadata.
create function private.password_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    update public.profiles set must_change_password =
      (new.raw_app_meta_data->>'password_reset_nonce' is distinct from old.raw_app_meta_data->>'password_reset_nonce')
    where id=new.id;
  end if;
  return new;
end;
$$;
create trigger auth_password_changed after update of encrypted_password on auth.users
for each row execute function private.password_changed();
revoke all on function private.password_changed() from public, anon, authenticated;
create or replace function public.complete_password_change()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and status='active' and not must_change_password) then
    raise exception 'PASSWORD_CHANGE_REQUIRED';
  end if;
end;
$$;

-- All last-admin checks take the same transaction lock, including direct service writes.
create function private.protect_last_admin()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_removes boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if tg_table_name='profiles' then
    v_id:=old.id;
    v_removes:=tg_op='DELETE' or (old.status='active' and new.status='disabled');
  else
    v_id:=old.user_id;
    v_removes:=true;
  end if;
  if v_removes and exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id=v_id and p.status='active' and r.role='admin')
    and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
      where p.id<>v_id and p.status='active' and r.role='admin') then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger profiles_last_admin before update of status or delete on public.profiles
for each row execute function private.protect_last_admin();
create trigger roles_last_admin before delete on public.system_roles
for each row execute function private.protect_last_admin();
revoke all on function private.protect_last_admin() from public, anon, authenticated;

create function private.has_references(p_table regclass, p_id uuid, p_ignore text[] default '{}')
returns boolean language plpgsql security definer set search_path = '' as $$
declare r record; v_exists boolean;
begin
  for r in select c.conrelid::regclass as tbl, a.attname as col
    from pg_catalog.pg_constraint c join pg_catalog.pg_attribute a
      on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid=p_table and pg_catalog.cardinality(c.conkey)=1
      and not(c.conrelid::regclass::text=any(p_ignore))
  loop
    execute pg_catalog.format('select exists(select 1 from %s where %I=$1)', r.tbl, r.col) into v_exists using p_id;
    if v_exists then return true; end if;
  end loop;
  return false;
end;
$$;
revoke all on function private.has_references(regclass, uuid, text[]) from public, anon, authenticated;

create function public.manage_area(p_id uuid, p_name text, p_slug text, p_active boolean, p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.areas%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into strict v_old from public.areas where id=p_id for update;
  if p_delete then
    if private.has_references('public.areas',p_id) then raise exception 'HAS_HISTORY'; end if;
    delete from public.areas where id=p_id;
  else
    update public.areas set name=trim(p_name),slug=lower(trim(p_slug)),active=p_active where id=p_id;
  end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value)
    values(auth.uid(),'staff',case when p_delete then 'area.deleted' else 'area.updated' end,'area',p_id,
      to_jsonb(v_old),jsonb_build_object('name',p_name,'slug',p_slug,'active',p_active));
end;
$$;

create function private.validate_campaign_dates()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists(select 1 from public.area_allocations al join public.campaign_areas ca on ca.id=al.campaign_area_id
    where ca.campaign_id=new.id and
      ((al.starts_at at time zone 'Europe/Rome')::date < new.starts_on
       or (al.ends_at at time zone 'Europe/Rome')::date > new.ends_on)) then
    raise exception 'CAMPAIGN_DATES_CONFLICT';
  end if;
  return new;
end;
$$;
create trigger campaign_dates_guard before update of starts_on,ends_on on public.recruitment_campaigns
for each row execute function private.validate_campaign_dates();

create function public.manage_campaign(p_id uuid,p_name text,p_starts_on date,p_ends_on date,p_status public.campaign_status,p_delete boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.recruitment_campaigns%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into strict v_old from public.recruitment_campaigns where id=p_id for update;
  if p_delete then
    if v_old.status<>'draft' or private.has_references('public.recruitment_campaigns',p_id) then raise exception 'HAS_HISTORY'; end if;
    delete from public.recruitment_campaigns where id=p_id;
  else
    update public.recruitment_campaigns set name=trim(p_name),starts_on=p_starts_on,ends_on=p_ends_on,status=p_status where id=p_id;
    if p_status='active' then perform public.activate_campaign(p_id); end if;
    if p_status='archived' then
      update public.booking_links l set status='revoked',revoked_at=now() where l.status='active' and l.session_id in
        (select s.id from public.interview_sessions s join public.area_allocations a on a.id=s.allocation_id
          join public.campaign_areas ca on ca.id=a.campaign_area_id where ca.campaign_id=p_id);
    end if;
  end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value)
    values(auth.uid(),'staff',case when p_delete then 'campaign.deleted' else 'campaign.updated' end,'recruitment_campaign',p_id,
      to_jsonb(v_old),jsonb_build_object('name',p_name,'status',p_status));
end;
$$;
-- Route edits through audited RPCs, not writable tables.
revoke update on public.areas, public.recruitment_campaigns from authenticated;

create function public.update_staff_profile(p_actor_id uuid,p_id uuid,p_username text,p_display_name text,p_is_admin boolean,p_area_id uuid,p_status public.profile_status)
returns void language plpgsql security definer set search_path = '' as $$
declare v_old public.profiles%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id=p_actor_id and p.status='active' and not p.must_change_password) then raise exception 'FORBIDDEN'; end if;
  select * into strict v_old from public.profiles where id=p_id for update;
  if p_username !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$' or p_is_admin is null then raise exception 'INVALID_STAFF_DATA'; end if;
  -- An existing association to an inactive area may be retained while editing or
  -- disabling its account, but no new association may target an inactive area.
  if not p_is_admin and not exists(select 1 from public.areas a where a.id=p_area_id and
    (a.active or exists(select 1 from public.area_memberships m where m.user_id=p_id and m.area_id=a.id and m.ended_at is null)))
    then raise exception 'INVALID_STAFF_DATA'; end if;
  if exists(select 1 from public.system_roles where user_id=p_id) and (not p_is_admin or p_status='disabled') and
    not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id<>p_id and p.status='active') then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  update public.profiles set username=trim(p_username),display_name=trim(p_display_name),status=p_status where id=p_id;
  if p_is_admin then
    insert into public.system_roles(user_id,role,granted_by) values(p_id,'admin',p_actor_id) on conflict do nothing;
  else delete from public.system_roles where user_id=p_id; end if;
  update public.area_memberships set ended_at=greatest(clock_timestamp(),started_at+interval '1 microsecond')
    where user_id=p_id and ended_at is null and (p_is_admin or area_id<>p_area_id);
  if not p_is_admin and not exists(select 1 from public.area_memberships where user_id=p_id and area_id=p_area_id and ended_at is null) then
    insert into public.area_memberships(user_id,area_id,created_by) values(p_id,p_area_id,p_actor_id);
  end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value)
    values(p_actor_id,'staff','staff.updated','profile',p_id,to_jsonb(v_old),
      jsonb_build_object('username',p_username,'display_name',p_display_name,'status',p_status,'is_admin',p_is_admin,'area_id',p_area_id));
end;
$$;

create function private.guard_profile_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if private.has_references('public.profiles',old.id,array['public.system_roles','system_roles'])
    or exists(select 1 from public.audit_logs where actor_user_id=old.id or (entity_type='profile' and entity_id=old.id)) then
    raise exception 'HAS_HISTORY';
  end if;
  if exists(select 1 from public.system_roles where user_id=old.id) and not exists(
    select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id<>old.id and p.status='active') then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  return old;
end;
$$;
create trigger profiles_preserve_history before delete on public.profiles for each row execute function private.guard_profile_deletion();
revoke all on function private.guard_profile_deletion() from public,anon,authenticated;
revoke all on function public.update_staff_profile(uuid,uuid,text,text,boolean,uuid,public.profile_status) from public,anon,authenticated;
grant execute on function public.update_staff_profile(uuid,uuid,text,text,boolean,uuid,public.profile_status) to service_role;
revoke all on function public.manage_area(uuid,text,text,boolean,boolean) from public,anon;
revoke all on function public.manage_campaign(uuid,text,date,date,public.campaign_status,boolean) from public,anon;
grant execute on function public.manage_area(uuid,text,text,boolean,boolean) to authenticated;
grant execute on function public.manage_campaign(uuid,text,date,date,public.campaign_status,boolean) to authenticated;

-- Even generic read policies require enabled staff. Own profile/role reads remain
-- available so the login screen can explain disabled/password-change states.
create policy areas_ready on public.areas as restrictive for select to authenticated using(private.staff_ready());
create policy rooms_ready on public.rooms as restrictive for select to authenticated using(private.staff_ready());
create policy campaigns_ready on public.recruitment_campaigns as restrictive for select to authenticated using(private.staff_ready());
create policy availabilities_ready on public.room_availabilities as restrictive for select to authenticated using(private.staff_ready());
commit;
