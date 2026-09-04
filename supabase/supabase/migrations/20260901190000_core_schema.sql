begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;
create extension if not exists citext;

create schema if not exists private;

create type public.app_role as enum ('admin');
create type public.profile_status as enum ('active', 'disabled');
create type public.area_membership_role as enum ('area_lead');
create type public.campaign_status as enum ('draft', 'active', 'archived');
create type public.availability_status as enum ('active', 'cancelled');
create type public.allocation_status as enum ('active', 'cancelled');
create type public.session_status as enum ('draft', 'published', 'closed', 'cancelled');
create type public.booking_link_status as enum ('active', 'revoked');
create type public.slot_status as enum ('available', 'disabled');
create type public.booking_status as enum ('confirmed', 'cancelled');
create type public.email_kind as enum (
  'booking_confirmation',
  'booking_reminder',
  'booking_cancelled',
  'booking_changed'
);
create type public.delivery_status as enum ('pending', 'sending', 'sent', 'failed');
create type public.audit_actor_type as enum ('staff', 'candidate', 'system');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username citext not null unique,
  display_name text not null,
  status public.profile_status not null default 'active',
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint profiles_username_length check (char_length(username::text) between 3 and 50),
  constraint profiles_display_name_length check (char_length(trim(display_name)) between 2 and 120)
);

create table public.system_roles (
  user_id uuid not null references public.profiles(id) on delete cascade,
  role public.app_role not null,
  granted_by uuid references public.profiles(id) on delete set null,
  granted_at timestamptz not null default now(),
  primary key (user_id, role)
);

create table public.areas (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique,
  slug citext not null unique,
  parent_area_id uuid references public.areas(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint areas_name_length check (char_length(trim(name::text)) between 2 and 80),
  constraint areas_slug_format check (slug::text ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  constraint areas_not_own_parent check (parent_area_id is null or parent_area_id <> id)
);

create table public.area_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  area_id uuid not null references public.areas(id) on delete restrict,
  role public.area_membership_role not null default 'area_lead',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint area_memberships_dates check (ended_at is null or ended_at > started_at)
);

create unique index area_memberships_one_active_role
  on public.area_memberships (user_id, area_id, role)
  where ended_at is null;
create index area_memberships_active_area_idx
  on public.area_memberships (area_id, user_id)
  where ended_at is null;

create table public.recruitment_campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date,
  ends_on date,
  status public.campaign_status not null default 'draft',
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recruitment_campaigns_name_length check (char_length(trim(name)) between 4 and 120),
  constraint recruitment_campaigns_dates check (
    starts_on is null or ends_on is null or ends_on >= starts_on
  )
);

create table public.campaign_areas (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.recruitment_campaigns(id) on delete restrict,
  area_id uuid not null references public.areas(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, area_id)
);
create index campaign_areas_area_idx on public.campaign_areas (area_id, campaign_id);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  name citext not null unique,
  location text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint rooms_name_length check (char_length(trim(name::text)) between 2 and 100)
);

create table public.room_availabilities (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  period tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status public.availability_status not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint room_availabilities_range check (ends_at > starts_at),
  constraint room_availabilities_cancelled_fields check (
    (status = 'active' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  ),
  exclude using gist (room_id with =, period with &&)
    where (status = 'active')
);
create index room_availabilities_starts_idx
  on public.room_availabilities (starts_at)
  where status = 'active';

create table public.area_allocations (
  id uuid primary key default gen_random_uuid(),
  room_availability_id uuid not null references public.room_availabilities(id) on delete restrict,
  campaign_area_id uuid not null references public.campaign_areas(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  period tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status public.allocation_status not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint area_allocations_range check (ends_at > starts_at),
  exclude using gist (room_availability_id with =, period with &&)
    where (status = 'active')
);
create index area_allocations_campaign_area_idx
  on public.area_allocations (campaign_area_id, starts_at)
  where status = 'active';

create table public.interview_sessions (
  id uuid primary key default gen_random_uuid(),
  allocation_id uuid not null unique references public.area_allocations(id) on delete restrict,
  name text not null,
  status public.session_status not null default 'draft',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interview_sessions_name_length check (char_length(trim(name)) between 3 and 120)
);

create table public.booking_links (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete restrict,
  public_id uuid not null unique default gen_random_uuid(),
  secret_hash bytea not null,
  status public.booking_link_status not null default 'active',
  expires_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint booking_links_secret_hash_length check (octet_length(secret_hash) = 32),
  constraint booking_links_revoked_fields check (
    (status = 'active' and revoked_at is null)
    or (status = 'revoked' and revoked_at is not null)
  )
);
create unique index booking_links_one_active_per_session
  on public.booking_links (session_id)
  where status = 'active';

create table public.slots (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.interview_sessions(id) on delete restrict,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  period tstzrange generated always as (tstzrange(starts_at, ends_at, '[)')) stored,
  status public.slot_status not null default 'available',
  manually_created boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint slots_range check (ends_at > starts_at),
  exclude using gist (session_id with =, period with &&)
    where (status = 'available')
);
create index slots_session_starts_idx on public.slots (session_id, starts_at);

create table public.candidates (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.recruitment_campaigns(id) on delete restrict,
  first_name text not null,
  last_name text not null,
  email citext not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, email),
  constraint candidates_first_name_length check (char_length(trim(first_name)) between 2 and 80),
  constraint candidates_last_name_length check (char_length(trim(last_name)) between 2 and 80),
  constraint candidates_email_length check (char_length(email::text) <= 254)
);

create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.slots(id) on delete restrict,
  candidate_id uuid not null references public.candidates(id) on delete restrict,
  status public.booking_status not null default 'confirmed',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles(id) on delete restrict,
  constraint bookings_cancelled_fields check (
    (status = 'confirmed' and cancelled_at is null)
    or (status = 'cancelled' and cancelled_at is not null)
  )
);
create unique index bookings_one_confirmed_per_slot
  on public.bookings (slot_id)
  where status = 'confirmed';
create index bookings_candidate_idx on public.bookings (candidate_id, created_at);

create table public.email_deliveries (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings(id) on delete restrict,
  kind public.email_kind not null,
  status public.delivery_status not null default 'pending',
  idempotency_key text not null unique,
  attempt_count integer not null default 0,
  provider_message_id text,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint email_deliveries_attempt_count check (attempt_count >= 0)
);
create index email_deliveries_pending_idx
  on public.email_deliveries (next_attempt_at)
  where status in ('pending', 'failed');

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_user_id uuid,
  actor_type public.audit_actor_type not null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  campaign_id uuid references public.recruitment_campaigns(id) on delete restrict,
  area_id uuid references public.areas(id) on delete restrict,
  before_value jsonb,
  after_value jsonb,
  created_at timestamptz not null default now(),
  constraint audit_logs_action_length check (char_length(action) between 2 and 120),
  constraint audit_logs_entity_type_length check (char_length(entity_type) between 2 and 80)
);
create index audit_logs_created_idx on public.audit_logs (created_at desc);
create index audit_logs_area_idx on public.audit_logs (area_id, created_at desc);

create or replace function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();
create trigger areas_set_updated_at
before update on public.areas
for each row execute function private.set_updated_at();
create trigger campaigns_set_updated_at
before update on public.recruitment_campaigns
for each row execute function private.set_updated_at();
create trigger rooms_set_updated_at
before update on public.rooms
for each row execute function private.set_updated_at();
create trigger room_availabilities_set_updated_at
before update on public.room_availabilities
for each row execute function private.set_updated_at();
create trigger area_allocations_set_updated_at
before update on public.area_allocations
for each row execute function private.set_updated_at();
create trigger interview_sessions_set_updated_at
before update on public.interview_sessions
for each row execute function private.set_updated_at();
create trigger slots_set_updated_at
before update on public.slots
for each row execute function private.set_updated_at();
create trigger candidates_set_updated_at
before update on public.candidates
for each row execute function private.set_updated_at();
create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function private.set_updated_at();
create trigger email_deliveries_set_updated_at
before update on public.email_deliveries
for each row execute function private.set_updated_at();

commit;
