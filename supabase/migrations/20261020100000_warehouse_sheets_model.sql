-- Magazzino: nuovo modello basato sui fogli Excel di Logistica
-- (Inventario, Tecnico, Analisi, Posizioni, Movimenti, Acquisti).
--  * Articolo unico con area (Tecnica/Analisi), sottoteam, SKU generato automaticamente e univoco,
--    posizione standard [Scaffale]-[Ripiano]-[Box] scelta dall'anagrafica Posizioni, stato, costo e valore totale.
--  * Movimenti: Entrata, Uscita, Prestito, Rientro, Spostamento, Smaltimento.
--  * Acquisti: richieste con ID ACQ-001..., stato iniziale "Da valutare" e flusso fino a "Ricevuto".
--  * Tutti i Capi Area vedono il magazzino, registrano uscite/prestiti/rientri/smaltimenti e inseriscono richieste
--    di acquisto; Logistica, Team Leader e Amministrazione gestiscono articoli, posizioni, entrate e stati.
begin;

create or replace function private.can_view_inventory()
returns boolean language sql stable security definer set search_path=''
as $$
  select private.can_manage_logistics_inventory()
    or (
      auth.uid() is not null
      and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
      and exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null and a.active)
    );
$$;
revoke all on function private.can_view_inventory() from public, anon;
grant execute on function private.can_view_inventory() to authenticated, service_role;

create or replace function private.inventory_actor(p_actor text)
returns text language plpgsql stable security definer set search_path=''
as $$
declare v_actor text:=btrim(coalesce(p_actor,''));
begin
  if v_actor<>'' then
    if char_length(v_actor) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
    return v_actor;
  end if;
  return coalesce((select display_name from public.profiles where id=auth.uid()),'Utente');
end; $$;
revoke all on function private.inventory_actor(text) from public, anon;
grant execute on function private.inventory_actor(text) to authenticated, service_role;

-- Limiti dei codici posizione (formato A-01-B01). Modificabili da Logistica quando saranno noti gli intervalli reali.
create table public.inventory_settings(
  id boolean primary key default true check(id),
  shelf_max_letter text not null default 'Z' check(shelf_max_letter ~ '^[A-Z]$'),
  level_max integer not null default 99 check(level_max between 1 and 99),
  slot_letters text not null default 'ABCDEFGHIJKLMNOPQRSTUVWXYZ' check(slot_letters ~ '^[A-Z]+$'),
  slot_max integer not null default 99 check(slot_max between 1 and 99),
  updated_at timestamptz not null default now()
);
insert into public.inventory_settings(id) values(true);

create table public.inventory_locations(
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.inventory_warehouses(id) on delete restrict,
  code text not null check(code ~ '^[A-Z]-[0-9]{2}-[A-Z][0-9]{2}$'),
  shelf_label text not null default '' check(char_length(shelf_label)<=80),
  level_label text not null default '' check(char_length(level_label)<=80),
  box_label text not null default '' check(char_length(box_label)<=80),
  main_content text not null default '' check(char_length(main_content)<=160),
  notes text not null default '' check(char_length(notes)<=1000),
  archived_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index inventory_locations_code_idx on public.inventory_locations(code);
create index inventory_locations_warehouse_idx on public.inventory_locations(warehouse_id);

-- Articoli
alter table public.inventory_items
  add column area text not null default 'tecnica' check(area in ('tecnica','analisi')),
  add column subteam text not null default 'Generale',
  add column category text not null default '' check(char_length(category)<=120),
  add column location_id uuid references public.inventory_locations(id) on delete restrict,
  add column owner_name text not null default '' check(char_length(owner_name)<=160),
  add column project_use text not null default '' check(char_length(project_use)<=240),
  add column supplier text not null default '' check(char_length(supplier)<=160),
  add column unit_cost numeric(12,2) check(unit_cost is null or unit_cost between 0 and 100000000),
  add column purchase_date date,
  add column expiry_date date,
  add column notes text not null default '' check(char_length(notes)<=3000),
  add column tech_specs text not null default '' check(char_length(tech_specs)<=3000),
  add column status text not null default 'Disponibile',
  add column on_loan integer not null default 0 check(on_loan>=0),
  add column total_value numeric(16,2) generated always as (round(quantity*unit_cost,2)) stored;
alter table public.inventory_items alter column unit set default 'pz';
alter table public.inventory_items add constraint inventory_items_subteam_check check(
  (area='tecnica' and subteam in ('Meccanica','Elettronica','Motore','Braccio','Sensoristica','Generale'))
  or (area='analisi' and subteam in ('Biologia','Geologia','Generale')));
alter table public.inventory_items add constraint inventory_items_status_check check(
  (area='tecnica' and status in ('Disponibile','In uso','Prestato','Da riparare','Danneggiato','Smaltito'))
  or (area='analisi' and status in ('Disponibile','Esaurito','Da controllare','Smaltito')));
create unique index inventory_items_sku_unique on public.inventory_items(lower(sku)) where sku<>'';
create index inventory_items_location_idx on public.inventory_items(location_id);

-- Movimenti (registro append-only già esistente): nuovi tipi e colonne
alter table public.inventory_movements drop constraint inventory_movements_event_type_check;
alter table public.inventory_movements add constraint inventory_movements_event_type_check check(event_type in (
  'warehouse_created','warehouse_updated','warehouse_archived','warehouse_restored',
  'item_created','item_updated','item_archived','item_restored','stock_in','stock_out',
  'loan','return','move','dispose',
  'location_created','location_updated','location_archived','location_restored'
));
alter table public.inventory_movements
  add column movement_date date not null default ((now() at time zone 'Europe/Rome')::date),
  add column sku_snapshot text not null default '',
  add column reason text not null default '' check(char_length(reason)<=500),
  add column from_location_code text not null default '',
  add column to_location_code text not null default '';

-- Richieste di acquisto
create sequence public.inventory_purchase_request_seq;
create table public.inventory_purchase_requests(
  id uuid primary key default gen_random_uuid(),
  seq bigint not null unique default nextval('public.inventory_purchase_request_seq'),
  code text not null unique default '',
  request_date date not null default ((now() at time zone 'Europe/Rome')::date),
  material text not null check(char_length(btrim(material)) between 2 and 200),
  area text not null check(area in ('tecnica','analisi')),
  quantity integer not null check(quantity between 1 and 1000000),
  priority text not null check(priority in ('Alta','Media','Bassa')),
  requester_user_id uuid references public.profiles(id) on delete set null,
  requester_name text not null check(char_length(btrim(requester_name)) between 2 and 160),
  reason text not null default '' check(char_length(reason)<=1000),
  supplier text not null default '' check(char_length(supplier)<=160),
  estimated_cost numeric(12,2) check(estimated_cost is null or estimated_cost between 0 and 100000000),
  status text not null default 'Da valutare' check(status in ('Da valutare','Approvato','Ordinato','In consegna','Ricevuto','Annullato')),
  order_date date,
  received_date date,
  notes text not null default '' check(char_length(notes)<=2000),
  item_id uuid references public.inventory_items(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(status not in ('Ordinato','In consegna','Ricevuto') or order_date is not null),
  check(status<>'Ricevuto' or received_date is not null)
);
create index inventory_purchase_requests_status_idx on public.inventory_purchase_requests(status,request_date desc);

create or replace function private.set_inventory_purchase_code()
returns trigger language plpgsql set search_path=''
as $$ begin new.code:='ACQ-'||lpad(new.seq::text,3,'0'); return new; end; $$;
create trigger inventory_purchase_code before insert on public.inventory_purchase_requests
  for each row execute function private.set_inventory_purchase_code();
revoke all on function private.set_inventory_purchase_code() from public, anon, authenticated;

-- Accessi: lettura a chi può vedere il magazzino; le scritture passano solo dalle funzioni sotto
alter table public.inventory_settings enable row level security;
alter table public.inventory_locations enable row level security;
alter table public.inventory_purchase_requests enable row level security;
revoke all on public.inventory_settings, public.inventory_locations, public.inventory_purchase_requests from public, anon, authenticated;
grant select on public.inventory_settings, public.inventory_locations, public.inventory_purchase_requests to authenticated;
grant update(shelf_max_letter, level_max, slot_letters, slot_max, updated_at) on public.inventory_settings to authenticated;
grant all on public.inventory_settings, public.inventory_locations, public.inventory_purchase_requests to service_role;
grant usage, select on sequence public.inventory_purchase_request_seq to service_role;

drop policy inventory_warehouses_read on public.inventory_warehouses;
drop policy inventory_items_read on public.inventory_items;
drop policy inventory_movements_read on public.inventory_movements;
create policy inventory_warehouses_read on public.inventory_warehouses for select to authenticated using(private.can_view_inventory());
create policy inventory_items_read on public.inventory_items for select to authenticated using(private.can_view_inventory());
create policy inventory_movements_read on public.inventory_movements for select to authenticated using(private.can_view_inventory());
create policy inventory_settings_read on public.inventory_settings for select to authenticated using(private.can_view_inventory());
create policy inventory_settings_update on public.inventory_settings for update to authenticated
  using(private.can_manage_logistics_inventory()) with check(private.can_manage_logistics_inventory());
create policy inventory_locations_read on public.inventory_locations for select to authenticated using(private.can_view_inventory());
create policy inventory_purchase_requests_read on public.inventory_purchase_requests for select to authenticated using(private.can_view_inventory());

-- Validazione codice posizione secondo i limiti configurati
create or replace function private.validate_inventory_location_code(p_code text)
returns void language plpgsql stable security definer set search_path=''
as $$
declare s public.inventory_settings%rowtype;
begin
  if p_code is null or p_code !~ '^[A-Z]-[0-9]{2}-[A-Z][0-9]{2}$' then raise exception 'INVALID_LOCATION_CODE'; end if;
  select * into s from public.inventory_settings where id;
  if substr(p_code,1,1)>s.shelf_max_letter
    or substr(p_code,3,2)::int not between 1 and s.level_max
    or position(substr(p_code,6,1) in s.slot_letters)=0
    or substr(p_code,7,2)::int not between 1 and s.slot_max then raise exception 'LOCATION_OUT_OF_RANGE'; end if;
end; $$;
revoke all on function private.validate_inventory_location_code(text) from public, anon;
grant execute on function private.validate_inventory_location_code(text) to authenticated, service_role;

-- SKU automatico: MEC|SCI - prime 3 lettere del sottoteam - progressivo (es. MEC-MOT-001)
create or replace function private.next_inventory_sku(p_area text,p_subteam text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_prefix text:=case p_area when 'tecnica' then 'MEC' else 'SCI' end; v_code text:=upper(left(p_subteam,3)); v_head text; v_next integer;
begin
  v_head:=v_prefix||'-'||v_code||'-';
  perform pg_advisory_xact_lock(hashtext('inventory_sku'));
  select coalesce(max(substr(sku,length(v_head)+1)::int),0)+1 into v_next
    from public.inventory_items where sku ~ ('^'||v_head||'[0-9]+$');
  return v_head||lpad(v_next::text,3,'0');
end; $$;
revoke all on function private.next_inventory_sku(text,text) from public, anon, authenticated;

-- Sostituzione delle vecchie funzioni articolo/movimento
drop function if exists public.inventory_create_item(uuid,text,text,text,text,integer,integer,text);
drop function if exists private.inventory_create_item(uuid,text,text,text,text,integer,integer);
drop function if exists public.inventory_update_item(uuid,text,text,text,text,integer,text);
drop function if exists public.inventory_update_item(uuid,text,text,text,text,integer);
drop function if exists public.inventory_stock_movement(uuid,text,integer,text,text,text);
drop function if exists private.inventory_stock_movement(uuid,text,integer,text,text);

create or replace function public.inventory_save_location(
  p_actor_name text,p_id uuid,p_warehouse_id uuid,p_code text,p_shelf_label text,p_level_label text,
  p_box_label text,p_main_content text,p_notes text
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_actor text; v_code text:=upper(btrim(coalesce(p_code,''))); v_wh public.inventory_warehouses%rowtype; v_id uuid:=p_id; v_old public.inventory_locations%rowtype;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  v_actor:=private.inventory_actor(p_actor_name);
  perform private.validate_inventory_location_code(v_code);
  if char_length(coalesce(p_shelf_label,''))>80 or char_length(coalesce(p_level_label,''))>80 or char_length(coalesce(p_box_label,''))>80
    or char_length(coalesce(p_main_content,''))>160 or char_length(coalesce(p_notes,''))>1000 then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select * into v_wh from public.inventory_warehouses where id=p_warehouse_id and archived_at is null;
  if not found then raise exception 'WAREHOUSE_NOT_FOUND'; end if;
  begin
    if p_id is null then
      v_id:=gen_random_uuid();
      insert into public.inventory_locations(id,warehouse_id,code,shelf_label,level_label,box_label,main_content,notes,created_by)
        values(v_id,p_warehouse_id,v_code,btrim(coalesce(p_shelf_label,'')),btrim(coalesce(p_level_label,'')),btrim(coalesce(p_box_label,'')),btrim(coalesce(p_main_content,'')),btrim(coalesce(p_notes,'')),auth.uid());
      insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,to_location_code,details)
        values(p_warehouse_id,v_wh.name,'location_created',auth.uid(),v_actor,v_code,jsonb_build_object('code',v_code,'main_content',btrim(coalesce(p_main_content,''))));
    else
      select * into v_old from public.inventory_locations where id=p_id for update;
      if not found then raise exception 'LOCATION_NOT_FOUND'; end if;
      update public.inventory_locations set warehouse_id=p_warehouse_id,code=v_code,shelf_label=btrim(coalesce(p_shelf_label,'')),level_label=btrim(coalesce(p_level_label,'')),
        box_label=btrim(coalesce(p_box_label,'')),main_content=btrim(coalesce(p_main_content,'')),notes=btrim(coalesce(p_notes,'')),updated_at=now() where id=p_id;
      insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,from_location_code,to_location_code,details)
        values(p_warehouse_id,v_wh.name,'location_updated',auth.uid(),v_actor,v_old.code,v_code,jsonb_build_object('before',to_jsonb(v_old),'after',jsonb_build_object('code',v_code,'main_content',btrim(coalesce(p_main_content,'')))));
    end if;
  exception when unique_violation then raise exception 'LOCATION_CODE_TAKEN';
  end;
  return v_id;
end; $$;

create or replace function public.inventory_archive_location(p_id uuid,p_archived boolean,p_actor_name text default '')
returns void language plpgsql security definer set search_path=''
as $$
declare v_loc public.inventory_locations%rowtype; v_wh text; v_actor text;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  v_actor:=private.inventory_actor(p_actor_name);
  select * into v_loc from public.inventory_locations where id=p_id for update;
  if not found then raise exception 'LOCATION_NOT_FOUND'; end if;
  if p_archived and exists(select 1 from public.inventory_items where location_id=p_id and archived_at is null) then raise exception 'ARCHIVE_ACTIVE_ITEMS_FIRST'; end if;
  select name into v_wh from public.inventory_warehouses where id=v_loc.warehouse_id;
  update public.inventory_locations set archived_at=case when p_archived then now() else null end,updated_at=now() where id=p_id;
  insert into public.inventory_movements(warehouse_id,warehouse_name_snapshot,event_type,actor_user_id,actor_name,to_location_code,details)
    values(v_loc.warehouse_id,coalesce(v_wh,''),case when p_archived then 'location_archived' else 'location_restored' end,auth.uid(),v_actor,v_loc.code,jsonb_build_object('code',v_loc.code));
end; $$;

create or replace function public.inventory_create_item(
  p_actor_name text,p_area text,p_subteam text,p_name text,p_category text,p_description text,p_quantity integer,p_unit text,
  p_minimum_quantity integer,p_location_id uuid,p_owner_name text,p_project_use text,p_supplier text,p_unit_cost numeric,
  p_purchase_date date,p_expiry_date date,p_notes text,p_tech_specs text,p_status text,p_purchase_request_id uuid default null
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid(); v_actor text; v_sku text; v_loc public.inventory_locations%rowtype; v_wh public.inventory_warehouses%rowtype; v_req public.inventory_purchase_requests%rowtype;
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  v_actor:=private.inventory_actor(p_actor_name);
  if p_area not in ('tecnica','analisi') or char_length(btrim(coalesce(p_name,''))) not between 2 and 160
    or p_unit not in ('pz','m','cm','kg','g','L','mL','set','scatola','confezione')
    or p_quantity not between 0 and 1000000 or p_minimum_quantity not between 0 and 1000000
    or char_length(coalesce(p_category,''))>120 or char_length(coalesce(p_description,''))>3000 or char_length(coalesce(p_owner_name,''))>160
    or char_length(coalesce(p_project_use,''))>240 or char_length(coalesce(p_supplier,''))>160 or char_length(coalesce(p_notes,''))>3000
    or char_length(coalesce(p_tech_specs,''))>3000 or (p_unit_cost is not null and p_unit_cost not between 0 and 100000000) then raise exception 'INVALID_INVENTORY_DATA'; end if;
  select * into v_loc from public.inventory_locations where id=p_location_id and archived_at is null;
  if not found then raise exception 'LOCATION_REQUIRED'; end if;
  select * into v_wh from public.inventory_warehouses where id=v_loc.warehouse_id and archived_at is null for update;
  if not found then raise exception 'WAREHOUSE_ARCHIVED'; end if;
  if p_purchase_request_id is not null then
    select * into v_req from public.inventory_purchase_requests where id=p_purchase_request_id for update;
    if not found or v_req.status<>'Ricevuto' or v_req.item_id is not null then raise exception 'PURCHASE_REQUEST_NOT_LINKABLE'; end if;
  end if;
  v_sku:=private.next_inventory_sku(p_area,p_subteam);
  begin
    insert into public.inventory_items(id,warehouse_id,location_id,area,subteam,sku,name,category,description,unit,quantity,minimum_quantity,owner_name,project_use,supplier,
      unit_cost,purchase_date,expiry_date,notes,tech_specs,status,created_by)
    values(v_id,v_loc.warehouse_id,v_loc.id,p_area,p_subteam,v_sku,btrim(p_name),btrim(coalesce(p_category,'')),btrim(coalesce(p_description,'')),p_unit,p_quantity,p_minimum_quantity,
      btrim(coalesce(p_owner_name,'')),btrim(coalesce(p_project_use,'')),btrim(coalesce(p_supplier,'')),p_unit_cost,p_purchase_date,p_expiry_date,btrim(coalesce(p_notes,'')),
      btrim(coalesce(p_tech_specs,'')),coalesce(nullif(btrim(coalesce(p_status,'')),''),'Disponibile'),auth.uid());
  exception when check_violation then raise exception 'INVALID_INVENTORY_DATA';
  end;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,sku_snapshot,event_type,quantity_delta,quantity_before,quantity_after,
    actor_user_id,actor_name,reason,to_location_code,details)
  values(v_loc.warehouse_id,v_id,v_wh.name,btrim(p_name),v_sku,case when p_quantity>0 then 'stock_in' else 'item_created' end,p_quantity,0,p_quantity,auth.uid(),v_actor,
    case when p_purchase_request_id is not null then 'Da richiesta '||v_req.code else 'Carico iniziale' end,v_loc.code,
    jsonb_build_object('area',p_area,'subteam',p_subteam,'unit',p_unit,'minimum_quantity',p_minimum_quantity,'opening_stock',p_quantity));
  if p_purchase_request_id is not null then
    update public.inventory_purchase_requests set item_id=v_id,updated_at=now() where id=p_purchase_request_id;
  end if;
  return v_id;
end; $$;

-- Area, sottoteam, SKU, posizione e giacenza non si cambiano qui: la giacenza e la posizione solo con i movimenti.
create or replace function public.inventory_update_item(
  p_id uuid,p_actor_name text,p_name text,p_category text,p_description text,p_unit text,p_minimum_quantity integer,p_owner_name text,p_project_use text,
  p_supplier text,p_unit_cost numeric,p_purchase_date date,p_expiry_date date,p_notes text,p_tech_specs text,p_status text
)
returns void language plpgsql security definer set search_path=''
as $$
declare v_old public.inventory_items%rowtype; v_actor text; v_wh text; v_code text; v_new_status text:=coalesce(nullif(btrim(coalesce(p_status,'')),''),'Disponibile');
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  v_actor:=private.inventory_actor(p_actor_name);
  select * into v_old from public.inventory_items where id=p_id for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if char_length(btrim(coalesce(p_name,''))) not between 2 and 160 or p_minimum_quantity not between 0 and 1000000
    or (p_unit<>v_old.unit and p_unit not in ('pz','m','cm','kg','g','L','mL','set','scatola','confezione'))
    or char_length(coalesce(p_category,''))>120 or char_length(coalesce(p_description,''))>3000 or char_length(coalesce(p_owner_name,''))>160
    or char_length(coalesce(p_project_use,''))>240 or char_length(coalesce(p_supplier,''))>160 or char_length(coalesce(p_notes,''))>3000
    or char_length(coalesce(p_tech_specs,''))>3000 or (p_unit_cost is not null and p_unit_cost not between 0 and 100000000) then raise exception 'INVALID_INVENTORY_DATA'; end if;
  begin
    update public.inventory_items set name=btrim(p_name),category=btrim(coalesce(p_category,'')),description=btrim(coalesce(p_description,'')),unit=p_unit,minimum_quantity=p_minimum_quantity,
      owner_name=btrim(coalesce(p_owner_name,'')),project_use=btrim(coalesce(p_project_use,'')),supplier=btrim(coalesce(p_supplier,'')),unit_cost=p_unit_cost,
      purchase_date=p_purchase_date,expiry_date=p_expiry_date,notes=btrim(coalesce(p_notes,'')),tech_specs=btrim(coalesce(p_tech_specs,'')),status=v_new_status,updated_at=now() where id=p_id;
  exception when check_violation then raise exception 'INVALID_INVENTORY_DATA';
  end;
  select name into v_wh from public.inventory_warehouses where id=v_old.warehouse_id;
  select code into v_code from public.inventory_locations where id=v_old.location_id;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,sku_snapshot,event_type,quantity_before,quantity_after,actor_user_id,actor_name,to_location_code,details)
  values(v_old.warehouse_id,p_id,coalesce(v_wh,''),btrim(p_name),v_old.sku,'item_updated',v_old.quantity,v_old.quantity,auth.uid(),v_actor,coalesce(v_code,''),
    jsonb_build_object(
      'before',jsonb_build_object('name',v_old.name,'category',v_old.category,'unit',v_old.unit,'minimum_quantity',v_old.minimum_quantity,'status',v_old.status,'owner_name',v_old.owner_name,'unit_cost',v_old.unit_cost,'tech_specs',v_old.tech_specs),
      'after',jsonb_build_object('name',btrim(p_name),'category',btrim(coalesce(p_category,'')),'unit',p_unit,'minimum_quantity',p_minimum_quantity,'status',v_new_status,'owner_name',btrim(coalesce(p_owner_name,'')),'unit_cost',p_unit_cost,'tech_specs',btrim(coalesce(p_tech_specs,'')))));
end; $$;

-- Movimenti: entrata, uscita, prestito, rientro, spostamento, smaltimento.
-- Entrata e spostamento: solo Logistica/Team Leader/Amministrazione. Gli altri: anche i Capi Area.
create or replace function public.inventory_record_movement(
  p_item_id uuid,p_actor_name text,p_type text,p_quantity integer,p_person text,p_reason text,p_date date default null,
  p_to_location_id uuid default null,p_notes text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
declare
  v_item public.inventory_items%rowtype; v_wh public.inventory_warehouses%rowtype; v_actor text; v_today date:=(now() at time zone 'Europe/Rome')::date;
  v_event text; v_delta integer:=0; v_after integer; v_loan integer; v_from text:=''; v_to text:=''; v_new_wh uuid; v_qty integer:=coalesce(p_quantity,0); v_new_loc public.inventory_locations%rowtype;
begin
  if not private.can_view_inventory() then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('entrata','uscita','prestito','rientro','spostamento','smaltimento') then raise exception 'INVALID_INVENTORY_MOVEMENT'; end if;
  if p_type in ('entrata','spostamento') and not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  v_actor:=private.inventory_actor(p_actor_name);
  if char_length(btrim(coalesce(p_person,''))) not between 2 and 160 then raise exception 'PERSON_REQUIRED'; end if;
  if char_length(coalesce(p_reason,''))>500 or char_length(coalesce(p_notes,''))>2000 then raise exception 'INVALID_INVENTORY_MOVEMENT'; end if;
  if p_date is not null and (p_date>v_today or p_date<v_today-interval '1 year') then raise exception 'INVALID_MOVEMENT_DATE'; end if;
  if p_type<>'spostamento' and v_qty not between 1 and 1000000 then raise exception 'INVALID_INVENTORY_MOVEMENT'; end if;
  select * into v_item from public.inventory_items where id=p_item_id and archived_at is null for update;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  select * into v_wh from public.inventory_warehouses where id=v_item.warehouse_id and archived_at is null;
  if not found then raise exception 'WAREHOUSE_ARCHIVED'; end if;
  select coalesce(code,'') into v_from from public.inventory_locations where id=v_item.location_id;
  v_from:=coalesce(v_from,''); v_after:=v_item.quantity; v_loan:=v_item.on_loan; v_new_wh:=v_item.warehouse_id;

  if p_type='entrata' then v_event:='stock_in'; v_delta:=v_qty;
  elsif p_type='uscita' then v_event:='stock_out'; v_delta:=-v_qty;
  elsif p_type='smaltimento' then v_event:='dispose'; v_delta:=-v_qty;
  elsif p_type='prestito' then v_event:='loan'; v_delta:=-v_qty; v_loan:=v_loan+v_qty;
  elsif p_type='rientro' then
    if v_qty>v_item.on_loan then raise exception 'RETURN_EXCEEDS_LOAN'; end if;
    v_event:='return'; v_delta:=v_qty; v_loan:=v_loan-v_qty;
  else
    v_event:='move'; v_qty:=0;
    select * into v_new_loc from public.inventory_locations where id=p_to_location_id and archived_at is null;
    if not found then raise exception 'LOCATION_REQUIRED'; end if;
    if v_new_loc.id is not distinct from v_item.location_id then raise exception 'SAME_LOCATION'; end if;
    if not exists(select 1 from public.inventory_warehouses where id=v_new_loc.warehouse_id and archived_at is null) then raise exception 'WAREHOUSE_ARCHIVED'; end if;
    v_to:=v_new_loc.code; v_new_wh:=v_new_loc.warehouse_id;
  end if;
  v_after:=v_item.quantity+v_delta;
  if v_after<0 then raise exception 'INSUFFICIENT_STOCK'; end if;

  update public.inventory_items set quantity=v_after,on_loan=v_loan,warehouse_id=v_new_wh,
    location_id=case when p_type='spostamento' then v_new_loc.id else location_id end,updated_at=now() where id=p_item_id;
  insert into public.inventory_movements(warehouse_id,item_id,warehouse_name_snapshot,item_name_snapshot,sku_snapshot,event_type,quantity_delta,quantity_before,quantity_after,
    actor_user_id,actor_name,taken_by_name,reason,notes,movement_date,from_location_code,to_location_code,details)
  values(v_new_wh,p_item_id,coalesce((select name from public.inventory_warehouses where id=v_new_wh),v_wh.name),v_item.name,v_item.sku,v_event,v_delta,v_item.quantity,v_after,
    auth.uid(),v_actor,btrim(p_person),btrim(coalesce(p_reason,'')),btrim(coalesce(p_notes,'')),coalesce(p_date,v_today),
    case when p_type='spostamento' then v_from else v_from end,case when p_type='spostamento' then v_to else v_from end,
    jsonb_build_object('on_loan_after',v_loan));
end; $$;

-- Richieste di acquisto
create or replace function public.inventory_create_purchase_request(
  p_actor_name text,p_material text,p_area text,p_quantity integer,p_priority text,p_requester_name text,p_reason text,
  p_supplier text,p_estimated_cost numeric,p_notes text default ''
)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid:=gen_random_uuid(); v_name text:=btrim(coalesce(p_requester_name,''));
begin
  if not private.can_view_inventory() then raise exception 'FORBIDDEN'; end if;
  if v_name='' then v_name:=private.inventory_actor(p_actor_name); end if;
  if char_length(v_name) not between 2 and 160 or char_length(btrim(coalesce(p_material,''))) not between 2 and 200
    or p_area not in ('tecnica','analisi') or p_quantity not between 1 and 1000000 or p_priority not in ('Alta','Media','Bassa')
    or char_length(coalesce(p_reason,''))>1000 or char_length(coalesce(p_supplier,''))>160 or char_length(coalesce(p_notes,''))>2000
    or (p_estimated_cost is not null and p_estimated_cost not between 0 and 100000000) then raise exception 'INVALID_PURCHASE_REQUEST'; end if;
  insert into public.inventory_purchase_requests(id,material,area,quantity,priority,requester_user_id,requester_name,reason,supplier,estimated_cost,notes)
  values(v_id,btrim(p_material),p_area,p_quantity,p_priority,auth.uid(),v_name,btrim(coalesce(p_reason,'')),btrim(coalesce(p_supplier,'')),p_estimated_cost,btrim(coalesce(p_notes,'')));
  return v_id;
end; $$;

create or replace function public.inventory_update_purchase_request(
  p_id uuid,p_status text,p_order_date date,p_received_date date,p_notes text,p_actor_name text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
declare
  v_old public.inventory_purchase_requests%rowtype; v_manage boolean:=private.can_manage_logistics_inventory(); v_today date:=(now() at time zone 'Europe/Rome')::date;
  v_order date; v_received date; v_rank_old integer; v_rank_new integer;
  v_ranks text[]:=array['Da valutare','Approvato','Ordinato','In consegna','Ricevuto'];
begin
  if not private.can_view_inventory() then raise exception 'FORBIDDEN'; end if;
  perform private.inventory_actor(p_actor_name);
  select * into v_old from public.inventory_purchase_requests where id=p_id for update;
  if not found then raise exception 'PURCHASE_REQUEST_NOT_FOUND'; end if;
  if not v_manage and not (v_old.requester_user_id=auth.uid() and v_old.status='Da valutare' and p_status='Annullato') then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('Da valutare','Approvato','Ordinato','In consegna','Ricevuto','Annullato') or char_length(coalesce(p_notes,''))>2000 then raise exception 'INVALID_PURCHASE_REQUEST'; end if;
  if v_old.status in ('Ricevuto','Annullato') and p_status<>v_old.status then raise exception 'PURCHASE_REQUEST_CLOSED'; end if;
  if p_status<>'Annullato' then
    v_rank_old:=array_position(v_ranks,v_old.status); v_rank_new:=array_position(v_ranks,p_status);
    if v_rank_new<v_rank_old then raise exception 'PURCHASE_STATUS_BACKWARDS'; end if;
  end if;
  v_order:=coalesce(p_order_date,v_old.order_date); v_received:=coalesce(p_received_date,v_old.received_date);
  if p_status in ('Ordinato','In consegna','Ricevuto') and v_order is null then raise exception 'ORDER_DATE_REQUIRED'; end if;
  if p_status='Ricevuto' and v_received is null then raise exception 'RECEIVED_DATE_REQUIRED'; end if;
  if (v_order is not null and v_order>v_today) or (v_received is not null and v_received>v_today)
    or (v_order is not null and v_received is not null and v_received<v_order) then raise exception 'INVALID_PURCHASE_DATES'; end if;
  update public.inventory_purchase_requests set status=p_status,order_date=v_order,received_date=v_received,notes=btrim(coalesce(p_notes,'')),updated_at=now() where id=p_id;
end; $$;

revoke all on function public.inventory_save_location(text,uuid,uuid,text,text,text,text,text,text),
  public.inventory_archive_location(uuid,boolean,text),
  public.inventory_create_item(text,text,text,text,text,text,integer,text,integer,uuid,text,text,text,numeric,date,date,text,text,text,uuid),
  public.inventory_update_item(uuid,text,text,text,text,text,integer,text,text,text,numeric,date,date,text,text,text),
  public.inventory_record_movement(uuid,text,text,integer,text,text,date,uuid,text),
  public.inventory_create_purchase_request(text,text,text,integer,text,text,text,text,numeric,text),
  public.inventory_update_purchase_request(uuid,text,date,date,text,text) from public, anon;
grant execute on function public.inventory_save_location(text,uuid,uuid,text,text,text,text,text,text),
  public.inventory_archive_location(uuid,boolean,text),
  public.inventory_create_item(text,text,text,text,text,text,integer,text,integer,uuid,text,text,text,numeric,date,date,text,text,text,uuid),
  public.inventory_update_item(uuid,text,text,text,text,text,integer,text,text,text,numeric,date,date,text,text,text),
  public.inventory_record_movement(uuid,text,text,integer,text,text,date,uuid,text),
  public.inventory_create_purchase_request(text,text,text,integer,text,text,text,text,numeric,text),
  public.inventory_update_purchase_request(uuid,text,date,date,text,text) to authenticated, service_role;

commit;
