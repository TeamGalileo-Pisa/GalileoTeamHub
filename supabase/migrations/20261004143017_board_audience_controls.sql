begin;

alter table public.announcements
  add column if not exists target_members boolean not null default true,
  add column if not exists target_area_leads boolean not null default true,
  add column if not exists all_area_leads boolean not null default false;

-- Individual area-lead recipients stay in a private schema and are only
-- touched by the security-definer board RPCs.
create table if not exists private.announcement_lead_targets (
  announcement_id uuid not null references public.announcements(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete restrict,
  primary key (announcement_id, user_id)
);
create index if not exists announcement_lead_targets_user_idx
  on private.announcement_lead_targets(user_id, announcement_id);
alter table private.announcement_lead_targets enable row level security;
revoke all on private.announcement_lead_targets from public, anon, authenticated;

create or replace function private.is_team_leader()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() and exists (
    select 1 from public.system_roles r
    where r.user_id = (select auth.uid()) and r.role = 'team_leader'
  );
$$;
revoke all on function private.is_team_leader() from public, anon, authenticated;

create or replace function private.is_administration()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.is_admin() and exists (
    select 1 from public.system_roles r
    where r.user_id = (select auth.uid()) and r.role = 'admin'
  );
$$;
revoke all on function private.is_administration() from public, anon, authenticated;

create or replace function private.can_read_announcement(p_announcement_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.status = 'active' and not p.must_change_password
  ) and (
    private.is_admin()
    or exists (
      select 1 from public.announcements a
      where a.id = p_announcement_id and (
        a.all_areas
        or (a.all_area_leads and exists (
          select 1 from public.area_memberships m
          where m.user_id = (select auth.uid()) and m.role = 'area_lead' and m.ended_at is null
        ))
        or (a.target_area_leads and exists (
          select 1 from public.announcement_targets t
          join public.area_memberships m on m.area_id = t.area_id
          where t.announcement_id = a.id and m.user_id = (select auth.uid())
            and m.role = 'area_lead' and m.ended_at is null
        ))
        or (a.target_members and exists (
          select 1 from public.announcement_targets t
          join public.area_shared_accounts m on m.area_id = t.area_id
          where t.announcement_id = a.id and m.user_id = (select auth.uid())
        ))
        or exists (
          select 1 from private.announcement_lead_targets t
          where t.announcement_id = a.id and t.user_id = (select auth.uid())
        )
      )
    )
  );
$$;
revoke all on function private.can_read_announcement(uuid) from public, anon;
grant execute on function private.can_read_announcement(uuid) to authenticated;

drop policy if exists announcements_select_visible on public.announcements;
create policy announcements_select_visible
on public.announcements for select to authenticated
using (
  private.can_read_announcement(id)
  and (private.is_admin() or (
    published_at <= pg_catalog.now()
    and (expires_at is null or expires_at > pg_catalog.now())
  ))
);

drop policy if exists announcement_reads_select_own_or_admin on public.announcement_reads;
create policy announcement_reads_select_own_or_admin
on public.announcement_reads for select to authenticated
using (
  private.is_admin()
  or read_by = (select auth.uid())
  or area_id in (select private.user_area_ids())
  or exists (select 1 from public.area_shared_accounts m
    where m.area_id = announcement_reads.area_id and m.user_id = (select auth.uid()))
);

drop policy if exists announcement_reads_insert_own on public.announcement_reads;
create policy announcement_reads_insert_own
on public.announcement_reads for insert to authenticated
with check (
  read_by = (select auth.uid())
  and (area_id in (select private.user_area_ids())
    or exists (select 1 from public.area_shared_accounts m
      where m.area_id = announcement_reads.area_id and m.user_id = (select auth.uid())))
  and private.can_read_announcement(announcement_id)
);

drop policy if exists announcement_reads_update_own on public.announcement_reads;
create policy announcement_reads_update_own
on public.announcement_reads for update to authenticated
using (read_by = (select auth.uid()) or private.is_admin())
with check (
  read_by = (select auth.uid())
  and private.can_read_announcement(announcement_id)
  and (area_id in (select private.user_area_ids())
    or exists (select 1 from public.area_shared_accounts m
      where m.area_id = announcement_reads.area_id and m.user_id = (select auth.uid())))
);

create or replace function private.notify_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notifications(recipient_user_id, type, title, body, data)
  select distinct recipients.user_id, 'announcement.created', 'Nuovo annuncio in bacheca', new.title,
    pg_catalog.jsonb_build_object('announcement_id', new.id)
  from (
    select r.user_id from public.system_roles r join public.profiles p on p.id = r.user_id
      where r.role in ('admin','team_leader') and p.status = 'active'
        and not p.must_change_password and r.user_id <> new.created_by
    union
    select m.user_id from public.area_memberships m join public.profiles p on p.id = m.user_id
      where m.role = 'area_lead' and m.ended_at is null and p.status = 'active'
        and not p.must_change_password and m.user_id <> new.created_by
        and (new.all_areas or new.all_area_leads)
    union
    select m.user_id from public.area_shared_accounts m join public.profiles p on p.id = m.user_id
      where new.all_areas and p.status = 'active' and not p.must_change_password
        and m.user_id <> new.created_by
  ) recipients
  where new.all_areas or new.all_area_leads or exists (
    select 1 from public.system_roles r where r.user_id = recipients.user_id and r.role in ('admin','team_leader')
  );
  return new;
end;
$$;

create or replace function private.notify_targeted_announcement()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_created_by uuid; v_target_members boolean; v_target_area_leads boolean; v_all_areas boolean;
begin
  if pg_catalog.current_setting('app.announcement_silent_targets', true) = 'true' then return new; end if;
  select title, created_by, target_members, target_area_leads, all_areas
    into v_title, v_created_by, v_target_members, v_target_area_leads, v_all_areas
  from public.announcements where id = new.announcement_id;
  insert into public.notifications(recipient_user_id, type, title, body, data)
  select distinct recipients.user_id, 'announcement.created', 'Nuovo annuncio in bacheca', v_title,
    pg_catalog.jsonb_build_object('announcement_id', new.announcement_id, 'area_id', new.area_id)
  from (
    select m.user_id from public.area_memberships m join public.profiles p on p.id = m.user_id
      where m.area_id = new.area_id and m.role = 'area_lead' and m.ended_at is null
        and p.status = 'active' and not p.must_change_password and m.user_id <> v_created_by
        and (v_all_areas or v_target_area_leads)
    union
    select m.user_id from public.area_shared_accounts m join public.profiles p on p.id = m.user_id
      where m.area_id = new.area_id and p.status = 'active' and not p.must_change_password
        and m.user_id <> v_created_by and (v_all_areas or v_target_members)
  ) recipients
  where not exists (
    select 1 from public.notifications n where n.recipient_user_id = recipients.user_id
      and n.type = 'announcement.created' and n.data ->> 'announcement_id' = new.announcement_id::text
  );
  return new;
end;
$$;

create or replace function private.notify_targeted_announcement_lead()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_title text; v_created_by uuid;
begin
  if pg_catalog.current_setting('app.announcement_silent_targets', true) = 'true' then return new; end if;
  select title, created_by into v_title, v_created_by
  from public.announcements where id = new.announcement_id;
  insert into public.notifications(recipient_user_id, type, title, body, data)
  select new.user_id, 'announcement.created', 'Nuovo annuncio in bacheca', v_title,
    pg_catalog.jsonb_build_object('announcement_id', new.announcement_id)
  where new.user_id <> v_created_by
    and exists (select 1 from public.profiles p where p.id = new.user_id
      and p.status = 'active' and not p.must_change_password)
    and not exists (select 1 from public.notifications n where n.recipient_user_id = new.user_id
      and n.type = 'announcement.created'
      and n.data ->> 'announcement_id' = new.announcement_id::text);
  return new;
end;
$$;

drop trigger if exists announcement_targets_notify_area_leads on public.announcement_targets;
drop trigger if exists targets_shared_push on public.announcement_targets;
create trigger announcement_targets_notify_recipients
  after insert on public.announcement_targets
  for each row execute function private.notify_targeted_announcement();
drop trigger if exists announcements_notify_area_leads on public.announcements;
create trigger announcements_notify_recipients
  after insert on public.announcements
  for each row execute function private.notify_announcement();
drop trigger if exists announcement_lead_targets_notify on private.announcement_lead_targets;
create trigger announcement_lead_targets_notify
  after insert on private.announcement_lead_targets
  for each row execute function private.notify_targeted_announcement_lead();

-- Replace the legacy all-area-only publisher so clients cannot bypass audience
-- restrictions by continuing to call the old RPC signature.
drop function if exists public.create_announcement(text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean);
drop function if exists public.update_announcement(uuid, text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean);

create or replace function public.list_announcement_leads()
returns table(user_id uuid, display_name text, area_name text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  return query
  select p.id, p.display_name::text, pg_catalog.string_agg(distinct a.name::text, ', ' order by a.name::text)
  from public.profiles p
  join public.area_memberships m on m.user_id = p.id and m.role = 'area_lead' and m.ended_at is null
  join public.areas a on a.id = m.area_id and a.active
  where p.status = 'active' and not p.must_change_password
  group by p.id, p.display_name
  order by p.display_name;
end;
$$;
revoke all on function public.list_announcement_leads() from public, anon;
grant execute on function public.list_announcement_leads() to authenticated;

create or replace function public.create_announcement(
  p_title text, p_body text, p_all_areas boolean, p_target_area_ids uuid[],
  p_target_lead_ids uuid[], p_all_area_leads boolean, p_target_members boolean,
  p_published_at timestamptz, p_expires_at timestamptz, p_important boolean, p_pinned boolean
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_area_ids uuid[] := coalesce(p_target_area_ids, array[]::uuid[]);
  v_lead_ids uuid[] := coalesce(p_target_lead_ids, array[]::uuid[]);
  v_all_areas boolean := coalesce(p_all_areas, false);
  v_target_members boolean := coalesce(p_target_members, false);
  v_all_area_leads boolean := coalesce(p_all_area_leads, false);
  v_published_at timestamptz := coalesce(p_published_at, pg_catalog.now());
  v_is_tl boolean := private.is_team_leader();
  v_is_admin boolean := private.is_administration();
  v_is_area_lead boolean;
  v_count integer;
begin
  if not v_is_tl and not v_is_admin then
    select exists (select 1 from public.area_memberships m where m.user_id = auth.uid()
      and m.role = 'area_lead' and m.ended_at is null) into v_is_area_lead;
    if not v_is_area_lead then raise exception 'FORBIDDEN'; end if;
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_title, ''))) not between 3 and 160
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_body, ''))) not between 3 and 10000 then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;
  if p_expires_at is not null and p_expires_at <= v_published_at then raise exception 'INVALID_ANNOUNCEMENT_EXPIRY'; end if;

  if v_all_areas then
    if not v_is_tl or pg_catalog.cardinality(v_area_ids) <> 0 or pg_catalog.cardinality(v_lead_ids) <> 0
      or v_target_members or v_all_area_leads then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  elsif v_is_area_lead and not v_is_admin and not v_is_tl then
    if not v_target_members or v_all_area_leads or pg_catalog.cardinality(v_lead_ids) <> 0 then raise exception 'FORBIDDEN'; end if;
    select pg_catalog.count(*)::integer into v_count from public.areas a
      where a.id = any(v_area_ids) and a.active and a.id in (select private.user_area_ids());
    if v_count = 0 or v_count <> pg_catalog.cardinality(v_area_ids) then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  elsif v_is_admin and not v_is_tl then
    if v_target_members or pg_catalog.cardinality(v_area_ids) <> 0 then raise exception 'FORBIDDEN'; end if;
    if not v_all_area_leads and pg_catalog.cardinality(v_lead_ids) = 0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  end if;

  if not v_all_areas then
    if v_target_members then
      select pg_catalog.count(*)::integer into v_count from public.areas a
        where a.id = any(v_area_ids) and a.active;
      if v_count = 0 or v_count <> pg_catalog.cardinality(v_area_ids) then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    elsif pg_catalog.cardinality(v_area_ids) > 0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    if not v_all_area_leads and pg_catalog.cardinality(v_lead_ids) > 0 then
      select pg_catalog.count(distinct p.id)::integer into v_count from public.profiles p
        join public.area_memberships m on m.user_id = p.id and m.role = 'area_lead' and m.ended_at is null
        join public.areas a on a.id = m.area_id and a.active
        where p.id = any(v_lead_ids) and p.status = 'active' and not p.must_change_password;
      if v_count = 0 or v_count <> pg_catalog.cardinality(v_lead_ids) then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    elsif v_all_area_leads and pg_catalog.cardinality(v_lead_ids) > 0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    if not v_target_members and not v_all_area_leads and pg_catalog.cardinality(v_lead_ids) = 0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  end if;

  insert into public.announcements(title, body, all_areas, target_members, target_area_leads,
    all_area_leads, published_at, expires_at, important, pinned, created_by)
  values(pg_catalog.btrim(p_title), pg_catalog.btrim(p_body), v_all_areas,
    v_target_members, false, v_all_area_leads, v_published_at, p_expires_at,
    coalesce(p_important, false), coalesce(p_pinned, false), auth.uid()) returning id into v_id;
  if not v_all_areas and pg_catalog.cardinality(v_area_ids) > 0 then
    insert into public.announcement_targets(announcement_id, area_id)
      select v_id, target_id from pg_catalog.unnest(v_area_ids) target_id;
  end if;
  if not v_all_areas and pg_catalog.cardinality(v_lead_ids) > 0 then
    insert into private.announcement_lead_targets(announcement_id, user_id)
      select v_id, target_id from pg_catalog.unnest(v_lead_ids) target_id;
  end if;
  insert into public.audit_logs(actor_user_id, actor_type, action, entity_type, entity_id, after_value)
  values(auth.uid(), 'staff', 'announcement.created', 'announcement', v_id,
    pg_catalog.jsonb_build_object('all_areas', v_all_areas, 'target_members', v_target_members,
      'target_area_ids', v_area_ids, 'target_lead_ids', v_lead_ids, 'all_area_leads', v_all_area_leads,
      'published_at', v_published_at, 'expires_at', p_expires_at,
      'important', coalesce(p_important, false), 'pinned', coalesce(p_pinned, false)));
  return v_id;
end;
$$;

create or replace function public.update_announcement(
  p_announcement_id uuid, p_title text, p_body text, p_all_areas boolean,
  p_target_area_ids uuid[], p_target_lead_ids uuid[], p_all_area_leads boolean,
  p_target_members boolean, p_published_at timestamptz, p_expires_at timestamptz,
  p_important boolean, p_pinned boolean
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_existing public.announcements%rowtype;
  v_area_ids uuid[] := coalesce(p_target_area_ids, array[]::uuid[]);
  v_lead_ids uuid[] := coalesce(p_target_lead_ids, array[]::uuid[]);
  v_all_areas boolean := coalesce(p_all_areas, false);
  v_target_members boolean := coalesce(p_target_members, false);
  v_all_area_leads boolean := coalesce(p_all_area_leads, false);
  v_published_at timestamptz := coalesce(p_published_at, pg_catalog.now());
  v_count integer;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into v_existing from public.announcements where id = p_announcement_id for update;
  if not found then raise exception 'ANNOUNCEMENT_NOT_FOUND'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_title, ''))) not between 3 and 160
    or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_body, ''))) not between 3 and 10000 then raise exception 'INVALID_ANNOUNCEMENT'; end if;
  if p_expires_at is not null and p_expires_at <= v_published_at then raise exception 'INVALID_ANNOUNCEMENT_EXPIRY'; end if;
  if v_all_areas then
    if not private.is_team_leader() and not v_existing.all_areas then raise exception 'FORBIDDEN'; end if;
    if pg_catalog.cardinality(v_area_ids) <> 0 or pg_catalog.cardinality(v_lead_ids) <> 0
      or v_target_members or v_all_area_leads then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  else
    if v_target_members then
      select pg_catalog.count(*)::integer into v_count from public.areas a where a.id = any(v_area_ids) and a.active;
      if v_count = 0 or v_count <> pg_catalog.cardinality(v_area_ids) then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    elsif pg_catalog.cardinality(v_area_ids) > 0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    if not v_all_area_leads and pg_catalog.cardinality(v_lead_ids) > 0 then
      select pg_catalog.count(distinct p.id)::integer into v_count from public.profiles p
        join public.area_memberships m on m.user_id=p.id and m.role='area_lead' and m.ended_at is null
        join public.areas a on a.id=m.area_id and a.active
        where p.id=any(v_lead_ids) and p.status='active' and not p.must_change_password;
      if v_count=0 or v_count<>pg_catalog.cardinality(v_lead_ids) then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    elsif v_all_area_leads and pg_catalog.cardinality(v_lead_ids)>0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
    if not v_target_members and not v_all_area_leads and pg_catalog.cardinality(v_lead_ids)=0 then raise exception 'INVALID_ANNOUNCEMENT_TARGETS'; end if;
  end if;

  update public.announcements set title=pg_catalog.btrim(p_title), body=pg_catalog.btrim(p_body),
    all_areas=v_all_areas, target_members=v_target_members, target_area_leads=false,
    all_area_leads=v_all_area_leads, published_at=v_published_at, expires_at=p_expires_at,
    important=coalesce(p_important,false), pinned=coalesce(p_pinned,false)
  where id=p_announcement_id;
  perform pg_catalog.set_config('app.announcement_silent_targets', 'true', true);
  delete from public.announcement_targets where announcement_id=p_announcement_id;
  delete from private.announcement_lead_targets where announcement_id=p_announcement_id;
  if not v_all_areas and pg_catalog.cardinality(v_area_ids)>0 then
    insert into public.announcement_targets(announcement_id,area_id)
      select p_announcement_id,target_id from pg_catalog.unnest(v_area_ids) target_id;
  end if;
  if not v_all_areas and pg_catalog.cardinality(v_lead_ids)>0 then
    insert into private.announcement_lead_targets(announcement_id,user_id)
      select p_announcement_id,target_id from pg_catalog.unnest(v_lead_ids) target_id;
  end if;
  perform pg_catalog.set_config('app.announcement_silent_targets', 'false', true);
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,after_value)
  values(auth.uid(),'staff','announcement.updated','announcement',p_announcement_id,
    pg_catalog.jsonb_build_object('all_areas',v_all_areas,'target_members',v_target_members,
      'target_area_ids',v_area_ids,'target_lead_ids',v_lead_ids,'all_area_leads',v_all_area_leads,
      'published_at',v_published_at,'expires_at',p_expires_at,
      'important',coalesce(p_important,false),'pinned',coalesce(p_pinned,false)));
end;
$$;

drop function if exists public.list_announcements();
create function public.list_announcements()
returns table (
  id uuid, title text, body text, all_areas boolean,
  target_area_ids uuid[], target_area_names text[], target_lead_ids uuid[], target_lead_names text[],
  target_members boolean, target_area_leads boolean, all_area_leads boolean,
  published_at timestamptz, expires_at timestamptz, important boolean, pinned boolean,
  is_active boolean, is_read boolean, read_count integer, created_at timestamptz
)
language sql stable security definer set search_path = '' as $$
  select a.id, a.title, a.body, a.all_areas,
    coalesce((select pg_catalog.array_agg(t.area_id order by ar.name) from public.announcement_targets t
      join public.areas ar on ar.id=t.area_id where t.announcement_id=a.id), array[]::uuid[]),
    coalesce((select pg_catalog.array_agg(ar.name::text order by ar.name) from public.announcement_targets t
      join public.areas ar on ar.id=t.area_id where t.announcement_id=a.id), array[]::text[]),
    case when private.is_admin() then coalesce((select pg_catalog.array_agg(t.user_id order by p.display_name)
      from private.announcement_lead_targets t join public.profiles p on p.id=t.user_id
      where t.announcement_id=a.id), array[]::uuid[]) else array[]::uuid[] end,
    case when private.is_admin() then coalesce((select pg_catalog.array_agg(p.display_name::text order by p.display_name)
      from private.announcement_lead_targets t join public.profiles p on p.id=t.user_id
      where t.announcement_id=a.id), array[]::text[]) else array[]::text[] end,
    a.target_members, a.target_area_leads, a.all_area_leads,
    a.published_at, a.expires_at, a.important, a.pinned,
    a.published_at <= pg_catalog.now() and (a.expires_at is null or a.expires_at > pg_catalog.now()),
    exists(select 1 from public.announcement_reads r where r.announcement_id=a.id and r.read_by=(select auth.uid())),
    (select pg_catalog.count(distinct r.read_by)::integer from public.announcement_reads r where r.announcement_id=a.id),
    a.created_at
  from public.announcements a
  where private.is_admin() or (
    a.published_at <= pg_catalog.now() and (a.expires_at is null or a.expires_at > pg_catalog.now())
    and private.can_read_announcement(a.id)
  )
  order by a.pinned desc, a.important desc, a.published_at desc;
$$;

create or replace function public.mark_announcement_read(p_announcement_id uuid, p_read boolean default true)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or private.is_admin() or not private.can_read_announcement(p_announcement_id) then raise exception 'FORBIDDEN'; end if;
  if coalesce(p_read, true) then
    insert into public.announcement_reads(announcement_id,area_id,read_by,read_at)
    select p_announcement_id, own.area_id, auth.uid(), pg_catalog.now()
    from (
      select m.area_id from public.area_memberships m where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
      union select m.area_id from public.area_shared_accounts m where m.user_id=auth.uid()
    ) own
    on conflict (announcement_id,area_id) do update set read_by=excluded.read_by, read_at=excluded.read_at;
  else
    delete from public.announcement_reads where announcement_id=p_announcement_id and read_by=auth.uid();
  end if;
end;
$$;

create or replace function public.get_unread_announcement_count()
returns integer language sql stable security definer set search_path = '' as $$
  select case when private.is_admin() then 0 else (
    select pg_catalog.count(*)::integer from public.announcements a
    where a.published_at <= pg_catalog.now() and (a.expires_at is null or a.expires_at > pg_catalog.now())
      and private.can_read_announcement(a.id)
      and not exists(select 1 from public.announcement_reads r where r.announcement_id=a.id and r.read_by=(select auth.uid()))
  ) end;
$$;

create or replace function public.member_announcements()
returns table(id uuid,title text,body text,published_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select a.id,a.title,a.body,a.published_at from public.announcements a
  join public.area_shared_accounts m on m.user_id=(select auth.uid())
  join public.profiles p on p.id=m.user_id
  where p.status='active' and not p.must_change_password
    and a.published_at<=pg_catalog.now() and (a.expires_at is null or a.expires_at>pg_catalog.now())
    and (a.all_areas or (a.target_members and exists(select 1 from public.announcement_targets t
      where t.announcement_id=a.id and t.area_id=m.area_id)))
  order by a.published_at desc;
$$;

revoke all on function public.create_announcement(text,text,boolean,uuid[],uuid[],boolean,boolean,timestamptz,timestamptz,boolean,boolean) from public,anon;
revoke all on function public.update_announcement(uuid,text,text,boolean,uuid[],uuid[],boolean,boolean,timestamptz,timestamptz,boolean,boolean) from public,anon;
revoke all on function public.list_announcement_leads() from public,anon;
revoke all on function public.list_announcements() from public,anon;
revoke all on function public.mark_announcement_read(uuid,boolean) from public,anon;
revoke all on function public.get_unread_announcement_count() from public,anon;
revoke all on function public.member_announcements() from public,anon;
grant execute on function public.create_announcement(text,text,boolean,uuid[],uuid[],boolean,boolean,timestamptz,timestamptz,boolean,boolean) to authenticated;
grant execute on function public.update_announcement(uuid,text,text,boolean,uuid[],uuid[],boolean,boolean,timestamptz,timestamptz,boolean,boolean) to authenticated;
grant execute on function public.list_announcements() to authenticated;
grant execute on function public.mark_announcement_read(uuid,boolean) to authenticated;
grant execute on function public.get_unread_announcement_count() to authenticated;
grant execute on function public.member_announcements() to authenticated;

commit;
