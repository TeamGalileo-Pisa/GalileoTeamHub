begin;
create table public.application_settings (
 id boolean primary key default true check(id), is_open boolean not null default false
);
insert into public.application_settings default values;
create table public.application_areas (
 area_id uuid primary key references public.areas(id), is_open boolean not null default false
);
insert into public.application_areas(area_id) select id from public.areas on conflict do nothing;
create table public.applications (
 id uuid primary key default gen_random_uuid(), area_id uuid not null references public.areas(id),
 email text not null, first_name text not null, last_name text not null,
 answers jsonb not null, created_at timestamptz not null default now(),
 unique(area_id,email)
);
create table public.membership_invitations (
 id uuid primary key default gen_random_uuid(), token_hash bytea not null unique,
 email text not null, area_id uuid not null references public.areas(id),
 created_by uuid not null references public.profiles(id),
 expires_at timestamptz not null default now()+interval '14 days', submitted_at timestamptz,
 revoked_at timestamptz, created_at timestamptz not null default now()
);
create table public.membership_submissions (
 invitation_id uuid primary key references public.membership_invitations(id),
 data jsonb not null, created_at timestamptz not null default now()
);
create table public.area_shared_accounts (
 area_id uuid primary key references public.areas(id),
 user_id uuid not null unique references public.profiles(id) on delete cascade
);
-- Separate membership: a shared member account never inherits area-lead RPCs.
create table public.community_outbox (
 id uuid primary key default gen_random_uuid(), kind text not null,
 recipient text not null, payload jsonb not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','failed')),
 attempts integer not null default 0, uncertain boolean not null default false,
 next_attempt_at timestamptz not null default now(), claimed_at timestamptz,
 last_error text, created_at timestamptz not null default now()
);
alter table public.application_settings enable row level security;
alter table public.application_areas enable row level security;
alter table public.applications enable row level security;
alter table public.membership_invitations enable row level security;
alter table public.membership_submissions enable row level security;
alter table public.area_shared_accounts enable row level security;
alter table public.community_outbox enable row level security;
revoke all on public.application_settings,public.application_areas,public.applications,public.membership_invitations,public.membership_submissions,public.area_shared_accounts,public.community_outbox from anon,authenticated;
grant select on public.application_settings,public.application_areas,public.applications,public.membership_invitations,public.membership_submissions,public.area_shared_accounts to authenticated;
grant update on public.application_settings,public.application_areas to authenticated;
create policy admin_settings on public.application_settings for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy admin_areas on public.application_areas for all to authenticated using(private.is_admin()) with check(private.is_admin());
create policy admin_applications on public.applications for select to authenticated using(private.is_admin());
create policy admin_invitations on public.membership_invitations for select to authenticated using(private.is_admin());
create policy admin_submissions on public.membership_submissions for select to authenticated using(private.is_admin());
create policy shared_account_self on public.area_shared_accounts for select to authenticated using(user_id=auth.uid() or private.is_admin());

create function public.public_application_areas()
returns table(id uuid,name text,slug text) language sql stable security definer set search_path='' as $$
 select a.id,a.name::text,a.slug::text from public.areas a join public.application_areas c on c.area_id=a.id
 where a.active and c.is_open and exists(select 1 from public.application_settings where is_open) order by a.name;
$$;
grant execute on function public.public_application_areas() to anon,authenticated;

create function public.submit_application(p_area uuid,p_email text,p_first text,p_last text,p_answers jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid;
begin
 -- Locks serialize closing a form with a concurrent submission.
 perform 1 from public.application_settings where is_open for share;
 if not found then raise exception 'APPLICATION_CLOSED'; end if;
 perform 1 from public.application_areas c join public.areas a on a.id=c.area_id
 where c.area_id=p_area and c.is_open and a.active for share of c,a;
 if not found then raise exception 'APPLICATION_CLOSED'; end if;
 insert into public.applications(area_id,email,first_name,last_name,answers)
 values(p_area,lower(trim(p_email)),p_first,p_last,p_answers) returning id into v_id;
 insert into public.community_outbox(kind,recipient,payload) values('application',p_email,jsonb_build_object('firstName',p_first));
 return v_id;
end;
$$;
create function public.submit_membership(p_token text,p_data jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare v public.membership_invitations%rowtype;
begin
 select * into v from public.membership_invitations where token_hash=extensions.digest(p_token,'sha256') for update;
 if v.id is null or v.revoked_at is not null or v.expires_at<now() then raise exception 'INVALID_INVITATION'; end if;
 if v.submitted_at is not null then raise exception 'ALREADY_SUBMITTED'; end if;
 insert into public.membership_submissions values(v.id,p_data,now());
 update public.membership_invitations set submitted_at=now() where id=v.id;
 insert into public.community_outbox(kind,recipient,payload) values('membership',v.email,p_data || jsonb_build_object('area',(select name from public.areas where id=v.area_id),'date',to_char(now() at time zone 'Europe/Rome','DD/MM/YYYY')));
end;
$$;
create function public.claim_community_mail()
returns setof public.community_outbox language sql security definer set search_path='' as $$
 update public.community_outbox set uncertain=uncertain or state='sending',state='sending',claimed_at=now(),attempts=attempts+1
 where id in (select id from public.community_outbox where attempts<6 and
 ((state in ('pending','failed') and next_attempt_at<=now()) or (state='sending' and claimed_at<now()-interval '3 minutes'))
 order by created_at limit 10 for update skip locked) returning *;
$$;
revoke all on function public.submit_application(uuid,text,text,text,jsonb),public.submit_membership(text,jsonb),public.claim_community_mail() from public,anon,authenticated;
grant execute on function public.submit_application(uuid,text,text,text,jsonb),public.submit_membership(text,jsonb),public.claim_community_mail() to service_role;

create function public.member_announcements()
returns table(id uuid,title text,body text,published_at timestamptz) language sql stable security definer set search_path='' as $$
 select n.id,n.title,n.body,n.published_at from public.announcements n
 where exists(select 1 from public.area_shared_accounts m join public.profiles p on p.id=m.user_id
 where m.user_id=auth.uid() and p.status='active' and not p.must_change_password
 and (n.all_areas or exists(select 1 from public.announcement_targets t where t.announcement_id=n.id and t.area_id=m.area_id)))
 and n.published_at<=now() and (n.expires_at is null or n.expires_at>now()) order by n.published_at desc;
$$;
revoke all on function public.member_announcements() from public,anon;
grant execute on function public.member_announcements() to authenticated;
commit;
