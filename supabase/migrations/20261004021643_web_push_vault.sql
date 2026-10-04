begin;
create function public.read_web_push_config()
returns jsonb language sql stable security definer set search_path='' as $$
 select decrypted_secret::jsonb from vault.decrypted_secrets where name='galileo_web_push_keys';
$$;
create function public.initialize_web_push_config(p_public text,p_private text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v jsonb;
begin
 perform pg_advisory_xact_lock(706202604);
 v:=public.read_web_push_config();
 if v is not null then return v; end if;
 if p_public !~ '^[A-Za-z0-9_-]{87}$' or p_private !~ '^[A-Za-z0-9_-]{43}$' then
  raise exception 'INVALID_VAPID_KEYS';
 end if;
 v:=jsonb_build_object('publicKey',p_public,'privateKey',p_private);
 perform vault.create_secret(v::text,'galileo_web_push_keys','Server-side Web Push signing keys');
 return v;
end;
$$;
revoke all on function public.read_web_push_config(),public.initialize_web_push_config(text,text) from public,anon,authenticated;
grant execute on function public.read_web_push_config(),public.initialize_web_push_config(text,text) to service_role;
commit;
