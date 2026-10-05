begin;

-- Web Push is available on supported desktop and mobile browsers. Native
-- Android/iOS registrations continue to use the mobile device class.
create or replace function private.enqueue_push()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.push_jobs(notification_id, device_id)
  select new.id, d.id
  from public.push_devices d
  join public.profiles p on p.id = d.user_id
  where d.user_id = new.recipient_user_id
    and p.status = 'active';
  return new;
end;
$$;

commit;

