begin;

alter table public.member_adhesions
  alter column submitted_by drop not null,
  alter column email drop not null,
  alter column first_name drop not null,
  alter column last_name drop not null,
  alter column student_number drop not null,
  alter column degree drop not null,
  alter column department drop not null,
  add column draft_id uuid unique,
  add column invitation_id uuid unique references public.membership_invitations(id) on delete cascade,
  add column status text not null default 'submitted' check (status in ('draft','submitted')),
  add column answers jsonb not null default '{}'::jsonb,
  add column updated_at timestamptz not null default now(),
  add column submitted_at timestamptz;

update public.member_adhesions m set
  answers=jsonb_build_object(
    'firstName',m.first_name,'lastName',m.last_name,'studentNumber',m.student_number,
    'degree',m.degree,'department',m.department,'institutionalEmail',m.email,
    'area',(select a.name from public.areas a where a.id=m.area_id)
  ),
  updated_at=m.created_at,
  submitted_at=m.created_at;

insert into public.member_adhesions(area_id,invitation_id,email,first_name,last_name,student_number,degree,department,status,answers,created_at,updated_at,submitted_at)
select i.area_id,i.id,
  coalesce(s.data->>'institutionalEmail',i.email),s.data->>'firstName',s.data->>'lastName',
  s.data->>'studentNumber',s.data->>'degree',s.data->>'department','submitted',s.data,
  s.created_at,s.created_at,coalesce(i.submitted_at,s.created_at)
from public.membership_submissions s
join public.membership_invitations i on i.id=s.invitation_id
on conflict(invitation_id) do nothing;

create or replace function private.membership_answers_valid(p_data jsonb)
returns boolean language sql immutable set search_path=''
as $$
  select jsonb_typeof(p_data)='object'
    and length(btrim(coalesce(p_data->>'firstName',''))) between 1 and 100
    and length(btrim(coalesce(p_data->>'lastName',''))) between 1 and 100
    and length(btrim(coalesce(p_data->>'degree',''))) between 2 and 180
    and length(btrim(coalesce(p_data->>'department',''))) between 2 and 180
    and length(btrim(coalesce(p_data->>'studentNumber',''))) between 1 and 30
    and (p_data->>'area') in (
      'Mobility Division','Manipulation Division','Electronics, RF & Power Supply Division',
      'Software, Nav & Controls Division','Geology Division','Life Detection Division',
      'Business Area','Marketing & Comm. Area','Logistics Area','Direzione tecnica/Responsabile'
    )
    and (
      (p_data->>'area'='Direzione tecnica/Responsabile' and (p_data->>'leadershipRole') in (
        'Team Leader','Engineering Director','Science Director','Head of Mobility Division',
        'Head of Manipulation Division','Head of Electronics, RF & Power Supply Division',
        'Head of Software, Nav & Controls Division','Head of Geology Division',
        'Head of Life Detection Division','Head of Business Area','Head of Marketing & Comm. Area',
        'Head of Logistics Area'
      )) or (p_data->>'area'<>'Direzione tecnica/Responsabile' and coalesce(p_data->>'leadershipRole','')='')
    )
    and p_data->>'commitmentsAccepted'='yes'
    and p_data->>'internalRegulationAccepted'='yes'
    and p_data->>'ipAccepted'='yes'
    and p_data->>'selfCertificationAccepted'='yes'
    and p_data->>'gdprAccepted'='yes'
    and length(btrim(coalesce(p_data->>'institutionalEmail','')))<=254
    and lower(coalesce(p_data->>'institutionalEmail','')) ~ '^[^[:space:]@]+@studenti[.]unipi[.]it$'
    and length(btrim(coalesce(p_data->>'phone',''))) between 3 and 40
    and length(coalesce(p_data->>'linkedin',''))<=500
    and p_data->>'privacyAccepted'='yes';
$$;
revoke all on function private.membership_answers_valid(jsonb) from public,anon,authenticated;
grant execute on function private.membership_answers_valid(jsonb) to service_role;

create or replace function public.get_membership_draft(p_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v public.membership_invitations%rowtype; v_answers jsonb;
begin
  select * into v from public.membership_invitations
  where token_hash=extensions.digest(p_token,'sha256');
  if v.id is null or v.revoked_at is not null or v.expires_at<now() then raise exception 'INVALID_INVITATION'; end if;
  if v.submitted_at is not null then
    select data into v_answers from public.membership_submissions where invitation_id=v.id;
    return jsonb_build_object('submitted',true,'answers',coalesce(v_answers,'{}'::jsonb));
  end if;
  select answers into v_answers from public.member_adhesions where invitation_id=v.id and status='draft';
  return jsonb_build_object('submitted',false,'answers',coalesce(v_answers,'{}'::jsonb));
end;
$$;

create or replace function public.save_membership_draft(p_token text,p_data jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.membership_invitations%rowtype; v_area uuid; v_answers jsonb; v_saved uuid;
begin
  select * into v from public.membership_invitations
  where token_hash=extensions.digest(p_token,'sha256') for update;
  if v.id is null or v.revoked_at is not null or v.expires_at<now() or v.submitted_at is not null then raise exception 'INVALID_INVITATION'; end if;
  v_answers:=coalesce(p_data,'{}'::jsonb);
  if coalesce(v_answers->>'area','')<>'Direzione tecnica/Responsabile' then v_answers:=v_answers-'leadershipRole'; end if;
  insert into public.member_adhesions(area_id,invitation_id,email,first_name,last_name,student_number,degree,department,status,answers,updated_at)
  values(v.area_id,v.id,nullif(btrim(v_answers->>'institutionalEmail'),''),nullif(btrim(v_answers->>'firstName'),''),nullif(btrim(v_answers->>'lastName'),''),nullif(btrim(v_answers->>'studentNumber'),''),nullif(btrim(v_answers->>'degree'),''),nullif(btrim(v_answers->>'department'),''),'draft',v_answers,now())
  on conflict(invitation_id) do update set
    email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
    student_number=excluded.student_number,degree=excluded.degree,department=excluded.department,
    answers=excluded.answers,updated_at=now()
  where public.member_adhesions.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
end;
$$;

create or replace function public.submit_membership(p_token text,p_data jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v public.membership_invitations%rowtype; v_answers jsonb; v_saved uuid; v_area_name text; v_date text;
begin
  select * into v from public.membership_invitations
  where token_hash=extensions.digest(p_token,'sha256') for update;
  if v.id is null or v.revoked_at is not null or v.expires_at<now() then raise exception 'INVALID_INVITATION'; end if;
  if v.submitted_at is not null then raise exception 'ALREADY_SUBMITTED'; end if;
  v_answers:=coalesce(p_data,'{}'::jsonb);
  if coalesce(v_answers->>'area','')<>'Direzione tecnica/Responsabile' then v_answers:=v_answers-'leadershipRole'; end if;
  if not private.membership_answers_valid(v_answers) then raise exception 'INVALID_DATA'; end if;
  v_date:=to_char(now() at time zone 'Europe/Rome','DD/MM/YYYY');
  select name into v_area_name from public.areas where id=v.area_id;
  insert into public.member_adhesions(area_id,invitation_id,email,first_name,last_name,student_number,degree,department,status,answers,updated_at,submitted_at)
  values(v.area_id,v.id,btrim(v_answers->>'institutionalEmail'),btrim(v_answers->>'firstName'),btrim(v_answers->>'lastName'),btrim(v_answers->>'studentNumber'),btrim(v_answers->>'degree'),btrim(v_answers->>'department'),'submitted',v_answers,now(),now())
  on conflict(invitation_id) do update set
    email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
    student_number=excluded.student_number,degree=excluded.degree,department=excluded.department,
    answers=excluded.answers,status='submitted',updated_at=now(),submitted_at=now()
  where public.member_adhesions.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
  insert into public.membership_submissions(invitation_id,data,created_at) values(v.id,v_answers,now());
  update public.membership_invitations set submitted_at=now() where id=v.id;
  insert into public.community_outbox(kind,recipient,payload)
  values('membership',btrim(v_answers->>'institutionalEmail'),jsonb_build_object(
    'firstName',btrim(v_answers->>'firstName'),'lastName',btrim(v_answers->>'lastName'),
    'studentNumber',btrim(v_answers->>'studentNumber'),'degree',btrim(v_answers->>'degree'),
    'department',btrim(v_answers->>'department'),'email',btrim(v_answers->>'institutionalEmail'),
    'date',v_date,'area',v_area_name
  ));
end;
$$;

create or replace function public.get_member_adhesion_draft(p_actor uuid,p_draft_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_answers jsonb; v_status text;
begin
  if not exists(select 1 from public.area_shared_accounts s join public.profiles p on p.id=s.user_id
    where s.user_id=p_actor and p.status='active' and not p.must_change_password) then raise exception 'FORBIDDEN'; end if;
  select answers,status into v_answers,v_status from public.member_adhesions where draft_id=p_draft_id and submitted_by=p_actor;
  return jsonb_build_object('submitted',coalesce(v_status='submitted',false),'answers',coalesce(v_answers,'{}'::jsonb));
end;
$$;

create or replace function public.save_member_adhesion_draft(p_actor uuid,p_draft_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_area uuid; v_answers jsonb; v_saved uuid;
begin
  select area_id into v_area from public.area_shared_accounts where user_id=p_actor;
  if v_area is null or not exists(select 1 from public.profiles where id=p_actor and status='active' and not must_change_password) then raise exception 'FORBIDDEN'; end if;
  if p_draft_id is null then raise exception 'INVALID_DATA'; end if;
  v_answers:=coalesce(p_data,'{}'::jsonb);
  if coalesce(v_answers->>'area','')<>'Direzione tecnica/Responsabile' then v_answers:=v_answers-'leadershipRole'; end if;
  insert into public.member_adhesions(area_id,submitted_by,draft_id,email,first_name,last_name,student_number,degree,department,status,answers,updated_at)
  values(v_area,p_actor,p_draft_id,nullif(btrim(v_answers->>'institutionalEmail'),''),nullif(btrim(v_answers->>'firstName'),''),nullif(btrim(v_answers->>'lastName'),''),nullif(btrim(v_answers->>'studentNumber'),''),nullif(btrim(v_answers->>'degree'),''),nullif(btrim(v_answers->>'department'),''),'draft',v_answers,now())
  on conflict(draft_id) do update set
    email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
    student_number=excluded.student_number,degree=excluded.degree,department=excluded.department,
    answers=excluded.answers,updated_at=now()
  where public.member_adhesions.submitted_by=p_actor and public.member_adhesions.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
end;
$$;

create or replace function public.submit_member_adhesion(p_actor uuid,p_draft_id uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_area uuid; v_answers jsonb; v_saved uuid; v_area_name text; v_date text;
begin
  select area_id into v_area from public.area_shared_accounts where user_id=p_actor;
  if v_area is null or not exists(select 1 from public.profiles where id=p_actor and status='active' and not must_change_password) then raise exception 'FORBIDDEN'; end if;
  if p_draft_id is null then raise exception 'INVALID_DATA'; end if;
  v_answers:=coalesce(p_data,'{}'::jsonb);
  if coalesce(v_answers->>'area','')<>'Direzione tecnica/Responsabile' then v_answers:=v_answers-'leadershipRole'; end if;
  if not private.membership_answers_valid(v_answers) then raise exception 'INVALID_DATA'; end if;
  v_date:=to_char(now() at time zone 'Europe/Rome','DD/MM/YYYY');
  select name into v_area_name from public.areas where id=v_area;
  insert into public.member_adhesions(area_id,submitted_by,draft_id,email,first_name,last_name,student_number,degree,department,status,answers,updated_at,submitted_at)
  values(v_area,p_actor,p_draft_id,btrim(v_answers->>'institutionalEmail'),btrim(v_answers->>'firstName'),btrim(v_answers->>'lastName'),btrim(v_answers->>'studentNumber'),btrim(v_answers->>'degree'),btrim(v_answers->>'department'),'submitted',v_answers,now(),now())
  on conflict(draft_id) do update set
    email=excluded.email,first_name=excluded.first_name,last_name=excluded.last_name,
    student_number=excluded.student_number,degree=excluded.degree,department=excluded.department,
    answers=excluded.answers,status='submitted',updated_at=now(),submitted_at=now()
  where public.member_adhesions.submitted_by=p_actor and public.member_adhesions.status='draft'
  returning id into v_saved;
  if v_saved is null then raise exception 'ALREADY_SUBMITTED'; end if;
  insert into public.community_outbox(kind,recipient,payload)
  values('membership',btrim(v_answers->>'institutionalEmail'),jsonb_build_object(
    'firstName',btrim(v_answers->>'firstName'),'lastName',btrim(v_answers->>'lastName'),
    'studentNumber',btrim(v_answers->>'studentNumber'),'degree',btrim(v_answers->>'degree'),
    'department',btrim(v_answers->>'department'),'email',btrim(v_answers->>'institutionalEmail'),
    'date',v_date,'area',v_area_name
  ));
end;
$$;

revoke all on function public.get_membership_draft(text),public.save_membership_draft(text,jsonb),
  public.submit_membership(text,jsonb),public.get_member_adhesion_draft(uuid,uuid),
  public.save_member_adhesion_draft(uuid,uuid,jsonb),public.submit_member_adhesion(uuid,uuid,jsonb)
  from public,anon,authenticated;
grant execute on function public.get_membership_draft(text),public.save_membership_draft(text,jsonb),
  public.submit_membership(text,jsonb),public.get_member_adhesion_draft(uuid,uuid),
  public.save_member_adhesion_draft(uuid,uuid,jsonb),public.submit_member_adhesion(uuid,uuid,jsonb)
  to service_role;

commit;

