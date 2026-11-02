begin;

create or replace function private.can_manage_merchandising()
returns boolean language sql stable security definer set search_path=''
as $$
  select private.is_admin() or exists(
    select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
    where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
      and a.slug='logistica' and a.active
  );
$$;

create table public.merch_products(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  description text not null default '' check (char_length(description)<=3000),
  image_url text,
  price_cents integer not null check (price_cents>0),
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.merch_variants(
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.merch_products(id) on delete cascade,
  label text not null default 'Unica' check (char_length(label) between 1 and 40),
  stock integer check (stock is null or stock>=0),
  active boolean not null default true,
  unique(product_id,label)
);
create table public.merch_orders(
  id uuid primary key default gen_random_uuid(),
  buyer_user_id uuid not null references auth.users(id),
  status text not null default 'pending' check (status in ('pending','paid','expired','cancelled')),
  total_cents integer not null check (total_cents>0),
  paypal_order_id text unique,
  paypal_capture_id text unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now()+interval '20 minutes',
  paid_at timestamptz
);
create table public.merch_order_items(
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.merch_orders(id) on delete cascade,
  product_id uuid references public.merch_products(id) on delete set null,
  variant_id uuid references public.merch_variants(id) on delete set null,
  product_name text not null,
  variant_label text not null,
  unit_price_cents integer not null,
  quantity integer not null check (quantity between 1 and 20),
  line_total_cents integer not null
);

alter table public.merch_products enable row level security;
alter table public.merch_variants enable row level security;
alter table public.merch_orders enable row level security;
alter table public.merch_order_items enable row level security;
grant select on public.merch_products,public.merch_variants to authenticated;
grant insert,update,delete on public.merch_products,public.merch_variants to authenticated;
grant select on public.merch_orders,public.merch_order_items to authenticated;
create policy merch_products_visible on public.merch_products for select to authenticated using(active or private.can_manage_merchandising());
create policy merch_products_manage on public.merch_products for all to authenticated using(private.can_manage_merchandising()) with check(private.can_manage_merchandising());
create policy merch_variants_visible on public.merch_variants for select to authenticated using(active or private.can_manage_merchandising());
create policy merch_variants_manage on public.merch_variants for all to authenticated using(private.can_manage_merchandising()) with check(private.can_manage_merchandising());
create policy merch_orders_read on public.merch_orders for select to authenticated using(buyer_user_id=auth.uid() or private.can_manage_merchandising());
create policy merch_items_read on public.merch_order_items for select to authenticated using(exists(select 1 from public.merch_orders o where o.id=order_id and (o.buyer_user_id=auth.uid() or private.can_manage_merchandising())));

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('galileo-merch','galileo-merch',true,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=true,file_size_limit=5242880,allowed_mime_types=array['image/jpeg','image/png','image/webp'];
create policy merch_images_public_read on storage.objects for select using(bucket_id='galileo-merch');
create policy merch_images_manager_insert on storage.objects for insert to authenticated with check(bucket_id='galileo-merch' and private.can_manage_merchandising());
create policy merch_images_manager_update on storage.objects for update to authenticated using(bucket_id='galileo-merch' and private.can_manage_merchandising()) with check(bucket_id='galileo-merch' and private.can_manage_merchandising());
create policy merch_images_manager_delete on storage.objects for delete to authenticated using(bucket_id='galileo-merch' and private.can_manage_merchandising());

create or replace function public.create_merch_order(p_buyer uuid,p_items jsonb)
returns table(order_id uuid,total_cents integer)
language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid(); v_total integer:=0; v_item jsonb; v_variant public.merch_variants%rowtype; v_product public.merch_products%rowtype; v_qty integer;
begin
 if p_buyer is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 or jsonb_array_length(p_items)>30 then raise exception 'INVALID_ORDER'; end if;
 -- Expire old reservations and return their stock before processing a new order.
 for v_item in select to_jsonb(o.id) from public.merch_orders o where o.status='pending' and o.expires_at<now() for update loop
   update public.merch_variants v set stock=v.stock+x.qty from (
     select variant_id,sum(quantity)::integer qty from public.merch_order_items where order_id=(v_item #>> '{}')::uuid group by variant_id
   ) x where v.id=x.variant_id and v.stock is not null;
   update public.merch_orders set status='expired' where id=(v_item #>> '{}')::uuid;
 end loop;
 for v_item in select value from jsonb_array_elements(p_items) loop
   if (v_item->>'quantity') !~ '^[1-9][0-9]?$' then raise exception 'INVALID_ORDER'; end if;
   v_qty:=(v_item->>'quantity')::integer; if v_qty>20 then raise exception 'INVALID_ORDER'; end if;
   select * into v_variant from public.merch_variants where id=(v_item->>'variantId')::uuid and active for update;
   if not found then raise exception 'UNAVAILABLE'; end if;
   select * into v_product from public.merch_products where id=v_variant.product_id and active;
   if not found then raise exception 'UNAVAILABLE'; end if;
   if v_variant.stock is not null and v_variant.stock<v_qty then raise exception 'OUT_OF_STOCK'; end if;
   if v_variant.stock is not null then update public.merch_variants set stock=stock-v_qty where id=v_variant.id; end if;
   v_total:=v_total+v_product.price_cents*v_qty;
 end loop;
 if v_total<=0 then raise exception 'INVALID_ORDER'; end if;
 insert into public.merch_orders(id,buyer_user_id,total_cents) values(v_id,p_buyer,v_total);
 for v_item in select value from jsonb_array_elements(p_items) loop
   select * into v_variant from public.merch_variants v where v.id=(v_item->>'variantId')::uuid;
   select * into v_product from public.merch_products p where p.id=v_variant.product_id;
   v_qty:=(v_item->>'quantity')::integer;
   insert into public.merch_order_items(order_id,product_id,variant_id,product_name,variant_label,unit_price_cents,quantity,line_total_cents)
   values(v_id,v_product.id,v_variant.id,v_product.name,v_variant.label,v_product.price_cents,v_qty,v_product.price_cents*v_qty);
 end loop;
 return query select v_id,v_total;
end;$$;

create or replace function public.cancel_merch_order(p_order uuid)
returns void language plpgsql security definer set search_path=''
as $$
declare v_status text;
begin
 select status into v_status from public.merch_orders where id=p_order for update;
 if v_status='pending' then
   update public.merch_variants v set stock=v.stock+x.qty from (
     select variant_id,sum(quantity)::integer qty from public.merch_order_items where order_id=p_order group by variant_id
   ) x where v.id=x.variant_id and v.stock is not null;
   update public.merch_orders set status='cancelled' where id=p_order;
 end if;
end;$$;

create or replace function public.submit_member_adhesion(p_actor uuid,p_data jsonb)
returns void language plpgsql security definer set search_path=''
as $$
declare v_area uuid; v_email text; v_first text; v_last text; v_student text;
begin
 select area_id into v_area from public.area_shared_accounts where user_id=p_actor;
 if v_area is null or not exists(select 1 from public.profiles where id=p_actor and status='active' and not must_change_password) then raise exception 'FORBIDDEN'; end if;
 v_first:=nullif(btrim(p_data->>'firstName'),'');v_last:=nullif(btrim(p_data->>'lastName'),'');v_student:=nullif(btrim(p_data->>'studentNumber'),'');v_email:=lower(btrim(p_data->>'email'));
 if v_first is null or v_last is null or v_student is null or char_length(v_first)>100 or char_length(v_last)>100 or char_length(v_student)>30 or char_length(coalesce(p_data->>'degree','')) not between 2 and 180 or char_length(coalesce(p_data->>'department','')) not between 2 and 180 or char_length(v_email)>254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' or p_data->>'confirmed'<>'yes' then raise exception 'INVALID_DATA'; end if;
 insert into public.member_adhesions(area_id,submitted_by,email,first_name,last_name,student_number,degree,department)
 values(v_area,p_actor,v_email,v_first,v_last,v_student,btrim(p_data->>'degree'),btrim(p_data->>'department'));
 insert into public.community_outbox(kind,recipient,payload)
 values('membership',v_email,jsonb_build_object('firstName',v_first,'lastName',v_last,'studentNumber',v_student,'degree',btrim(p_data->>'degree'),'department',btrim(p_data->>'department'),'email',v_email,'date',to_char(now() at time zone 'Europe/Rome','DD/MM/YYYY'),'area',(select name from public.areas where id=v_area)));
end;$$;

create table public.member_adhesions(
 id uuid primary key default gen_random_uuid(), area_id uuid not null references public.areas(id), submitted_by uuid not null references auth.users(id),
 email text not null, first_name text not null, last_name text not null, student_number text not null, degree text not null, department text not null, created_at timestamptz not null default now()
);
alter table public.member_adhesions enable row level security;
revoke all on public.member_adhesions from anon,authenticated;
grant all on public.member_adhesions to service_role;
revoke all on function public.create_merch_order(uuid,jsonb),public.cancel_merch_order(uuid),public.submit_member_adhesion(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_merch_order(uuid,jsonb),public.cancel_merch_order(uuid),public.submit_member_adhesion(uuid,jsonb) to service_role;
commit;

