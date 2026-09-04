begin;
create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

alter table public.email_deliveries add column payload jsonb;
alter table public.email_deliveries add column send_uncertain boolean not null default false;
comment on column public.email_deliveries.payload is 'Immutable notification details at enqueue time; legacy NULL payloads are resolved at claim time.';

create function private.booking_email_payload(p_booking_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('to_email',c.email::text,'candidate_name',c.first_name||' '||c.last_name,
    'area_name',ar.name::text,'room_name',r.name::text,'starts_at',sl.starts_at,'ends_at',sl.ends_at)
  from public.bookings b join public.candidates c on c.id=b.candidate_id join public.slots sl on sl.id=b.slot_id
    join public.interview_sessions s on s.id=sl.session_id join public.area_allocations a on a.id=s.allocation_id
    join public.room_availabilities ra on ra.id=a.room_availability_id join public.rooms r on r.id=ra.room_id
    join public.campaign_areas ca on ca.id=a.campaign_area_id join public.areas ar on ar.id=ca.area_id where b.id=p_booking_id;
$$;
create function private.snapshot_email_payload()
returns trigger language plpgsql security definer set search_path = '' as $$
begin new.payload:=private.booking_email_payload(new.booking_id); return new; end;
$$;
create trigger email_payload_snapshot before insert on public.email_deliveries for each row execute function private.snapshot_email_payload();

create or replace function public.claim_email_delivery(p_delivery_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d public.email_deliveries%rowtype;
begin
  update public.email_deliveries set send_uncertain=send_uncertain or status='sending',status='sending',attempt_count=attempt_count+1,last_error=null
  where id=p_delivery_id and attempt_count<6 and
    ((status in ('pending','failed') and next_attempt_at<=now()) or (status='sending' and updated_at<now()-interval '2 minutes'))
  returning * into d;
  if d.id is null then return null; end if;
  return coalesce(d.payload,private.booking_email_payload(d.booking_id)) || jsonb_build_object(
    'delivery_id',d.id,'kind',d.kind,'attempt_count',d.attempt_count,'reconcile_only',d.send_uncertain);
end;
$$;
-- Fencing prevents an expired worker from acknowledging a newer attempt.
create function public.mark_email_delivery_sent(p_delivery_id uuid,p_provider_message_id text,p_attempt integer)
returns void language sql security definer set search_path = '' as $$
  update public.email_deliveries set status='sent',provider_message_id=p_provider_message_id,sent_at=now(),last_error=null
  where id=p_delivery_id and status='sending' and attempt_count=p_attempt;
$$;
create function public.mark_email_delivery_failed(p_delivery_id uuid,p_error text,p_attempt integer)
returns void language sql security definer set search_path = '' as $$
  update public.email_deliveries set status='failed',
    send_uncertain=send_uncertain or p_error in ('GMAIL_SEND_UNCERTAIN','EMAIL_ACK_FAILED'),
    last_error=case when p_error ~ '^[A-Z_]+(:[0-9]{3})?$' then left(p_error,100) else 'EMAIL_PROVIDER_ERROR' end,
    next_attempt_at=now()+make_interval(secs=>least(900,30*power(2,least(attempt_count-1,5))::integer))
  where id=p_delivery_id and status='sending' and attempt_count=p_attempt;
$$;
-- Compatibility during rolling Edge deployments: legacy acknowledgement is
-- valid only for attempt 1, and development simulations never count as sent.
create or replace function public.mark_email_delivery_sent(p_delivery_id uuid,p_provider_message_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_provider_message_id like 'development:%' then
    perform public.mark_email_delivery_failed(p_delivery_id,'EMAIL_NOT_CONFIGURED',1);
  else perform public.mark_email_delivery_sent(p_delivery_id,p_provider_message_id,1); end if;
end;
$$;
create or replace function public.mark_email_delivery_failed(p_delivery_id uuid,p_error text)
returns void language sql security definer set search_path = '' as $$
  select public.mark_email_delivery_failed(p_delivery_id,p_error,1);
$$;
create function public.list_due_email_deliveries()
returns setof uuid language plpgsql security definer set search_path = '' as $$
begin
  -- Schedule reminders without changing existing bookings or candidate records.
  insert into public.email_deliveries(booking_id,kind,idempotency_key)
    select b.id,'booking_reminder',b.id::text||':booking_reminder:'||sl.starts_at::text
    from public.bookings b join public.slots sl on sl.id=b.slot_id
    where b.status='confirmed' and sl.starts_at>now()+interval '1 hour' and sl.starts_at<=now()+interval '24 hours'
    on conflict(idempotency_key) do nothing;
  update public.email_deliveries set status='failed',last_error='RETRY_LIMIT_REACHED'
    where status='sending' and attempt_count>=6 and updated_at<now()-interval '2 minutes';
  return query select d.id from public.email_deliveries d where d.attempt_count<6 and
    ((d.status in ('pending','failed') and d.next_attempt_at<=now()) or (d.status='sending' and d.updated_at<now()-interval '2 minutes'))
    and not exists(select 1 from public.email_deliveries older where older.booking_id=d.booking_id
      and (older.created_at,older.id)<(d.created_at,d.id) and older.status<>'sent' and older.attempt_count<6)
    order by d.next_attempt_at limit 20;
end;
$$;

-- Cron authentication is generated in the database, stored encrypted in Vault,
-- and never returned to a browser or committed. Configuration is service-only.
create function public.configure_email_worker(p_url text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_existing text;
begin
  if p_url !~ '^https://[a-z0-9]+\.supabase\.co$' and p_url !~ '^http://(127\.0\.0\.1|localhost|kong)(:[0-9]+)?$' then raise exception 'INVALID_WORKER_URL'; end if;
  perform pg_advisory_xact_lock(706202603);
  select id,decrypted_secret into v_id,v_existing from vault.decrypted_secrets where name='colloqui_email_worker_url';
  if v_id is null then perform vault.create_secret(p_url,'colloqui_email_worker_url');
  elsif v_existing<>p_url then perform vault.update_secret(v_id,p_url); end if;
  if not exists(select 1 from vault.secrets where name='colloqui_email_worker_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'colloqui_email_worker_token');
  end if;
end;
$$;
create function public.verify_email_worker_token(p_token text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from vault.decrypted_secrets where name='colloqui_email_worker_token'
    and extensions.digest(decrypted_secret,'sha256')=extensions.digest(p_token,'sha256'));
$$;
create function private.dispatch_email_queue()
returns void language plpgsql security definer set search_path = '' as $$
declare v_url text; v_token text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='colloqui_email_worker_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name='colloqui_email_worker_token';
  if v_url is null or v_token is null then return; end if;
  perform net.http_post(url:=v_url||'/functions/v1/process-email-queue',
    headers:=jsonb_build_object('Content-Type','application/json','x-queue-token',v_token),body:='{}'::jsonb,timeout_milliseconds:=5000);
end;
$$;
select cron.schedule('colloqui-email-queue','* * * * *','select private.dispatch_email_queue()');

create function public.list_email_diagnostics()
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object('worker_configured',exists(select 1 from vault.secrets where name='colloqui_email_worker_url'),
    'deliveries',coalesce((select jsonb_agg(to_jsonb(d)) from
      (select id,kind,status,attempt_count,last_error,created_at,next_attempt_at,sent_at,send_uncertain,
        coalesce(provider_message_id like 'development:%',false) as simulated
       from public.email_deliveries order by created_at desc limit 100) d),'[]'::jsonb));
end;
$$;
create function public.retry_email_delivery(p_delivery_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_admin() then raise exception 'FORBIDDEN'; end if;
  update public.email_deliveries set attempt_count=0,next_attempt_at=now(),last_error=null
    where id=p_delivery_id and status='failed';
  insert into public.audit_logs(actor_user_id,actor_type,action,entity_type,entity_id)
    values(auth.uid(),'staff','email.retry','email_delivery',p_delivery_id);
end;
$$;

revoke all on function private.booking_email_payload(uuid),private.snapshot_email_payload(),private.dispatch_email_queue() from public,anon,authenticated;
revoke all on function public.claim_email_delivery(uuid),public.mark_email_delivery_sent(uuid,text,integer),public.mark_email_delivery_failed(uuid,text,integer),public.list_due_email_deliveries(),public.configure_email_worker(text),public.verify_email_worker_token(text) from public,anon,authenticated;
grant execute on function public.claim_email_delivery(uuid),public.mark_email_delivery_sent(uuid,text,integer),public.mark_email_delivery_failed(uuid,text,integer),public.list_due_email_deliveries(),public.configure_email_worker(text),public.verify_email_worker_token(text) to service_role;
revoke all on function public.list_email_diagnostics(),public.retry_email_delivery(uuid) from public,anon;
grant execute on function public.list_email_diagnostics(),public.retry_email_delivery(uuid) to authenticated;
commit;
