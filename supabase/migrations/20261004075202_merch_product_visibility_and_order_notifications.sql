begin;

alter table public.merch_products
  add column visibility text not null default 'everyone'
    check (visibility in ('team_leader','team_leader_and_area_leads','everyone'));

create or replace function private.can_view_merch_product(p_visibility text,p_user uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from public.profiles p
    where p.id=p_user and p.status='active' and not p.must_change_password
      and (
        p_visibility='everyone'
        or (p_visibility='team_leader' and exists(
          select 1 from public.system_roles r
          where r.user_id=p.id and r.role='team_leader'
        ))
        or (p_visibility='team_leader_and_area_leads' and (
          exists(select 1 from public.system_roles r where r.user_id=p.id and r.role='team_leader')
          or exists(select 1 from public.area_memberships m
            where m.user_id=p.id and m.role='area_lead' and m.ended_at is null)
        ))
      )
  );
$$;
revoke all on function private.can_view_merch_product(text,uuid) from public,anon;
grant execute on function private.can_view_merch_product(text,uuid) to authenticated,service_role;

drop policy if exists merch_products_visible on public.merch_products;
create policy merch_products_visible on public.merch_products for select to authenticated
  using (private.can_manage_merchandising() or private.can_view_merch_product(visibility,auth.uid()));

drop policy if exists merch_variants_visible on public.merch_variants;
create policy merch_variants_visible on public.merch_variants for select to authenticated
  using (
    private.can_manage_merchandising()
    or (active and exists(
      select 1 from public.merch_products p
      where p.id=product_id and p.active
        and private.can_view_merch_product(p.visibility,auth.uid())
    ))
  );

create or replace function public.create_merch_order(p_buyer uuid,p_items jsonb)
returns table(order_id uuid,total_cents integer)
language plpgsql security definer set search_path=''
as $$
declare
  v_id uuid:=gen_random_uuid();
  v_total integer:=0;
  v_item jsonb;
  v_variant public.merch_variants%rowtype;
  v_product public.merch_products%rowtype;
  v_qty integer;
begin
  if p_buyer is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>30 then
    raise exception 'INVALID_ORDER';
  end if;
  for v_item in
    select to_jsonb(o.id) from public.merch_orders o
    where o.status='pending' and o.expires_at<now() for update
  loop
    update public.merch_variants v set stock=v.stock+x.qty from (
      select variant_id,sum(quantity)::integer qty from public.merch_order_items
      where order_id=(v_item #>> '{}')::uuid group by variant_id
    ) x where v.id=x.variant_id and v.stock is not null;
    update public.merch_orders set status='expired' where id=(v_item #>> '{}')::uuid;
  end loop;
  for v_item in select value from jsonb_array_elements(p_items) loop
    if (v_item->>'quantity') !~ '^[1-9][0-9]?$' then raise exception 'INVALID_ORDER'; end if;
    v_qty:=(v_item->>'quantity')::integer;
    if v_qty>20 then raise exception 'INVALID_ORDER'; end if;
    select * into v_variant from public.merch_variants
      where id=(v_item->>'variantId')::uuid and active for update;
    if not found then raise exception 'UNAVAILABLE'; end if;
    select * into v_product from public.merch_products
      where id=v_variant.product_id and active;
    if not found or not private.can_view_merch_product(v_product.visibility,p_buyer) then
      raise exception 'UNAVAILABLE';
    end if;
    if v_variant.stock is not null and v_variant.stock<v_qty then raise exception 'OUT_OF_STOCK'; end if;
    if v_variant.stock is not null then
      update public.merch_variants set stock=stock-v_qty where id=v_variant.id;
    end if;
    v_total:=v_total+v_product.price_cents*v_qty;
  end loop;
  if v_total<=0 then raise exception 'INVALID_ORDER'; end if;
  insert into public.merch_orders(id,buyer_user_id,total_cents)
    values(v_id,p_buyer,v_total);
  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_variant from public.merch_variants where id=(v_item->>'variantId')::uuid;
    select * into v_product from public.merch_products where id=v_variant.product_id;
    v_qty:=(v_item->>'quantity')::integer;
    insert into public.merch_order_items(order_id,product_id,variant_id,product_name,variant_label,unit_price_cents,quantity,line_total_cents)
      values(v_id,v_product.id,v_variant.id,v_product.name,v_variant.label,v_product.price_cents,v_qty,v_product.price_cents*v_qty);
  end loop;
  return query select v_id,v_total;
end;
$$;
revoke all on function public.create_merch_order(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_merch_order(uuid,jsonb) to service_role;

create or replace function private.notify_merch_order_paid()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if old.status<>'pending' or new.status<>'paid' then return new; end if;
  insert into public.notifications(recipient_user_id,type,title,body,data)
  select recipients.user_id,'merch.order_paid','Nuovo ordine merchandising',
    'Nuovo ordine pagato per €'||to_char(new.total_cents/100.0,'FM9999999990.00')||'. Apri Merchandising per i dettagli.',
    jsonb_build_object('order_id',new.id,'total_cents',new.total_cents,'route','/merchandising')
  from (
    select r.user_id
    from public.system_roles r join public.profiles p on p.id=r.user_id
    where r.role='team_leader' and p.status='active' and not p.must_change_password
    union
    select m.user_id
    from public.area_memberships m
    join public.areas a on a.id=m.area_id
    join public.profiles p on p.id=m.user_id
    where a.slug='logistica' and a.active and m.role='area_lead' and m.ended_at is null
      and p.status='active' and not p.must_change_password
  ) recipients;
  return new;
end;
$$;
drop trigger if exists merch_order_paid_notifications on public.merch_orders;
create trigger merch_order_paid_notifications
  after update of status on public.merch_orders
  for each row when (old.status is distinct from new.status)
  execute function private.notify_merch_order_paid();

commit;

