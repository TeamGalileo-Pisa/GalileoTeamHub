begin;

create table if not exists public.user_presence (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  last_seen_at timestamptz not null default pg_catalog.now(),
  last_path text,
  updated_at timestamptz not null default pg_catalog.now()
);

alter table public.user_presence enable row level security;
revoke all on public.user_presence from public, anon, authenticated;

create or replace function public.touch_user_presence(p_path text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'UNAUTHORIZED'; end if;

  insert into public.user_presence(user_id,last_seen_at,last_path,updated_at)
  values(
    auth.uid(),
    pg_catalog.now(),
    case when p_path is null then null else pg_catalog.left(p_path,500) end,
    pg_catalog.now()
  )
  on conflict(user_id) do update set
    last_seen_at=excluded.last_seen_at,
    last_path=excluded.last_path,
    updated_at=excluded.updated_at;
end;
$$;

create or replace function public.mark_user_offline()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_presence
  set last_seen_at=pg_catalog.now()-interval '1 day',
      updated_at=pg_catalog.now()
  where user_id=auth.uid();
$$;

create or replace function public.list_online_area_leads()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;

  return coalesce((
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'userId',q.user_id,
        'username',q.username,
        'displayName',q.display_name,
        'areas',q.areas,
        'lastSeenAt',q.last_seen_at,
        'lastPath',q.last_path
      ) order by q.display_name
    )
    from (
      select
        p.id as user_id,
        p.username::text as username,
        p.display_name,
        coalesce(
          pg_catalog.jsonb_agg(
            pg_catalog.jsonb_build_object(
              'id',a.id,
              'name',a.name::text,
              'slug',a.slug::text
            ) order by a.name::text
          ),
          '[]'::jsonb
        ) as areas,
        up.last_seen_at,
        up.last_path
      from public.profiles p
      join public.user_presence up on up.user_id=p.id
      join public.area_memberships am
        on am.user_id=p.id
       and am.role='area_lead'
       and am.ended_at is null
      join public.areas a on a.id=am.area_id and a.active
      where p.status='active'
        and up.last_seen_at>=pg_catalog.now()-interval '90 seconds'
      group by p.id,p.username,p.display_name,up.last_seen_at,up.last_path
    ) q
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.touch_user_presence(text), public.mark_user_offline(), public.list_online_area_leads() from public, anon;
grant execute on function public.touch_user_presence(text), public.mark_user_offline(), public.list_online_area_leads() to authenticated;

commit;
