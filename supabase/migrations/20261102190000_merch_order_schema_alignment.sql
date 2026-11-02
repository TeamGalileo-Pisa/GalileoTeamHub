-- Allinea merch_orders a quanto già usano update_merch_order,
-- cancel_managed_merch_order e la pagina Merchandising (gestione ordini):
-- colonne payment_method, buyer_email, request_number e stato 'ordered'.
-- Prima mancavano, quindi la lista ordini e le due funzioni fallivano.
begin;

alter table public.merch_orders
  add column buyer_email text,
  -- PayPal manuale finché l'ordine non è legato a un pagamento PayPal online.
  add column payment_method text generated always as (
    case when paypal_order_id is null then 'paypal_manual' else 'paypal' end
  ) stored,
  -- Numero mostrato in admin: ANNO/PROGRESSIVO, oppure i primi 8 caratteri
  -- dell'identificativo per gli ordini precedenti alla numerazione.
  add column request_number text generated always as (
    case when order_seq is null then upper(left(id::text, 8))
         else order_year::text || '/' || order_seq::text end
  ) stored,
  add constraint merch_orders_buyer_email_check
    check (buyer_email is null or (char_length(buyer_email) <= 254 and buyer_email = lower(buyer_email)));

alter table public.merch_orders drop constraint if exists merch_orders_status_check;
alter table public.merch_orders add constraint merch_orders_status_check
  check (status in ('pending', 'ordered', 'paid', 'expired', 'cancelled'));

-- Email dell'acquirente per gli ordini già esistenti, dalla coda mail.
update public.merch_orders o
set buyer_email = lower(btrim(c.recipient))
from public.community_outbox c
where c.kind = 'merch_order'
  and c.payload->>'orderId' = o.id::text
  and o.buyer_email is null
  and c.recipient is not null
  and char_length(btrim(c.recipient)) <= 254;

-- Per i nuovi ordini l'email viene copiata quando la mail viene messa in coda.
-- Un errore qui non deve mai impedire l'invio della mail.
create or replace function private.sync_merch_buyer_email()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if new.kind = 'merch_order' and new.recipient is not null
     and coalesce(new.payload->>'orderId', '') ~* '^[0-9a-f-]{36}$' then
    begin
      update public.merch_orders
      set buyer_email = lower(btrim(new.recipient))
      where id = (new.payload->>'orderId')::uuid and buyer_email is null
        and char_length(btrim(new.recipient)) <= 254;
    exception when others then null;
    end;
  end if;
  return new;
end;
$$;
revoke all on function private.sync_merch_buyer_email() from public, anon, authenticated;

drop trigger if exists community_outbox_sync_merch_buyer_email on public.community_outbox;
create trigger community_outbox_sync_merch_buyer_email
  after insert on public.community_outbox
  for each row execute function private.sync_merch_buyer_email();

commit;
