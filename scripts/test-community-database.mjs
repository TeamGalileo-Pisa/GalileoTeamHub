// Runs the changed SQL against PostgreSQL (PGlite). The fixture models existing
// tables; provider extensions/auth API still require staging integration tests.
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const db = new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role;
create schema auth;create schema private;create schema extensions;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1),'hex')$$;
create type public.app_role as enum('admin','team_leader','area_lead','member');
create type public.profile_status as enum('active','disabled');
create table public.profiles(id uuid primary key,username text,display_name text,status public.profile_status default 'active',must_change_password boolean default false);
create table public.system_roles(user_id uuid references public.profiles on delete cascade,role public.app_role,granted_by uuid,primary key(user_id,role));
create table public.areas(id uuid primary key default gen_random_uuid(),name text,slug text unique,active boolean default true);
create table public.area_memberships(id uuid default gen_random_uuid(),user_id uuid references public.profiles,area_id uuid references public.areas,role text default 'area_lead',created_by uuid,started_at timestamptz default now(),ended_at timestamptz);
create table private.staff_operations(user_id uuid references public.profiles on delete cascade);
create table public.audit_logs(actor_user_id uuid,actor_type text,action text,entity_type text,entity_id uuid,before_value jsonb,after_value jsonb);
create table public.email_deliveries(id uuid primary key,booking_id uuid,kind text default 'booking_confirmation',status text default 'pending',attempt_count int default 0,last_error text,send_uncertain boolean default false,next_attempt_at timestamptz default now(),updated_at timestamptz default now(),payload jsonb,metadata jsonb default '{}');
create function private.booking_email_payload(uuid) returns jsonb language sql as $$select '{}'::jsonb$$;
create function private.staff_ready() returns boolean language sql as $$select exists(select 1 from public.profiles where id=auth.uid() and status='active' and not must_change_password)$$;
create table public.announcements(id uuid primary key,title text,body text,all_areas boolean,published_at timestamptz default now(),expires_at timestamptz);
create table public.announcement_targets(announcement_id uuid references public.announcements,area_id uuid references public.areas);
create function public.list_room_availabilities() returns integer language sql as $$select 42$$;
create table public.notifications(id uuid primary key default gen_random_uuid(),recipient_user_id uuid references public.profiles on delete cascade,type text,title text,body text,data jsonb);
`);
const original = await readFile(
  "supabase/migrations/20260902100000_staff_and_admin_management.sql",
  "utf8",
);
await db.exec(
  original.slice(
    original.indexOf("create function private.has_references"),
    original.indexOf("revoke all on function private.has_references"),
  ),
);
const guards = await readFile(
  "supabase/migrations/20261003183000_fix_staff_operations.sql",
  "utf8",
);
await db.exec(guards);
for (
  const file of [
    "20261003200000_repair_staff_and_email.sql",
    "20261003210000_community_forms.sql",
    "20261003220000_push_devices.sql",
    "20261003230000_member_account_management.sql",
    "20261003240000_delivery_visibility.sql",
  ]
) await db.exec(await readFile("supabase/migrations/" + file, "utf8"));
await db.exec(
  `create trigger protect_profiles before update or delete on profiles for each row execute function private.protect_last_admin();create trigger protect_roles before update or delete on system_roles for each row execute function private.protect_last_admin();`,
);
const scalar = async (sql, params = []) =>
  Object.values((await db.query(sql, params)).rows[0])[0];
const a = "11111111-1111-4111-8111-111111111111",
  b = "22222222-2222-4222-8222-222222222222",
  c = "33333333-3333-4333-8333-333333333333";
await db.query(
  `insert into profiles(id,username,display_name) values($1,'leader','Leader'),($2,'admin','Admin'),($3,'member','Member')`,
  [a, b, c],
);
await db.query(
  `insert into system_roles(user_id,role) values($1,'team_leader'),($2,'admin')`,
  [a, b],
);
await db.query(`select set_config('test.uid',$1,false)`, [a]);
assert.equal(await scalar("select private.is_admin()"), true);
const area = await scalar(`select id from areas where slug='agraria'`);
await db.query(
  `select update_staff_profile_v2($1,$2,'changed','Changed','area_lead',$3,'active')`,
  [a, b, area],
);
assert.equal(
  await scalar("select count(*)::int from system_roles where user_id=$1", [b]),
  0,
  "demotion must remove global role",
);
await assert.rejects(
  db.query(
    `select update_staff_profile_v2($1,$1,'leader','Leader','area_lead',$2,'active')`,
    [a, area],
  ),
  /LAST_ACTIVE_ADMIN/,
);
await db.query(
  `select update_staff_profile_v2($1,$2,'changed','Changed','area_lead',$3,'disabled')`,
  [a, b, area],
);
assert.equal(
  await scalar("select status from profiles where id=$1", [b]),
  "disabled",
);
await db.exec(
  `create trigger guard_profile before delete on profiles for each row execute function private.guard_profile_deletion();`,
);
await db.query(`select prepare_staff_deletion($1)`, [c]);
await db.query(`delete from profiles where id=$1`, [c]);
await assert.rejects(
  db.query(`select prepare_staff_deletion($1)`, [b]),
  /HAS_HISTORY/,
);
await db.query(
  `insert into email_deliveries(id,payload,metadata) values($1,'{"to_email":"sample@example.test"}','{"manage_url":"https://example.test/manage/test"}')`,
  [c],
);
let mail = await scalar("select claim_email_delivery($1)", [c]);
assert.equal(mail.attempt_count, 1);
assert.equal(mail.manage_url, "https://example.test/manage/test");
assert.equal(mail.reconcile_only, false);
await db.query(
  `update email_deliveries set updated_at=now()-interval '4 minutes' where id=$1`,
  [c],
);
mail = await scalar("select claim_email_delivery($1)", [c]);
assert.equal(mail.attempt_count, 2);
assert.equal(mail.reconcile_only, true);
assert.equal(await scalar("select claim_email_delivery($1)", [c]), null);
await assert.rejects(
  db.query(`select submit_application($1,'sample@example.test','A','B','{}')`, [
    area,
  ]),
  /APPLICATION_CLOSED/,
);
await db.exec("update application_settings set is_open=true");
await assert.rejects(
  db.query(`select submit_application($1,'sample@example.test','A','B','{}')`, [
    area,
  ]),
  /APPLICATION_CLOSED/,
);
await db.query("update application_areas set is_open=true where area_id=$1", [
  area,
]);
await db.query(
  `select submit_application($1,'sample@example.test','A','B','{}')`,
  [area],
);
await assert.rejects(
  db.query(`select submit_application($1,'sample@example.test','A','B','{}')`, [
    area,
  ]),
  /unique/,
);
assert.equal(
  await scalar(
    `select has_function_privilege('anon','public.submit_application(uuid,text,text,text,jsonb)','execute')`,
  ),
  false,
);
assert.equal(
  await scalar(
    `select has_function_privilege('authenticated','public.claim_community_mail()','execute')`,
  ),
  false,
);
await db.query(
  `insert into membership_invitations(token_hash,email,area_id,created_by) values(extensions.digest('test','sha256'),'sample@example.test',$1,$2)`,
  [area, a],
);
await db.query(`select submit_membership('test','{"firstName":"Example"}')`);
await assert.rejects(
  db.query(`select submit_membership('test','{}')`),
  /ALREADY_SUBMITTED/,
);
assert.equal(
  await scalar(
    `select count(*)::int from community_outbox where kind='membership'`,
  ),
  1,
);
const claimed = await db.query("select * from claim_community_mail()");
assert.equal(claimed.rows.length, 2);
assert.equal(
  (await db.query("select * from claim_community_mail()")).rows.length,
  0,
);
await db.query(
  `insert into push_devices(user_id,platform,address) values($1,'web','https://fcm.googleapis.com/test')`,
  [a],
);
await db.query(
  `insert into notifications(recipient_user_id,type,title) values($1,'test','Test')`,
  [a],
);
assert.equal(
  (await db.query("select * from claim_push_jobs()")).rows.length,
  1,
);
assert.equal(
  (await db.query("select * from claim_push_jobs()")).rows.length,
  0,
);
assert.equal(
  await scalar("select list_room_availabilities()"),
  42,
  "keep existing production availability RPC",
);
assert.equal(
  await scalar(
    `select has_column_privilege('authenticated','public.community_outbox','payload','select')`,
  ),
  false,
);
await db.query(
  `select update_staff_profile_v2($1,$1,'leader','Leader','admin',null,'active')`,
  [a],
);
assert.equal(
  await scalar("select role from system_roles where user_id=$1", [a]),
  "admin",
);
console.log(
  "PASS: roles, demotion, last-admin protection, disable, safe deletion, email fencing, closed forms, duplicate submissions, invitations, outbox and push claims.",
);
await db.close();
