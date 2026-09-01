begin;

select plan(14);

select has_table('public', 'room_availabilities', 'room_availabilities exists');
select has_table('public', 'area_allocations', 'area_allocations exists');
select has_table('public', 'booking_links', 'booking_links exists');
select has_table('public', 'bookings', 'bookings exists');
select has_table('public', 'audit_logs', 'audit_logs exists');

select has_index(
  'public', 'bookings', 'bookings_one_confirmed_per_slot',
  'one confirmed booking per slot is enforced'
);
select has_index(
  'public', 'booking_links', 'booking_links_one_active_per_session',
  'one active link per session is enforced'
);

select has_function(
  'public', 'book_public_slot',
  array['text', 'uuid', 'text', 'text', 'text'],
  'atomic public booking function exists'
);
select has_function(
  'public', 'claim_room_allocation',
  array['uuid', 'uuid', 'timestamptz', 'timestamptz'],
  'allocation function exists'
);
select has_function(
  'private', 'is_admin', array[]::text[],
  'private admin helper exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.bookings'::regclass),
  'RLS enabled on bookings'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.candidates'::regclass),
  'RLS enabled on candidates'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.area_allocations'::regclass),
  'RLS enabled on area allocations'
);
select ok(
  to_regclass('public.users') is null,
  'no public password table exists'
);

select * from finish();
rollback;

