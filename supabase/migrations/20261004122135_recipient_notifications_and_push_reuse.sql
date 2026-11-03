begin;

-- A device permission is granted once by the operating system. Preserve the
-- subscription at sign-out; push-device upsert will attach it to the account
-- that is currently signed in.

create or replace function private.notify_announcement()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.all_areas then
    insert into public.notifications(recipient_user_id,type,title,body,data)
    select recipients.user_id,'announcement.created','Nuovo annuncio in bacheca',new.title,
      jsonb_build_object('announcement_id',new.id)
    from (
      select r.user_id
      from public.system_roles r join public.profiles p on p.id=r.user_id
      where r.role in ('admin','team_leader') and p.status='active'
        and not p.must_change_password and r.user_id<>new.created_by
      union
      select m.user_id
      from public.area_memberships m join public.profiles p on p.id=m.user_id
      where m.role='area_lead' and m.ended_at is null and p.status='active'
        and not p.must_change_password and m.user_id<>new.created_by
    ) recipients;
  end if;
  return new;
end;
$$;
drop trigger if exists announcements_notify_area_leads on public.announcements;
create trigger announcements_notify_area_leads
  after insert on public.announcements
  for each row execute function private.notify_announcement();

create or replace function private.notify_targeted_announcement()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_title text; v_creator uuid;
begin
  select title,created_by into v_title,v_creator
  from public.announcements where id=new.announcement_id;
  insert into public.notifications(recipient_user_id,type,title,body,data)
  select recipients.user_id,'announcement.created','Nuovo annuncio in bacheca',v_title,
    jsonb_build_object('announcement_id',new.announcement_id,'area_id',new.area_id)
  from (
    select r.user_id
    from public.system_roles r join public.profiles p on p.id=r.user_id
    where r.role in ('admin','team_leader') and p.status='active'
      and not p.must_change_password and r.user_id<>v_creator
    union
    select m.user_id
    from public.area_memberships m join public.profiles p on p.id=m.user_id
    where m.area_id=new.area_id and m.role='area_lead' and m.ended_at is null
      and p.status='active' and not p.must_change_password and m.user_id<>v_creator
  ) recipients;
  return new;
end;
$$;
drop trigger if exists announcement_targets_notify_area_leads on public.announcement_targets;
create trigger announcement_targets_notify_area_leads
  after insert on public.announcement_targets
  for each row execute function private.notify_targeted_announcement();

-- Shared member accounts receive only announcements for their own area and
-- never receive a notification for an announcement they posted themselves.
create or replace function private.notify_shared_members()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_table_name='announcements' then
    if new.all_areas then
      insert into public.notifications(recipient_user_id,type,title,body,data)
      select distinct m.user_id,'announcement.created','Nuovo annuncio in bacheca',new.title,
        jsonb_build_object('announcement_id',new.id)
      from public.area_shared_accounts m join public.profiles p on p.id=m.user_id
      where p.status='active' and not p.must_change_password and m.user_id<>new.created_by;
    end if;
  else
    insert into public.notifications(recipient_user_id,type,title,body,data)
    select distinct m.user_id,'announcement.created','Nuovo annuncio in bacheca',a.title,
      jsonb_build_object('announcement_id',a.id,'area_id',new.area_id)
    from public.area_shared_accounts m join public.profiles p on p.id=m.user_id
    join public.announcements a on a.id=new.announcement_id
    where m.area_id=new.area_id and p.status='active' and not p.must_change_password
      and m.user_id<>a.created_by;
  end if;
  return new;
end;
$$;

commit;
