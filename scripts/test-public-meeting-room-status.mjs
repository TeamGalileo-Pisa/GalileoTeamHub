import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
await db.exec(`
  create role anon; create role authenticated; create role service_role;
  create table public.meeting_rooms(id uuid primary key default gen_random_uuid(), name text not null, location text not null default '', active boolean not null default true);
  create table public.meeting_room_availability(id uuid primary key default gen_random_uuid(), room_id uuid not null, day date not null, start_time time not null, end_time time not null);
  create table public.meeting_bookings(id uuid primary key default gen_random_uuid(), room_id uuid not null, day date not null, slot_start time not null, title text not null, booker_name text not null);
`);
await db.exec(await readFile("supabase/migrations/20261111180000_public_meeting_room_status.sql", "utf8"));

const day = (await db.query("select ((now() at time zone 'Europe/Rome')::date + 3)::text d")).rows[0].d;
const a = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", b = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
await db.query("insert into meeting_rooms(id,name,location) values($1,'Aula A','Piano terra'),($2,'Aula B','')", [a, b]);
await db.query("insert into meeting_room_availability(room_id,day,start_time,end_time) values($1,$2,'09:00','10:00'),($1,$2,'11:00','11:30')", [a, day]);
await db.query("insert into meeting_bookings(room_id,day,slot_start,title,booker_name) values($1,$2,'09:30','Riunione segreta','Mario Rossi')", [a, day]);

const rows = (await db.query("select * from public_meeting_room_status($1::date)", [day])).rows;
const asA = rows.filter((r) => r.room_name === "Aula A").map((r) => `${r.slot_start.slice(0, 5)}:${r.status}`);
assert.deepEqual(asA, ["09:00:free", "09:30:busy", "10:00:unavailable", "10:30:unavailable", "11:00:free"]);
const asB = rows.filter((r) => r.room_name === "Aula B");
assert.equal(asB.length, 1);
assert.equal(asB[0].status, "unavailable");
assert.equal(asB[0].slot_start, null);
// Nessun dato personale nel risultato.
assert.deepEqual(Object.keys(rows[0]).sort(), ["location", "room_name", "slot_start", "status"]);
assert.ok(!JSON.stringify(rows).includes("Rossi") && !JSON.stringify(rows).includes("segreta"));
// Fuori dall'intervallo consentito: nessun dato.
assert.equal((await db.query("select * from public_meeting_room_status(((now() at time zone 'Europe/Rome')::date - 1))")).rows.length, 0);
assert.equal((await db.query("select * from public_meeting_room_status(((now() at time zone 'Europe/Rome')::date + 90))")).rows.length, 0);
await db.close();
console.log("Public meeting room status checks passed.");
