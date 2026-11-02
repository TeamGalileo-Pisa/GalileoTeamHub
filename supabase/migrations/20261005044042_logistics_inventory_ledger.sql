begin;

create or replace function private.can_manage_logistics_inventory()
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r
        where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
          and a.slug='logistica' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and a.slug='logistica' and a.active)
    );
$$;
revoke all on function private.can_manage_logistics_inventory() from public,anon;
grant execute on function private.can_manage_logistics_inventory() to authenticated,service_role;

create table public.inventory_warehouses(
  id uuid primary key default gen_random_uuid(),
  name text not null check(char_length(btrim(name)) between 2 and 120),
  location text not null default '' check(char_length(location)<=240),
  notes text not null default '' check(char_length(notes)<=2000),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.inventory_items(
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  name text not null check(char_length(btrim(name)) between 2 and 160),
  sku text not null default '' check(char_length(sku)<=80),
  description text not null default '' check(char_length(description)<=3000),
  unit text not null default 'pezzi' check(char_length(btrim(unit)) between 1 and 30),
  quantity integer not null default 0 check(quantity>=0),
  minimum_quantity integer not null default 0 check(minimum_quantity>=0),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index inventory_items_warehouse_idx on public.inventory_items(warehouse_id,archived_at,name);

create table public.inventory_movements(
  id bigint generated always as identity primary key,
  warehouse_id uuid references public.inventory_warehouses(id) on delete set null,
  item_id uuid references public.inventory_items(id) on delete set null,
  warehouse_name_snapshot text not null,
  item_name_snapshot text not null default '',
  event_type text not null check(event_type in (
    'warehouse_created','warehouse_updated','warehouse_archived','warehouse_restored',
    'item_created','item_updated','item_archived','item_restored','stock_in','stock_out'
  )),
  quantity_delta integer not null default 0,
  quantity_before integer,
  quantity_after integer,
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  taken_by_name text not null default '',
  notes text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index inventory_movements_created_idx on public.inventory_movements(created_at desc,id desc);
create index inventory_movements_item_idx on public.inventory_movements(item_id,created_at desc);

alter table public.inventory_warehouses enable row level security;
alter table public.inventory_items enable row level security;
alter table public.inventory_movements enable row level security;
revoke all on public.inventory_warehouses,public.inventory_items,public.inventory_movements from public,anon,authenticated;
grant select on public.inventory_warehouses,public.inventory_items,public.inventory_movements to authenticated;
create policy inventory_warehouses_read on public.inventory_warehouses for select to authenticated
  using(private.can_manage_logistics_inventory());
create policy inventory_items_read on public.inventory_items for select to authenticated
  using(private.can_manage_logistics_inventory());
create policy inventory_movements_read on public.inventory_movements for select to authenticated
  using(private.can_manage_logistics_inventory());

create or replace function private.reject_inventory_history_change()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception 'INVENTORY_HISTORY_IS_APPEND_ONLY'; end; $$;
create trigger inventory_movements_append_only before update or delete on public.inventory_movements
  for each row execute function private.reject_inventory_history_change();
revoke all on function private.reject_inventory_history_change() from public,anon,authenticated;

create or replace function public.inventory_create_warehouse(p_name text,p_location text default '',p_notes text default '')
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid(); v_actor text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 120
    or char_length(coalesce(p_location,''))>240 or char_length(coalesce(p_notes,''))>2000 then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  insert into public.inventory_warehouses(id,name,location,notes,created_by)
    values(v_id,btrim(p_name),btrim(coalesce(p_location,'')),btrim(coalesce(p_notes,'')),auth.uid());
  insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,details)
    values(v_id,btrim(p_name),'warehouse_created',auth.uid(),v_actor,
      jsonb_build_object('location',btrim(coalesce(p_location,'')),'notes',btrim(coalesce(p_notes,''))));
  return v_id;
end; $$;

create or replace function public.inventory_update_warehouse(p_id uuid,p_name text,p_location text,p_notes text)
returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.inventory_warehouses%rowtype; v_actor text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 120
    or char_length(coalesce(p_location,''))>240 or char_length(coalesce(p_notes,''))>2000 then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select * into v_old from public.inventory_warehouses where id=p_id for update;
  if not found then raise exception 'WAREHOUSE_NOT_FOUND'; end if;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  update public.inventory_warehouses set name=btrim(p_name),location=btrim(coalesce(p_location,'')),notes=btrim(coalesce(p_notes,'')),updated_at=now() where id=p_id;
  insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,details)
    values(p_id,btrim(p_name),'warehouse_updated',auth.uid(),v_actor,
      jsonb_build_object('before',jsonb_build_object('name',v_old.name,'location',v_old.location,'notes',v_old.notes),
                         'after',jsonb_build_object('name',btrim(p_name),'location',btrim(coalesce(p_location,'')),'notes',btrim(coalesce(p_notes,'')))));
end; $$;

create or replace function public.inventory_archive_warehouse(p_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare v_row public.inventory_warehouses%rowtype; v_actor text; v_event text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  select * into v_row from public.inventory_warehouses where id=p_id for update;
  if not found then raise exception 'WAREHOUSE_NOT_FOUND'; end if;
  if p_archived and exists(select 1 from public.inventory_items where warehouse_id=p_id and archived_at is null) then
    raise exception 'ARCHIVE_ACTIVE_ITEMS_FIRST';
  end if;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  update public.inventory_warehouses set archived_at=case when p_archived then now() else null end,updated_at=now() where id=p_id;
  v_event:=case when p_archived then 'warehouse_archived' else 'warehouse_restored' end;
  insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,details)
    values(p_id,v_row.name,v_event,auth.uid(),v_actor,jsonb_build_object('name',v_row.name,'location',v_row.location,'notes',v_row.notes));
end; $$;

create or replace function public.inventory_create_item(
  p_warehouse_id uuid,p_name text,p_sku text default '',p_description text default '',
  p_unit text default 'pezzi',p_initial_quantity integer default 0,p_minimum_quantity integer default 0
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid(); v_warehouse public.inventory_warehouses%rowtype; v_actor text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 160 or char_length(coalesce(p_sku,''))>80
    or char_length(coalesce(p_description,''))>3000 or char_length(btrim(coalesce(p_unit,''))) not between 1 and 30
    or p_initial_quantity not between 0 and 1000000 or p_minimum_quantity not between 0 and 1000000 then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select * into v_warehouse from public.inventory_warehouses where id=p_warehouse_id and archived_at is null for update;
  if not found then raise exception 'WAREHOUSE_NOT_FOUND'; end if;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  insert into public.inventory_items(id,warehouse_id,name,sku,description,unit,quantity,minimum_quantity,created_by)
    values(v_id,p_warehouse_id,btrim(p_name),btrim(coalesce(p_sku,'')),btrim(coalesce(p_description,'')),btrim(p_unit),p_initial_quantity,p_minimum_quantity,auth.uid());
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,event_type,
    quantity_delta,quantity_before,quantity_after,actor_user_id,actor_name,details)
    values(p_warehouse_id,v_id,v_warehouse.name,btrim(p_name),case when p_initial_quantity>0 then 'stock_in' else 'item_created' end,
      p_initial_quantity,0,p_initial_quantity,auth.uid(),v_actor,
      jsonb_build_object('unit',btrim(p_unit),'sku',btrim(coalesce(p_sku,'')),'description',btrim(coalesce(p_description,'')),'minimum_quantity',p_minimum_quantity,'opening_stock',p_initial_quantity));
  return v_id;
end; $$;

create or replace function public.inventory_update_item(p_id uuid,p_name text,p_sku text,p_description text,p_unit text,p_minimum_quantity integer)
returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.inventory_items%rowtype; v_warehouse text; v_actor text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 160 or char_length(coalesce(p_sku,''))>80
    or char_length(coalesce(p_description,''))>3000 or char_length(btrim(coalesce(p_unit,''))) not between 1 and 30
    or p_minimum_quantity not between 0 and 1000000 then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select * into v_old from public.inventory_items where id=p_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select name into v_warehouse from public.inventory_warehouses where id=v_old.warehouse_id;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  update public.inventory_items set name=btrim(p_name),sku=btrim(coalesce(p_sku,'')),description=btrim(coalesce(p_description,'')),unit=btrim(p_unit),minimum_quantity=p_minimum_quantity,updated_at=now() where id=p_id;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,event_type,quantity_before,quantity_after,actor_user_id,actor_name,details)
    values(v_old.warehouse_id,p_id,coalesce(v_warehouse,''),btrim(p_name),'item_updated',v_old.quantity,v_old.quantity,auth.uid(),v_actor,
      jsonb_build_object('before',jsonb_build_object('name',v_old.name,'sku',v_old.sku,'description',v_old.description,'unit',v_old.unit,'minimum_quantity',v_old.minimum_quantity),
        'after',jsonb_build_object('name',btrim(p_name),'sku',btrim(coalesce(p_sku,'')),'description',btrim(coalesce(p_description,'')),'unit',btrim(p_unit),'minimum_quantity',p_minimum_quantity)));
end; $$;

create or replace function public.inventory_stock_movement(p_item_id uuid,p_event text,p_quantity integer,p_taken_by text default '',p_notes text default '')
returns void language plpgsql security definer set search_path=''
as $$
declare v_item public.inventory_items%rowtype; v_warehouse public.inventory_warehouses%rowtype; v_actor text; v_after integer; v_delta integer;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if p_event not in ('stock_in','stock_out') or p_quantity not between 1 and 1000000 or char_length(coalesce(p_taken_by,''))>160 or char_length(coalesce(p_notes,''))>2000 then raise exception 'INVALID_INVENTORY_MOVEMENT'; end if;
  if p_event='stock_out' and char_length(btrim(coalesce(p_taken_by,'')))<2 then raise exception 'TAKER_NAME_REQUIRED'; end if;
  select * into v_item from public.inventory_items where id=p_item_id and archived_at is null for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into v_warehouse from public.inventory_warehouses where id=v_item.warehouse_id and archived_at is null;
  if not found then raise exception 'WAREHOUSE_ARCHIVED'; end if;
  v_delta:=case when p_event='stock_in' then p_quantity else -p_quantity end;
  v_after:=v_item.quantity+v_delta;
  if v_after<0 then raise exception 'INSUFFICIENT_STOCK'; end if;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  update public.inventory_items set quantity=v_after,updated_at=now() where id=p_item_id;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,event_type,quantity_delta,quantity_before,quantity_after,actor_user_id,actor_name,taken_by_name,notes)
    values(v_item.warehouse_id,p_item_id,v_warehouse.name,v_item.name,p_event,v_delta,v_item.quantity,v_after,auth.uid(),v_actor,btrim(coalesce(p_taken_by,'')),btrim(coalesce(p_notes,'')));
end; $$;

create or replace function public.inventory_archive_item(p_id uuid,p_archived boolean)
returns void language plpgsql security definer set search_path=''
as $$
declare v_item public.inventory_items%rowtype; v_warehouse text; v_actor text; v_event text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  select * into v_item from public.inventory_items where id=p_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if not p_archived and not exists(select 1 from public.inventory_warehouses where id=v_item.warehouse_id and archived_at is null) then raise exception 'WAREHOUSE_ARCHIVED'; end if;
  select name into v_warehouse from public.inventory_warehouses where id=v_item.warehouse_id;
  select coalesce(nullif(current_setting('app.inventory_actor_name',true),''),display_name) into v_actor from public.profiles where id=auth.uid();
  update public.inventory_items set archived_at=case when p_archived then now() else null end,updated_at=now() where id=p_id;
  v_event:=case when p_archived then 'item_archived' else 'item_restored' end;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,event_type,quantity_before,quantity_after,actor_user_id,actor_name,details)
    values(v_item.warehouse_id,p_id,coalesce(v_warehouse,''),v_item.name,v_event,v_item.quantity,v_item.quantity,auth.uid(),v_actor,
      jsonb_build_object('sku',v_item.sku,'description',v_item.description,'unit',v_item.unit,'quantity',v_item.quantity,'minimum_quantity',v_item.minimum_quantity));
end; $$;

revoke all on function public.inventory_create_warehouse(text,text,text),public.inventory_update_warehouse(uuid,text,text,text),public.inventory_archive_warehouse(uuid,boolean),
  public.inventory_create_item(uuid,text,text,text,text,integer,integer),public.inventory_update_item(uuid,text,text,text,text,integer),
  public.inventory_stock_movement(uuid,text,integer,text,text),public.inventory_archive_item(uuid,boolean) from public,anon;
grant execute on function public.inventory_create_warehouse(text,text,text),public.inventory_update_warehouse(uuid,text,text,text),public.inventory_archive_warehouse(uuid,boolean),
  public.inventory_create_item(uuid,text,text,text,text,integer,integer),public.inventory_update_item(uuid,text,text,text,text,integer),
  public.inventory_stock_movement(uuid,text,integer,text,text),public.inventory_archive_item(uuid,boolean) to authenticated,service_role;

commit;
