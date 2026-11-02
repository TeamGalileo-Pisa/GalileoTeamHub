begin;

do $$
declare
  v_proc record;
  v_definition text;
  v_old text:='select display_name into v_actor from public.profiles where id=auth.uid();';
  v_new text:='select coalesce(nullif(current_setting(''app.inventory_actor_name'',true),''''),display_name) into v_actor from public.profiles where id=auth.uid();';
begin
  for v_proc in
    select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'inventory\_%' escape '\'
  loop
    v_definition:=pg_get_functiondef(v_proc.oid);
    if position(v_old in v_definition)=0 then raise exception 'INVENTORY_ACTOR_AUDIT_PATCH_MISSING'; end if;
    execute replace(v_definition,v_old,v_new);
  end loop;
end; $$;

create or replace function public.inventory_create_warehouse(
  p_name text,p_location text default '',p_notes text default '',p_actor_name text default ''
)
returns uuid language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  return public.inventory_create_warehouse(p_name,p_location,p_notes);
end; $$;

create or replace function public.inventory_update_warehouse(
  p_id uuid,p_name text,p_location text,p_notes text,p_actor_name text
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform public.inventory_update_warehouse(p_id,p_name,p_location,p_notes);
end; $$;

create or replace function public.inventory_archive_warehouse(
  p_id uuid,p_archived boolean,p_actor_name text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform public.inventory_archive_warehouse(p_id,p_archived);
end; $$;

create or replace function public.inventory_create_item(
  p_warehouse_id uuid,p_name text,p_sku text default '',p_description text default '',
  p_unit text default 'pezzi',p_initial_quantity integer default 0,p_minimum_quantity integer default 0,
  p_actor_name text default ''
)
returns uuid language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  return public.inventory_create_item(p_warehouse_id,p_name,p_sku,p_description,p_unit,p_initial_quantity,p_minimum_quantity);
end; $$;

create or replace function public.inventory_update_item(
  p_id uuid,p_name text,p_sku text,p_description text,p_unit text,p_minimum_quantity integer,p_actor_name text
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform public.inventory_update_item(p_id,p_name,p_sku,p_description,p_unit,p_minimum_quantity);
end; $$;

create or replace function public.inventory_stock_movement(
  p_item_id uuid,p_event text,p_quantity integer,p_taken_by text default '',p_notes text default '',
  p_actor_name text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform public.inventory_stock_movement(p_item_id,p_event,p_quantity,p_taken_by,p_notes);
end; $$;

create or replace function public.inventory_archive_item(
  p_id uuid,p_archived boolean,p_actor_name text default ''
)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if not private.can_manage_logistics_inventory() then raise exception 'FORBIDDEN'; end if;
  if char_length(btrim(coalesce(p_actor_name,''))) not between 2 and 160 then raise exception 'OPERATOR_NAME_REQUIRED'; end if;
  perform set_config('app.inventory_actor_name',btrim(p_actor_name),true);
  perform public.inventory_archive_item(p_id,p_archived);
end; $$;

revoke execute on function public.inventory_create_warehouse(text,text,text),
  public.inventory_update_warehouse(uuid,text,text,text),
  public.inventory_archive_warehouse(uuid,boolean),
  public.inventory_create_item(uuid,text,text,text,text,integer,integer),
  public.inventory_update_item(uuid,text,text,text,text,integer),
  public.inventory_stock_movement(uuid,text,integer,text,text),
  public.inventory_archive_item(uuid,boolean) from public,anon,authenticated;

grant execute on function public.inventory_create_warehouse(text,text,text,text),
  public.inventory_update_warehouse(uuid,text,text,text,text),
  public.inventory_archive_warehouse(uuid,boolean,text),
  public.inventory_create_item(uuid,text,text,text,text,integer,integer,text),
  public.inventory_update_item(uuid,text,text,text,text,integer,text),
  public.inventory_stock_movement(uuid,text,integer,text,text,text),
  public.inventory_archive_item(uuid,boolean,text) to authenticated,service_role;

commit;
