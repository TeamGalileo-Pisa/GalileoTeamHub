begin;

alter table public.push_devices
  add column device_class text not null default 'desktop'
    check (device_class in ('mobile','desktop'));

-- Existing native registrations are phones/tablets. Existing browser records
-- default to desktop until a mobile browser refreshes its subscription.
update public.push_devices set device_class='mobile'
  where platform in ('android','ios');

create or replace function private.enqueue_push()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
  insert into public.push_jobs(notification_id,device_id)
  select new.id,d.id
  from public.push_devices d join public.profiles p on p.id=d.user_id
  where d.user_id=new.recipient_user_id and d.device_class='mobile'
    and p.status='active';
  return new;
end;
$$;

delete from public.push_jobs j using public.push_devices d
  where d.id=j.device_id and d.device_class='desktop';

commit;

