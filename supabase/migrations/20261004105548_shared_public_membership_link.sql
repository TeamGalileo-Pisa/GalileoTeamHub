begin;

create table public.membership_form_links (
  id uuid primary key default gen_random_uuid(),
  public_token text not null unique,
  token_hash bytea not null unique,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index membership_form_links_one_active
  on public.membership_form_links ((true))
  where revoked_at is null;

create table public.membership_form_responses (
  id uuid primary key default gen_random_uuid(),
  link_id uuid not null references public.membership_form_links(id),
  draft_id uuid not null unique,
  data jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft','submitted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  submitted_at timestamptz
);

create unique index membership_form_responses_submitted_email
  on public.membership_form_responses (lower(data->>'institutionalEmail'))
  where status='submitted';

alter table public.membership_form_links enable row level security;
alter table public.membership_form_responses enable row level security;
revoke all on public.membership_form_links, public.membership_form_responses
  from public, anon, authenticated;
grant all on public.membership_form_links, public.membership_form_responses
  to service_role;

create function public.get_or_create_membership_form_link(p_actor uuid)
returns text language plpgsql security definer set search_path=''
as $$
declare v_token text;
begin
  if not exists (
    select 1 from public.profiles p
    join public.system_roles r on r.user_id=p.id
    where p.id=p_actor and p.status='active' and not p.must_change_password
      and r.role in ('admin','team_leader')
  ) then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtext('membership-form-public-link'));
  select public_token into v_token
  from public.membership_form_links where revoked_at is null;

  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(32), 'hex');
    insert into public.membership_form_links(public_token,token_hash,created_by)
    values(v_token,extensions.digest(v_token,'sha256'),p_actor);
  end if;
  return v_token;
end;
$$;

create function public.get_membership_shared_draft(p_token text,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_link uuid; v_response public.membership_form_responses%rowtype;
begin
  select id into v_link from public.membership_form_links
  where token_hash=extensions.digest(p_token,'sha256') and revoked_at is null;
  if v_link is null then return null; end if;

  select * into v_response from public.membership_form_responses
  where link_id=v_link and draft_id=p_draft_id;
  return jsonb_build_object(
    'shared',true,
    'submitted',coalesce(v_response.status='submitted',false),
    'answers',coalesce(v_response.data,'{}'::jsonb)
  );
end;
$$;

create function public.save_membership_shared_draft(
  p_token text,p_draft_id uuid,p_data jsonb
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_link uuid; v_saved uuid;
begin
  select id into v_link from public.membership_form_links
  where token_hash=extensions.digest(p_token,'sha256') and revoked_at is null
  for update;
  if v_link is null then return false; end if;
  if p_draft_id is null or jsonb_typeof(p_data)<>'object' then
    raise exception 'INVALID_DATA';
  end if;
  insert into public.membership_form_responses(link_id,draft_id,data,status,updated_at)
  values(v_link,p_draft_id,coalesce(p_data,'{}'::jsonb),'draft',now())
  on conflict(draft_id) do update set
    data=excluded.data,updated_at=now()
  where public.membership_form_responses.link_id=v_link
    and public.membership_form_responses.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
  return true;
end;
$$;

create function public.submit_membership_shared_form(
  p_token text,p_draft_id uuid,p_data jsonb
)
returns boolean language plpgsql security definer set search_path=''
as $$
declare
  v_link uuid; v_saved uuid; v_answers jsonb; v_date text;
begin
  select id into v_link from public.membership_form_links
  where token_hash=extensions.digest(p_token,'sha256') and revoked_at is null
  for update;
  if v_link is null then return false; end if;
  if p_draft_id is null then raise exception 'INVALID_DATA'; end if;
  v_answers:=coalesce(p_data,'{}'::jsonb);
  if coalesce(v_answers->>'area','')<>'Direzione tecnica/Responsabile' then
    v_answers:=v_answers-'leadershipRole';
  end if;
  if not private.membership_answers_valid(v_answers) then
    raise exception 'INVALID_DATA';
  end if;
  if exists (
    select 1 from public.membership_form_responses
    where status='submitted' and draft_id<>p_draft_id
      and lower(data->>'institutionalEmail')=
        lower(btrim(v_answers->>'institutionalEmail'))
  ) then raise exception 'DUPLICATE_MEMBERSHIP'; end if;
  if exists (
    select 1 from public.member_adhesions
    where status='submitted'
      and lower(email)=lower(btrim(v_answers->>'institutionalEmail'))
  ) then raise exception 'DUPLICATE_MEMBERSHIP'; end if;
  v_date:=to_char(now() at time zone 'Europe/Rome','DD/MM/YYYY');
  insert into public.membership_form_responses(
    link_id,draft_id,data,status,updated_at,submitted_at
  ) values(v_link,p_draft_id,v_answers,'submitted',now(),now())
  on conflict(draft_id) do update set
    data=excluded.data,status='submitted',updated_at=now(),submitted_at=now()
  where public.membership_form_responses.link_id=v_link
    and public.membership_form_responses.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
  insert into public.community_outbox(kind,recipient,payload)
  values(
    'membership',
    lower(btrim(v_answers->>'institutionalEmail')),
    jsonb_build_object(
      'firstName',btrim(v_answers->>'firstName'),
      'lastName',btrim(v_answers->>'lastName'),
      'studentNumber',btrim(v_answers->>'studentNumber'),
      'degree',btrim(v_answers->>'degree'),
      'department',btrim(v_answers->>'department'),
      'email',lower(btrim(v_answers->>'institutionalEmail')),
      'date',v_date,
      'area',v_answers->>'area'
    )
  );
  return true;
end;
$$;

revoke all on function public.get_or_create_membership_form_link(uuid),
  public.get_membership_shared_draft(text,uuid),
  public.save_membership_shared_draft(text,uuid,jsonb),
  public.submit_membership_shared_form(text,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_or_create_membership_form_link(uuid),
  public.get_membership_shared_draft(text,uuid),
  public.save_membership_shared_draft(text,uuid,jsonb),
  public.submit_membership_shared_form(text,uuid,jsonb)
  to service_role;

commit;

