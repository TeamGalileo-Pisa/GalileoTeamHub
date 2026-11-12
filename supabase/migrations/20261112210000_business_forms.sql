begin;

-- FORM BUSINESS: form dinamici creati da Team Leader, Capo Business e membri Business,
-- compilati dai Capi Area tramite link riservato. Stesso schema delle candidature:
-- una riga per compilazione con l'account di chi risponde e le risposte in un jsonb.

create or replace function private.can_manage_business_forms()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.staff_ready() and (
    private.is_admin()
    or exists (select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
               where m.user_id = auth.uid() and m.ended_at is null and a.slug = 'business' and a.active)
    or exists (select 1 from public.area_shared_accounts s join public.areas a on a.id = s.area_id
               where s.user_id = auth.uid() and a.slug = 'business' and a.active)
  );
$$;

create or replace function private.can_answer_business_forms()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.staff_ready() and exists (
    select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
    where m.user_id = auth.uid() and m.role = 'area_lead' and m.ended_at is null and a.active
  );
$$;
revoke all on function private.can_manage_business_forms(), private.can_answer_business_forms() from public, anon;
grant execute on function private.can_manage_business_forms(), private.can_answer_business_forms() to authenticated, service_role;

create table public.business_forms (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 2 and 160),
  description text not null default '' check (char_length(description) <= 2000),
  is_open boolean not null default false,
  share_token text not null unique default (replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.business_form_questions (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.business_forms(id) on delete cascade,
  position integer not null default 0,
  label text not null check (char_length(btrim(label)) between 2 and 300),
  help text not null default '' check (char_length(help) <= 500),
  kind text not null check (kind in ('short_text', 'long_text', 'single_choice', 'multiple_choice', 'yes_no', 'number', 'rating', 'date')),
  options jsonb not null default '[]'::jsonb check (jsonb_typeof(options) = 'array'),
  required boolean not null default false,
  archived_at timestamptz,
  created_at timestamptz not null default now()
);
create index business_form_questions_form_idx on public.business_form_questions(form_id, position);

create table public.business_form_responses (
  id uuid primary key default gen_random_uuid(),
  form_id uuid not null references public.business_forms(id) on delete cascade,
  respondent_id uuid references public.profiles(id) on delete set null,
  respondent_name text not null,
  respondent_username text not null default '',
  area_names text not null default '',
  answers jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index business_form_responses_form_idx on public.business_form_responses(form_id, created_at desc);
create index business_form_responses_respondent_idx on public.business_form_responses(respondent_id);

alter table public.business_forms enable row level security;
alter table public.business_form_questions enable row level security;
alter table public.business_form_responses enable row level security;
revoke all on public.business_forms, public.business_form_questions, public.business_form_responses from public, anon, authenticated;
grant select, insert, update, delete on public.business_forms, public.business_form_questions to authenticated;
grant select, delete on public.business_form_responses to authenticated;
grant all on public.business_forms, public.business_form_questions, public.business_form_responses to service_role;

create policy business_forms_manage on public.business_forms for all to authenticated
  using (private.can_manage_business_forms()) with check (private.can_manage_business_forms());
create policy business_form_questions_manage on public.business_form_questions for all to authenticated
  using (private.can_manage_business_forms()) with check (private.can_manage_business_forms());
create policy business_form_responses_read on public.business_form_responses for select to authenticated
  using (private.can_manage_business_forms());
create policy business_form_responses_delete on public.business_form_responses for delete to authenticated
  using (private.can_manage_business_forms());

create or replace function private.touch_business_form()
returns trigger language plpgsql set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;
create trigger business_forms_touch before update on public.business_forms
  for each row execute function private.touch_business_form();
revoke all on function private.touch_business_form() from public, anon, authenticated;

-- Domande attive del form + dati del form, per chi compila (Capi Area) e per chi gestisce (anteprima).
create or replace function public.business_form_for_response(p_token text)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_form public.business_forms%rowtype;
begin
  if not (private.can_answer_business_forms() or private.can_manage_business_forms()) then
    raise exception 'BUSINESS_FORM_FORBIDDEN';
  end if;
  select * into v_form from public.business_forms where share_token = btrim(coalesce(p_token, ''));
  if not found then raise exception 'BUSINESS_FORM_NOT_FOUND'; end if;
  return jsonb_build_object(
    'id', v_form.id, 'title', v_form.title, 'description', v_form.description, 'is_open', v_form.is_open,
    'can_answer', private.can_answer_business_forms(),
    'questions', coalesce((
      select jsonb_agg(jsonb_build_object('id', q.id, 'label', q.label, 'help', q.help, 'kind', q.kind,
                                          'options', q.options, 'required', q.required) order by q.position, q.created_at)
      from public.business_form_questions q where q.form_id = v_form.id and q.archived_at is null
    ), '[]'::jsonb)
  );
end; $$;

create or replace function public.submit_business_form(p_token text, p_answers jsonb)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  v_form public.business_forms%rowtype;
  v_q record;
  v_raw jsonb;
  v_clean jsonb := '{}'::jsonb;
  v_name text; v_username text; v_areas text; v_id uuid;
  v_text text; v_max integer;
begin
  if not private.can_answer_business_forms() then raise exception 'BUSINESS_FORM_FORBIDDEN'; end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then raise exception 'BUSINESS_FORM_INVALID'; end if;
  select * into v_form from public.business_forms where share_token = btrim(coalesce(p_token, '')) for share;
  if not found then raise exception 'BUSINESS_FORM_NOT_FOUND'; end if;
  if not v_form.is_open then raise exception 'BUSINESS_FORM_CLOSED'; end if;

  for v_q in select * from public.business_form_questions q where q.form_id = v_form.id and q.archived_at is null order by q.position loop
    v_raw := p_answers -> v_q.id::text;
    if v_raw is null or v_raw = 'null'::jsonb
       or (jsonb_typeof(v_raw) = 'string' and btrim(v_raw #>> '{}') = '')
       or (jsonb_typeof(v_raw) = 'array' and jsonb_array_length(v_raw) = 0) then
      if v_q.required then raise exception 'BUSINESS_FORM_REQUIRED:%', v_q.label; end if;
      continue;
    end if;
    if v_q.kind in ('short_text', 'long_text') then
      if jsonb_typeof(v_raw) <> 'string' then raise exception 'BUSINESS_FORM_INVALID'; end if;
      v_text := btrim(v_raw #>> '{}');
      v_max := case when v_q.kind = 'short_text' then 300 else 4000 end;
      if char_length(v_text) > v_max then raise exception 'BUSINESS_FORM_TOO_LONG'; end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, to_jsonb(v_text));
    elsif v_q.kind = 'single_choice' then
      if jsonb_typeof(v_raw) <> 'string' or not (v_q.options @> to_jsonb(v_raw #>> '{}')) then raise exception 'BUSINESS_FORM_INVALID'; end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_raw);
    elsif v_q.kind = 'multiple_choice' then
      if jsonb_typeof(v_raw) <> 'array' or exists (select 1 from jsonb_array_elements(v_raw) e where jsonb_typeof(e) <> 'string' or not (v_q.options @> e)) then
        raise exception 'BUSINESS_FORM_INVALID';
      end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, (select jsonb_agg(distinct e) from jsonb_array_elements(v_raw) e));
    elsif v_q.kind = 'yes_no' then
      if jsonb_typeof(v_raw) <> 'boolean' then raise exception 'BUSINESS_FORM_INVALID'; end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_raw);
    elsif v_q.kind = 'number' then
      if jsonb_typeof(v_raw) <> 'number' then raise exception 'BUSINESS_FORM_INVALID'; end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_raw);
    elsif v_q.kind = 'rating' then
      if jsonb_typeof(v_raw) <> 'number' or (v_raw #>> '{}')::numeric not between 1 and 5 or (v_raw #>> '{}')::numeric <> trunc((v_raw #>> '{}')::numeric) then
        raise exception 'BUSINESS_FORM_INVALID';
      end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_raw);
    elsif v_q.kind = 'date' then
      if jsonb_typeof(v_raw) <> 'string' or (v_raw #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'BUSINESS_FORM_INVALID'; end if;
      v_clean := v_clean || jsonb_build_object(v_q.id::text, v_raw);
    end if;
  end loop;

  select coalesce(p.display_name, 'Utente'), p.username::text into v_name, v_username from public.profiles p where p.id = auth.uid();
  select coalesce(string_agg(a.name, ', ' order by a.name), '') into v_areas
    from public.area_memberships m join public.areas a on a.id = m.area_id
    where m.user_id = auth.uid() and m.role = 'area_lead' and m.ended_at is null and a.active;

  insert into public.business_form_responses(form_id, respondent_id, respondent_name, respondent_username, area_names, answers)
    values (v_form.id, auth.uid(), coalesce(v_name, 'Utente'), coalesce(v_username, ''), v_areas, v_clean)
    returning id into v_id;
  return v_id;
end; $$;

-- Capi Area che non hanno ancora compilato il form (per chi gestisce).
create or replace function public.business_form_pending_leads(p_form uuid)
returns table(user_id uuid, name text, area_names text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_manage_business_forms() then raise exception 'BUSINESS_FORM_FORBIDDEN'; end if;
  return query
  select p.id, coalesce(p.display_name, 'Utente'), string_agg(a.name, ', ' order by a.name)
  from public.area_memberships m
  join public.areas a on a.id = m.area_id and a.active
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.role = 'area_lead' and m.ended_at is null
    and not exists (select 1 from public.business_form_responses r where r.form_id = p_form and r.respondent_id = p.id)
  group by p.id, p.display_name
  order by 2;
end; $$;

create or replace function public.reorder_business_form_questions(p_form uuid, p_ids uuid[])
returns void language plpgsql security definer set search_path = ''
as $$
declare v_i integer := 0; v_id uuid;
begin
  if not private.can_manage_business_forms() then raise exception 'BUSINESS_FORM_FORBIDDEN'; end if;
  foreach v_id in array coalesce(p_ids, '{}') loop
    update public.business_form_questions set position = v_i where id = v_id and form_id = p_form;
    v_i := v_i + 1;
  end loop;
  update public.business_forms set updated_at = now() where id = p_form;
end; $$;

revoke all on function public.business_form_for_response(text), public.submit_business_form(text, jsonb),
  public.business_form_pending_leads(uuid), public.reorder_business_form_questions(uuid, uuid[]) from public, anon;
grant execute on function public.business_form_for_response(text), public.submit_business_form(text, jsonb),
  public.business_form_pending_leads(uuid), public.reorder_business_form_questions(uuid, uuid[]) to authenticated, service_role;

commit;
