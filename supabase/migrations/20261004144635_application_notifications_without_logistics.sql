begin;

-- Send application notifications to administrators, Team Leaders, and only
-- the area lead responsible for the submitted application.
create or replace function private.notify_application_reviewers()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_area_name text;
begin
  select name::text into v_area_name from public.areas where id=new.area_id;
  insert into public.notifications(recipient_user_id,type,title,body,data)
  select recipients.user_id,'application.received','Nuova candidatura · '||coalesce(v_area_name,'Area'),
    'Apri Candidature per consultare i dati e le risposte del candidato.',
    jsonb_build_object('application_id',new.id,'area_id',new.area_id,'route','/area/candidature')
  from (
    select r.user_id from public.system_roles r join public.profiles p on p.id=r.user_id
      where r.role in ('admin','team_leader') and p.status='active'
    union
    select m.user_id from public.area_memberships m join public.profiles p on p.id=m.user_id
      where m.role='area_lead' and m.area_id=new.area_id and m.ended_at is null and p.status='active'
  ) recipients;
  return new;
end;
$$;

revoke all on function private.notify_application_reviewers() from public,anon,authenticated;

commit;

