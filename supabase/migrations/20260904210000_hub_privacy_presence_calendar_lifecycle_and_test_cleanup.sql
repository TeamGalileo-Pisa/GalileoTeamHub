begin;

-- GalileoHub operational hardening requested on 2026-09-04.
-- This migration preserves every account, role, area membership, area, room,
-- announcement and stable per-area public URL. At the end it removes only the
-- recruitment/scheduling records that were explicitly declared TEST data.

-- Historical remote migrations introduced these soft-delete columns. Reassert
-- them canonically so the repository remains reproducible on a fresh database.
alter table public.interview_sessions add column if not exists deleted_at timestamptz;
alter table public.interview_sessions add column if not exists deleted_from_status public.session_status;
alter table public.slots add column if not exists deleted_at timestamptz;
alter table public.slots add column if not exists deleted_from_status public.slot_status;

-- ---------------------------------------------------------------------------
-- Terms / privacy documents
-- ---------------------------------------------------------------------------
create table if not exists public.legal_documents (
  document_key text primary key,
  title text not null,
  body text not null,
  version bigint not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint legal_documents_key_check check (document_key in ('privacy','terms')),
  constraint legal_documents_title_length check (pg_catalog.char_length(pg_catalog.trim(title)) between 3 and 160),
  constraint legal_documents_body_length check (pg_catalog.char_length(pg_catalog.trim(body)) between 20 and 30000),
  constraint legal_documents_version_positive check (version >= 1)
);

insert into public.legal_documents(document_key,title,body)
values
('privacy','Informativa privacy per la prenotazione dei colloqui',
 'GalileoHub raccoglie nome, cognome, indirizzo email universitario e dati dell’appuntamento esclusivamente per gestire la prenotazione del colloquio e le comunicazioni collegate. L’Amministrazione può aggiornare in qualsiasi momento questa informativa dalla sezione Termini e Privacy.'),
('terms','Termini di servizio GalileoHub',
 'GalileoHub è il gestionale interno del Team Galileo Pisa. L’Amministrazione può aggiornare in qualsiasi momento in questa sezione i termini di utilizzo approvati per il servizio.')
on conflict (document_key) do nothing;

create table if not exists public.booking_privacy_consents (
  booking_id uuid primary key references public.bookings(id) on delete cascade,
  privacy_version bigint not null,
  accepted_at timestamptz not null default pg_catalog.now(),
  constraint booking_privacy_version_positive check (privacy_version >= 1)
);

alter table public.legal_documents enable row level security;
alter table public.booking_privacy_consents enable row level security;
revoke all on public.legal_documents, public.booking_privacy_consents from public, anon, authenticated;
grant select on public.legal_documents to authenticated;

drop policy if exists legal_documents_admin_select on public.legal_documents;
create policy legal_documents_admin_select
on public.legal_documents for select to authenticated
using ((select private.is_admin()));

create or replace function public.get_public_privacy_document()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'key',d.document_key,'title',d.title,'body',d.body,
    'version',d.version,'updatedAt',d.updated_at
  )
  from public.legal_documents d where d.document_key='privacy';
$$;

create or replace function public.list_legal_documents()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  return coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'key',d.document_key,'title',d.title,'body',d.body,
      'version',d.version,'updatedAt',d.updated_at
    ) order by d.document_key)
    from public.legal_documents d
  ),'[]'::jsonb);
end;
$$;

create or replace function public.update_legal_document(p_key text,p_title text,p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_row public.legal_documents%rowtype;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_key not in ('privacy','terms') then raise exception 'INVALID_LEGAL_DOCUMENT'; end if;
  if pg_catalog.char_length(pg_catalog.trim(coalesce(p_title,''))) not between 3 and 160
     or pg_catalog.char_length(pg_catalog.trim(coalesce(p_body,''))) not between 20 and 30000 then
    raise exception 'INVALID_LEGAL_DOCUMENT';
  end if;

  update public.legal_documents
  set title=pg_catalog.trim(p_title), body=pg_catalog.trim(p_body),
      version=version+1, updated_by=auth.uid(), updated_at=pg_catalog.now()
  where document_key=p_key returning * into v_row;
  if v_row.document_key is null then raise exception 'LEGAL_DOCUMENT_NOT_FOUND'; end if;

  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,after_value)
  values(auth.uid(),'staff','legal_document.updated','legal_document',
    pg_catalog.jsonb_build_object('key',p_key,'version',v_row.version));

  return pg_catalog.jsonb_build_object(
    'key',v_row.document_key,'title',v_row.title,'body',v_row.body,
    'version',v_row.version,'updatedAt',v_row.updated_at
  );
end;
$$;

revoke all on function public.get_public_privacy_document() from public;
grant execute on function public.get_public_privacy_document() to anon, authenticated, service_role;
revoke all on function public.list_legal_documents(), public.update_legal_document(text,text,text) from public, anon;
grant execute on function public.list_legal_documents(), public.update_legal_document(text,text,text) to authenticated;

-- Keep the proven booking implementation as the private core, then require an
-- explicit, current privacy-version acceptance at the public entry point.
do $$
begin
  if pg_catalog.to_regprocedure('private.book_public_slot(text,uuid,text,text,text)') is null then
    execute 'alter function public.book_public_slot(text,uuid,text,text,text) set schema private';
  end if;
end $$;

revoke all on function private.book_public_slot(text,uuid,text,text,text) from public, anon, authenticated;

create or replace function public.book_public_slot(
  p_token text,p_slot_id uuid,p_first_name text,p_last_name text,p_email text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'PRIVACY_CONSENT_REQUIRED';
end;
$$;

create or replace function public.book_public_slot(
  p_token text,p_slot_id uuid,p_first_name text,p_last_name text,p_email text,
  p_privacy_accepted boolean,p_privacy_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_current_version bigint; v_result jsonb; v_booking_id uuid;
begin
  if p_privacy_accepted is distinct from true then raise exception 'PRIVACY_CONSENT_REQUIRED'; end if;
  select version into v_current_version from public.legal_documents where document_key='privacy';
  if v_current_version is null then raise exception 'PRIVACY_NOT_CONFIGURED'; end if;
  if p_privacy_version is null or p_privacy_version<>v_current_version then raise exception 'PRIVACY_VERSION_OUTDATED'; end if;

  v_result:=private.book_public_slot(p_token,p_slot_id,p_first_name,p_last_name,p_email);
  v_booking_id:=(v_result->>'booking_id')::uuid;
  insert into public.booking_privacy_consents(booking_id,privacy_version)
  values(v_booking_id,v_current_version);
  return v_result;
end;
$$;

revoke all on function public.book_public_slot(text,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.book_public_slot(text,uuid,text,text,text,boolean,bigint) from public, anon, authenticated;
grant execute on function public.book_public_slot(text,uuid,text,text,text), public.book_public_slot(text,uuid,text,text,text,boolean,bigint) to service_role;

-- ---------------------------------------------------------------------------
-- Online presence
-- ---------------------------------------------------------------------------
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
  values(auth.uid(),pg_catalog.now(),pg_catalog.left(p_path,500),pg_catalog.now())
  on conflict(user_id) do update set
    last_seen_at=excluded.last_seen_at,last_path=excluded.last_path,updated_at=excluded.updated_at;
end;
$$;

create or replace function public.mark_user_offline()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.user_presence set last_seen_at=pg_catalog.now()-interval '1 day',updated_at=pg_catalog.now()
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
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'userId',q.user_id,'username',q.username,'displayName',q.display_name,
      'areas',q.areas,'lastSeenAt',q.last_seen_at,'lastPath',q.last_path
    ) order by q.display_name)
    from (
      select p.id user_id,p.username::text username,p.display_name,
        coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'id',a.id,'name',a.name::text,'slug',a.slug::text
        ) order by a.name::text),'[]'::jsonb) areas,
        up.last_seen_at,up.last_path
      from public.profiles p
      join public.user_presence up on up.user_id=p.id
      join public.area_memberships am on am.user_id=p.id and am.role='area_lead' and am.ended_at is null
      join public.areas a on a.id=am.area_id and a.active
      where p.status='active' and up.last_seen_at>=pg_catalog.now()-interval '90 seconds'
      group by p.id,p.username,p.display_name,up.last_seen_at,up.last_path
    ) q
  ),'[]'::jsonb);
end;
$$;

revoke all on function public.touch_user_presence(text), public.mark_user_offline(), public.list_online_area_leads() from public, anon;
grant execute on function public.touch_user_presence(text), public.mark_user_offline(), public.list_online_area_leads() to authenticated;

-- ---------------------------------------------------------------------------
-- Calendar: confirmed/cancelled bookings + still-free slots
-- ---------------------------------------------------------------------------
create or replace function public.list_calendar_bookings(p_start timestamptz,p_end timestamptz,p_area_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_result jsonb;
begin
  if not private.staff_ready() then raise exception 'FORBIDDEN'; end if;
  if p_start is null or p_end is null or p_end<=p_start or p_end-p_start>interval '367 days' then raise exception 'INVALID_TIME_RANGE'; end if;

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
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and s.deleted_at is null and sl.deleted_at is null

    union all

    select pg_catalog.jsonb_build_object(
      'kind','free','bookingId',null,'slotId',sl.id,'sessionId',s.id,
      'candidateName',null,'candidateEmail',null,'areaName',ar.name::text,'areaId',ar.id,
      'roomName',r.name::text,'startsAt',sl.starts_at,'endsAt',sl.ends_at,
      'status','available','campaignId',ca.campaign_id,'sessionName',s.name
    ) item
    from public.slots sl
    join public.interview_sessions s on s.id=sl.session_id
    join public.area_allocations al on al.id=s.allocation_id
    join public.room_availabilities ra on ra.id=al.room_availability_id
    join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=al.campaign_area_id
    join public.areas ar on ar.id=ca.area_id
    where sl.starts_at<p_end and sl.ends_at>p_start
      and (p_area_id is null or ar.id=p_area_id)
      and private.can_manage_session(s.id)
      and sl.status='available' and s.status in ('draft','published')
      and al.status='active' and ra.status='active' and ca.active
      and s.deleted_at is null and sl.deleted_at is null
      and not exists(select 1 from public.bookings b2 where b2.slot_id=sl.id and b2.status='confirmed')
  ) src;
  return v_result;
end;
$$;
revoke all on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) from public, anon;
grant execute on function public.list_calendar_bookings(timestamptz,timestamptz,uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Soft cancel versus irreversible deletion
-- ---------------------------------------------------------------------------
create or replace function public.delete_booking_permanently(p_booking_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session_id uuid; v_candidate_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select s.id,b.candidate_id into v_session_id,v_candidate_id
  from public.bookings b join public.slots sl on sl.id=b.slot_id
  join public.interview_sessions s on s.id=sl.session_id where b.id=p_booking_id;
  if v_session_id is null or not private.can_manage_session(v_session_id) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  delete from public.booking_privacy_consents where booking_id=p_booking_id;
  delete from public.email_deliveries where booking_id=p_booking_id;
  delete from public.audit_logs where entity_type='booking' and entity_id=p_booking_id;
  delete from public.bookings where id=p_booking_id;
  delete from public.audit_logs where entity_type='candidate' and entity_id=v_candidate_id
    and not exists(select 1 from public.bookings where candidate_id=v_candidate_id);
  delete from public.candidates c where c.id=v_candidate_id and not exists(select 1 from public.bookings b where b.candidate_id=c.id);
end;
$$;

create or replace function public.cancel_session(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_allocation_id uuid; v_area_id uuid; v_campaign_id uuid; v_cancelled_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select s.allocation_id,ca.area_id,ca.campaign_id into v_allocation_id,v_area_id,v_campaign_id
  from public.interview_sessions s join public.area_allocations al on al.id=s.allocation_id
  join public.campaign_areas ca on ca.id=al.campaign_area_id where s.id=p_session_id;
  if v_allocation_id is null or not private.can_manage_session(p_session_id) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;

  update public.booking_links set status='revoked',revoked_at=coalesce(revoked_at,pg_catalog.now())
  where session_id=p_session_id and status='active';

  with changed as (
    update public.bookings b set status='cancelled',cancelled_at=pg_catalog.now(),cancelled_by=auth.uid()
    where b.status='confirmed' and b.slot_id in (select id from public.slots where session_id=p_session_id)
    returning b.id
  ) select coalesce(pg_catalog.array_agg(id),array[]::uuid[]) into v_cancelled_ids from changed;

  insert into public.email_deliveries(booking_id,kind,idempotency_key)
  select id,'booking_cancelled',id::text||':booking_cancelled:'||extensions.gen_random_uuid()::text
  from pg_catalog.unnest(v_cancelled_ids) id;

  update public.slots set status='disabled' where session_id=p_session_id and status='available';
  update public.interview_sessions set status='cancelled' where id=p_session_id;
  update public.area_allocations set status='cancelled',cancelled_by=auth.uid(),cancelled_at=pg_catalog.now()
  where id=v_allocation_id and status='active';
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id,campaign_id,area_id,after_value)
  values(auth.uid(),'staff','session.cancelled','interview_session',p_session_id,v_campaign_id,v_area_id,
    pg_catalog.jsonb_build_object('status','cancelled','allocation_id',v_allocation_id));
end;
$$;

create or replace function public.delete_session_permanently(p_session_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_allocation_id uuid; v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select allocation_id into v_allocation_id from public.interview_sessions where id=p_session_id;
  if v_allocation_id is null or not private.can_manage_session(p_session_id) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  select coalesce(pg_catalog.array_agg(distinct b.candidate_id),array[]::uuid[]) into v_candidate_ids
  from public.bookings b join public.slots sl on sl.id=b.slot_id where sl.session_id=p_session_id;
  delete from public.booking_privacy_consents where booking_id in (select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id where sl.session_id=p_session_id);
  delete from public.email_deliveries where booking_id in (select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id where sl.session_id=p_session_id);
  delete from public.audit_logs where entity_id in (
    select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id where sl.session_id=p_session_id
    union select id from public.slots where session_id=p_session_id
    union select p_session_id union select v_allocation_id
  );
  delete from public.bookings b using public.slots sl where b.slot_id=sl.id and sl.session_id=p_session_id;
  delete from public.booking_links where session_id=p_session_id;
  delete from public.slots where session_id=p_session_id;
  delete from public.interview_sessions where id=p_session_id;
  delete from public.area_allocations where id=v_allocation_id;
  delete from public.candidates c where c.id=any(v_candidate_ids) and not exists(select 1 from public.bookings b where b.candidate_id=c.id);
end;
$$;

create or replace function public.delete_area_allocation_permanently(p_allocation_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session_id uuid;
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.can_manage_allocation(p_allocation_id) then raise exception 'FORBIDDEN'; end if;
  select id into v_session_id from public.interview_sessions where allocation_id=p_allocation_id;
  if v_session_id is not null then perform public.delete_session_permanently(v_session_id);
  else
    delete from public.audit_logs where entity_type='area_allocation' and entity_id=p_allocation_id;
    delete from public.area_allocations where id=p_allocation_id;
  end if;
end;
$$;

create or replace function public.delete_slot_permanently(p_slot_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_session_id uuid; v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  select session_id into v_session_id from public.slots where id=p_slot_id;
  if v_session_id is null or not private.can_manage_session(v_session_id) then raise exception 'FORBIDDEN_OR_NOT_FOUND'; end if;
  if exists(select 1 from public.bookings where slot_id=p_slot_id and status='confirmed') then raise exception 'SLOT_HAS_BOOKINGS'; end if;
  select coalesce(pg_catalog.array_agg(distinct candidate_id),array[]::uuid[]) into v_candidate_ids from public.bookings where slot_id=p_slot_id;
  delete from public.booking_privacy_consents where booking_id in (select id from public.bookings where slot_id=p_slot_id);
  delete from public.email_deliveries where booking_id in (select id from public.bookings where slot_id=p_slot_id);
  delete from public.audit_logs where entity_id in (select id from public.bookings where slot_id=p_slot_id) or entity_id=p_slot_id;
  delete from public.bookings where slot_id=p_slot_id;
  delete from public.slots where id=p_slot_id;
  delete from public.candidates c where c.id=any(v_candidate_ids) and not exists(select 1 from public.bookings b where b.candidate_id=c.id);
end;
$$;

create or replace function public.delete_room_availability_permanently(p_availability_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_candidate_ids uuid[];
begin
  perform pg_catalog.pg_advisory_xact_lock(706202602);
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if not exists(select 1 from public.room_availabilities where id=p_availability_id) then raise exception 'AVAILABILITY_NOT_FOUND'; end if;
  select coalesce(pg_catalog.array_agg(distinct b.candidate_id),array[]::uuid[]) into v_candidate_ids
  from public.bookings b join public.slots sl on sl.id=b.slot_id join public.interview_sessions s on s.id=sl.session_id
  join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id;
  delete from public.booking_privacy_consents where booking_id in (
    select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id join public.interview_sessions s on s.id=sl.session_id join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id);
  delete from public.email_deliveries where booking_id in (
    select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id join public.interview_sessions s on s.id=sl.session_id join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id);
  delete from public.audit_logs where entity_id in (
    select b.id from public.bookings b join public.slots sl on sl.id=b.slot_id join public.interview_sessions s on s.id=sl.session_id join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id
    union select sl.id from public.slots sl join public.interview_sessions s on s.id=sl.session_id join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id
    union select s.id from public.interview_sessions s join public.area_allocations al on al.id=s.allocation_id where al.room_availability_id=p_availability_id
    union select al.id from public.area_allocations al where al.room_availability_id=p_availability_id
    union select p_availability_id);
  delete from public.bookings b using public.slots sl,public.interview_sessions s,public.area_allocations al
    where b.slot_id=sl.id and sl.session_id=s.id and s.allocation_id=al.id and al.room_availability_id=p_availability_id;
  delete from public.booking_links bl using public.interview_sessions s,public.area_allocations al
    where bl.session_id=s.id and s.allocation_id=al.id and al.room_availability_id=p_availability_id;
  delete from public.slots sl using public.interview_sessions s,public.area_allocations al
    where sl.session_id=s.id and s.allocation_id=al.id and al.room_availability_id=p_availability_id;
  delete from public.interview_sessions s using public.area_allocations al
    where s.allocation_id=al.id and al.room_availability_id=p_availability_id;
  delete from public.area_allocations where room_availability_id=p_availability_id;
  delete from public.room_availabilities where id=p_availability_id;
  delete from public.candidates c where c.id=any(v_candidate_ids) and not exists(select 1 from public.bookings b where b.candidate_id=c.id);
end;
$$;

revoke all on function public.delete_booking_permanently(uuid), public.cancel_session(uuid), public.delete_session_permanently(uuid), public.delete_area_allocation_permanently(uuid), public.delete_slot_permanently(uuid), public.delete_room_availability_permanently(uuid) from public, anon;
grant execute on function public.delete_booking_permanently(uuid), public.cancel_session(uuid), public.delete_session_permanently(uuid), public.delete_area_allocation_permanently(uuid), public.delete_slot_permanently(uuid), public.delete_room_availability_permanently(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- One-time cleanup: ALL current recruitment/scheduling records are test data.
-- Accounts are deliberately untouched.
-- ---------------------------------------------------------------------------
delete from public.email_deliveries;
delete from public.booking_privacy_consents;
delete from public.audit_logs
where campaign_id is not null
   or entity_type in ('booking','candidate','slot','interview_session','area_allocation','room_availability','booking_link');
delete from public.bookings;
delete from public.candidates;
delete from public.booking_links;
delete from public.slots;
delete from public.interview_sessions;
delete from public.area_allocations;
delete from public.room_availabilities;
delete from public.campaign_areas;
delete from public.recruitment_campaigns;

commit;
