begin;

create or replace function private.can_manage_team_orders()
returns boolean language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null and a.slug='logistica' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and a.slug='logistica' and a.active)
    );
$$;
revoke all on function private.can_manage_team_orders() from public,anon;
grant execute on function private.can_manage_team_orders() to authenticated,service_role;

create table public.team_purchase_orders(
  id uuid primary key default gen_random_uuid(),
  requester_user_id uuid not null references public.profiles(id) on delete restrict,
  requester_first_name text not null check(char_length(btrim(requester_first_name)) between 1 and 100),
  requester_last_name text not null check(char_length(btrim(requester_last_name)) between 1 and 100),
  vendor_name text not null check(char_length(btrim(vendor_name)) between 2 and 180),
  description text not null check(char_length(btrim(description)) between 2 and 5000),
  order_date date not null,
  amount numeric(12,2) not null check(amount between 0 and 100000000),
  status text not null default 'ordered' check(status in ('ordered','received','cancelled')),
  invoice_path text not null default '' check(char_length(invoice_path)<=500),
  notes text not null default '' check(char_length(notes)<=3000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index team_purchase_orders_date_idx on public.team_purchase_orders(order_date desc,created_at desc);
create index team_purchase_orders_status_idx on public.team_purchase_orders(status,order_date desc);

create table public.team_purchase_order_audit(
  id bigint generated always as identity primary key,
  order_id uuid not null references public.team_purchase_orders(id) on delete restrict,
  event_type text not null check(event_type in ('created','updated')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index team_purchase_order_audit_order_idx on public.team_purchase_order_audit(order_id,id desc);

alter table public.team_purchase_orders enable row level security;
alter table public.team_purchase_order_audit enable row level security;
revoke all on public.team_purchase_orders,public.team_purchase_order_audit from public,anon,authenticated;
grant select,insert,update on public.team_purchase_orders to authenticated;
grant select on public.team_purchase_order_audit to authenticated;
grant usage,select on sequence public.team_purchase_order_audit_id_seq to authenticated,service_role;
grant all on public.team_purchase_orders,public.team_purchase_order_audit to service_role;
create policy team_purchase_orders_read on public.team_purchase_orders for select to authenticated using(private.can_manage_team_orders());
create policy team_purchase_orders_insert on public.team_purchase_orders for insert to authenticated with check(private.can_manage_team_orders() and requester_user_id=(select auth.uid()));
create policy team_purchase_orders_update on public.team_purchase_orders for update to authenticated using(private.can_manage_team_orders()) with check(private.can_manage_team_orders());
create policy team_purchase_order_audit_read on public.team_purchase_order_audit for select to authenticated using(private.can_manage_team_orders());

create or replace function private.prepare_team_purchase_order()
returns trigger language plpgsql set search_path=''
as $$
begin
  if tg_op='UPDATE' then
    if new.requester_user_id is distinct from old.requester_user_id
      or new.requester_first_name is distinct from old.requester_first_name
      or new.requester_last_name is distinct from old.requester_last_name then
      raise exception 'PURCHASE_ORDER_REQUESTER_IS_IMMUTABLE';
    end if;
  end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger team_purchase_orders_prepare before insert or update on public.team_purchase_orders for each row execute function private.prepare_team_purchase_order();

create or replace function private.audit_team_purchase_order()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_actor text;
begin
  select coalesce(p.display_name,'Utente') into v_actor from public.profiles p where p.id=auth.uid();
  if tg_op='INSERT' then
    insert into public.team_purchase_order_audit(order_id,event_type,actor_user_id,actor_name,after_data)
      values(new.id,'created',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(new));
  else
    insert into public.team_purchase_order_audit(order_id,event_type,actor_user_id,actor_name,before_data,after_data)
      values(new.id,'updated',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end; $$;
create trigger team_purchase_orders_audit after insert or update on public.team_purchase_orders for each row execute function private.audit_team_purchase_order();
revoke all on function private.prepare_team_purchase_order(),private.audit_team_purchase_order() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-order-invoices','team-order-invoices',false,15728640,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=15728640,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];
create policy team_order_invoices_read on storage.objects for select to authenticated
using(bucket_id='team-order-invoices' and private.can_manage_team_orders());
create policy team_order_invoices_insert on storage.objects for insert to authenticated
with check(bucket_id='team-order-invoices' and private.can_manage_team_orders());
create policy team_order_invoices_update on storage.objects for update to authenticated
using(bucket_id='team-order-invoices' and private.can_manage_team_orders()) with check(bucket_id='team-order-invoices' and private.can_manage_team_orders());
create policy team_order_invoices_delete on storage.objects for delete to authenticated
using(bucket_id='team-order-invoices' and private.can_manage_team_orders());

commit;

