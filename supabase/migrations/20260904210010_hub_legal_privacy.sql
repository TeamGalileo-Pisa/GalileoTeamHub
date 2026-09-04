begin;

create table if not exists public.legal_documents (
  document_key text primary key,
  title text not null,
  body text not null,
  version bigint not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default pg_catalog.now(),
  constraint legal_documents_key_check check (document_key in ('privacy','terms')),
  constraint legal_documents_title_length check (pg_catalog.char_length(pg_catalog.btrim(title)) between 3 and 160),
  constraint legal_documents_body_length check (pg_catalog.char_length(pg_catalog.btrim(body)) between 20 and 30000),
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
    'key',d.document_key,
    'title',d.title,
    'body',d.body,
    'version',d.version,
    'updatedAt',d.updated_at
  )
  from public.legal_documents d
  where d.document_key='privacy';
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
    select pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_object(
        'key',d.document_key,
        'title',d.title,
        'body',d.body,
        'version',d.version,
        'updatedAt',d.updated_at
      ) order by d.document_key
    )
    from public.legal_documents d
  ),'[]'::jsonb);
end;
$$;

create or replace function public.update_legal_document(
  p_key text,
  p_title text,
  p_body text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.legal_documents%rowtype;
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  if p_key not in ('privacy','terms') then raise exception 'INVALID_LEGAL_DOCUMENT'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(coalesce(p_title,''))) not between 3 and 160
     or pg_catalog.char_length(pg_catalog.btrim(coalesce(p_body,''))) not between 20 and 30000 then
    raise exception 'INVALID_LEGAL_DOCUMENT';
  end if;

  update public.legal_documents
  set title=pg_catalog.btrim(p_title),
      body=pg_catalog.btrim(p_body),
      version=version+1,
      updated_by=auth.uid(),
      updated_at=pg_catalog.now()
  where document_key=p_key
  returning * into v_row;

  if v_row.document_key is null then raise exception 'LEGAL_DOCUMENT_NOT_FOUND'; end if;

  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,after_value)
  values(
    auth.uid(),'staff','legal_document.updated','legal_document',
    pg_catalog.jsonb_build_object('key',p_key,'version',v_row.version)
  );

  return pg_catalog.jsonb_build_object(
    'key',v_row.document_key,
    'title',v_row.title,
    'body',v_row.body,
    'version',v_row.version,
    'updatedAt',v_row.updated_at
  );
end;
$$;

revoke all on function public.get_public_privacy_document() from public;
grant execute on function public.get_public_privacy_document() to anon, authenticated, service_role;
revoke all on function public.list_legal_documents(), public.update_legal_document(text,text,text) from public, anon;
grant execute on function public.list_legal_documents(), public.update_legal_document(text,text,text) to authenticated;

do $$
begin
  if pg_catalog.to_regprocedure('private.book_public_slot(text,uuid,text,text,text)') is null
     and pg_catalog.to_regprocedure('public.book_public_slot(text,uuid,text,text,text)') is not null then
    execute 'alter function public.book_public_slot(text,uuid,text,text,text) set schema private';
  end if;
end $$;

revoke all on function private.book_public_slot(text,uuid,text,text,text) from public, anon, authenticated;

create or replace function public.book_public_slot(
  p_token text,
  p_slot_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text
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
  p_token text,
  p_slot_id uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_privacy_accepted boolean,
  p_privacy_version bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_current_version bigint;
  v_result jsonb;
  v_booking_id uuid;
begin
  if p_privacy_accepted is distinct from true then
    raise exception 'PRIVACY_CONSENT_REQUIRED';
  end if;

  select version into v_current_version
  from public.legal_documents
  where document_key='privacy';

  if v_current_version is null then raise exception 'PRIVACY_NOT_CONFIGURED'; end if;
  if p_privacy_version is null or p_privacy_version<>v_current_version then
    raise exception 'PRIVACY_VERSION_OUTDATED';
  end if;

  v_result:=private.book_public_slot(
    p_token,p_slot_id,p_first_name,p_last_name,p_email
  );
  v_booking_id:=(v_result->>'booking_id')::uuid;

  insert into public.booking_privacy_consents(booking_id,privacy_version)
  values(v_booking_id,v_current_version);

  return v_result;
end;
$$;

revoke all on function public.book_public_slot(text,uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.book_public_slot(text,uuid,text,text,text,boolean,bigint) from public, anon, authenticated;
grant execute on function public.book_public_slot(text,uuid,text,text,text), public.book_public_slot(text,uuid,text,text,text,boolean,bigint) to service_role;

commit;
