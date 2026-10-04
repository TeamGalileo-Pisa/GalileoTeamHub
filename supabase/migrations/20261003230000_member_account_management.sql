begin;
create or replace function public.update_shared_account(p_actor_id uuid,p_id uuid,p_username text,p_display_name text,p_status public.profile_status)
returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select 1 from public.profiles p join public.system_roles r on r.user_id=p.id where p.id=p_actor_id and p.status='active' and not p.must_change_password and r.role in ('admin','team_leader')) then raise exception 'FORBIDDEN';end if;
 if not exists(select 1 from public.area_shared_accounts where user_id=p_id) or p_username !~ '^[A-Za-z0-9][A-Za-z0-9._-]{1,48}[A-Za-z0-9]$' then raise exception 'INVALID_STAFF_DATA';end if;
 update public.profiles set username=p_username,display_name=p_display_name,status=p_status where id=p_id;
 insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id) values(p_actor_id,'staff','staff.updated','profile',p_id);
end;$$;
revoke all on function public.update_shared_account(uuid,uuid,text,text,public.profile_status) from public,anon,authenticated;
grant execute on function public.update_shared_account(uuid,uuid,text,text,public.profile_status) to service_role;

create or replace function public.list_staff_members()
returns table(id uuid,username text,display_name text,status public.profile_status,is_admin boolean,role public.app_role,areas jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
 if not private.is_admin() then raise exception 'FORBIDDEN';end if;
 return query select p.id,p.username::text,p.display_name,p.status,
 exists(select 1 from public.system_roles r where r.user_id=p.id and r.role in ('admin','team_leader')),
 coalesce((select r.role from public.system_roles r where r.user_id=p.id and r.role in ('admin','team_leader') order by r.role limit 1),
 case when exists(select 1 from public.area_shared_accounts m where m.user_id=p.id) then 'member'::public.app_role else 'area_lead'::public.app_role end),
 coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'slug',a.slug)) from public.areas a where a.id in (
 select m.area_id from public.area_memberships m where m.user_id=p.id and m.ended_at is null
 union select m.area_id from public.area_shared_accounts m where m.user_id=p.id)), '[]'::jsonb)
 from public.profiles p order by p.display_name;
end;$$;
-- Auto-create a closed switch when an administrator adds a new area.
create function private.new_application_area() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.application_areas(area_id) values(new.id) on conflict do nothing;return new;end;$$;
create trigger new_application_area after insert on public.areas for each row execute function private.new_application_area();
insert into public.areas(name,slug) values('Scienze Agrarie','agraria') on conflict(slug) do nothing;
commit;
