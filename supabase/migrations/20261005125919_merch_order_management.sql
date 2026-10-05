begin;

create table public.merch_order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.merch_orders(id) on delete restrict,
  actor_user_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('updated', 'cancelled')),
  old_status text not null,
  new_status text not null,
  old_total_cents integer not null,
  new_total_cents integer not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.merch_order_events enable row level security;
grant select on public.merch_order_events to authenticated;
create policy merch_order_events_manager_read on public.merch_order_events
  for select to authenticated using (private.can_manage_merchandising());
revoke insert, update, delete on public.merch_order_events from public, anon, authenticated;

create or replace function public.update_merch_order(
  p_order uuid,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_items jsonb,
  p_confirm_payment_adjustment boolean default false
)
returns table(total_cents integer, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_order public.merch_orders%rowtype;
  v_old_items jsonb;
  v_new_items jsonb := '[]'::jsonb;
  v_item jsonb;
  v_old_item public.merch_order_items%rowtype;
  v_variant public.merch_variants%rowtype;
  v_product public.merch_products%rowtype;
  v_item_id uuid;
  v_variant_id uuid;
  v_quantity integer;
  v_line_total integer;
  v_total bigint := 0;
  v_next_status text;
begin
  if auth.uid() is null or not private.can_manage_merchandising() then
    raise exception 'FORBIDDEN';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 30
    or p_first_name is null or char_length(btrim(p_first_name)) not between 1 and 100
    or p_last_name is null or char_length(btrim(p_last_name)) not between 1 and 100
    or p_email is null or char_length(btrim(p_email)) > 254
    or lower(btrim(p_email)) !~ '^[^[:space:]@]+@studenti[.]unipi[.]it$'
    or exists (
      select 1 from jsonb_array_elements(p_items) x(item)
      where coalesce(x.item->>'quantity', '') !~ '^[1-9][0-9]?$'
        or (x.item ? 'itemId' and coalesce(x.item->>'itemId', '') !~* '^[0-9a-f-]{36}$')
        or (not (x.item ? 'itemId') and coalesce(x.item->>'variantId', '') !~* '^[0-9a-f-]{36}$')
    )
  then raise exception 'INVALID_ORDER'; end if;

  if (select count(*) from jsonb_array_elements(p_items) x(item) where x.item ? 'itemId') <>
       (select count(distinct x.item->>'itemId') from jsonb_array_elements(p_items) x(item) where x.item ? 'itemId')
     or (select count(*) from jsonb_array_elements(p_items) x(item) where not (x.item ? 'itemId')) <>
       (select count(distinct x.item->>'variantId') from jsonb_array_elements(p_items) x(item) where not (x.item ? 'itemId'))
  then raise exception 'INVALID_ORDER'; end if;

  select * into v_order from public.merch_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_method <> 'paypal_manual' or v_order.status not in ('ordered', 'paid') then
    raise exception 'ORDER_STATUS_LOCKED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'itemId', id, 'productId', product_id, 'variantId', variant_id,
    'product', product_name, 'variant', variant_label,
    'quantity', quantity, 'unitPriceCents', unit_price_cents
  ) order by product_name, variant_label), '[]'::jsonb)
  into v_old_items from public.merch_order_items where order_id = p_order;

  perform 1 from public.merch_variants v
  where v.id in (
    select i.variant_id from public.merch_order_items i
    where i.order_id = p_order and i.variant_id is not null
    union
    select (x.item->>'variantId')::uuid from jsonb_array_elements(p_items) x(item)
    where not (x.item ? 'itemId')
  ) order by v.id for update;

  -- Return the old reservation first. The transaction rolls it back if any
  -- requested line is invalid or no longer available.
  update public.merch_variants v set stock = v.stock + x.quantity
  from (
    select variant_id, sum(quantity)::integer as quantity
    from public.merch_order_items where order_id = p_order and variant_id is not null
    group by variant_id
  ) x where v.id = x.variant_id and v.stock is not null;
  delete from public.merch_order_items where order_id = p_order;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_quantity := (v_item->>'quantity')::integer;
    if v_quantity > 20 then raise exception 'INVALID_ORDER'; end if;

    if v_item ? 'itemId' then
      v_item_id := (v_item->>'itemId')::uuid;
      select (x.item->>'productId')::uuid, (x.item->>'variantId')::uuid,
        x.item->>'product', x.item->>'variant', (x.item->>'unitPriceCents')::integer
      into v_old_item.product_id, v_old_item.variant_id, v_old_item.product_name,
        v_old_item.variant_label, v_old_item.unit_price_cents
      from jsonb_array_elements(v_old_items) x(item)
      where (x.item->>'itemId')::uuid = v_item_id;
      if not found then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;

      if v_old_item.variant_id is not null then
        select * into v_variant from public.merch_variants
        where id = v_old_item.variant_id for update;
        if not found then v_old_item.variant_id := null;
        elsif v_variant.stock is not null then
          if v_variant.stock < v_quantity then raise exception 'OUT_OF_STOCK'; end if;
          update public.merch_variants set stock = stock - v_quantity where id = v_variant.id;
        end if;
      end if;
      v_line_total := v_old_item.unit_price_cents * v_quantity;
      v_total := v_total + v_line_total;
      insert into public.merch_order_items(id, order_id, product_id, variant_id,
        product_name, variant_label, unit_price_cents, quantity, line_total_cents)
      values (v_item_id, p_order, v_old_item.product_id, v_old_item.variant_id,
        v_old_item.product_name, v_old_item.variant_label, v_old_item.unit_price_cents,
        v_quantity, v_line_total);
      v_new_items := v_new_items || jsonb_build_array(jsonb_build_object(
        'itemId', v_item_id, 'product', v_old_item.product_name, 'variant', v_old_item.variant_label,
        'quantity', v_quantity, 'unitPriceCents', v_old_item.unit_price_cents));
    else
      v_variant_id := (v_item->>'variantId')::uuid;
      select * into v_variant from public.merch_variants
      where id = v_variant_id and active for update;
      if not found then raise exception 'UNAVAILABLE'; end if;
      select * into v_product from public.merch_products
      where id = v_variant.product_id and active;
      if not found or (v_order.buyer_user_id is null and v_product.visibility <> 'everyone') then
        raise exception 'UNAVAILABLE';
      end if;
      if v_variant.stock is not null and v_variant.stock < v_quantity then raise exception 'OUT_OF_STOCK'; end if;
      if v_variant.stock is not null then
        update public.merch_variants set stock = stock - v_quantity where id = v_variant.id;
      end if;
      v_line_total := v_product.price_cents * v_quantity;
      v_total := v_total + v_line_total;
      insert into public.merch_order_items(order_id, product_id, variant_id,
        product_name, variant_label, unit_price_cents, quantity, line_total_cents)
      values (p_order, v_product.id, v_variant.id, v_product.name, v_variant.label,
        v_product.price_cents, v_quantity, v_line_total);
      v_new_items := v_new_items || jsonb_build_array(jsonb_build_object(
        'product', v_product.name, 'variant', v_variant.label,
        'quantity', v_quantity, 'unitPriceCents', v_product.price_cents));
    end if;
  end loop;

  if v_total <= 0 or v_total > 2147483647 then raise exception 'INVALID_ORDER'; end if;
  v_next_status := v_order.status;
  if v_order.status = 'paid' and v_total <> v_order.total_cents then
    if not coalesce(p_confirm_payment_adjustment, false) then
      raise exception 'PAYMENT_ADJUSTMENT_CONFIRMATION_REQUIRED';
    end if;
  end if;

  update public.merch_orders set
    buyer_first_name = btrim(p_first_name), buyer_last_name = btrim(p_last_name),
    buyer_email = lower(btrim(p_email)), total_cents = v_total::integer,
    status = v_next_status,
    paid_at = case
      when v_next_status <> 'paid' then null
      when v_order.status = 'paid' and v_total <> v_order.total_cents then now()
      else v_order.paid_at
    end
  where id = p_order;

  insert into public.merch_order_events(order_id, actor_user_id, action,
    old_status, new_status, old_total_cents, new_total_cents, details)
  values (p_order, auth.uid(), 'updated', v_order.status, v_next_status,
    v_order.total_cents, v_total::integer,
    jsonb_build_object('before', v_old_items, 'after', v_new_items));

  return query select v_total::integer, v_next_status;
end;
$$;
revoke all on function public.update_merch_order(uuid, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.update_merch_order(uuid, text, text, text, jsonb, boolean) to authenticated;

create or replace function public.cancel_managed_merch_order(
  p_order uuid,
  p_confirmed_refund boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v_order public.merch_orders%rowtype; v_items jsonb;
begin
  if auth.uid() is null or not private.can_manage_merchandising() then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_order from public.merch_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_method <> 'paypal_manual' or v_order.status not in ('ordered', 'paid') then
    raise exception 'ORDER_STATUS_LOCKED';
  end if;
  if v_order.status = 'paid' and not coalesce(p_confirmed_refund, false) then
    raise exception 'REFUND_CONFIRMATION_REQUIRED';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'product', product_name, 'variant', variant_label, 'quantity', quantity,
    'unitPriceCents', unit_price_cents
  ) order by product_name, variant_label), '[]'::jsonb)
  into v_items from public.merch_order_items where order_id = p_order;

  perform 1 from public.merch_variants v
  where v.id in (select variant_id from public.merch_order_items
    where order_id = p_order and variant_id is not null)
  order by v.id for update;

  update public.merch_variants v set stock = v.stock + x.quantity
  from (select variant_id, sum(quantity)::integer quantity
    from public.merch_order_items where order_id = p_order and variant_id is not null
    group by variant_id) x
  where v.id = x.variant_id and v.stock is not null;

  update public.merch_orders set status = 'cancelled', paid_at = null where id = p_order;
  insert into public.merch_order_events(order_id, actor_user_id, action,
    old_status, new_status, old_total_cents, new_total_cents, details)
  values (p_order, auth.uid(), 'cancelled', v_order.status, 'cancelled',
    v_order.total_cents, v_order.total_cents,
    jsonb_build_object('items', v_items, 'refundConfirmed', coalesce(p_confirmed_refund, false)));
end;
$$;
revoke all on function public.cancel_managed_merch_order(uuid, boolean) from public, anon;
grant execute on function public.cancel_managed_merch_order(uuid, boolean) to authenticated;

commit;
