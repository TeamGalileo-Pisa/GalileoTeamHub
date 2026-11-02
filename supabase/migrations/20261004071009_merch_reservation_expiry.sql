begin;
create or replace function public.expire_merch_orders()
returns integer language plpgsql security definer set search_path=''
as $$
declare v_order record; v_count integer:=0;
begin
 for v_order in select id from public.merch_orders where status='pending' and expires_at<=now() for update skip locked loop
   update public.merch_variants v set stock=v.stock+x.qty from (
     select variant_id,sum(quantity)::integer qty from public.merch_order_items where order_id=v_order.id group by variant_id
   ) x where v.id=x.variant_id and v.stock is not null;
   update public.merch_orders set status='expired' where id=v_order.id and status='pending';
   v_count:=v_count+1;
 end loop;
 return v_count;
end;$$;
revoke all on function public.expire_merch_orders() from public,anon,authenticated;
grant execute on function public.expire_merch_orders() to service_role;
select cron.schedule('galileo-merch-order-expiry','*/5 * * * *','select public.expire_merch_orders()');
commit;

