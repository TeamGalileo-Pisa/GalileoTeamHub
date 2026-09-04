begin;

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  all_areas boolean not null default true,
  published_at timestamptz not null default now(),
  expires_at timestamptz,
  important boolean not null default false,
  pinned boolean not null default false,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint announcements_title_length
    check (pg_catalog.char_length(trim(title)) between 3 and 160),
  constraint announcements_body_length
    check (pg_catalog.char_length(trim(body)) between 3 and 10000),
  constraint announcements_expiry
    check (expires_at is null or expires_at > published_at)
);

create table public.announcement_targets (
  announcement_id uuid not null
    references public.announcements(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete restrict,
  primary key (announcement_id, area_id)
);

create table public.announcement_reads (
  announcement_id uuid not null
    references public.announcements(id) on delete cascade,
  area_id uuid not null references public.areas(id) on delete restrict,
  read_by uuid not null references public.profiles(id) on delete restrict,
  read_at timestamptz not null default now(),
  primary key (announcement_id, area_id)
);

create index announcements_visibility_idx
  on public.announcements (published_at desc, expires_at);
create index announcement_targets_area_idx
  on public.announcement_targets (area_id, announcement_id);
create index announcement_reads_area_idx
  on public.announcement_reads (area_id, announcement_id);

create trigger announcements_set_updated_at
before update on public.announcements
for each row execute function private.set_updated_at();

alter table public.announcements enable row level security;
alter table public.announcement_targets enable row level security;
alter table public.announcement_reads enable row level security;

revoke all on public.announcements from public, anon, authenticated;
revoke all on public.announcement_targets from public, anon, authenticated;
revoke all on public.announcement_reads from public, anon, authenticated;

grant select, insert, update, delete on public.announcements to authenticated;
grant select on public.announcement_targets to authenticated;
grant select, insert, update, delete on public.announcement_reads to authenticated;

create policy announcements_select_visible
on public.announcements for select to authenticated
using (
  (select private.is_admin())
  or (
    published_at <= pg_catalog.now()
    and (expires_at is null or expires_at > pg_catalog.now())
    and (
      all_areas
      or exists (
        select 1
        from public.announcement_targets target
        where target.announcement_id = announcements.id
          and target.area_id in (select private.user_area_ids())
      )
    )
  )
);

create policy announcements_insert_admin
on public.announcements for insert to authenticated
with check ((select private.is_admin()));

create policy announcements_update_admin
on public.announcements for update to authenticated
using ((select private.is_admin()))
with check ((select private.is_admin()));

create policy announcements_delete_admin
on public.announcements for delete to authenticated
using ((select private.is_admin()));

create policy announcement_targets_select_visible
on public.announcement_targets for select to authenticated
using (
  (select private.is_admin())
  or area_id in (select private.user_area_ids())
);

create policy announcement_reads_select_own_or_admin
on public.announcement_reads for select to authenticated
using (
  (select private.is_admin())
  or area_id in (select private.user_area_ids())
);

create policy announcement_reads_insert_own
on public.announcement_reads for insert to authenticated
with check (
  area_id in (select private.user_area_ids())
  and read_by = (select auth.uid())
  and exists (
    select 1
    from public.announcements announcement
    where announcement.id = announcement_reads.announcement_id
      and announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
      and (
        announcement.all_areas
        or exists (
          select 1
          from public.announcement_targets target
          where target.announcement_id = announcement.id
            and target.area_id = announcement_reads.area_id
        )
      )
  )
);

create policy announcement_reads_update_own
on public.announcement_reads for update to authenticated
using (area_id in (select private.user_area_ids()))
with check (
  area_id in (select private.user_area_ids())
  and read_by = (select auth.uid())
  and exists (
    select 1
    from public.announcements announcement
    where announcement.id = announcement_reads.announcement_id
      and announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
      and (
        announcement.all_areas
        or exists (
          select 1
          from public.announcement_targets target
          where target.announcement_id = announcement.id
            and target.area_id = announcement_reads.area_id
        )
      )
  )
);

create policy announcement_reads_delete_own
on public.announcement_reads for delete to authenticated
using (area_id in (select private.user_area_ids()));

create or replace function public.create_announcement(
  p_title text,
  p_body text,
  p_all_areas boolean,
  p_target_area_ids uuid[],
  p_published_at timestamptz,
  p_expires_at timestamptz,
  p_important boolean,
  p_pinned boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_all_areas boolean := coalesce(p_all_areas, false);
  v_published_at timestamptz := coalesce(p_published_at, pg_catalog.now());
  v_target_count integer;
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if pg_catalog.char_length(trim(coalesce(p_title, ''))) not between 3 and 160
     or pg_catalog.char_length(trim(coalesce(p_body, ''))) not between 3 and 10000 then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;

  if p_expires_at is not null and p_expires_at <= v_published_at then
    raise exception 'INVALID_ANNOUNCEMENT_EXPIRY';
  end if;

  if not v_all_areas then
    select pg_catalog.count(*)::integer
      into v_target_count
    from public.areas area_record
    where area_record.id = any(coalesce(p_target_area_ids, array[]::uuid[]))
      and area_record.active;

    if v_target_count = 0
       or v_target_count <> coalesce(
         pg_catalog.cardinality(p_target_area_ids), 0
       ) then
      raise exception 'INVALID_ANNOUNCEMENT_TARGETS';
    end if;
  end if;

  insert into public.announcements (
    title, body, all_areas, published_at, expires_at,
    important, pinned, created_by
  ) values (
    trim(p_title), trim(p_body), v_all_areas, v_published_at, p_expires_at,
    coalesce(p_important, false),
    coalesce(p_pinned, false),
    auth.uid()
  ) returning id into v_id;

  if not v_all_areas then
    insert into public.announcement_targets (announcement_id, area_id)
    select v_id, target_id
    from pg_catalog.unnest(p_target_area_ids) target_id;
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(), 'staff', 'announcement.created', 'announcement', v_id,
    pg_catalog.jsonb_build_object(
      'all_areas', v_all_areas,
      'published_at', v_published_at,
      'expires_at', p_expires_at,
      'important', coalesce(p_important, false),
      'pinned', coalesce(p_pinned, false)
    )
  );

  return v_id;
end;
$$;

create or replace function public.update_announcement(
  p_announcement_id uuid,
  p_title text,
  p_body text,
  p_all_areas boolean,
  p_target_area_ids uuid[],
  p_published_at timestamptz,
  p_expires_at timestamptz,
  p_important boolean,
  p_pinned boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all_areas boolean := coalesce(p_all_areas, false);
  v_published_at timestamptz := coalesce(p_published_at, pg_catalog.now());
  v_target_count integer;
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if pg_catalog.char_length(trim(coalesce(p_title, ''))) not between 3 and 160
     or pg_catalog.char_length(trim(coalesce(p_body, ''))) not between 3 and 10000 then
    raise exception 'INVALID_ANNOUNCEMENT';
  end if;

  if p_expires_at is not null and p_expires_at <= v_published_at then
    raise exception 'INVALID_ANNOUNCEMENT_EXPIRY';
  end if;

  if not v_all_areas then
    select pg_catalog.count(*)::integer
      into v_target_count
    from public.areas area_record
    where area_record.id = any(coalesce(p_target_area_ids, array[]::uuid[]))
      and area_record.active;

    if v_target_count = 0
       or v_target_count <> coalesce(
         pg_catalog.cardinality(p_target_area_ids), 0
       ) then
      raise exception 'INVALID_ANNOUNCEMENT_TARGETS';
    end if;
  end if;

  update public.announcements
  set title = trim(p_title),
      body = trim(p_body),
      all_areas = v_all_areas,
      published_at = v_published_at,
      expires_at = p_expires_at,
      important = coalesce(p_important, false),
      pinned = coalesce(p_pinned, false)
  where id = p_announcement_id;

  if not found then
    raise exception 'ANNOUNCEMENT_NOT_FOUND';
  end if;

  delete from public.announcement_targets
  where announcement_id = p_announcement_id;

  if not v_all_areas then
    insert into public.announcement_targets (announcement_id, area_id)
    select p_announcement_id, target_id
    from pg_catalog.unnest(p_target_area_ids) target_id;
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id, after_value
  ) values (
    auth.uid(), 'staff', 'announcement.updated', 'announcement',
    p_announcement_id,
    pg_catalog.jsonb_build_object(
      'all_areas', v_all_areas,
      'published_at', v_published_at,
      'expires_at', p_expires_at,
      'important', coalesce(p_important, false),
      'pinned', coalesce(p_pinned, false)
    )
  );
end;
$$;

create or replace function public.delete_announcement(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  delete from public.announcements
  where id = p_announcement_id;

  if not found then
    raise exception 'ANNOUNCEMENT_NOT_FOUND';
  end if;

  insert into public.audit_logs (
    actor_user_id, actor_type, action, entity_type, entity_id
  ) values (
    auth.uid(), 'staff', 'announcement.deleted', 'announcement',
    p_announcement_id
  );
end;
$$;

create or replace function public.list_announcements()
returns table (
  id uuid,
  title text,
  body text,
  all_areas boolean,
  target_area_ids uuid[],
  target_area_names text[],
  published_at timestamptz,
  expires_at timestamptz,
  important boolean,
  pinned boolean,
  is_active boolean,
  is_read boolean,
  read_count integer,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    announcement.id,
    announcement.title,
    announcement.body,
    announcement.all_areas,
    coalesce((
      select pg_catalog.array_agg(target.area_id order by area_record.name)
      from public.announcement_targets target
      join public.areas area_record on area_record.id = target.area_id
      where target.announcement_id = announcement.id
    ), array[]::uuid[]),
    coalesce((
      select pg_catalog.array_agg(area_record.name::text order by area_record.name)
      from public.announcement_targets target
      join public.areas area_record on area_record.id = target.area_id
      where target.announcement_id = announcement.id
    ), array[]::text[]),
    announcement.published_at,
    announcement.expires_at,
    announcement.important,
    announcement.pinned,
    announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now()),
    exists (
      select 1
      from public.announcement_reads read_record
      where read_record.announcement_id = announcement.id
        and read_record.area_id in (select private.user_area_ids())
    ),
    (
      select pg_catalog.count(distinct read_record.area_id)::integer
      from public.announcement_reads read_record
      where read_record.announcement_id = announcement.id
    ),
    announcement.created_at
  from public.announcements announcement
  where private.is_admin()
     or (
       announcement.published_at <= pg_catalog.now()
       and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
       and (
         announcement.all_areas
         or exists (
           select 1
           from public.announcement_targets target
           where target.announcement_id = announcement.id
             and target.area_id in (select private.user_area_ids())
         )
       )
     )
  order by announcement.pinned desc,
           announcement.important desc,
           announcement.published_at desc;
$$;

create or replace function public.mark_announcement_read(
  p_announcement_id uuid,
  p_read boolean default true
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or private.is_admin() then
    raise exception 'FORBIDDEN';
  end if;

  if not exists (
    select 1
    from public.announcements announcement
    where announcement.id = p_announcement_id
      and announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
      and (
        announcement.all_areas
        or exists (
          select 1
          from public.announcement_targets target
          where target.announcement_id = announcement.id
            and target.area_id in (select private.user_area_ids())
        )
      )
  ) then
    raise exception 'ANNOUNCEMENT_NOT_FOUND';
  end if;

  if coalesce(p_read, true) then
    insert into public.announcement_reads (
      announcement_id, area_id, read_by, read_at
    )
    select p_announcement_id, own_area.area_id, auth.uid(), pg_catalog.now()
    from private.user_area_ids() as own_area(area_id)
    where exists (
      select 1
      from public.announcements announcement
      where announcement.id = p_announcement_id
        and (
          announcement.all_areas
          or exists (
            select 1
            from public.announcement_targets target
            where target.announcement_id = announcement.id
              and target.area_id = own_area.area_id
          )
        )
    )
    on conflict (announcement_id, area_id)
    do update set read_by = excluded.read_by, read_at = excluded.read_at;
  else
    delete from public.announcement_reads
    where announcement_id = p_announcement_id
      and area_id in (select private.user_area_ids());
  end if;
end;
$$;

create or replace function public.get_unread_announcement_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select case when private.is_admin() then 0 else (
    select pg_catalog.count(*)::integer
    from public.announcements announcement
    where announcement.published_at <= pg_catalog.now()
      and (announcement.expires_at is null or announcement.expires_at > pg_catalog.now())
      and (
        announcement.all_areas
        or exists (
          select 1
          from public.announcement_targets target
          where target.announcement_id = announcement.id
            and target.area_id in (select private.user_area_ids())
        )
      )
      and not exists (
        select 1
        from public.announcement_reads read_record
        where read_record.announcement_id = announcement.id
          and read_record.area_id in (select private.user_area_ids())
      )
  ) end;
$$;

revoke all on function public.create_announcement(text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean)
  from public, anon;
revoke all on function public.update_announcement(uuid, text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean)
  from public, anon;
revoke all on function public.delete_announcement(uuid) from public, anon;
revoke all on function public.list_announcements() from public, anon;
revoke all on function public.mark_announcement_read(uuid, boolean) from public, anon;
revoke all on function public.get_unread_announcement_count() from public, anon;

grant execute on function public.create_announcement(text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean)
  to authenticated;
grant execute on function public.update_announcement(uuid, text, text, boolean, uuid[], timestamptz, timestamptz, boolean, boolean)
  to authenticated;
grant execute on function public.delete_announcement(uuid) to authenticated;
grant execute on function public.list_announcements() to authenticated;
grant execute on function public.mark_announcement_read(uuid, boolean) to authenticated;
grant execute on function public.get_unread_announcement_count() to authenticated;

commit;
