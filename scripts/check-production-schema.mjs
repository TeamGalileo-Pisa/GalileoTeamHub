// Read-only production catalog snapshot is supplied externally; never committed.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
const schema = JSON.parse(await readFile(process.argv[2], 'utf8'));
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role;
create schema auth; create schema private; create schema extensions; create schema vault;
create table vault.decrypted_secrets(name text,decrypted_secret text);
create function vault.create_secret(text,text,text default null) returns uuid language sql as $$select gen_random_uuid()$$;
create table auth.users(id uuid primary key);
create domain extensions.citext as text;
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create function auth.role() returns text language sql as $$select 'service_role'::text$$;
create function extensions.gen_random_uuid() returns uuid language sql as $$select gen_random_uuid()$$;
create function extensions.digest(text,text) returns bytea language sql as $$select decode(md5($1),'hex')$$;
create function extensions.gen_random_bytes(integer) returns bytea language sql as $$select decode(repeat('ab',$1),'hex')$$;
set search_path=public,extensions; set check_function_bodies=false;`);
for (const kind of ['enums','tables','constraints','functions','triggers']) {
  const entries = kind === 'constraints' ? [...schema[kind]].sort((a,b)=>Number(a.includes('FOREIGN KEY'))-Number(b.includes('FOREIGN KEY'))) : schema[kind];
  for (let sql of entries) {
    if (kind === 'functions' && /LANGUAGE (c|internal)\b/.test(sql)) continue;
    sql = sql.replaceAll("period tstzrange default tstzrange(starts_at, ends_at, '[)'::text)", "period tstzrange generated always as (tstzrange(starts_at, ends_at, '[)'::text)) stored");
    try { await db.exec(sql); } catch (error) { console.error(kind, sql.slice(0,140), error.message); process.exit(1); }
  }
}
await db.exec('set check_function_bodies=true;');
for(const file of (await readdir('supabase/migrations')).filter(p=>p.startsWith('202610')).sort()) {
  try { await db.exec(await readFile('supabase/migrations/'+file,'utf8')); console.log('PASS',file); }
  catch(error) { console.error('FAILED',file,error.message); process.exit(1); }
}
await db.close();
