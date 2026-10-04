begin;

drop policy if exists legal_documents_public_select on public.legal_documents;
create policy legal_documents_public_select
on public.legal_documents for select to anon, authenticated
using (document_key in ('privacy', 'terms'));

commit;
