-- Il link pubblico al modulo di adesione usava un token di 64 caratteri
-- (32 byte in esadecimale). I nuovi link usano 12 byte (24 caratteri,
-- 96 bit di entropia), sufficienti per un link non indovinabile.
-- Il link già attivo non viene revocato: resta valido finché non viene
-- sostituito, così i moduli già condivisi e le bozze in corso continuano
-- a funzionare.
begin;

create or replace function public.get_or_create_membership_form_link(p_actor uuid)
returns text
language plpgsql
security definer
set search_path to ''
as $$
declare v_token text;
begin
  if not exists (
    select 1 from public.profiles p
    join public.system_roles r on r.user_id=p.id
    where p.id=p_actor and p.status='active' and not p.must_change_password
      and r.role in ('admin','team_leader')
  ) then raise exception 'FORBIDDEN'; end if;

  perform pg_advisory_xact_lock(hashtext('membership-form-public-link'));
  select public_token into v_token
  from public.membership_form_links where revoked_at is null;

  if v_token is null then
    v_token := encode(extensions.gen_random_bytes(12), 'hex');
    insert into public.membership_form_links(public_token,token_hash,created_by)
    values(v_token,extensions.digest(v_token,'sha256'),p_actor);
  end if;
  return v_token;
end;
$$;

commit;
