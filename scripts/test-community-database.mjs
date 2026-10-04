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
create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
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
await db.exec(`
create table public.merch_products(
  id uuid primary key default gen_random_uuid(),name text not null,description text not null default '',
  image_url text,price_cents integer not null,active boolean not null default true,
  sort_order integer not null default 0,created_by uuid,created_at timestamptz not null default now()
);
create table public.merch_variants(
  id uuid primary key default gen_random_uuid(),product_id uuid not null references public.merch_products(id),
  label text not null default 'Unica',stock integer,active boolean not null default true
);
create table public.merch_orders(
  id uuid primary key default gen_random_uuid(),buyer_user_id uuid not null references public.profiles(id),
  status text not null default 'pending',total_cents integer not null,expires_at timestamptz not null default now()+interval '20 minutes'
);
create table public.merch_order_items(
  id uuid primary key default gen_random_uuid(),order_id uuid not null references public.merch_orders(id),
  product_id uuid references public.merch_products(id),variant_id uuid references public.merch_variants(id),
  product_name text not null,variant_label text not null,unit_price_cents integer not null,
  quantity integer not null,line_total_cents integer not null
);
create table public.member_adhesions(
  id uuid primary key default gen_random_uuid(),area_id uuid not null references public.areas(id),
  submitted_by uuid not null references public.profiles(id),email text not null,first_name text not null,
  last_name text not null,student_number text not null,degree text not null,department text not null,
  created_at timestamptz not null default now()
);
create or replace function private.can_manage_merchandising()
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_admin() or exists(
  select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
  where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null and a.slug='logistica' and a.active
) $$;
alter table public.merch_products enable row level security;
alter table public.merch_variants enable row level security;
grant select on public.merch_products,public.merch_variants to authenticated;
create policy merch_products_visible on public.merch_products for select to authenticated
  using(active or private.can_manage_merchandising());
create policy merch_variants_visible on public.merch_variants for select to authenticated
  using(active or private.can_manage_merchandising());
`);
await db.exec(await readFile(
  "supabase/migrations/20261004075202_merch_product_visibility_and_order_notifications.sql",
  "utf8",
));
await db.exec(await readFile(
  "supabase/migrations/20261004101000_merch_hide_inactive_products_for_buyers.sql",
  "utf8",
));
await db.exec(await readFile(
  "supabase/migrations/20261004113000_membership_questionnaire_drafts_and_export.sql",
  "utf8",
));
await db.exec(await readFile(
  "supabase/migrations/20261004123000_membership_adhesion_indexes.sql",
  "utf8",
));
await db.exec(await readFile(
  "supabase/migrations/20261004130000_member_adhesion_service_policy.sql",
  "utf8",
));
await db.exec(await readFile(
  "supabase/migrations/20261004150000_shared_public_membership_link.sql",
  "utf8",
));
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
const validAnswers = {
  firstName: "Example", lastName: "Member", degree: "Ingegneria",
  department: "Dipartimento di Ingegneria", studentNumber: "123456",
  area: "Mobility Division", commitmentsAccepted: "yes",
  internalRegulationAccepted: "yes", ipAccepted: "yes",
  selfCertificationAccepted: "yes", gdprAccepted: "yes",
  institutionalEmail: "example@studenti.unipi.it", phone: "+393331234567",
  linkedin: "", privacyAccepted: "yes",
};
await db.query(`select save_membership_draft('test',$1::jsonb)`, [JSON.stringify({ firstName: "Example" })]);
assert.equal(await scalar("select status from member_adhesions where invitation_id=(select id from membership_invitations where email='sample@example.test')"), "draft");
await db.query(`select submit_membership('test',$1::jsonb)`, [JSON.stringify(validAnswers)]);
await assert.rejects(
  db.query(`select submit_membership('test',$1::jsonb)`, [JSON.stringify(validAnswers)]),
  /ALREADY_SUBMITTED/,
);
assert.equal(await scalar("select answers->>'area' from member_adhesions where invitation_id=(select id from membership_invitations where email='sample@example.test')"), "Mobility Division");
const sharedToken = await scalar(
  "select get_or_create_membership_form_link($1)",
  [a],
);
assert.match(sharedToken, /^[a-f0-9]{64}$/);
assert.equal(await scalar("select get_or_create_membership_form_link($1)", [a]), sharedToken);
const sharedDraftId = "99999999-9999-4999-8999-999999999999";
await db.query(
  "select save_membership_shared_draft($1,$2,$3::jsonb)",
  [sharedToken, sharedDraftId, JSON.stringify({ firstName: "Public draft" })],
);
const sharedDraft = await scalar(
  "select get_membership_shared_draft($1,$2)",
  [sharedToken, sharedDraftId],
);
assert.equal(sharedDraft.shared, true);
assert.equal(sharedDraft.answers.firstName, "Public draft");
const sharedAnswers = {
  ...validAnswers,
  firstName: "Shared",
  institutionalEmail: "shared@studenti.unipi.it",
};
await db.query(
  "select submit_membership_shared_form($1,$2,$3::jsonb)",
  [sharedToken, sharedDraftId, JSON.stringify(sharedAnswers)],
);
assert.equal(
  await scalar("select status from membership_form_responses where draft_id=$1", [sharedDraftId]),
  "submitted",
);
assert.equal(
  await scalar("select count(*)::int from community_outbox where kind='membership'"),
  2,
);
await assert.rejects(
  db.query(
    "select submit_membership_shared_form($1,$2,$3::jsonb)",
    [sharedToken, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", JSON.stringify(sharedAnswers)],
  ),
  /DUPLICATE_MEMBERSHIP|unique/,
);
assert.equal(
  await scalar("select get_membership_shared_draft($1,$2) is null", [
    "f".repeat(64),
    sharedDraftId,
  ]),
  true,
);
assert.equal(
  await scalar(
    `select count(*)::int from community_outbox where kind='membership'`,
  ),
  2,
);
const claimed = await db.query("select * from claim_community_mail()");
assert.equal(claimed.rows.length, 3);
assert.equal(
  (await db.query("select * from claim_community_mail()")).rows.length,
  0,
);
await db.query(
  `insert into profiles(id,username,display_name) values($1,'member-drafter','Member Drafter') on conflict(id) do update set status='active',must_change_password=false`,
  [c],
);
await db.query(`insert into area_shared_accounts(area_id,user_id) values($1,$2)`, [area, c]);
const draftId = "88888888-8888-4888-8888-888888888888";
await db.query(
  `select save_member_adhesion_draft($1,$2,'{"firstName":"Saved progressively"}'::jsonb)`,
  [c, draftId],
);
const draft = await scalar(`select get_member_adhesion_draft($1,$2)`, [c, draftId]);
assert.equal(draft.answers.firstName, "Saved progressively");
const nonLeadershipAnswers = { ...validAnswers, leadershipRole: "Team Leader" };
await db.query(
  `select submit_member_adhesion($1,$2,$3::jsonb)`,
  [c, draftId, JSON.stringify(nonLeadershipAnswers)],
);
assert.equal(await scalar("select answers ? 'leadershipRole' from member_adhesions where draft_id=$1", [draftId]), false);
await assert.rejects(
  db.query(`select save_member_adhesion_draft($1,$2,'{}'::jsonb)`, [c, draftId]),
  /ALREADY_SUBMITTED/,
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
const leaderId = "44444444-4444-4444-8444-444444444444";
const logisticsId = "55555555-5555-4555-8555-555555555555";
const areaLeadId = "66666666-6666-4666-8666-666666666666";
const memberId = "77777777-7777-4777-8777-777777777777";
await db.query(
  `insert into profiles(id,username,display_name) values
   ($1,'merch-leader','Merch Leader'),($2,'merch-logistics','Merch Logistics'),
   ($3,'merch-area-lead','Merch Area Lead'),($4,'merch-member','Merch Member')`,
  [leaderId, logisticsId, areaLeadId, memberId],
);
await db.query("insert into system_roles(user_id,role) values($1,'team_leader')", [leaderId]);
await db.query(
  `insert into areas(name,slug) values('Logistica','logistica')
   on conflict(slug) do update set active=true`,
);
const logisticsAreaId = await scalar("select id from areas where slug='logistica'");
await db.query(
  `insert into area_memberships(user_id,area_id,role)
   values($1,$3,'area_lead'),($2,$4,'area_lead')`,
  [logisticsId, areaLeadId, logisticsAreaId, area],
);
await db.query(
  `insert into merch_products(id,name,price_cents,visibility) values
   ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Solo leader',1000,'team_leader'),
   ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Staff',2000,'team_leader_and_area_leads'),
   ('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Tutti',3000,'everyone')`,
);
await db.query(
  `insert into merch_products(id,name,price_cents,visibility,active) values
   ('dddddddd-dddd-4ddd-8ddd-dddddddddddd','Ritirato',4000,'everyone',false)`,
);
await db.query(
  `insert into merch_variants(id,product_id,label,stock) values
   ('aaaaaaaa-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Unica',5),
   ('bbbbbbbb-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Unica',5),
   ('cccccccc-0000-4000-8000-000000000003','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Unica',5)`,
);
const visibleAs = async (userId) => {
  await db.query("select set_config('test.uid',$1,false)", [userId]);
  return (await db.query("select name from merch_products order by name")).rows.map((row) => row.name);
};
await db.exec("set role authenticated");
assert.deepEqual(await visibleAs(leaderId), ["Ritirato", "Solo leader", "Staff", "Tutti"]);
assert.deepEqual(await visibleAs(areaLeadId), ["Staff", "Tutti"]);
assert.deepEqual(await visibleAs(memberId), ["Tutti"]);
await db.exec("reset role");
assert.equal(await scalar("select private.can_view_merch_product('team_leader',$1)", [logisticsId]), false);
assert.equal(await scalar("select private.can_view_merch_product('team_leader_and_area_leads',$1)", [areaLeadId]), true);
await assert.rejects(
  db.query(
    `select * from create_merch_order($1,jsonb_build_array(jsonb_build_object('variantId',$2::uuid,'quantity',1)))`,
    [memberId, "aaaaaaaa-0000-4000-8000-000000000001"],
  ),
  /UNAVAILABLE/,
  "a hidden product must not be orderable through the service-only RPC",
);
const order = await db.query(
  `select * from create_merch_order($1,jsonb_build_array(jsonb_build_object('variantId',$2::uuid,'quantity',1)))`,
  [areaLeadId, "bbbbbbbb-0000-4000-8000-000000000002"],
);
assert.equal(order.rows[0].total_cents, 2000);
await db.query(
  `insert into push_devices(user_id,platform,address) values
   ($1,'web','https://fcm.googleapis.com/merch-leader'),
   ($2,'web','https://fcm.googleapis.com/merch-logistics'),
   ($3,'web','https://fcm.googleapis.com/merch-area-lead')`,
  [leaderId, logisticsId, areaLeadId],
);
const newOrderId = order.rows[0].order_id;
assert.equal(await scalar("select count(*)::int from notifications where type='merch.order_paid'"), 0);
await db.query("update merch_orders set status='paid' where id=$1", [newOrderId]);
assert.equal(await scalar("select count(*)::int from notifications where type='merch.order_paid'"), 2);
assert.equal(await scalar("select count(*)::int from push_jobs j join notifications n on n.id=j.notification_id where n.type='merch.order_paid'"), 2);
assert.equal(await scalar("select count(*)::int from notifications where type='merch.order_paid' and data->>'route'='/merchandising'"), 2);
await db.query("update merch_orders set status='paid' where id=$1", [newOrderId]);
assert.equal(await scalar("select count(*)::int from notifications where type='merch.order_paid'"), 2);
console.log(
  "PASS: roles, account guards, mail and membership queues, push jobs, merch visibility, protected checkout and paid-order notifications.",
);
await db.close();

