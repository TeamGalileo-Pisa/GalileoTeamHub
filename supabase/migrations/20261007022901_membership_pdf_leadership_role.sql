-- Il PDF di adesione deve riportare anche il ruolo di Direzione tecnica
-- (es. "Head of Geology Division") accanto all'area "Direzione tecnica/Responsabile".
begin;

create or replace function public.submit_membership_shared_form(p_token text, p_draft_id uuid, p_data jsonb)
returns boolean
language plpgsql
security definer
set search_path to ''
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
      'area',v_answers->>'area',
      'leadershipRole',coalesce(v_answers->>'leadershipRole','')
    )
  );
  return true;
end;
$$;

commit;
