import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create schema auth; create schema private;
  create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  create function private.staff_ready() returns boolean language sql as $$ select auth.uid() is not null $$;
  create function private.is_admin() returns boolean language sql as $$ select coalesce(current_setting('test.admin', true), 'false') = 'true' $$;
  create table public.profiles(id uuid primary key, display_name text, username text, status text default 'active');
  create table public.areas(id uuid primary key, name text, slug text, active boolean default true);
  create table public.area_memberships(user_id uuid, area_id uuid, role text, ended_at timestamptz);
  create table public.area_shared_accounts(area_id uuid, user_id uuid);
`);
await db.exec(await readFile("supabase/migrations/20261112210000_business_forms.sql", "utf8"));

const ids = { tl: "00000000-0000-4000-8000-000000000001", bizLead: "00000000-0000-4000-8000-000000000002", bizMember: "00000000-0000-4000-8000-000000000003", geoLead: "00000000-0000-4000-8000-000000000004", roverLead: "00000000-0000-4000-8000-000000000005", other: "00000000-0000-4000-8000-000000000006" };
const area = { biz: "10000000-0000-4000-8000-000000000001", geo: "10000000-0000-4000-8000-000000000002", rover: "10000000-0000-4000-8000-000000000003" };
for (const [k, v] of Object.entries(ids)) await db.query("insert into profiles(id,display_name,username) values($1,$2,$2)", [v, k]);
await db.query("insert into areas(id,name,slug) values($1,'Business','business'),($2,'Geologia','geologia'),($3,'Rover','rover')", [area.biz, area.geo, area.rover]);
await db.query("insert into area_memberships(user_id,area_id,role) values($1,$2,'area_lead'),($3,$4,'area_lead'),($5,$6,'area_lead')", [ids.bizLead, area.biz, ids.geoLead, area.geo, ids.roverLead, area.rover]);
await db.query("insert into area_shared_accounts(area_id,user_id) values($1,$2)", [area.biz, ids.bizMember]);

const as = async (who, admin = false) => db.query("select set_config('test.uid',$1,false), set_config('test.admin',$2,false)", [ids[who] ?? "", String(admin)]);
const scalar = async (sql, params) => Object.values((await db.query(sql, params)).rows[0])[0];

// Permessi.
await as("tl", true); assert.equal(await scalar("select private.can_manage_business_forms()"), true);
await as("bizLead"); assert.equal(await scalar("select private.can_manage_business_forms()"), true);
await as("bizMember"); assert.equal(await scalar("select private.can_manage_business_forms()"), true);
await as("geoLead"); assert.equal(await scalar("select private.can_manage_business_forms()"), false);
await as("other"); assert.equal(await scalar("select private.can_answer_business_forms()"), false);
assert.equal(await scalar("select private.can_manage_business_forms()"), false);
await as("geoLead"); assert.equal(await scalar("select private.can_answer_business_forms()"), true);
await as("bizMember"); assert.equal(await scalar("select private.can_answer_business_forms()"), false, "i membri non sono Capi Area");

// Il Business crea form e domande.
await as("bizLead");
const form = (await db.query("insert into business_forms(title,description,is_open,created_by) values('Check-in mensile','Rispondi entro venerdì',true,$1) returning id, share_token", [ids.bizLead])).rows[0];
assert.ok(form.share_token.length >= 32);
const q = async (label, kind, options = [], required = false, position = 0) =>
  (await db.query("insert into business_form_questions(form_id,label,kind,options,required,position) values($1,$2,$3,$4::jsonb,$5,$6) returning id", [form.id, label, kind, JSON.stringify(options), required, position])).rows[0].id;
const qText = await q("Come va l'area?", "long_text", [], true, 0);
const qChoice = await q("Stato avanzamento", "single_choice", ["In linea", "In ritardo"], true, 1);
const qMulti = await q("Servono risorse?", "multiple_choice", ["Budget", "Persone", "Materiale"], false, 2);
const qYes = await q("Hai bisogno di una riunione?", "yes_no", [], false, 3);
const qRate = await q("Morale del team", "rating", [], false, 4);
const qNum = await q("Ore lavorate", "number", [], false, 5);

// Chi compila: solo Capi Area, con il token.
await as("other");
await assert.rejects(db.query("select business_form_for_response($1)", [form.share_token]), /BUSINESS_FORM_FORBIDDEN/);
await as("geoLead");
const shown = (await db.query("select business_form_for_response($1) f", [form.share_token])).rows[0].f;
assert.equal(shown.questions.length, 6);
assert.equal(shown.can_answer, true);
await assert.rejects(db.query("select business_form_for_response('sbagliato')"), /BUSINESS_FORM_NOT_FOUND/);

const submit = (answers) => db.query("select submit_business_form($1,$2::jsonb) id", [form.share_token, JSON.stringify(answers)]);
await assert.rejects(submit({ [qChoice]: "In linea" }), /BUSINESS_FORM_REQUIRED/);
await assert.rejects(submit({ [qText]: "ok", [qChoice]: "Inventata" }), /BUSINESS_FORM_INVALID/);
await assert.rejects(submit({ [qText]: "ok", [qChoice]: "In linea", [qRate]: 9 }), /BUSINESS_FORM_INVALID/);
await submit({ [qText]: " Tutto bene ", [qChoice]: "In linea", [qMulti]: ["Budget", "Persone"], [qYes]: true, [qRate]: 4, [qNum]: 12.5, extra: "ignorato" });
await as("roverLead");
await submit({ [qText]: "Qualche ritardo", [qChoice]: "In ritardo", [qRate]: 2 });
await submit({ [qText]: "Aggiornamento", [qChoice]: "In linea" });

// I membri e chi non è Capo Area non possono rispondere.
await as("bizMember");
await assert.rejects(submit({ [qText]: "x", [qChoice]: "In linea" }), /BUSINESS_FORM_FORBIDDEN/);

// Chi gestisce vede le risposte, l'account e le risposte registrate; chi risponde no (RLS fuori da PGlite, controllo funzionale).
await as("tl", true);
const rows = (await db.query("select respondent_name, area_names, answers from business_form_responses order by created_at, id")).rows;
assert.equal(rows.length, 3);
assert.equal(rows[0].respondent_name, "geoLead");
assert.equal(rows[0].area_names, "Geologia");
assert.equal(rows[0].answers[qText], "Tutto bene");
assert.equal(rows[0].answers.extra, undefined, "chiavi sconosciute scartate");
assert.deepEqual(rows[0].answers[qMulti], ["Budget", "Persone"]);
assert.equal(rows[0].answers[qNum], 12.5);

// Domanda archiviata: le vecchie risposte restano, il form non la mostra più.
await db.query("update business_form_questions set archived_at=now() where id=$1", [qNum]);
await as("geoLead");
assert.equal((await db.query("select business_form_for_response($1) f", [form.share_token])).rows[0].f.questions.length, 5);
await as("tl", true);
assert.equal((await db.query("select answers from business_form_responses order by created_at limit 1")).rows[0].answers[qNum], 12.5);

// Chi non ha ancora risposto: Capi Area senza compilazioni (Business non ha risposto).
const pending = (await db.query("select name, area_names from business_form_pending_leads($1)", [form.id])).rows;
assert.deepEqual(pending.map((p) => p.name), ["bizLead"]);
await as("geoLead");
await assert.rejects(db.query("select * from business_form_pending_leads($1)", [form.id]), /BUSINESS_FORM_FORBIDDEN/);

// Form chiuso: non si può più rispondere.
await as("bizLead");
await db.query("update business_forms set is_open=false where id=$1", [form.id]);
await as("geoLead");
await assert.rejects(submit({ [qText]: "x", [qChoice]: "In linea" }), /BUSINESS_FORM_CLOSED/);

// Riordino.
await as("bizLead");
await db.query("select reorder_business_form_questions($1,$2::uuid[])", [form.id, [qChoice, qText]]);
const order = (await db.query("select id from business_form_questions where form_id=$1 and archived_at is null order by position, created_at", [form.id])).rows.map((r) => r.id);
assert.equal(order[0], qChoice);
assert.equal(order[1], qText);
await db.close();
console.log("Business forms SQL checks passed.");
