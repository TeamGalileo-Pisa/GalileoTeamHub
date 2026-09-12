begin;

-- private.staff_operations is only used by SECURITY DEFINER/service-role flows.
-- Keep it inaccessible to direct client roles and enable RLS as a second layer.
alter table private.staff_operations enable row level security;
revoke all on table private.staff_operations from public, anon, authenticated;

-- rls_auto_enable is an event-trigger helper, not a public RPC endpoint.
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;
grant execute on function public.rls_auto_enable() to service_role;

commit;
