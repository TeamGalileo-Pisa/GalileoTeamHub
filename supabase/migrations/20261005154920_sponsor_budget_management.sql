begin;

create or replace function private.can_manage_sponsors()
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r
        where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
          and a.slug='logistica' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and a.slug='logistica' and a.active)
    );
$$;

create or replace function private.can_manage_budget()
returns boolean
language sql stable security definer set search_path=''
as $$
  select auth.uid() is not null
    and exists(select 1 from public.profiles p
      where p.id=auth.uid() and p.status='active' and not p.must_change_password)
    and (
      exists(select 1 from public.system_roles r
        where r.user_id=auth.uid() and r.role::text='team_leader')
      or exists(select 1 from public.area_memberships m join public.areas a on a.id=m.area_id
        where m.user_id=auth.uid() and m.role='area_lead' and m.ended_at is null
          and a.slug='business' and a.active)
    );
$$;

revoke all on function private.can_manage_sponsors(),private.can_manage_budget() from public,anon;
grant execute on function private.can_manage_sponsors(),private.can_manage_budget() to authenticated,service_role;

create table public.sponsors(
  id uuid primary key default gen_random_uuid(),
  organization_name text not null check(char_length(btrim(organization_name)) between 2 and 180),
  contact_name text not null default '' check(char_length(contact_name)<=160),
  email text not null default '' check(char_length(email)<=254),
  phone text not null default '' check(char_length(phone)<=60),
  status text not null default 'prospect' check(status in ('prospect','contacted','proposal','negotiation','active','closed_lost')),
  contribution_type text not null default 'cash' check(contribution_type in ('cash','in_kind','mixed')),
  pledged_cash numeric(12,2) not null default 0 check(pledged_cash between 0 and 100000000),
  received_cash numeric(12,2) not null default 0 check(received_cash between 0 and 100000000),
  in_kind_description text not null default '' check(char_length(in_kind_description)<=3000),
  estimated_in_kind_value numeric(12,2) not null default 0 check(estimated_in_kind_value between 0 and 100000000),
  owner_name text not null default '' check(char_length(owner_name)<=160),
  next_follow_up date,
  renewal_date date,
  notes text not null default '' check(char_length(notes)<=5000),
  archived_at timestamptz,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index sponsors_status_idx on public.sponsors(status,archived_at,updated_at desc);
create index sponsors_follow_up_idx on public.sponsors(next_follow_up) where archived_at is null;

create table public.sponsor_audit_log(
  id bigint generated always as identity primary key,
  sponsor_id uuid not null references public.sponsors(id) on delete restrict,
  event_type text not null check(event_type in ('created','updated')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index sponsor_audit_log_sponsor_idx on public.sponsor_audit_log(sponsor_id,id desc);

create table public.sponsor_interactions(
  id bigint generated always as identity primary key,
  sponsor_id uuid not null references public.sponsors(id) on delete restrict,
  interaction_type text not null check(interaction_type in ('call','email','meeting','other')),
  summary text not null check(char_length(btrim(summary)) between 2 and 2000),
  actor_user_id uuid not null references public.profiles(id) on delete restrict,
  actor_name text not null,
  happened_at timestamptz not null default now()
);
create index sponsor_interactions_sponsor_idx on public.sponsor_interactions(sponsor_id,happened_at desc);

create table public.budget_entries(
  id uuid primary key default gen_random_uuid(),
  title text not null check(char_length(btrim(title)) between 2 and 180),
  category text not null check(char_length(btrim(category)) between 2 and 100),
  area_id uuid references public.areas(id) on delete restrict,
  entry_type text not null default 'expense' check(entry_type in ('expense','income')),
  budgeted_amount numeric(12,2) not null default 0 check(budgeted_amount between 0 and 100000000),
  actual_amount numeric(12,2) not null default 0 check(actual_amount between 0 and 100000000),
  payment_status text not null default 'unpaid' check(payment_status in ('unpaid','partial','paid')),
  approval_status text not null default 'pending' check(approval_status in ('pending','approved','rejected')),
  due_date date,
  paid_at date,
  document_path text not null default '' check(char_length(document_path)<=500),
  notes text not null default '' check(char_length(notes)<=5000),
  created_by uuid not null references public.profiles(id) on delete restrict,
  approved_by uuid references public.profiles(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index budget_entries_status_idx on public.budget_entries(approval_status,payment_status,due_date);
create index budget_entries_area_idx on public.budget_entries(area_id,created_at desc);

create table public.budget_audit_log(
  id bigint generated always as identity primary key,
  entry_id uuid not null references public.budget_entries(id) on delete restrict,
  event_type text not null check(event_type in ('created','updated')),
  actor_user_id uuid references public.profiles(id) on delete set null,
  actor_name text not null,
  before_data jsonb,
  after_data jsonb not null,
  created_at timestamptz not null default now()
);
create index budget_audit_log_entry_idx on public.budget_audit_log(entry_id,id desc);

alter table public.sponsors enable row level security;
alter table public.sponsor_audit_log enable row level security;
alter table public.sponsor_interactions enable row level security;
alter table public.budget_entries enable row level security;
alter table public.budget_audit_log enable row level security;
revoke all on public.sponsors,public.sponsor_audit_log,public.sponsor_interactions,public.budget_entries,public.budget_audit_log from public,anon,authenticated;
grant select,insert,update on public.sponsors to authenticated;
grant select on public.sponsor_audit_log to authenticated;
grant select,insert on public.sponsor_interactions to authenticated;
grant select,insert,update on public.budget_entries to authenticated;
grant select on public.budget_audit_log to authenticated;
grant usage,select on sequence public.sponsor_audit_log_id_seq,public.sponsor_interactions_id_seq,public.budget_audit_log_id_seq to authenticated,service_role;
grant all on public.sponsors,public.sponsor_audit_log,public.sponsor_interactions,public.budget_entries,public.budget_audit_log to service_role;

create policy sponsors_read on public.sponsors for select to authenticated using(private.can_manage_sponsors());
create policy sponsors_insert on public.sponsors for insert to authenticated with check(private.can_manage_sponsors() and created_by=(select auth.uid()));
create policy sponsors_update on public.sponsors for update to authenticated using(private.can_manage_sponsors()) with check(private.can_manage_sponsors());
create policy sponsor_audit_read on public.sponsor_audit_log for select to authenticated using(private.can_manage_sponsors());
create policy sponsor_interactions_read on public.sponsor_interactions for select to authenticated using(private.can_manage_sponsors());
create policy sponsor_interactions_insert on public.sponsor_interactions for insert to authenticated with check(private.can_manage_sponsors() and actor_user_id=(select auth.uid()));
create policy budget_entries_read on public.budget_entries for select to authenticated using(private.can_manage_budget());
create policy budget_entries_insert on public.budget_entries for insert to authenticated with check(private.can_manage_budget() and created_by=(select auth.uid()));
create policy budget_entries_update on public.budget_entries for update to authenticated using(private.can_manage_budget()) with check(private.can_manage_budget());
create policy budget_audit_read on public.budget_audit_log for select to authenticated using(private.can_manage_budget());

create or replace function private.prepare_sponsor_interaction()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  select coalesce(p.display_name,'Utente') into new.actor_name from public.profiles p where p.id=auth.uid();
  new.happened_at=now();
  return new;
end; $$;
create trigger sponsor_interactions_prepare before insert on public.sponsor_interactions for each row execute function private.prepare_sponsor_interaction();

create or replace function private.audit_sponsor_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_actor text;
begin
  select coalesce(p.display_name,'Utente') into v_actor from public.profiles p where p.id=auth.uid();
  if tg_op='INSERT' then
    insert into public.sponsor_audit_log(sponsor_id,event_type,actor_user_id,actor_name,after_data)
      values(new.id,'created',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(new));
  else
    insert into public.sponsor_audit_log(sponsor_id,event_type,actor_user_id,actor_name,before_data,after_data)
      values(new.id,'updated',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end; $$;
create or replace function private.prepare_sponsor_change()
returns trigger language plpgsql set search_path=''
as $$
begin
  if new.created_by<>old.created_by then raise exception 'CREATOR_IS_IMMUTABLE'; end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger sponsors_prepare before update on public.sponsors for each row execute function private.prepare_sponsor_change();
create trigger sponsors_audit after insert or update on public.sponsors for each row execute function private.audit_sponsor_change();

create or replace function private.prepare_budget_change()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  if tg_op='INSERT' then
    if new.approval_status<>'pending' or new.approved_by is not null or new.approved_at is not null
      or new.payment_status<>'unpaid' or new.paid_at is not null then
      raise exception 'BUDGET_ENTRY_MUST_START_PENDING';
    end if;
  else
    if new.created_by<>old.created_by then raise exception 'CREATOR_IS_IMMUTABLE'; end if;
    if old.approval_status='approved' and (
      new.title is distinct from old.title or new.category is distinct from old.category
      or new.area_id is distinct from old.area_id or new.entry_type is distinct from old.entry_type
      or new.budgeted_amount is distinct from old.budgeted_amount or new.actual_amount is distinct from old.actual_amount
      or new.due_date is distinct from old.due_date or new.notes is distinct from old.notes
    ) then
      new.approval_status='pending'; new.approved_by=null; new.approved_at=null;
    end if;
    if new.approval_status is distinct from old.approval_status then
      if new.approval_status='approved' then
        if new.created_by=auth.uid() then raise exception 'BUDGET_SELF_APPROVAL_NOT_ALLOWED'; end if;
        new.approved_by=auth.uid(); new.approved_at=now();
      else
        new.approved_by=null; new.approved_at=null;
      end if;
    else
      new.approved_by=old.approved_by; new.approved_at=old.approved_at;
    end if;
    if new.payment_status is distinct from old.payment_status and new.approval_status<>'approved' then
      raise exception 'BUDGET_ENTRY_NOT_APPROVED';
    end if;
    if new.payment_status='paid' then
      new.paid_at=coalesce(new.paid_at,current_date);
    elsif new.payment_status='unpaid' then
      new.paid_at=null;
    end if;
  end if;
  new.updated_at=now();
  return new;
end; $$;
create trigger budget_entries_prepare before insert or update on public.budget_entries for each row execute function private.prepare_budget_change();

create or replace function private.audit_budget_change()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_actor text;
begin
  select coalesce(p.display_name,'Utente') into v_actor from public.profiles p where p.id=auth.uid();
  if tg_op='INSERT' then
    insert into public.budget_audit_log(entry_id,event_type,actor_user_id,actor_name,after_data)
      values(new.id,'created',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(new));
  else
    insert into public.budget_audit_log(entry_id,event_type,actor_user_id,actor_name,before_data,after_data)
      values(new.id,'updated',auth.uid(),coalesce(v_actor,'Utente'),to_jsonb(old),to_jsonb(new));
  end if;
  return new;
end; $$;
create trigger budget_entries_audit after insert or update on public.budget_entries for each row execute function private.audit_budget_change();

revoke all on function private.audit_sponsor_change(),private.prepare_sponsor_change(),private.prepare_sponsor_interaction(),private.prepare_budget_change(),private.audit_budget_change() from public,anon,authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('budget-documents','budget-documents',false,10485760,array['application/pdf','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=10485760,allowed_mime_types=array['application/pdf','image/jpeg','image/png'];

create policy budget_documents_read on storage.objects for select to authenticated
using(bucket_id='budget-documents' and private.can_manage_budget());
create policy budget_documents_insert on storage.objects for insert to authenticated
with check(bucket_id='budget-documents' and private.can_manage_budget());
create policy budget_documents_update on storage.objects for update to authenticated
using(bucket_id='budget-documents' and private.can_manage_budget()) with check(bucket_id='budget-documents' and private.can_manage_budget());
create policy budget_documents_delete on storage.objects for delete to authenticated
using(bucket_id='budget-documents' and private.can_manage_budget());

commit;

