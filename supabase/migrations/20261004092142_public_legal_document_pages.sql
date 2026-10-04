begin;

create or replace function public.get_public_legal_document(p_key text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_key is null or p_key not in ('privacy', 'terms') then
    raise exception 'LEGAL_DOCUMENT_NOT_FOUND';
  end if;

  return (
    select pg_catalog.jsonb_build_object(
      'key', d.document_key,
      'title', d.title,
      'body', d.body,
      'version', d.version,
      'updatedAt', d.updated_at
    )
    from public.legal_documents d
    where d.document_key = p_key
  );
end;
$$;

revoke all on function public.get_public_legal_document(text) from public;
grant execute on function public.get_public_legal_document(text)
  to anon, authenticated, service_role;

commit;
