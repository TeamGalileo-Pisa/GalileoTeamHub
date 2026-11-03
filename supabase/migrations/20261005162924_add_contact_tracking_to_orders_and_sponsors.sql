begin;

alter table public.team_purchase_orders
  add column contact_status text not null default '' check (char_length(contact_status) <= 1000),
  add column received_items text not null default '' check (char_length(received_items) <= 3000);

alter table public.sponsors
  add column contacted_by_first_name text not null default '' check (char_length(contacted_by_first_name) <= 100),
  add column contacted_by_last_name text not null default '' check (char_length(contacted_by_last_name) <= 100),
  add column contact_status text not null default '' check (char_length(contact_status) <= 1000),
  add column received_in_kind_description text not null default '' check (char_length(received_in_kind_description) <= 3000);

commit;
