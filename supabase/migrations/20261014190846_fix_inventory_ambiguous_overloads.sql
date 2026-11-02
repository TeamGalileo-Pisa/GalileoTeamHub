-- Magazzino: le funzioni con p_actor_name (default '') richiamavano la versione senza p_actor_name con gli
-- stessi argomenti. Postgres non sapeva quale scegliere ("function ... is not unique") e ogni salvataggio falliva.
-- Le versioni "interne" vengono spostate nello schema private (non esposto dall'API) e le funzioni pubbliche le chiamano da li'.
alter function public.inventory_create_warehouse(text,text,text) set schema private;
alter function public.inventory_archive_warehouse(uuid,boolean) set schema private;
alter function public.inventory_create_item(uuid,text,text,text,text,integer,integer) set schema private;
alter function public.inventory_stock_movement(uuid,text,integer,text,text) set schema private;
alter function public.inventory_archive_item(uuid,boolean) set schema private;

create or replace function public.inventory_create_warehouse(p_name text, p_location text default '', p_notes text default '', p_actor_name text default '')
returns uuid language plpgsql security definer set search_path to '' as $f$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  return private.inventory_create_warehouse(p_name,p_location,p_notes);
end; $f$;

create or replace function public.inventory_archive_warehouse(p_id uuid, p_archived boolean, p_actor_name text default '')
returns void language plpgsql security definer set search_path to '' as $f$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform private.inventory_archive_warehouse(p_id,p_archived);
end; $f$;

create or replace function public.inventory_create_item(p_warehouse_id uuid, p_name text, p_sku text default '', p_description text default '', p_unit text default 'pezzi', p_initial_quantity integer default 0, p_minimum_quantity integer default 0, p_actor_name text default '')
returns uuid language plpgsql security definer set search_path to '' as $f$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  return private.inventory_create_item(p_warehouse_id,p_name,p_sku,p_description,p_unit,p_initial_quantity,p_minimum_quantity);
end; $f$;

create or replace function public.inventory_stock_movement(p_item_id uuid, p_event text, p_quantity integer, p_taken_by text default '', p_notes text default '', p_actor_name text default '')
returns void language plpgsql security definer set search_path to '' as $f$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform private.inventory_stock_movement(p_item_id,p_event,p_quantity,p_taken_by,p_notes);
end; $f$;

create or replace function public.inventory_archive_item(p_id uuid, p_archived boolean, p_actor_name text default '')
returns void language plpgsql security definer set search_path to '' as $f$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform private.inventory_archive_item(p_id,p_archived);
end; $f$;
