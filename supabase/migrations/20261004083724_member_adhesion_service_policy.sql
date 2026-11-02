begin;

alter table public.member_adhesions enable row level security;
create policy member_adhesions_service_role
  on public.member_adhesions
  for all
  to service_role
  using (true)
  with check (true);

commit;

