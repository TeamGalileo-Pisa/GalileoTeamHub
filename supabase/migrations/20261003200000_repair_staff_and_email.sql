begin;
create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path='' as $$
 select private.staff_ready() and exists(select 1 from public.system_roles
 where user_id=auth.uid() and role in ('admin','team_leader'));
$$;
-- Service-only preparation checks history but does not mutate roles. The
-- auth.users deletion and profile trigger perform cleanup in one transaction.
create or replace function public.prepare_staff_deletion(p_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(706202601);
 perform public.check_staff_deletion(p_id);
end;
$$;
revoke all on function public.prepare_staff_deletion(uuid) from public,anon,authenticated;
grant execute on function public.prepare_staff_deletion(uuid) to service_role;
create or replace function private.guard_profile_deletion()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(706202601);
 perform public.check_staff_deletion(old.id);
 delete from public.area_memberships where user_id=old.id and ended_at is null;
 return old;
end;
$$;
create or replace function public.claim_email_delivery(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.email_deliveries%rowtype;
begin
  update public.email_deliveries set send_uncertain=send_uncertain or status='sending',status='sending',attempt_count=attempt_count+1,last_error=null,updated_at=now()
  where id=p_delivery_id and attempt_count<6 and
    ((status in ('pending','failed') and next_attempt_at<=now()) or (status='sending' and updated_at<now()-interval '2 minutes'))
  returning * into d;
  if d.id is null then return null; end if;
  return coalesce(d.payload,private.booking_email_payload(d.booking_id)) || jsonb_build_object(
    'delivery_id',d.id,'kind',d.kind,'attempt_count',d.attempt_count,'reconcile_only',d.send_uncertain,'manage_url',d.metadata->>'manage_url');
end;
$$;

create or replace function public.update_staff_profile_v2(
  p_actor_id uuid,p_id uuid,p_username text,p_display_name text,
  p_role public.app_role,p_area_id uuid,p_status public.profile_status
)
returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.profiles%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if not exists(
    select 1 from public.profiles p
    where p.id=p_actor_id and p.status='active' and not p.must_change_password
      and exists(select 1 from public.system_roles r where r.user_id=p_actor_id and r.role in ('admin','team_leader'))
  ) then raise exception 'FORBIDDEN'; end if;
  if p_role not in ('admin','team_leader','area_lead') then raise exception 'INVALID_STAFF_DATA'; end if;
  select * into strict v_old from public.profiles where id=p_id for update;
  if p_username !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$' then raise exception 'INVALID_STAFF_DATA'; end if;
  if p_role='area_lead' and not exists(
    select 1 from public.areas a where a.id=p_area_id and
      (a.active or exists(select 1 from public.area_memberships m where m.user_id=p_id and m.area_id=a.id and m.ended_at is null))
  ) then raise exception 'INVALID_STAFF_DATA'; end if;
  if exists(select 1 from public.system_roles r where r.user_id=p_id and r.role in ('admin','team_leader'))
     and (p_role='area_lead' or p_status='disabled')
     and not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
                    where p.id<>p_id and p.status='active' and r.role in ('admin','team_leader')) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  update public.profiles set username=trim(p_username),display_name=trim(p_display_name),status=p_status where id=p_id;
  if p_role in ('admin','team_leader') then
    if exists(select 1 from public.system_roles where user_id=p_id and role in ('admin','team_leader')) then
      update public.system_roles set role=p_role,granted_by=p_actor_id where user_id=p_id and role in ('admin','team_leader');
    else
      insert into public.system_roles(user_id,role,granted_by) values(p_id,p_role,p_actor_id);
    end if;
    delete from public.system_roles where user_id=p_id and role not in ('admin','team_leader');
    update public.area_memberships set ended_at=greatest(clock_timestamp(),started_at+interval '1 microsecond')
      where user_id=p_id and ended_at is null;
  else
    delete from public.system_roles where user_id=p_id;
    update public.area_memberships set ended_at=greatest(clock_timestamp(),started_at+interval '1 microsecond')
      where user_id=p_id and ended_at is null and area_id<>p_area_id;
    if not exists(select 1 from public.area_memberships where user_id=p_id and area_id=p_area_id and ended_at is null) then
      insert into public.area_memberships(user_id,area_id,created_by) values(p_id,p_area_id,p_actor_id);
    end if;
  end if;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value)
    values(p_actor_id,'staff','staff.updated','profile',p_id,to_jsonb(v_old),
      jsonb_build_object('username',p_username,'display_name',p_display_name,'status',p_status,'role',p_role,'area_id',p_area_id));
end;
$$;
revoke all on function public.update_staff_profile_v2(uuid,uuid,text,text,public.app_role,uuid,public.profile_status) from public,anon,authenticated;
grant execute on function public.update_staff_profile_v2(uuid,uuid,text,text,public.app_role,uuid,public.profile_status) to service_role;


create or replace function private.protect_last_admin()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_id uuid; v_removes boolean;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202601);
  if tg_table_name='profiles' then
    v_id:=old.id;
    v_removes:=tg_op='DELETE' or (old.status='active' and new.status='disabled');
  else
    v_id:=old.user_id;
    v_removes:=tg_op='DELETE' or new.user_id<>old.user_id or new.role not in ('admin','team_leader');
  end if;
  if v_removes and exists(
    select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id=v_id and p.status='active' and r.role in ('admin','team_leader')
  ) and not exists(
    select 1 from public.profiles p join public.system_roles r on r.user_id=p.id
    where p.id<>v_id and p.status='active' and r.role in ('admin','team_leader')
  ) then
    raise exception 'LAST_ACTIVE_ADMIN';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;


commit;
