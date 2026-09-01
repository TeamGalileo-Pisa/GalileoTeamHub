begin;

select plan(35);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('10000000-0000-0000-0000-000000000001', 'admin@test.local', '{}'::jsonb, '{"username":"test-admin","display_name":"Test Admin"}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000002', 'software@test.local', '{}'::jsonb, '{"username":"test-software","display_name":"Test Software"}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000003', 'rover@test.local', '{}'::jsonb, '{"username":"test-rover","display_name":"Test Rover"}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000004', 'logistica@test.local', '{}'::jsonb, '{"username":"test-logistica","display_name":"Test Logistica"}'::jsonb, now(), now()),
  ('10000000-0000-0000-0000-000000000005', 'business@test.local', '{}'::jsonb, '{"username":"test-business","display_name":"Test Business"}'::jsonb, now(), now());

insert into public.system_roles (user_id, role)
values ('10000000-0000-0000-0000-000000000001', 'admin');

insert into public.area_memberships (user_id, area_id, role)
select '10000000-0000-0000-0000-000000000002'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Software'
union all
select '10000000-0000-0000-0000-000000000003'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Rover'
union all
select '10000000-0000-0000-0000-000000000004'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Logistica'
union all
select '10000000-0000-0000-0000-000000000005'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Business';

insert into public.recruitment_campaigns (
  id, name, starts_on, ends_on, status, created_by
) values (
  '20000000-0000-0000-0000-000000000001',
  'Test capacità e booking',
  '2099-01-01',
  '2099-12-31',
  'active',
  '10000000-0000-0000-0000-000000000001'
);

insert into public.campaign_areas (campaign_id, area_id)
select '20000000-0000-0000-0000-000000000001', id
from public.areas
where name in ('Software', 'Rover', 'Logistica', 'Business');

insert into public.rooms (id, name, max_simultaneous_interviews_limit)
values ('30000000-0000-0000-0000-000000000003', 'F2 test', 3);

create temp table test_ids (name text primary key, id uuid not null);
create temp table test_tokens (name text primary key, token text not null);

select is(
  (select max_simultaneous_interviews_limit from public.rooms where name = 'Riunioni 5067'),
  1,
  'Riunioni 5067 has physical capacity 1'
);
select is(
  (select max_simultaneous_interviews_limit from public.rooms where name = 'A27'),
  2,
  'A27 has physical capacity 2'
);

select set_config(
  'request.jwt.claims',
  '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}',
  true
);

select throws_ok(
  $test$
    select public.create_room_availability(
      (select id from public.rooms where name = 'A27'),
      '2100-01-01 09:00+01', '2100-01-01 12:00+01', 3, ''
    )
  $test$,
  'P0001',
  'ROOM_PHYSICAL_LIMIT_EXCEEDED:2',
  'availability capacity cannot exceed the physical room limit'
);

insert into test_ids
select 'riunioni', public.create_room_availability(
  (select id from public.rooms where name = 'Riunioni 5067'),
  '2099-09-15 09:00+02', '2099-09-15 12:00+02', 1, 'Una postazione'
);
select is(
  (select max_simultaneous_interviews from public.room_availabilities where id = (select id from test_ids where name = 'riunioni')),
  1,
  'capacity 1 window is created'
);

insert into test_ids
select 'a27', public.create_room_availability(
  (select id from public.rooms where name = 'A27'),
  '2099-09-15 09:00+02', '2099-09-15 13:00+02', 2, 'Due tavoli'
);
select is(
  (select max_simultaneous_interviews from public.room_availabilities where id = (select id from test_ids where name = 'a27')),
  2,
  'capacity 2 window is created'
);

insert into test_ids
select 'f2', public.create_room_availability(
  '30000000-0000-0000-0000-000000000003',
  '2099-09-15 09:00+02', '2099-09-15 13:00+02', 3, 'Tre postazioni'
);
select is(
  (select max_simultaneous_interviews from public.room_availabilities where id = (select id from test_ids where name = 'f2')),
  3,
  'capacity greater than 2 is supported'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'riunioni'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Software'),
    '2099-09-15 09:00+02', '2099-09-15 10:00+02'
  ) $test$,
  'first interview is accepted at capacity 1'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'riunioni'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Rover'),
    '2099-09-15 09:30+02', '2099-09-15 10:30+02'
  ) $test$,
  'P0001', 'ROOM_CAPACITY_EXCEEDED',
  'overlapping interview is blocked at capacity 1'
);
select lives_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'riunioni'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Rover'),
    '2099-09-15 10:00+02', '2099-09-15 11:00+02'
  ) $test$,
  'consecutive half-open intervals are accepted'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'a27'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Software'),
    '2099-09-15 09:00+02', '2099-09-15 10:00+02'
  ) $test$,
  'A27 accepts the first interview'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'a27'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Rover'),
    '2099-09-15 09:30+02', '2099-09-15 10:30+02'
  ) $test$,
  'A27 accepts the second partially overlapping interview'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select throws_ok(
  $test$ select public.claim_room_allocation(
    (select id from test_ids where name = 'a27'),
    (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Logistica'),
    '2099-09-15 09:45+02', '2099-09-15 10:15+02'
  ) $test$,
  'P0001', 'ROOM_CAPACITY_EXCEEDED',
  'A27 blocks the third simultaneous interview'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation((select id from test_ids where name = 'f2'), (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Software'), '2099-09-15 09:00+02', '2099-09-15 11:00+02') $test$,
  'capacity 3 accepts first interview'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation((select id from test_ids where name = 'f2'), (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Rover'), '2099-09-15 09:15+02', '2099-09-15 10:45+02') $test$,
  'capacity 3 accepts second interview'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000004","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.claim_room_allocation((select id from test_ids where name = 'f2'), (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Logistica'), '2099-09-15 09:30+02', '2099-09-15 10:30+02') $test$,
  'capacity 3 accepts third interview'
);
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000005","role":"authenticated"}', true);
select throws_ok(
  $test$ select public.claim_room_allocation((select id from test_ids where name = 'f2'), (select ca.id from public.campaign_areas ca join public.areas a on a.id = ca.area_id where a.name = 'Business'), '2099-09-15 09:45+02', '2099-09-15 10:15+02') $test$,
  'P0001', 'ROOM_CAPACITY_EXCEEDED',
  'capacity 3 blocks the fourth simultaneous interview'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;
select ok(
  not exists (
    select 1
    from public.area_allocations allocation
    join public.campaign_areas ca on ca.id = allocation.campaign_area_id
    join public.areas area_record on area_record.id = ca.area_id
    where area_record.name <> 'Software'
  ),
  'Software RLS hides allocations from other areas'
);
select is(
  (select count(*)::integer from public.area_allocations),
  3,
  'Software sees only its three allocations'
);
reset role;
select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
set local role authenticated;
select is(
  (select count(*)::integer from public.area_allocations),
  7,
  'admin RLS sees every area allocation'
);
reset role;

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select throws_ok(
  $test$ select public.update_room_availability((select id from test_ids where name = 'a27'), '2099-09-15 09:00+02', '2099-09-15 13:00+02', 1, 'Ridotta') $test$,
  'P0001', 'ROOM_CAPACITY_BELOW_USAGE:2',
  'capacity cannot be lowered below existing peak usage'
);
select throws_ok(
  $test$ select public.update_room_availability((select id from test_ids where name = 'a27'), '2099-09-15 09:15+02', '2099-09-15 13:00+02', 2, 'Orario ridotto') $test$,
  'P0001', 'AVAILABILITY_TIME_EXCLUDES_ALLOCATIONS',
  'availability time cannot exclude existing allocations'
);
select lives_ok(
  $test$ select public.update_room_availability((select id from test_ids where name = 'a27'), '2099-09-15 09:00+02', '2099-09-15 13:00+02', 2, 'Nota aggiornata') $test$,
  'admin can safely update note and valid capacity'
);
select is(
  (select area_note from public.room_availabilities where id = (select id from test_ids where name = 'a27')),
  'Nota aggiornata',
  'updated area note is stored'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
insert into test_ids
select 'session', public.create_interview_session(
  (
    select allocation.id
    from public.area_allocations allocation
    join public.campaign_areas ca on ca.id = allocation.campaign_area_id
    join public.areas area_record on area_record.id = ca.area_id
    where allocation.room_availability_id = (select id from test_ids where name = 'a27')
      and area_record.name = 'Software'
  ),
  'Sessione test booking'
);
select pass('session is created from the area allocation');
select is(
  public.generate_session_slots((select id from test_ids where name = 'session'), 15),
  4,
  'session slots are generated'
);

insert into test_tokens
select 'first', public.rotate_booking_link((select id from test_ids where name = 'session'));
select matches(
  (select token from test_tokens where name = 'first'),
  '^[0-9a-f-]{36}\.[0-9a-f]{64}$',
  'booking token has UUID and 256-bit random secret'
);
select is(
  (select count(*)::integer from public.booking_links where session_id = (select id from test_ids where name = 'session') and status = 'active'),
  1,
  'one active booking link is stored'
);
select ok(
  pg_catalog.jsonb_array_length(
    public.get_public_booking_availability((select token from test_tokens where name = 'first')) -> 'slots'
  ) = 4,
  'public availability is accessible through the token'
);

insert into test_tokens
select 'second', public.rotate_booking_link((select id from test_ids where name = 'session'));
select isnt(
  (select token from test_tokens where name = 'first'),
  (select token from test_tokens where name = 'second'),
  'regeneration returns a new token'
);
select is(
  (select count(*)::integer from public.booking_links where session_id = (select id from test_ids where name = 'session') and status = 'revoked'),
  1,
  'previous booking link is revoked'
);
select throws_ok(
  $test$ select public.get_public_booking_availability((select token from test_tokens where name = 'first')) $test$,
  'P0001', 'INVALID_BOOKING_LINK',
  'revoked token cannot access public availability'
);

select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
select throws_ok(
  $test$ select public.rotate_booking_link((select id from test_ids where name = 'session')) $test$,
  'P0001', 'FORBIDDEN',
  'area lead cannot rotate a link for another area'
);

select set_config('request.jwt.claims', '{"role":"service_role"}', true);
select lives_ok(
  $test$ select public.book_public_slot(
    (select token from test_tokens where name = 'second'),
    (select id from public.slots where session_id = (select id from test_ids where name = 'session') order by starts_at limit 1),
    'Mario', 'Rossi', 'mario.rossi@example.test'
  ) $test$,
  'first public booking succeeds'
);
select throws_ok(
  $test$ select public.book_public_slot(
    (select token from test_tokens where name = 'second'),
    (select id from public.slots where session_id = (select id from test_ids where name = 'session') order by starts_at limit 1),
    'Luigi', 'Bianchi', 'luigi.bianchi@example.test'
  ) $test$,
  'P0001', 'SLOT_UNAVAILABLE',
  'double booking of the same slot is rejected'
);
select is(
  (select count(*)::integer from public.email_deliveries),
  1,
  'one idempotent confirmation delivery is queued'
);

select * from finish();
rollback;
