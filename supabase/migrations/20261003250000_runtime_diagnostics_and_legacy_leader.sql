begin;
create or replace function public.mark_email_delivery_failed(p_delivery_id uuid,p_error text,p_attempt integer)
returns void language sql security definer set search_path='' as $$
 update public.email_deliveries set status='failed',
 send_uncertain=send_uncertain or p_error in ('GMAIL_SEND_UNCERTAIN','EMAIL_ACK_FAILED'),
 last_error=case when p_error ~ '^[A-Z_]+(:[a-z0-9_]+)?$' then left(p_error,100) else 'EMAIL_PROVIDER_ERROR' end,
 next_attempt_at=now()+make_interval(secs=>least(900,30*power(2,least(attempt_count-1,5))::integer))
 where id=p_delivery_id and status='sending' and attempt_count=p_attempt;
$$;

-- Upgrade the legacy TeamLeader account, previously modelled only as an area lead.
insert into public.system_roles(user_id,role)
select id,'team_leader' from public.profiles where lower(username::text)='teamleader'
on conflict(user_id,role) do nothing;

revoke update on public.notifications from authenticated;
grant update(read_at) on public.notifications to authenticated;
alter policy notifications_select_own on public.notifications
 using(recipient_user_id=auth.uid() and private.staff_ready());
alter policy notifications_update_own on public.notifications
 using(recipient_user_id=auth.uid() and private.staff_ready())
 with check(recipient_user_id=auth.uid() and private.staff_ready());
create or replace function public.list_notifications(p_limit integer default 30)
returns table(id uuid,type text,title text,body text,data jsonb,created_at timestamptz,read_at timestamptz)
language sql stable security definer set search_path='' as $$
 select id,type,title,body,data,created_at,read_at from public.notifications
 where recipient_user_id=auth.uid() and private.staff_ready()
 order by created_at desc limit greatest(1,least(coalesce(p_limit,30),100));
$$;
create or replace function public.get_unread_notification_count()
returns integer language sql stable security definer set search_path='' as $$
 select count(*)::integer from public.notifications
 where recipient_user_id=auth.uid() and private.staff_ready() and read_at is null;
$$;
create or replace function public.mark_notification_read(p_notification_id uuid)
returns void language sql security definer set search_path='' as $$
 update public.notifications set read_at=coalesce(read_at,now())
 where id=p_notification_id and recipient_user_id=auth.uid() and private.staff_ready();
$$;
commit;
