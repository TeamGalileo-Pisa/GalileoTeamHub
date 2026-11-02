begin;

-- Enforce the minimum notice on every booking path and for every role. Public
-- availability already hides earlier slots; this trigger closes direct insert
-- and rescheduling paths that could otherwise bypass the UI filter.
create or replace function private.guard_public_booking_24h()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_starts_at timestamptz;
begin
  select slot_record.starts_at
    into v_starts_at
  from public.slots slot_record
  where slot_record.id = new.slot_id;

  if v_starts_at is not null
     and v_starts_at < pg_catalog.statement_timestamp() + interval '24 hours' then
    raise exception 'BOOKING_REQUIRES_24_HOURS';
  end if;

  return new;
end;
$$;

drop trigger if exists bookings_public_24h_guard on public.bookings;
create trigger bookings_public_24h_guard
before insert or update of slot_id on public.bookings
for each row execute function private.guard_public_booking_24h();

revoke all on function private.guard_public_booking_24h() from public, anon, authenticated;
grant execute on function private.guard_public_booking_24h() to service_role;

commit;
