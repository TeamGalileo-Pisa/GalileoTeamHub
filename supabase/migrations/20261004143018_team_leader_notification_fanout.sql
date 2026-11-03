begin;

-- Track one Team Leader copy per logical notification event. A single event
-- can create an original notification for several recipients; the receipt
-- table avoids forwarding that same event repeatedly.
create table if not exists private.team_leader_notification_receipts (
  event_hash text not null,
  team_leader_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.now(),
  primary key (event_hash, team_leader_user_id)
);
alter table private.team_leader_notification_receipts enable row level security;
revoke all on private.team_leader_notification_receipts from public, anon, authenticated;

create or replace function private.claim_team_leader_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  if pg_catalog.current_setting('app.team_leader_notification_fanout', true) = 'true' then
    return new;
  end if;

  if exists (
    select 1 from public.system_roles r
    join public.profiles p on p.id = r.user_id
    where r.user_id = new.recipient_user_id and r.role = 'team_leader'
      and p.status = 'active'
  ) then
    v_hash := pg_catalog.md5(pg_catalog.concat_ws(pg_catalog.chr(31), new.type, new.title,
      new.body, new.data::text, new.created_at::text));
    insert into private.team_leader_notification_receipts(event_hash, team_leader_user_id)
    values(v_hash, new.recipient_user_id)
    on conflict do nothing;
    if not found then
      return null;
    end if;
  end if;

  return new;
end;
$$;

create or replace function private.forward_notification_to_team_leader()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_prior_setting text := pg_catalog.current_setting('app.team_leader_notification_fanout', true);
begin
  if v_prior_setting = 'true' then return new; end if;

  v_hash := pg_catalog.md5(pg_catalog.concat_ws(pg_catalog.chr(31), new.type, new.title,
    new.body, new.data::text, new.created_at::text));
  perform pg_catalog.set_config('app.team_leader_notification_fanout', 'true', true);

  with claimed as (
    insert into private.team_leader_notification_receipts(event_hash, team_leader_user_id)
    select v_hash, r.user_id
    from public.system_roles r
    join public.profiles p on p.id = r.user_id
    where r.role = 'team_leader' and p.status = 'active'
    on conflict do nothing
    returning team_leader_user_id
  )
  insert into public.notifications(recipient_user_id, type, title, body, data)
  select c.team_leader_user_id, new.type, new.title, new.body, new.data
  from claimed c
  where c.team_leader_user_id <> new.recipient_user_id;

  perform pg_catalog.set_config('app.team_leader_notification_fanout', coalesce(v_prior_setting, ''), true);
  return new;
end;
$$;

revoke all on function private.claim_team_leader_notification(),
  private.forward_notification_to_team_leader() from public, anon, authenticated;

drop trigger if exists notifications_claim_team_leader_copy on public.notifications;
create trigger notifications_claim_team_leader_copy
before insert on public.notifications
for each row execute function private.claim_team_leader_notification();

drop trigger if exists notifications_forward_to_team_leader on public.notifications;
create trigger notifications_forward_to_team_leader
after insert on public.notifications
for each row execute function private.forward_notification_to_team_leader();

commit;
