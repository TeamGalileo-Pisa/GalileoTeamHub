begin;

select plan(28);

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

select has_table('public', 'announcements', 'announcements exists');
select has_table('public', 'announcement_targets', 'announcement targets exists');
select has_table('public', 'announcement_reads', 'announcement reads exists');

select has_column(
  'public', 'rooms', 'max_simultaneous_interviews_limit',
  'rooms have an optional physical capacity limit'
);
select has_column(
  'public', 'room_availabilities', 'max_simultaneous_interviews',
  'availability windows have an operational capacity'
);
select has_column(
  'public', 'room_availabilities', 'area_note',
  'availability windows have an area note'
);

select has_function(
  'public', 'create_room_availability',
  array['uuid', 'timestamptz', 'timestamptz', 'integer', 'text'],
  'capacity-aware availability creation exists'
);
select has_function(
  'public', 'update_room_availability',
  array['uuid', 'timestamptz', 'timestamptz', 'integer', 'text'],
  'safe availability update exists'
);
select has_function(
  'public', 'list_announcements', array[]::text[],
  'announcement listing exists'
);
select has_function(
  'public', 'create_announcement',
  array['text', 'text', 'boolean', 'uuid[]', 'timestamptz', 'timestamptz', 'boolean', 'boolean'],
  'announcement creation exists'
);
select has_function(
  'public', 'get_unread_announcement_count', array[]::text[],
  'unread announcement count exists'
);

select ok(
  (select relrowsecurity from pg_class where oid = 'public.announcements'::regclass),
  'RLS enabled on announcements'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.announcement_targets'::regclass),
  'RLS enabled on announcement targets'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.announcement_reads'::regclass),
  'RLS enabled on announcement reads'
);

select * from finish();
rollback;

