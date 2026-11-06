begin;

-- Le richieste via mail restano "Ordinato" (scorta riservata) finche' la logistica
-- non le segna manualmente come pagate o annullate.
alter table public.merch_order_events drop constraint if exists merch_order_events_action_check;
alter table public.merch_order_events add constraint merch_order_events_action_check
  check (action in ('updated', 'cancelled', 'paid', 'unpaid'));

create or replace function public.mark_merch_order_ordered(p_order uuid)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  update public.merch_orders set status = 'ordered'
  where id = p_order and status = 'pending' and paypal_order_id is null;
end;
$$;
revoke all on function public.mark_merch_order_ordered(uuid) from public, anon, authenticated;
grant execute on function public.mark_merch_order_ordered(uuid) to service_role;

create or replace function public.set_merch_order_paid(p_order uuid, p_paid boolean)
returns void language plpgsql security definer set search_path = ''
as $$
declare v_order public.merch_orders%rowtype; v_new text;
begin
  if auth.uid() is null or not private.can_manage_merchandising() then
    raise exception 'FORBIDDEN';
  end if;
  select * into v_order from public.merch_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if v_order.payment_method <> 'paypal_manual' or v_order.status not in ('ordered', 'paid') then
    raise exception 'ORDER_STATUS_LOCKED';
  end if;
  v_new := case when coalesce(p_paid, false) then 'paid' else 'ordered' end;
  if v_new = v_order.status then return; end if;
  update public.merch_orders
  set status = v_new, paid_at = case when v_new = 'paid' then now() else null end
  where id = p_order;
  insert into public.merch_order_events(order_id, actor_user_id, action,
    old_status, new_status, old_total_cents, new_total_cents)
  values (p_order, auth.uid(), case when v_new = 'paid' then 'paid' else 'unpaid' end,
    v_order.status, v_new, v_order.total_cents, v_order.total_cents);
end;
$$;
revoke all on function public.set_merch_order_paid(uuid, boolean) from public, anon;
grant execute on function public.set_merch_order_paid(uuid, boolean) to authenticated;

commit;
