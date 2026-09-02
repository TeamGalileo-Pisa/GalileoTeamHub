begin;

select plan(14);

insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('11000000-0000-0000-0000-000000000001', 'admin-board@test.local', '{}'::jsonb, '{"username":"board-admin","display_name":"Board Admin"}'::jsonb, now(), now()),
  ('11000000-0000-0000-0000-000000000002', 'software-board@test.local', '{}'::jsonb, '{"username":"board-software","display_name":"Board Software"}'::jsonb, now(), now()),
  ('11000000-0000-0000-0000-000000000003', 'rover-board@test.local', '{}'::jsonb, '{"username":"board-rover","display_name":"Board Rover"}'::jsonb, now(), now());

update public.profiles set must_change_password=false;

insert into public.system_roles (user_id, role)
values ('11000000-0000-0000-0000-000000000001', 'admin');

insert into public.area_memberships (user_id, area_id, role)
select '11000000-0000-0000-0000-000000000002'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Software'
union all
select '11000000-0000-0000-0000-000000000003'::uuid, id, 'area_lead'::public.area_membership_role
from public.areas where name = 'Rover';

create temp table board_ids (name text primary key, id uuid not null);
grant select on board_ids to authenticated;

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);

insert into board_ids
select 'global', public.create_announcement(
  'Globale', 'Messaggio per tutte le aree', true, array[]::uuid[],
  now() - interval '1 minute', null, false, false
);
select pass('admin creates a global announcement');

insert into board_ids
select 'software', public.create_announcement(
  'Solo Software', 'Messaggio riservato a Software', false,
  array[(select id from public.areas where name = 'Software')],
  now() - interval '1 minute', null, true, true
);
select pass('admin creates a Software announcement');

insert into board_ids
select 'rover', public.create_announcement(
  'Solo Rover', 'Messaggio riservato a Rover', false,
  array[(select id from public.areas where name = 'Rover')],
  now() - interval '1 minute', null, false, false
);
select pass('admin creates a Rover announcement');

select is(
  (select count(*)::integer from public.list_announcements()),
  3,
  'admin lists every announcement'
);

select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000002","role":"authenticated"}', true);
set local role authenticated;

select results_eq(
  $test$ select title from public.announcements order by title $test$,
  $test$ values ('Globale'::text), ('Solo Software'::text) $test$,
  'Software RLS exposes only global and Software announcements'
);
select is(
  (select count(*)::integer from public.announcement_targets),
  1,
  'Software cannot inspect target rows belonging to Rover'
);
select throws_ok(
  $test$
    insert into public.announcement_reads (announcement_id, area_id, read_by)
    values (
      (select id from board_ids where name = 'rover'),
      (select id from public.areas where name = 'Rover'),
      '11000000-0000-0000-0000-000000000002'
    )
  $test$,
  '42501',
  'new row violates row-level security policy for table "announcement_reads"',
  'Software cannot write Rover read state'
);
select is(
  (select count(*)::integer from public.list_announcements()),
  2,
  'Software RPC also filters announcements'
);
select is(public.get_unread_announcement_count(), 2, 'Software starts with two unread messages');
select lives_ok(
  $test$ select public.mark_announcement_read((select id from board_ids where name = 'global'), true) $test$,
  'Software can mark a visible announcement as read'
);
select is(public.get_unread_announcement_count(), 1, 'unread count decreases after reading');

reset role;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000003","role":"authenticated"}', true);
set local role authenticated;
select results_eq(
  $test$ select title from public.list_announcements() order by title $test$,
  $test$ values ('Globale'::text), ('Solo Rover'::text) $test$,
  'Rover sees global and Rover announcements only'
);

reset role;
select set_config('request.jwt.claims', '{"sub":"11000000-0000-0000-0000-000000000001","role":"authenticated"}', true);
select lives_ok(
  $test$ select public.update_announcement(
    (select id from board_ids where name = 'software'),
    'Solo Software aggiornato', 'Testo aggiornato', false,
    array[(select id from public.areas where name = 'Software')],
    now() - interval '1 minute', null, true, false
  ) $test$,
  'admin updates an announcement'
);
select lives_ok(
  $test$ select public.delete_announcement((select id from board_ids where name = 'rover')) $test$,
  'admin deletes an announcement'
);

select * from finish();
rollback;
