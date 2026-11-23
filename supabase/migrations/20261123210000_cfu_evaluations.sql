begin;
create or replace function private.is_cfu_manager()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.staff_ready()
    and exists (select 1 from public.system_roles r where r.user_id = auth.uid() and r.role::text = 'team_leader');
$$;

create table public.cfu_area_settings (
  area_id uuid primary key references public.areas(id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.cfu_members (
  id uuid primary key default gen_random_uuid(),
  first_name text not null check (char_length(btrim(first_name)) between 1 and 120),
  last_name text not null check (char_length(btrim(last_name)) between 1 and 120),
  student_number text not null default '' check (char_length(student_number) <= 40),
  degree text not null default '' check (char_length(degree) <= 200),
  department text not null default '' check (char_length(department) <= 200),
  professor_name text not null default '' check (char_length(professor_name) <= 200),
  professor_email text not null default '' check (char_length(professor_email) <= 200),
  area_id uuid references public.areas(id) on delete set null,
  division text not null default '' check (char_length(division) <= 200),
  team_role text not null default '' check (char_length(team_role) <= 200),
  period_from date,
  period_to date,
  description text not null default '' check (char_length(description) <= 4000),
  ratings jsonb not null default '{}'::jsonb check (jsonb_typeof(ratings) = 'object'),
  evaluated_by uuid references public.profiles(id) on delete set null,
  evaluated_at timestamptz,
  created_at timestamptz not null default now()
);
create index cfu_members_area_idx on public.cfu_members(area_id);

create table public.cfu_settings (
  id boolean primary key default true check (id),
  requests_open boolean not null default false
);
insert into public.cfu_settings default values;

alter table public.cfu_settings enable row level security;
alter table public.cfu_area_settings enable row level security;
alter table public.cfu_members enable row level security;
revoke all on public.cfu_settings, public.cfu_area_settings, public.cfu_members from public, anon, authenticated;
grant select, insert, update, delete on public.cfu_settings, public.cfu_area_settings, public.cfu_members to authenticated;
grant all on public.cfu_settings, public.cfu_area_settings, public.cfu_members to service_role;

create policy cfu_settings_manage on public.cfu_settings for all to authenticated
  using (private.is_cfu_manager()) with check (private.is_cfu_manager());
create policy cfu_area_settings_manage on public.cfu_area_settings for all to authenticated
  using (private.is_cfu_manager()) with check (private.is_cfu_manager());
create policy cfu_members_manage on public.cfu_members for all to authenticated
  using (private.is_cfu_manager()) with check (private.is_cfu_manager());

revoke all on function private.is_cfu_manager() from public, anon;
grant execute on function private.is_cfu_manager() to authenticated, service_role;

create or replace function private.cfu_lead_area_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select m.area_id
  from public.area_memberships m
  join public.areas a on a.id = m.area_id and a.active
  join public.cfu_area_settings s on s.area_id = m.area_id and s.enabled
  where private.staff_ready() and m.user_id = auth.uid() and m.role = 'area_lead' and m.ended_at is null;
$$;
revoke all on function private.cfu_lead_area_ids() from public, anon;
grant execute on function private.cfu_lead_area_ids() to authenticated, service_role;

create or replace function public.cfu_lead_access()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from private.cfu_lead_area_ids()); $$;

create or replace function public.cfu_lead_members()
returns table(id uuid, first_name text, last_name text, description text, ratings jsonb, evaluated_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.id, m.first_name, m.last_name, m.description, m.ratings, m.evaluated_at
  from public.cfu_members m
  where m.area_id in (select private.cfu_lead_area_ids())
  order by m.last_name, m.first_name;
$$;

create or replace function public.cfu_lead_save(p_member uuid, p_description text, p_ratings jsonb)
returns void language plpgsql security definer set search_path = ''
as $$
declare
  v_keys constant text[] := array['competenza','autonomia','problem_solving','costanza','teamwork','comunicazione','sicurezza','documentazione','applicazione','coordinamento','innovazione','risorse','divulgazione','relazioni_esterne','feedback','correttezza'];
  v_levels constant text[] := array['ottimo','discreto','buono','sufficiente','insufficiente'];
  v_clean jsonb := '{}'::jsonb;
  v_key text;
  v_text text := btrim(coalesce(p_description, ''));
begin
  if not exists (select 1 from private.cfu_lead_area_ids()) then raise exception 'CFU_CLOSED'; end if;
  if char_length(v_text) > 4000 or p_ratings is null or jsonb_typeof(p_ratings) <> 'object' then raise exception 'CFU_INVALID'; end if;
  foreach v_key in array v_keys loop
    if p_ratings ? v_key then
      if jsonb_typeof(p_ratings -> v_key) <> 'string' or not ((p_ratings ->> v_key) = any (v_levels)) then raise exception 'CFU_INVALID'; end if;
      v_clean := v_clean || jsonb_build_object(v_key, p_ratings -> v_key);
    end if;
  end loop;
  update public.cfu_members
     set description = v_text, ratings = v_clean, evaluated_by = auth.uid(), evaluated_at = now()
   where id = p_member and area_id in (select private.cfu_lead_area_ids());
  if not found then raise exception 'CFU_NOT_FOUND'; end if;
end; $$;

create or replace function public.cfu_import_members()
returns integer language plpgsql security definer set search_path = ''
as $$
declare v_count integer;
begin
  if not private.is_cfu_manager() then raise exception 'CFU_FORBIDDEN'; end if;
  with src as (
    select btrim(r.data->>'firstName') as first_name, btrim(r.data->>'lastName') as last_name,
           btrim(coalesce(r.data->>'studentNumber', '')) as student_number,
           btrim(coalesce(r.data->>'degree', '')) as degree, btrim(coalesce(r.data->>'department', '')) as department,
           btrim(coalesce(r.data->>'area', '')) as division,
           btrim(coalesce(r.data->>'leadershipRole', '')) as team_role
    from public.membership_form_responses r
    where r.status = 'submitted' and coalesce(btrim(r.data->>'firstName'), '') <> '' and coalesce(btrim(r.data->>'lastName'), '') <> ''
  ), ins as (
    insert into public.cfu_members(first_name, last_name, student_number, degree, department, division, team_role, area_id)
    select s.first_name, s.last_name, s.student_number, s.degree, s.department, s.division, s.team_role,
           (select a.id from public.areas a where a.active and lower(a.name::text) = lower(s.division) limit 1)
    from src s
    where not exists (
      select 1 from public.cfu_members m
      where (s.student_number <> '' and lower(m.student_number) = lower(s.student_number))
         or (lower(m.first_name) = lower(s.first_name) and lower(m.last_name) = lower(s.last_name))
    )
    returning 1
  ) select count(*) into v_count from ins;
  return v_count;
end; $$;

create or replace function public.cfu_public_info()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'open', (select requests_open from public.cfu_settings),
    'areas', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name::text) order by a.name) from public.areas a where a.active), '[]'::jsonb)
  );
$$;

create or replace function public.cfu_submit_request(p_data jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_first text; v_last text; v_student text; v_degree text; v_dept text; v_division text; v_role text; v_prof text; v_prof_email text;
  v_area uuid; v_from date; v_to date; v_id uuid;
begin
  if not coalesce((select requests_open from public.cfu_settings), false) then raise exception 'CFU_REQUESTS_CLOSED'; end if;
  if p_data is null or jsonb_typeof(p_data) <> 'object' then raise exception 'CFU_INVALID'; end if;
  v_first := btrim(coalesce(p_data->>'first_name', '')); v_last := btrim(coalesce(p_data->>'last_name', ''));
  v_student := btrim(coalesce(p_data->>'student_number', '')); v_degree := btrim(coalesce(p_data->>'degree', ''));
  v_dept := btrim(coalesce(p_data->>'department', '')); v_division := btrim(coalesce(p_data->>'division', ''));
  v_role := btrim(coalesce(p_data->>'team_role', ''));
  v_prof := btrim(coalesce(p_data->>'professor_name', '')); v_prof_email := btrim(coalesce(p_data->>'professor_email', ''));
  if char_length(v_first) not between 1 and 120 or char_length(v_last) not between 1 and 120 or char_length(v_student) not between 1 and 40
     or char_length(v_degree) > 200 or char_length(v_dept) > 200 or char_length(v_division) > 200 or char_length(v_role) > 200
     or char_length(v_prof) not between 1 and 200 or char_length(v_prof_email) not between 3 and 200 or v_prof_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or char_length(v_degree) < 1 then
    raise exception 'CFU_INVALID';
  end if;
  begin
    v_area := nullif(p_data->>'area_id', '')::uuid;
    v_from := nullif(p_data->>'period_from', '')::date;
    v_to := nullif(p_data->>'period_to', '')::date;
  exception when others then raise exception 'CFU_INVALID';
  end;
  if v_area is not null and not exists (select 1 from public.areas where id = v_area and active) then raise exception 'CFU_INVALID'; end if;
  if v_from is not null and v_to is not null and v_to < v_from then raise exception 'CFU_INVALID'; end if;
  if exists (select 1 from public.cfu_members where lower(student_number) = lower(v_student)) then raise exception 'CFU_DUPLICATE'; end if;
  insert into public.cfu_members(first_name, last_name, student_number, degree, department, area_id, division, team_role, period_from, period_to, professor_name, professor_email)
    values (v_first, v_last, v_student, v_degree, v_dept, v_area, v_division, v_role, v_from, v_to, v_prof, v_prof_email)
    returning id into v_id;
  return v_id;
end; $$;

revoke all on function public.cfu_public_info(), public.cfu_submit_request(jsonb) from public;
grant execute on function public.cfu_public_info(), public.cfu_submit_request(jsonb) to anon, authenticated, service_role;

revoke all on function public.cfu_lead_access(), public.cfu_lead_members(), public.cfu_lead_save(uuid, text, jsonb), public.cfu_import_members() from public, anon;
grant execute on function public.cfu_lead_access(), public.cfu_lead_members(), public.cfu_lead_save(uuid, text, jsonb), public.cfu_import_members() to authenticated, service_role;
commit;
