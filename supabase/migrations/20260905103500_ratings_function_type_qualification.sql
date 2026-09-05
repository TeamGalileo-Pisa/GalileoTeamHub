begin;

-- Security-definer functions use an empty search_path. Qualify the citext type
-- explicitly so rating create/update cannot depend on the caller's search path.
create or replace function public.create_candidate_rating(
  p_area_id uuid,p_first_name text,p_last_name text,p_email text,
  p_course_of_study text,p_interview_date date,p_score integer,p_comment text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_id uuid;
begin
  if private.is_admin() or p_area_id not in (select private.user_area_ids()) then
    raise exception 'FORBIDDEN';
  end if;
  if p_score<1 or p_score>30 then raise exception 'INVALID_SCORE'; end if;

  insert into public.candidate_ratings(
    area_id,created_by,first_name,last_name,email,course_of_study,
    interview_date,score,comment
  ) values(
    p_area_id,auth.uid(),pg_catalog.btrim(p_first_name),pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email))::public.citext,
    pg_catalog.btrim(p_course_of_study),p_interview_date,p_score,
    nullif(pg_catalog.btrim(coalesce(p_comment,'')),'')
  ) returning id into v_id;

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,area_id
  ) values(
    auth.uid(),'staff','candidate_rating.created','candidate_rating',v_id,p_area_id
  );
  return v_id;
end;
$$;

create or replace function public.update_candidate_rating(
  p_id uuid,p_area_id uuid,p_first_name text,p_last_name text,p_email text,
  p_course_of_study text,p_interview_date date,p_score integer,p_comment text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_old_area uuid;
begin
  if private.is_admin() then raise exception 'READ_ONLY_ADMIN'; end if;

  select area_id into v_old_area
  from public.candidate_ratings
  where id=p_id
  for update;

  if v_old_area is null
     or v_old_area not in (select private.user_area_ids())
     or p_area_id not in (select private.user_area_ids()) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;
  if p_score<1 or p_score>30 then raise exception 'INVALID_SCORE'; end if;

  update public.candidate_ratings
  set area_id=p_area_id,
      first_name=pg_catalog.btrim(p_first_name),
      last_name=pg_catalog.btrim(p_last_name),
      email=pg_catalog.lower(pg_catalog.btrim(p_email))::public.citext,
      course_of_study=pg_catalog.btrim(p_course_of_study),
      interview_date=p_interview_date,
      score=p_score,
      comment=nullif(pg_catalog.btrim(coalesce(p_comment,'')),''),
      updated_at=pg_catalog.now()
  where id=p_id;

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,area_id
  ) values(
    auth.uid(),'staff','candidate_rating.updated','candidate_rating',p_id,p_area_id
  );
end;
$$;

revoke all on function public.create_candidate_rating(uuid,text,text,text,text,date,integer,text) from public,anon;
revoke all on function public.update_candidate_rating(uuid,uuid,text,text,text,text,date,integer,text) from public,anon;
grant execute on function public.create_candidate_rating(uuid,text,text,text,text,date,integer,text) to authenticated;
grant execute on function public.update_candidate_rating(uuid,uuid,text,text,text,text,date,integer,text) to authenticated;

commit;
