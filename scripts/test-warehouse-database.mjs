// Verifica la migration del magazzino (modello a fogli: Inventario, Posizioni, Movimenti, Acquisti)
// su PostgreSQL (PGlite) con ruoli e RLS reali. Il fixture riproduce solo le tabelle da cui dipende.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";

const db = new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create schema auth;create schema private;create schema storage;
grant usage on schema public,private to authenticated,service_role;
grant usage on schema auth to authenticated,service_role;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create type public.app_role as enum('admin','team_leader','area_lead','member');
create table public.profiles(id uuid primary key,display_name text,status text default 'active',must_change_password boolean default false);
create table public.system_roles(user_id uuid references public.profiles on delete cascade,role public.app_role);
create table public.areas(id uuid primary key default gen_random_uuid(),name text,slug text unique,active boolean default true);
create table public.area_memberships(user_id uuid references public.profiles,area_id uuid references public.areas,role text default 'area_lead',ended_at timestamptz);
create table public.area_shared_accounts(user_id uuid references public.profiles,area_id uuid references public.areas);
create function private.is_admin() returns boolean language sql as $$select exists(select 1 from public.system_roles where user_id=auth.uid() and role='admin')$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
`);
const adminAwareManage = `create or replace function private.can_manage_logistics_inventory() returns boolean language sql stable security definer set search_path='' as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (private.is_admin()
      or exists(select 1 from public.system_roles r where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null and a.slug='logistica' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id where m.user_id=auth.uid() and a.slug='logistica' and a.active))
$$;
`;
const migration = (file) => readFile(`supabase/migrations/${file}`, "utf8");
await db.exec(await migration("20261005042617_logistics_inventory_ledger.sql"));
// Stessa regola della migration 20261013110000: il Team Leader, l'Amministrazione e Logistica gestiscono il magazzino.
await db.exec(adminAwareManage);
await db.exec(await migration("20261005044433_inventory_audit_backup.sql"));
// Il blocco DO iniziale di operator_identity "patcha" funzioni già aggiornate nel file del ledger (non rigiocabile da zero):
// qui si carica solo la parte con le funzioni wrapper.
const identity = await migration("20261005044700_inventory_operator_identity.sql");
await db.exec("begin;" + identity.slice(identity.indexOf("create or replace function public.inventory_create_warehouse(")));
await db.exec(await migration("20261014190000_fix_inventory_ambiguous_overloads.sql"));
await db.exec(await migration("20261020100000_warehouse_sheets_model.sql"));

try {
const ids = {
  tl: "00000000-0000-0000-0000-000000000001", adm: "00000000-0000-0000-0000-000000000002",
  logi: "00000000-0000-0000-0000-000000000003", lead: "00000000-0000-0000-0000-000000000004",
  out: "00000000-0000-0000-0000-000000000005", mem: "00000000-0000-0000-0000-000000000006",
};
await db.exec(`
insert into public.profiles(id,display_name) values
 ('${ids.tl}','Team Leader'),('${ids.adm}','Admin'),('${ids.logi}','Capo Logistica'),('${ids.lead}','Capo Software'),('${ids.out}','Senza ruolo'),('${ids.mem}','Membro Software');
insert into public.areas(id,name,slug) values ('10000000-0000-0000-0000-000000000001','Logistica','logistica'),('10000000-0000-0000-0000-000000000002','Software','software');
insert into public.system_roles values ('${ids.tl}','team_leader'),('${ids.adm}','admin');
insert into public.area_memberships(user_id,area_id) values ('${ids.logi}','10000000-0000-0000-0000-000000000001'),('${ids.lead}','10000000-0000-0000-0000-000000000002');
insert into public.area_shared_accounts values ('${ids.mem}','10000000-0000-0000-0000-000000000002');
`);

const as = async (user, sql, params) => {
  await db.exec(`set role authenticated; select set_config('test.uid','${ids[user]}',false);`);
  try { return await db.query(sql, params); } finally { await db.exec("reset role"); }
};
const fails = async (user, sql, params, code) => {
  try { await as(user, sql, params); } catch (error) {
    assert.match(String(error.message), new RegExp(code), `atteso ${code}, ottenuto: ${error.message}`);
    return;
  }
  assert.fail(`atteso errore ${code} ma l'operazione è riuscita: ${sql.slice(0, 80)}`);
};

// --- magazzino e posizioni
const wh = (await as("logi", "select public.inventory_create_warehouse('Magazzino tecnico','Sede','', 'Mario Rossi') id")).rows[0].id;
const wh2 = (await as("logi", "select public.inventory_create_warehouse('Laboratorio analisi','Sede','', 'Mario Rossi') id")).rows[0].id;
const loc = async (user, id, wid, code) => (await as(user, "select public.inventory_save_location('Mario Rossi',$1,$2,$3,'Scaffale A','1','Box 1','Elettronica','') id", [id, wid, code])).rows[0].id;
const locA = await loc("logi", null, wh, "a-01-b01");
const locC = await loc("tl", null, wh2, "C-02-R01");
assert.equal((await as("logi", "select code from public.inventory_locations where id=$1", [locA])).rows[0].code, "A-01-B01", "il codice viene normalizzato in maiuscolo");
await fails("logi", "select public.inventory_save_location('Mario Rossi',null,$1,'AA-1-B1','','','','','')", [wh], "INVALID_LOCATION_CODE");
await fails("logi", "select public.inventory_save_location('Mario Rossi',null,$1,'A-01-B01','','','','','')", [wh], "LOCATION_CODE_TAKEN");
await fails("lead", "select public.inventory_save_location('',null,$1,'B-01-B01','','','','','')", [wh], "FORBIDDEN");
await as("logi", "update public.inventory_settings set shelf_max_letter='C'");
await fails("logi", "select public.inventory_save_location('Mario Rossi',null,$1,'D-01-B01','','','','','')", [wh], "LOCATION_OUT_OF_RANGE");
await as("lead", "update public.inventory_settings set shelf_max_letter='Z'");
assert.equal((await db.query("select shelf_max_letter from public.inventory_settings")).rows[0].shelf_max_letter, "C", "un capo area non può cambiare i limiti");

// --- articoli e SKU automatico
const item = (user, area, sub, name, qty, unit, min, loc, status = "Disponibile", extra = {}) => as(user,
  "select public.inventory_create_item('Mario Rossi',$1,$2,$3,'Cat','',$4,$5,$6,$7,'Resp','Rover','Forn',$8,null,null,'','12V',$9,$10) id",
  [area, sub, name, qty, unit, min, loc, extra.cost ?? 2.5, status, extra.req ?? null]);
const i1 = (await item("logi", "tecnica", "Motore", "Motore DC", 10, "pz", 2, locA)).rows[0].id;
const i2 = (await item("tl", "tecnica", "Motore", "Motore stepper", 5, "pz", 1, locA)).rows[0].id;
const i3 = (await item("adm", "analisi", "Biologia", "Provette", 100, "pz", 20, locC, "Disponibile")).rows[0].id;
const skus = (await db.query("select name,sku,total_value from public.inventory_items order by sku")).rows;
assert.deepEqual(skus.map((r) => r.sku), ["MEC-MOT-001", "MEC-MOT-002", "SCI-BIO-001"]);
assert.equal(Number(skus[0].total_value), 25, "valore totale = quantità x costo unitario");
await fails("logi", "select public.inventory_create_item('Mario Rossi','tecnica','Biologia','Nome','','',1,'pz',0,$1,'','','',null,null,null,'','','Disponibile')", [locA], "INVALID_INVENTORY_DATA");
await fails("logi", "select public.inventory_create_item('Mario Rossi','tecnica','Motore','Nome','','',1,'pz',0,$1,'','','',null,null,null,'','','Esaurito')", [locA], "INVALID_INVENTORY_DATA");
await fails("logi", "select public.inventory_create_item('Mario Rossi','tecnica','Motore','Nome','','',1,'pezzi',0,$1,'','','',null,null,null,'','','Disponibile')", [locA], "INVALID_INVENTORY_DATA");
await fails("lead", "select public.inventory_create_item('Mario Rossi','tecnica','Motore','Nome','','',1,'pz',0,$1,'','','',null,null,null,'','','Disponibile')", [locA], "FORBIDDEN");
await assert.rejects(db.query("insert into public.inventory_items(warehouse_id,name,sku,created_by) values($1,'Doppione','mec-mot-001',$2)", [wh, ids.logi]), /unique/i, "SKU duplicato impossibile");
assert.equal((await db.query("select count(*)::int n from public.inventory_movements where event_type='stock_in'")).rows[0].n, 3, "carico iniziale registrato come Entrata");

// --- visibilità
assert.equal((await as("lead", "select count(*)::int n from public.inventory_items")).rows[0].n, 3, "il capo area vede l'inventario");
assert.equal((await as("out", "select count(*)::int n from public.inventory_items")).rows[0].n, 0, "chi non ha ruolo non vede nulla");
assert.equal((await as("mem", "select count(*)::int n from public.inventory_items")).rows[0].n, 0, "un membro semplice non vede il magazzino");

// --- movimenti
const mv = (user, id, type, q, person = "Anna Bianchi", reason = "Test", date = null, to = null) =>
  as(user, "select public.inventory_record_movement($1,'',$2,$3,$4,$5,$6,$7,'')", [id, type, q, person, reason, date, to]);
await fails("lead", "select public.inventory_record_movement($1,'','entrata',1,'Anna','x',null,null,'')", [i1], "FORBIDDEN");
await fails("lead", "select public.inventory_record_movement($1,'','spostamento',0,'Anna','x',null,$2,'')", [i1, locC], "FORBIDDEN");
await fails("out", "select public.inventory_record_movement($1,'','uscita',1,'Anna','x',null,null,'')", [i1], "FORBIDDEN");
await mv("lead", i1, "uscita", 2);
await mv("lead", i1, "prestito", 3);
let row = (await db.query("select quantity,on_loan from public.inventory_items where id=$1", [i1])).rows[0];
assert.deepEqual([row.quantity, row.on_loan], [5, 3]);
await fails("lead", "select public.inventory_record_movement($1,'','rientro',4,'Anna','x',null,null,'')", [i1], "RETURN_EXCEEDS_LOAN");
await mv("lead", i1, "rientro", 3);
await mv("logi", i1, "entrata", 5, "Anna", "Arrivo ordine ACQ-001");
await mv("lead", i1, "smaltimento", 1, "Anna", "Guasto");
row = (await db.query("select quantity,on_loan from public.inventory_items where id=$1", [i1])).rows[0];
assert.deepEqual([row.quantity, row.on_loan], [12, 0], "10-2-3+3+5-1 = 12");
await fails("lead", "select public.inventory_record_movement($1,'','uscita',50,'Anna','x',null,null,'')", [i1], "INSUFFICIENT_STOCK");
await fails("lead", "select public.inventory_record_movement($1,'','uscita',1,'','x',null,null,'')", [i1], "PERSON_REQUIRED");
await fails("lead", "select public.inventory_record_movement($1,'','uscita',1,'Anna','x','2999-01-01',null,'')", [i1], "INVALID_MOVEMENT_DATE");
await fails("lead", "select public.inventory_record_movement($1,'','uscita',0,'Anna','x',null,null,'')", [i1], "INVALID_INVENTORY_MOVEMENT");
await mv("logi", i2, "spostamento", 0, "Anna", "Riordino", null, locC);
row = (await db.query("select location_id,warehouse_id,quantity from public.inventory_items where id=$1", [i2])).rows[0];
assert.deepEqual([row.location_id, row.warehouse_id, row.quantity], [locC, wh2, 5], "lo spostamento cambia posizione e magazzino, non la quantità");
await fails("logi", "select public.inventory_record_movement($1,'','spostamento',0,'Anna','x',null,$2,'')", [i2, locC], "SAME_LOCATION");
const moved = (await db.query("select from_location_code,to_location_code,event_type from public.inventory_movements where event_type='move'")).rows[0];
assert.deepEqual([moved.from_location_code, moved.to_location_code], ["A-01-B01", "C-02-R01"]);
await assert.rejects(db.query("update public.inventory_movements set reason='x'"), /APPEND_ONLY/, "il registro resta append-only");
const types = (await db.query("select distinct event_type from public.inventory_movements")).rows.map((r) => r.event_type);
for (const t of ["stock_in", "stock_out", "loan", "return", "move", "dispose"]) assert.ok(types.includes(t), `manca il movimento ${t}`);

// --- modifica articolo: SKU, posizione e giacenza non cambiano
await as("logi", "select public.inventory_update_item($1,'Mario Rossi','Motore DC 12V','Cat','','pz',3,'Resp','Rover','Forn',3.1,null,null,'','24V','In uso')", [i1]);
row = (await db.query("select name,sku,quantity,minimum_quantity,status,tech_specs,total_value from public.inventory_items where id=$1", [i1])).rows[0];
assert.deepEqual([row.name, row.sku, row.quantity, row.minimum_quantity, row.status, row.tech_specs, Number(row.total_value)], ["Motore DC 12V", "MEC-MOT-001", 12, 3, "In uso", "24V", 37.2]);
await fails("lead", "select public.inventory_update_item($1,'','x','','','pz',0,'','','',null,null,null,'','','Disponibile')", [i1], "FORBIDDEN");
await fails("logi", "select public.inventory_update_item($1,'Mario Rossi','Provette','','','pz',0,'','','',null,null,null,'','','In uso')", [i3], "INVALID_INVENTORY_DATA");

// --- acquisti
const req = async (user, mat = "Cuscinetti") => (await as(user, "select public.inventory_create_purchase_request('','"+mat+"','tecnica',20,'Alta','','Serve per il rover','Fornitore SRL',45,'') id")).rows[0].id;
const r1 = await req("lead"); const r2 = await req("lead", "Viti M8");
const codes = (await as("lead", "select code,status,requester_name from public.inventory_purchase_requests order by seq")).rows;
assert.deepEqual(codes.map((r) => [r.code, r.status]), [["ACQ-001", "Da valutare"], ["ACQ-002", "Da valutare"]], "ID automatico e stato iniziale");
assert.equal(codes[0].requester_name, "Capo Software", "il richiedente di default è l'utente");
await fails("out", "select public.inventory_create_purchase_request('','x','tecnica',1,'Alta','','','',null)", [], "FORBIDDEN");
await fails("lead", "select public.inventory_update_purchase_request($1,'Approvato',null,null,'','')", [r1], "FORBIDDEN");
const upd = (user, id, status, o = null, r = null) => as(user, "select public.inventory_update_purchase_request($1,$2,$3,$4,'','')", [id, status, o, r]);
await upd("logi", r1, "Approvato");
await fails("logi", "select public.inventory_update_purchase_request($1,'Ordinato',null,null,'','')", [r1], "ORDER_DATE_REQUIRED");
await upd("logi", r1, "Ordinato", "2026-10-01");
await upd("logi", r1, "In consegna");
await fails("logi", "select public.inventory_update_purchase_request($1,'Ricevuto',null,null,'','')", [r1], "RECEIVED_DATE_REQUIRED");
await fails("logi", "select public.inventory_update_purchase_request($1,'Approvato',null,null,'','')", [r1], "PURCHASE_STATUS_BACKWARDS");
await fails("logi", "select public.inventory_update_purchase_request($1,'Ricevuto',null,'2026-09-01','','')", [r1], "INVALID_PURCHASE_DATES");
await upd("logi", r1, "Ricevuto", null, "2026-10-10");
await fails("logi", "select public.inventory_update_purchase_request($1,'Annullato',null,null,'','')", [r1], "PURCHASE_REQUEST_CLOSED");
// chiusura ciclo: articolo creato dalla richiesta ricevuta, collegato una sola volta
await fails("logi", "select public.inventory_create_item('Mario Rossi','tecnica','Meccanica','Cuscinetti','','',20,'pz',5,$1,'','','',2.25,null,null,'','','Disponibile',$2)", [locA, r2], "PURCHASE_REQUEST_NOT_LINKABLE");
const i4 = (await item("logi", "tecnica", "Meccanica", "Cuscinetti", 20, "pz", 5, locA, "Disponibile", { req: r1 })).rows[0].id;
assert.equal((await db.query("select item_id from public.inventory_purchase_requests where id=$1", [r1])).rows[0].item_id, i4);
await fails("logi", "select public.inventory_create_item('Mario Rossi','tecnica','Meccanica','Altro','','',1,'pz',0,$1,'','','',null,null,null,'','','Disponibile',$2)", [locA, r1], "PURCHASE_REQUEST_NOT_LINKABLE");
// il richiedente può annullare solo la propria richiesta ancora "Da valutare"
await upd("lead", r2, "Annullato");
assert.equal((await db.query("select status from public.inventory_purchase_requests where id=$1", [r2])).rows[0].status, "Annullato");
const r3 = await req("tl"); await fails("lead", "select public.inventory_update_purchase_request($1,'Annullato',null,null,'','')", [r3], "FORBIDDEN");

// --- archiviazione posizioni
await fails("logi", "select public.inventory_archive_location($1,true,'')", [locA], "ARCHIVE_ACTIVE_ITEMS_FIRST");
console.log("Magazzino: tutti i controlli database superati");
await db.close();
} catch (error) {
  console.error("FAIL:", error.message ?? error);
  process.exit(1);
}
