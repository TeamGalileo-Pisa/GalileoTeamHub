begin;

drop function if exists public.get_public_legal_document(text);

drop policy if exists legal_documents_public_select on public.legal_documents;
create policy legal_documents_public_select
on public.legal_documents for select to anon
using (document_key in ('privacy', 'terms'));

grant select (document_key, title, body, version, updated_at)
  on public.legal_documents to anon;

commit;
