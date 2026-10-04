begin;
create table public.push_devices (
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.profiles(id) on delete cascade,
 platform text not null check(platform in ('web','android','ios')),address text not null unique,
 subscription jsonb,created_at timestamptz not null default now()
);
alter table public.push_devices enable row level security;
revoke all on public.push_devices from anon,authenticated;
create table public.push_jobs (
 id uuid primary key default gen_random_uuid(), notification_id uuid not null references public.notifications(id) on delete cascade,
 device_id uuid not null references public.push_devices(id) on delete cascade,
 status text not null default 'pending',attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),claimed_at timestamptz,
 unique(notification_id,device_id)
);
alter table public.push_jobs enable row level security;
revoke all on public.push_jobs from anon,authenticated;
create function private.enqueue_push() returns trigger language plpgsql security definer set search_path='' as $$
begin insert into public.push_jobs(notification_id,device_id) select new.id,d.id from public.push_devices d join public.profiles p on p.id=d.user_id where d.user_id=new.recipient_user_id and p.status='active';return new;end;$$;
create trigger notification_push after insert on public.notifications for each row execute function private.enqueue_push();
create function public.claim_push_jobs() returns setof public.push_jobs language sql security definer set search_path='' as $$
 update public.push_jobs set status='sending',attempts=attempts+1,claimed_at=now() where id in (
 select id from public.push_jobs where attempts<5 and ((status='pending' and next_attempt_at<=now()) or (status='sending' and claimed_at<now()-interval '3 minutes'))
 order by next_attempt_at limit 30 for update skip locked) returning *;
$$;
revoke all on function public.claim_push_jobs() from public,anon,authenticated;
grant execute on function public.claim_push_jobs() to service_role;
-- Shared member recipients remain separate from the managerial role graph.
create function private.notify_shared_members() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_table_name='announcements' then
  if new.all_areas then insert into public.notifications(recipient_user_id,type,title,body,data)
   select m.user_id,'announcement.created','Nuovo annuncio in bacheca',new.title,jsonb_build_object('announcement_id',new.id) from public.area_shared_accounts m;
  end if;
 else
  insert into public.notifications(recipient_user_id,type,title,body,data)
   select m.user_id,'announcement.created','Nuovo annuncio in bacheca',a.title,jsonb_build_object('announcement_id',a.id)
   from public.area_shared_accounts m join public.announcements a on a.id=new.announcement_id where m.area_id=new.area_id;
 end if; return new;
end;$$;
create trigger announcements_shared_push after insert on public.announcements for each row execute function private.notify_shared_members();
create trigger targets_shared_push after insert on public.announcement_targets for each row execute function private.notify_shared_members();
commit;
