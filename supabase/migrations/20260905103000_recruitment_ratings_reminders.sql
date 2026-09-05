begin;

-- Recruitment lifecycle: archive operational records without destroying history.
alter table public.area_allocations add column if not exists archived_at timestamptz;
alter table public.interview_sessions add column if not exists archived_at timestamptz;
alter table public.slots add column if not exists archived_at timestamptz;
alter table public.bookings add column if not exists archived_at timestamptz;

create index if not exists area_allocations_archived_idx
  on public.area_allocations(archived_at) where archived_at is null;
create index if not exists interview_sessions_archived_idx
  on public.interview_sessions(archived_at) where archived_at is null;
create index if not exists slots_archived_idx
  on public.slots(archived_at) where archived_at is null;
create index if not exists bookings_archived_idx
  on public.bookings(archived_at) where archived_at is null;

-- Area leads can claim several daily windows in one atomic operation, with an
-- independent start/end interval for each selected day.
create or replace function public.claim_room_allocations_batch(
  p_campaign_area_id uuid,
  p_ranges jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_item jsonb;
  v_availability_id uuid;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
  v_id uuid;
  v_ids uuid[] := array[]::uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);

  if not private.can_manage_campaign_area(p_campaign_area_id) then
    raise exception 'FORBIDDEN';
  end if;
  if pg_catalog.jsonb_typeof(p_ranges) <> 'array'
     or pg_catalog.jsonb_array_length(p_ranges) < 1
     or pg_catalog.jsonb_array_length(p_ranges) > 60 then
    raise exception 'INVALID_ALLOCATION_BATCH';
  end if;

  for v_item in select value from pg_catalog.jsonb_array_elements(p_ranges)
  loop
    begin
      v_availability_id := (v_item->>'availabilityId')::uuid;
      v_starts_at := (v_item->>'startsAt')::timestamptz;
      v_ends_at := (v_item->>'endsAt')::timestamptz;
    exception when others then
      raise exception 'INVALID_ALLOCATION_BATCH';
    end;

    if v_ends_at <= v_starts_at then
      raise exception 'INVALID_TIME_RANGE';
    end if;

    v_id := public.claim_room_allocation(
      v_availability_id,
      p_campaign_area_id,
      v_starts_at,
      v_ends_at
    );
    v_ids := pg_catalog.array_append(v_ids, v_id);
  end loop;

  return pg_catalog.jsonb_build_object(
    'count', pg_catalog.cardinality(v_ids),
    'ids', v_ids
  );
end;
$$;

-- Archive a recruitment and every operational event created under it. The
-- shared room availability remains available for other/future recruitments.
create or replace function public.archive_campaign(
  p_campaign_id uuid,
  p_delete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_campaign public.recruitment_campaigns%rowtype;
  v_now timestamptz := pg_catalog.now();
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;

  select * into v_campaign
  from public.recruitment_campaigns
  where id=p_campaign_id
  for update;
  if v_campaign.id is null then raise exception 'CAMPAIGN_NOT_FOUND'; end if;

  if p_delete then
    -- Remove all candidate-facing data belonging only to this recruitment.
    delete from public.booking_privacy_consents pc
    where pc.booking_id in (
      select b.id
      from public.bookings b
      join public.slots sl on sl.id=b.slot_id
      join public.interview_sessions s on s.id=sl.session_id
      join public.area_allocations al on al.id=s.allocation_id
      join public.campaign_areas ca on ca.id=al.campaign_area_id
      where ca.campaign_id=p_campaign_id
    );

    delete from public.email_deliveries d
    where d.booking_id in (
      select b.id
      from public.bookings b
      join public.slots sl on sl.id=b.slot_id
      join public.interview_sessions s on s.id=sl.session_id
      join public.area_allocations al on al.id=s.allocation_id
      join public.campaign_areas ca on ca.id=al.campaign_area_id
      where ca.campaign_id=p_campaign_id
    );

    -- Audit rows for a permanently removed recruitment must not retain a
    -- recoverable copy of the recruitment/candidate workflow.
    delete from public.audit_logs where campaign_id=p_campaign_id;
    delete from public.audit_logs
    where entity_type='candidate'
      and entity_id in (select id from public.candidates where campaign_id=p_campaign_id);

    delete from public.bookings b
    using public.slots sl,
          public.interview_sessions s,
          public.area_allocations al,
          public.campaign_areas ca
    where b.slot_id=sl.id
      and sl.session_id=s.id
      and s.allocation_id=al.id
      and al.campaign_area_id=ca.id
      and ca.campaign_id=p_campaign_id;

    delete from public.booking_links bl
    using public.interview_sessions s,
          public.area_allocations al,
          public.campaign_areas ca
    where bl.session_id=s.id
      and s.allocation_id=al.id
      and al.campaign_area_id=ca.id
      and ca.campaign_id=p_campaign_id;

    delete from public.slots sl
    using public.interview_sessions s,
          public.area_allocations al,
          public.campaign_areas ca
    where sl.session_id=s.id
      and s.allocation_id=al.id
      and al.campaign_area_id=ca.id
      and ca.campaign_id=p_campaign_id;

    delete from public.interview_sessions s
    using public.area_allocations al, public.campaign_areas ca
    where s.allocation_id=al.id
      and al.campaign_area_id=ca.id
      and ca.campaign_id=p_campaign_id;

    delete from public.area_allocations al
    using public.campaign_areas ca
    where al.campaign_area_id=ca.id and ca.campaign_id=p_campaign_id;

    delete from public.candidates where campaign_id=p_campaign_id;
    delete from public.campaign_areas where campaign_id=p_campaign_id;
    delete from public.recruitment_campaigns where id=p_campaign_id;
    return;
  end if;

  update public.recruitment_campaigns
  set status='archived', updated_at=v_now
  where id=p_campaign_id;

  update public.campaign_areas
  set active=false
  where campaign_id=p_campaign_id;

  update public.booking_links bl
  set status='revoked', revoked_at=coalesce(bl.revoked_at,v_now)
  where bl.status='active'
    and bl.session_id in (
      select s.id
      from public.interview_sessions s
      join public.area_allocations al on al.id=s.allocation_id
      join public.campaign_areas ca on ca.id=al.campaign_area_id
      where ca.campaign_id=p_campaign_id
    );

  update public.bookings b
  set archived_at=coalesce(b.archived_at,v_now)
  where b.slot_id in (
    select sl.id
    from public.slots sl
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    where ca.campaign_id=p_campaign_id
  );

  update public.slots sl
  set status='disabled', archived_at=coalesce(sl.archived_at,v_now)
  where sl.session_id in (
    select s.id
    from public.interview_sessions s
    join public.area_allocations al on al.id=s.allocation_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    where ca.campaign_id=p_campaign_id
  );

  update public.interview_sessions s
  set status='closed', archived_at=coalesce(s.archived_at,v_now)
  where s.allocation_id in (
    select al.id
    from public.area_allocations al
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    where ca.campaign_id=p_campaign_id
  );

  update public.area_allocations al
  set status='cancelled',
      cancelled_by=coalesce(al.cancelled_by,auth.uid()),
      cancelled_at=coalesce(al.cancelled_at,v_now),
      archived_at=coalesce(al.archived_at,v_now)
  where al.campaign_area_id in (
    select id from public.campaign_areas where campaign_id=p_campaign_id
  );

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,campaign_id,after_value
  ) values(
    auth.uid(),'staff','campaign.archived','recruitment_campaign',p_campaign_id,
    p_campaign_id,pg_catalog.jsonb_build_object('status','archived')
  );
end;
$$;

-- Route the existing editor through the new archive/delete lifecycle.
create or replace function public.manage_campaign(
  p_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_status public.campaign_status,
  p_delete boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.recruitment_campaigns%rowtype;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  select * into strict v_old from public.recruitment_campaigns where id=p_id for update;

  if p_delete then
    perform public.archive_campaign(p_id,true);
    return;
  end if;

  if v_old.status='archived' and p_status<>'archived' then
    raise exception 'ARCHIVED_CAMPAIGN_IMMUTABLE';
  end if;

  update public.recruitment_campaigns
  set name=pg_catalog.btrim(p_name),
      starts_on=p_starts_on,
      ends_on=p_ends_on
  where id=p_id;

  if p_status='archived' then
    perform public.archive_campaign(p_id,false);
    return;
  end if;

  update public.recruitment_campaigns set status=p_status where id=p_id;
  if p_status='active' then perform public.activate_campaign(p_id); end if;

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,before_value,after_value
  ) values(
    auth.uid(),'staff','campaign.updated','recruitment_campaign',p_id,
    to_jsonb(v_old),pg_catalog.jsonb_build_object('name',p_name,'status',p_status)
  );
end;
$$;

-- Archived recruitment data must disappear from operational session/allocation
-- and calendar views while remaining in the database until explicit deletion.
create or replace function public.list_interview_sessions()
returns table(
  id uuid,
  name text,
  area_id uuid,
  area_name text,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  status public.session_status,
  available_slots integer,
  booked_slots integer,
  booking_link_active boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    s.id,s.name,ca.area_id,ar.name::text,r.name::text,al.starts_at,al.ends_at,s.status,
    (select count(*)::integer from public.slots sl
      where sl.session_id=s.id and sl.deleted_at is null and sl.archived_at is null
        and sl.status='available'
        and not exists(select 1 from public.bookings b where b.slot_id=sl.id and b.status='confirmed' and b.archived_at is null)),
    (select count(*)::integer from public.slots sl
      join public.bookings b on b.slot_id=sl.id
      where sl.session_id=s.id and sl.deleted_at is null and sl.archived_at is null
        and b.status='confirmed' and b.archived_at is null),
    (s.status in ('draft','published') and exists(
      select 1 from public.area_booking_links abl
      where abl.area_id=ca.area_id and abl.status='active'))
  from public.interview_sessions s
  join public.area_allocations al on al.id=s.allocation_id
  join public.room_availabilities ra on ra.id=al.room_availability_id
  join public.rooms r on r.id=ra.room_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  join public.recruitment_campaigns c on c.id=ca.campaign_id
  join public.areas ar on ar.id=ca.area_id
  where s.deleted_at is null
    and s.archived_at is null
    and al.archived_at is null
    and c.status='active'
    and ca.active
    and ra.deleted_at is null
    and r.deleted_at is null
    and (private.is_admin() or ca.area_id in (select private.user_area_ids()))
  order by al.starts_at desc;
$$;

create or replace function public.list_my_allocations()
returns table(
  id uuid,
  campaign_area_id uuid,
  area_name text,
  room_name text,
  starts_at timestamptz,
  ends_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select al.id,al.campaign_area_id,ar.name::text,r.name::text,al.starts_at,al.ends_at
  from public.area_allocations al
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  join public.recruitment_campaigns c on c.id=ca.campaign_id
  join public.areas ar on ar.id=ca.area_id
  join public.room_availabilities ra on ra.id=al.room_availability_id
  join public.rooms r on r.id=ra.room_id
  where al.status='active'
    and al.archived_at is null
    and ca.active
    and c.status='active'
    and ra.status='active'
    and private.can_manage_campaign_area(al.campaign_area_id)
  order by al.starts_at;
$$;

create or replace function public.list_calendar_bookings(
  p_start timestamptz,
  p_end timestamptz,
  p_area_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not private.staff_ready() then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '367 days' then
    raise exception 'INVALID_TIME_RANGE';
  end if;

  select coalesce(pg_catalog.jsonb_agg(item order by (item->>'startsAt')::timestamptz,item->>'kind'),'[]'::jsonb)
  into v_result
  from (
    select pg_catalog.jsonb_build_object(
      'kind','booking','bookingId',b.id,'slotId',sl.id,'sessionId',s.id,
      'candidateName',c.first_name||' '||c.last_name,'candidateEmail',c.email::text,
      'areaName',ar.name::text,'areaId',ar.id,'roomName',r.name::text,
      'startsAt',sl.starts_at,'endsAt',sl.ends_at,'status',b.status,
      'campaignId',ca.campaign_id,'sessionName',s.name
    ) item
    from public.bookings b
    join public.candidates c on c.id=b.candidate_id
    join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.room_availabilities ra on ra.id=al.room_availability_id
    join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    join public.recruitment_campaigns campaign on campaign.id=ca.campaign_id
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and campaign.status='active' and ca.active
      and al.archived_at is null and s.archived_at is null
      and sl.archived_at is null and b.archived_at is null
      and s.deleted_at is null and sl.deleted_at is null

    union all

    select pg_catalog.jsonb_build_object(
      'kind','free','bookingId',null,'slotId',sl.id,'sessionId',s.id,
      'candidateName',null,'candidateEmail',null,'areaName',ar.name::text,
      'areaId',ar.id,'roomName',r.name::text,'startsAt',sl.starts_at,'endsAt',sl.ends_at,
      'status','available','campaignId',ca.campaign_id,'sessionName',s.name
    ) item
    from public.slots sl
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.room_availabilities ra on ra.id=al.room_availability_id
    join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    join public.recruitment_campaigns campaign on campaign.id=ca.campaign_id
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and campaign.status='active' and ca.active
      and sl.status='available' and s.status in ('draft','published')
      and al.status='active' and ra.status='active'
      and al.archived_at is null and s.archived_at is null and sl.archived_at is null
      and s.deleted_at is null and sl.deleted_at is null
      and not exists(select 1 from public.bookings b2 where b2.slot_id=sl.id and b2.status='confirmed' and b2.archived_at is null)
  ) src;
  return v_result;
end;
$$;

-- Preserve a custom reminder message in the immutable email payload snapshot.
create or replace function private.snapshot_email_payload()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.payload := private.booking_email_payload(new.booking_id)
    || coalesce(new.payload,'{}'::jsonb);
  return new;
end;
$$;

create or replace function public.send_booking_reminder(
  p_booking_id uuid,
  p_message text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_id uuid;
  v_area_id uuid;
  v_delivery_id uuid;
  v_message text := pg_catalog.btrim(coalesce(p_message,''));
begin
  if private.is_admin() then raise exception 'AREA_LEAD_ONLY'; end if;
  if pg_catalog.char_length(v_message)<1 or pg_catalog.char_length(v_message)>2000 then
    raise exception 'INVALID_REMINDER_MESSAGE';
  end if;

  select s.id,ca.area_id into v_session_id,v_area_id
  from public.bookings b
  join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id
  where b.id=p_booking_id and b.status='confirmed' and b.archived_at is null;

  if v_session_id is null or not private.can_manage_session(v_session_id) then
    raise exception 'FORBIDDEN_OR_NOT_FOUND';
  end if;

  insert into public.email_deliveries(booking_id,kind,idempotency_key,payload)
  values(
    p_booking_id,'booking_reminder',
    p_booking_id::text||':manual_reminder:'||extensions.gen_random_uuid()::text,
    pg_catalog.jsonb_build_object('custom_message',v_message)
  ) returning id into v_delivery_id;

  insert into public.audit_logs(
    actor_user_id,actor_type,action,entity_type,entity_id,area_id,after_value
  ) values(
    auth.uid(),'staff','booking.reminder_sent','booking',p_booking_id,v_area_id,
    pg_catalog.jsonb_build_object('delivery_id',v_delivery_id)
  );
  return v_delivery_id;
end;
$$;

-- Ratings / interview judgements ------------------------------------------------
create table if not exists public.candidate_ratings(
  id uuid primary key default extensions.gen_random_uuid(),
  area_id uuid not null references public.areas(id) on delete restrict,
  created_by uuid not null references public.profiles(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email citext not null,
  course_of_study text not null,
  interview_date date not null,
  score smallint not null,
  comment text,
  archived_at timestamptz,
  created_at timestamptz not null default pg_catalog.now(),
  updated_at timestamptz not null default pg_catalog.now(),
  constraint candidate_ratings_first_name check (pg_catalog.char_length(pg_catalog.btrim(first_name)) between 1 and 80),
  constraint candidate_ratings_last_name check (pg_catalog.char_length(pg_catalog.btrim(last_name)) between 1 and 80),
  constraint candidate_ratings_email check (pg_catalog.char_length(email::text) between 3 and 254),
  constraint candidate_ratings_course check (pg_catalog.char_length(pg_catalog.btrim(course_of_study)) between 2 and 160),
  constraint candidate_ratings_score check (score between 1 and 30),
  constraint candidate_ratings_comment check (comment is null or pg_catalog.char_length(comment)<=5000)
);
create index if not exists candidate_ratings_area_idx on public.candidate_ratings(area_id,created_at desc);
alter table public.candidate_ratings enable row level security;
revoke all on table public.candidate_ratings from anon, authenticated;

create or replace function public.list_candidate_ratings()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not private.staff_ready() then raise exception 'FORBIDDEN'; end if;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',cr.id,'areaId',cr.area_id,'areaName',a.name::text,
    'firstName',cr.first_name,'lastName',cr.last_name,'email',cr.email::text,
    'courseOfStudy',cr.course_of_study,'interviewDate',cr.interview_date,
    'score',cr.score,'comment',coalesce(cr.comment,''),'archivedAt',cr.archived_at,
    'createdAt',cr.created_at,'updatedAt',cr.updated_at
  ) order by cr.created_at desc),'[]'::jsonb)
  into v_result
  from public.candidate_ratings cr
  join public.areas a on a.id=cr.area_id
  where private.is_admin() or cr.area_id in (select private.user_area_ids());
  return v_result;
end;
$$;

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
  if private.is_admin() or p_area_id not in (select private.user_area_ids()) then raise exception 'FORBIDDEN'; end if;
  if p_score<1 or p_score>30 then raise exception 'INVALID_SCORE'; end if;
  insert into public.candidate_ratings(
    area_id,created_by,first_name,last_name,email,course_of_study,interview_date,score,comment
  ) values(
    p_area_id,auth.uid(),pg_catalog.btrim(p_first_name),pg_catalog.btrim(p_last_name),
    pg_catalog.lower(pg_catalog.btrim(p_email))::citext,pg_catalog.btrim(p_course_of_study),
    p_interview_date,p_score,nullif(pg_catalog.btrim(coalesce(p_comment,'')),'')
  ) returning id into v_id;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,area_id)
  values(auth.uid(),'staff','candidate_rating.created','candidate_rating',v_id,p_area_id);
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
  select area_id into v_old_area from public.candidate_ratings where id=p_id for update;
  if v_old_area is null or v_old_area not in (select private.user_area_ids())
     or p_area_id not in (select private.user_area_ids()) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  if p_score<1 or p_score>30 then raise exception 'INVALID_SCORE'; end if;
  update public.candidate_ratings
  set area_id=p_area_id,first_name=pg_catalog.btrim(p_first_name),last_name=pg_catalog.btrim(p_last_name),
      email=pg_catalog.lower(pg_catalog.btrim(p_email))::citext,course_of_study=pg_catalog.btrim(p_course_of_study),
      interview_date=p_interview_date,score=p_score,comment=nullif(pg_catalog.btrim(coalesce(p_comment,'')),''),
      updated_at=pg_catalog.now()
  where id=p_id;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,area_id)
  values(auth.uid(),'staff','candidate_rating.updated','candidate_rating',p_id,p_area_id);
end;
$$;

create or replace function public.archive_candidate_rating(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_area uuid;
begin
  if private.is_admin() then raise exception 'READ_ONLY_ADMIN'; end if;
  select area_id into v_area from public.candidate_ratings where id=p_id for update;
  if v_area is null or v_area not in (select private.user_area_ids()) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  update public.candidate_ratings set archived_at=coalesce(archived_at,pg_catalog.now()),updated_at=pg_catalog.now() where id=p_id;
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,area_id)
  values(auth.uid(),'staff','candidate_rating.archived','candidate_rating',p_id,v_area);
end;
$$;

create or replace function public.delete_candidate_rating(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_area uuid;
begin
  if private.is_admin() then raise exception 'READ_ONLY_ADMIN'; end if;
  select area_id into v_area from public.candidate_ratings where id=p_id for update;
  if v_area is null or v_area not in (select private.user_area_ids()) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  delete from public.audit_logs where entity_type='candidate_rating' and entity_id=p_id;
  delete from public.candidate_ratings where id=p_id;
end;
$$;

create or replace function public.reset_candidate_ratings(p_area_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_admin() or p_area_id not in (select private.user_area_ids()) then raise exception 'FORBIDDEN'; end if;
  delete from public.audit_logs where entity_type='candidate_rating'
    and entity_id in (select id from public.candidate_ratings where area_id=p_area_id);
  delete from public.candidate_ratings where area_id=p_area_id;
end;
$$;

create or replace function public.reset_all_candidate_ratings()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  delete from public.audit_logs where entity_type='candidate_rating';
  delete from public.candidate_ratings;
end;
$$;

revoke all on function public.claim_room_allocations_batch(uuid,jsonb) from public,anon;
revoke all on function public.archive_campaign(uuid,boolean) from public,anon;
revoke all on function public.manage_campaign(uuid,text,date,date,public.campaign_status,boolean) from public,anon;
revoke all on function public.list_interview_sessions() from public,anon;
revoke all on function public.list_my_allocations() from public,anon;
revoke all on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) from public,anon;
revoke all on function public.send_booking_reminder(uuid,text) from public,anon;
revoke all on function public.list_candidate_ratings() from public,anon;
revoke all on function public.create_candidate_rating(uuid,text,text,text,text,date,integer,text) from public,anon;
revoke all on function public.update_candidate_rating(uuid,uuid,text,text,text,text,date,integer,text) from public,anon;
revoke all on function public.archive_candidate_rating(uuid) from public,anon;
revoke all on function public.delete_candidate_rating(uuid) from public,anon;
revoke all on function public.reset_candidate_ratings(uuid) from public,anon;
revoke all on function public.reset_all_candidate_ratings() from public,anon;

grant execute on function public.claim_room_allocations_batch(uuid,jsonb) to authenticated;
grant execute on function public.archive_campaign(uuid,boolean) to authenticated;
grant execute on function public.manage_campaign(uuid,text,date,date,public.campaign_status,boolean) to authenticated;
grant execute on function public.list_interview_sessions() to authenticated;
grant execute on function public.list_my_allocations() to authenticated;
grant execute on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) to authenticated;
grant execute on function public.send_booking_reminder(uuid,text) to authenticated;
grant execute on function public.list_candidate_ratings() to authenticated;
grant execute on function public.create_candidate_rating(uuid,text,text,text,text,date,integer,text) to authenticated;
grant execute on function public.update_candidate_rating(uuid,uuid,text,text,text,text,date,integer,text) to authenticated;
grant execute on function public.archive_candidate_rating(uuid) to authenticated;
grant execute on function public.delete_candidate_rating(uuid) to authenticated;
grant execute on function public.reset_candidate_ratings(uuid) to authenticated;
grant execute on function public.reset_all_candidate_ratings() to authenticated;

commit;
