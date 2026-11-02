-- Numero progressivo ordini merchandising nel formato ANNO/NUMERO (es. 2026/1,
-- 2026/2 ...). La numerazione riparte da 1 il primo gennaio (fuso Europe/Rome):
-- 2027/1, 2027/2, ... Gli ordini già esistenti restano senza numero.
begin;

create table public.merch_order_counters(
  order_year integer primary key check (order_year between 2000 and 9999),
  last_value integer not null default 0 check (last_value >= 0)
);
alter table public.merch_order_counters enable row level security;
revoke all on public.merch_order_counters from public, anon, authenticated;
grant all on public.merch_order_counters to service_role;

alter table public.merch_orders
  add column order_year integer,
  add column order_seq integer,
  add column order_number text generated always as (order_year::text || '/' || order_seq::text) stored,
  add constraint merch_orders_number_pair check ((order_year is null) = (order_seq is null)),
  add constraint merch_orders_number_unique unique (order_year, order_seq);

-- Assegna il numero in modo atomico: l'upsert sul contatore dell'anno blocca la
-- riga fino al commit, quindi due ordini simultanei non ricevono mai lo stesso
-- numero e, se l'ordine fallisce (rollback), il numero non viene consumato.
create or replace function private.assign_merch_order_number()
returns trigger language plpgsql security definer set search_path=''
as $$
declare
  v_year integer := extract(year from (now() at time zone 'Europe/Rome'))::integer;
  v_seq integer;
begin
  insert into public.merch_order_counters(order_year, last_value)
  values (v_year, 1)
  on conflict (order_year) do update
    set last_value = public.merch_order_counters.last_value + 1
  returning last_value into v_seq;
  new.order_year := v_year;
  new.order_seq := v_seq;
  return new;
end;
$$;
revoke all on function private.assign_merch_order_number() from public, anon, authenticated;

drop trigger if exists merch_orders_assign_number on public.merch_orders;
create trigger merch_orders_assign_number
  before insert on public.merch_orders
  for each row execute function private.assign_merch_order_number();

commit;
