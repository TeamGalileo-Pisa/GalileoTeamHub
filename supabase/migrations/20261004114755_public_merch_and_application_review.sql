begin;

-- Public applicants can only see the names of areas whose forms are open and
-- assigned to them (or any open area for an administrator/team leader).
create or replace function public.list_my_open_application_areas()
returns table(area_id uuid, area_name text)
language sql stable security definer set search_path=''
as $$
  select a.id, a.name::text
  from public.areas a
  join public.application_areas c on c.area_id=a.id and c.is_open
  join public.application_settings s on s.id=true and s.is_open
  where a.active and exists(
    select 1 from public.profiles p where p.id=auth.uid()
      and p.status='active' and not p.must_change_password
  ) and (
    private.is_admin()
    or exists(select 1 from public.area_memberships m
      where m.user_id=auth.uid() and m.area_id=a.id and m.role='area_lead'
        and m.ended_at is null)
  )
  order by a.name;
$$;
revoke all on function public.list_my_open_application_areas() from public,anon;
grant execute on function public.list_my_open_application_areas() to authenticated;

-- Public orders store the buyer identity instead of an authenticated user id.
alter table public.merch_orders alter column buyer_user_id drop not null;
alter table public.merch_orders
  add column buyer_first_name text,
  add column buyer_last_name text,
  add column public_checkout_token_hash text;
alter table public.merch_orders add constraint merch_public_buyer_identity
  check (buyer_user_id is not null or
    (buyer_first_name is not null and buyer_last_name is not null and public_checkout_token_hash is not null));

create or replace function public.create_public_merch_order(
  p_first_name text, p_last_name text, p_token_hash text, p_items jsonb
)
returns table(order_id uuid,total_cents integer)
language plpgsql security definer set search_path=''
as $$
declare
  v_id uuid:=gen_random_uuid(); v_total integer:=0; v_item jsonb;
  v_variant public.merch_variants%rowtype; v_product public.merch_products%rowtype;
  v_qty integer; v_variant_id uuid; v_pending uuid;
begin
  if p_first_name is null or char_length(btrim(p_first_name)) not between 1 and 100
    or p_last_name is null or char_length(btrim(p_last_name)) not between 1 and 100
    or p_token_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0
    or jsonb_array_length(p_items)>30 then raise exception 'INVALID_ORDER'; end if;
  if (select count(distinct (item->>'variantId')) from jsonb_array_elements(p_items) x(item))
      <> jsonb_array_length(p_items) then raise exception 'INVALID_ORDER'; end if;

  for v_pending in select o.id from public.merch_orders o
    where o.status='pending' and o.expires_at<now() for update
  loop
    update public.merch_variants v set stock=v.stock+x.qty from (
      select variant_id,sum(quantity)::integer qty from public.merch_order_items
      where order_id=v_pending group by variant_id
    ) x where v.id=x.variant_id and v.stock is not null;
    update public.merch_orders set status='expired' where id=v_pending;
  end loop;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if coalesce(v_item->>'variantId','') !~* '^[0-9a-f-]{36}$'
      or coalesce(v_item->>'quantity','') !~ '^[1-9][0-9]?$' then raise exception 'INVALID_ORDER'; end if;
    v_variant_id:=(v_item->>'variantId')::uuid;
    v_qty:=(v_item->>'quantity')::integer;
    if v_qty>20 then raise exception 'INVALID_ORDER'; end if;
    select * into v_variant from public.merch_variants
      where id=v_variant_id and active for update;
    if not found then raise exception 'UNAVAILABLE'; end if;
    select * into v_product from public.merch_products
      where id=v_variant.product_id and active and visibility='everyone';
    if not found then raise exception 'UNAVAILABLE'; end if;
    if v_variant.stock is not null and v_variant.stock<v_qty then raise exception 'OUT_OF_STOCK'; end if;
    if v_variant.stock is not null then
      update public.merch_variants set stock=stock-v_qty where id=v_variant.id;
    end if;
    v_total:=v_total+v_product.price_cents*v_qty;
  end loop;
  if v_total<=0 then raise exception 'INVALID_ORDER'; end if;
  insert into public.merch_orders(id,buyer_first_name,buyer_last_name,
    public_checkout_token_hash,total_cents)
  values(v_id,btrim(p_first_name),btrim(p_last_name),p_token_hash,v_total);
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_variant from public.merch_variants where id=(v_item->>'variantId')::uuid;
    select * into v_product from public.merch_products where id=v_variant.product_id;
    v_qty:=(v_item->>'quantity')::integer;
    insert into public.merch_order_items(order_id,product_id,variant_id,product_name,
      variant_label,unit_price_cents,quantity,line_total_cents)
    values(v_id,v_product.id,v_variant.id,v_product.name,v_variant.label,
      v_product.price_cents,v_qty,v_product.price_cents*v_qty);
  end loop;
  return query select v_id,v_total;
end;
$$;
revoke all on function public.create_public_merch_order(text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_public_merch_order(text,text,text,jsonb) to service_role;

-- Notify the Team Leader, logistics lead, and only the lead(s) of the selected
-- area. The notification text intentionally contains no applicant PII.
create or replace function private.notify_application_reviewers()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_area_name text;
begin
  select name::text into v_area_name from public.areas where id=new.area_id;
  insert into public.notifications(recipient_user_id,type,title,body,data)
  select recipients.user_id,'application.received','Nuova candidatura · '||coalesce(v_area_name,'Area'),
    'Apri Candidature per consultare i dati e le risposte del candidato.',
    jsonb_build_object('application_id',new.id,'area_id',new.area_id,'route','/area/candidature')
  from (
    select r.user_id from public.system_roles r join public.profiles p on p.id=r.user_id
      where r.role in ('admin','team_leader') and p.status='active' and not p.must_change_password
    union
    select m.user_id from public.area_memberships m join public.areas a on a.id=m.area_id
      join public.profiles p on p.id=m.user_id
      where m.role='area_lead' and m.ended_at is null and p.status='active'
        and not p.must_change_password and m.area_id=new.area_id
  ) recipients;
  return new;
end;
$$;
drop trigger if exists applications_notify_reviewers on public.applications;
create trigger applications_notify_reviewers after insert on public.applications
  for each row execute function private.notify_application_reviewers();

revoke all on function private.notify_application_reviewers() from public,anon,authenticated;
commit;

