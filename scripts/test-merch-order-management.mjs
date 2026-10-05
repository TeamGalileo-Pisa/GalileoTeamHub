import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated;
  create schema auth; create schema private;
  create function auth.uid() returns uuid language sql as $$
    select nullif(current_setting('test.uid', true), '')::uuid
  $$;
  create function private.can_manage_merchandising() returns boolean language sql as $$
    select coalesce(current_setting('test.can_manage', true), 'false') = 'true'
  $$;
  create table public.profiles(id uuid primary key);
  create table public.merch_products(
    id uuid primary key, name text not null, price_cents integer not null,
    active boolean not null default true, visibility text not null default 'everyone'
  );
  create table public.merch_variants(
    id uuid primary key, product_id uuid not null references public.merch_products(id),
    label text not null, stock integer, active boolean not null default true
  );
  create table public.merch_orders(
    id uuid primary key, buyer_user_id uuid, buyer_first_name text, buyer_last_name text,
    buyer_email text, payment_method text not null, status text not null,
    total_cents integer not null, paid_at timestamptz
  );
  create table public.merch_order_items(
    id uuid primary key default gen_random_uuid(),
    order_id uuid not null references public.merch_orders(id),
    product_id uuid references public.merch_products(id) on delete set null,
    variant_id uuid references public.merch_variants(id) on delete set null,
    product_name text not null, variant_label text not null,
    unit_price_cents integer not null, quantity integer not null, line_total_cents integer not null
  );
`);

await db.exec(await readFile("supabase/migrations/20261005125919_merch_order_management.sql", "utf8"));

const manager = "11111111-1111-4111-8111-111111111111";
const orderId = "22222222-2222-4222-8222-222222222222";
const orderItemId = "33333333-3333-4333-8333-333333333333";
const productId = "44444444-4444-4444-8444-444444444444";
const mediumId = "55555555-5555-4555-8555-555555555555";
const smallId = "66666666-6666-4666-8666-666666666666";
await db.query("insert into profiles(id) values($1)", [manager]);
await db.query("insert into merch_products(id,name,price_cents) values($1,'Felpa',1000)", [productId]);
await db.query("insert into merch_variants(id,product_id,label,stock) values($1,$3,'M',8),($2,$3,'S',10)", [mediumId, smallId, productId]);
await db.query(`insert into merch_orders(id,buyer_first_name,buyer_last_name,buyer_email,payment_method,status,total_cents)
  values($1,'Ada','Lovelace','ada@studenti.unipi.it','paypal_manual','ordered',2000)`, [orderId]);
await db.query(`insert into merch_order_items(id,order_id,product_id,variant_id,product_name,variant_label,unit_price_cents,quantity,line_total_cents)
  values($1,$2,$3,$4,'Felpa','M',1000,2,2000)`, [orderItemId, orderId, productId, mediumId]);

await db.query("select set_config('test.uid',$1,false), set_config('test.can_manage','true',false)", [manager]);
const update = async (items, confirmAdjustment = false) => db.query(
  "select * from public.update_merch_order($1,'Ada','Lovelace','ada@studenti.unipi.it',$2::jsonb,$3)",
  [orderId, JSON.stringify(items), confirmAdjustment],
);
const stock = async (variantId) => (await db.query("select stock from merch_variants where id=$1", [variantId])).rows[0].stock;

await update([{ itemId: orderItemId, quantity: 3 }, { variantId: smallId, quantity: 1 }]);
assert.equal((await db.query("select total_cents from merch_orders where id=$1", [orderId])).rows[0].total_cents, 4000);
assert.equal(await stock(mediumId), 7, "retained lines reserve the requested quantity");
assert.equal(await stock(smallId), 9, "added lines reserve inventory");
assert.equal((await db.query("select count(*)::int as n from merch_order_events where action='updated'")).rows[0].n, 1);

await assert.rejects(update([{ itemId: orderItemId, quantity: 20 }, { variantId: smallId, quantity: 20 }]), /OUT_OF_STOCK/);
assert.equal(await stock(mediumId), 7, "failed edits roll back stock changes");
assert.equal(await stock(smallId), 9, "failed edits roll back added stock");

await update([{ itemId: orderItemId, quantity: 2 }]);
assert.equal(await stock(mediumId), 8, "removing quantity returns inventory");
assert.equal(await stock(smallId), 10, "removing a line returns inventory");
await db.query("update merch_orders set status='paid', paid_at=now() where id=$1", [orderId]);
await assert.rejects(update([{ itemId: orderItemId, quantity: 3 }]), /PAYMENT_ADJUSTMENT_CONFIRMATION_REQUIRED/);
await update([{ itemId: orderItemId, quantity: 3 }], true);
assert.equal((await db.query("select status from merch_orders where id=$1", [orderId])).rows[0].status, "paid");
assert.ok((await db.query("select paid_at from merch_orders where id=$1", [orderId])).rows[0].paid_at);

await assert.rejects(db.query("select cancel_managed_merch_order($1,false)", [orderId]), /REFUND_CONFIRMATION_REQUIRED/);
await db.query("select cancel_managed_merch_order($1,true)", [orderId]);
assert.equal((await db.query("select status from merch_orders where id=$1", [orderId])).rows[0].status, "cancelled");
assert.equal(await stock(mediumId), 10, "cancelling restores the reserved stock");
assert.equal((await db.query("select count(*)::int as n from merch_order_events where action='cancelled'")).rows[0].n, 1);

await db.query("select set_config('test.can_manage','false',false)");
await assert.rejects(update([{ itemId: orderItemId, quantity: 1 }]), /FORBIDDEN/);
await db.close();
console.log("Order management SQL checks passed.");
