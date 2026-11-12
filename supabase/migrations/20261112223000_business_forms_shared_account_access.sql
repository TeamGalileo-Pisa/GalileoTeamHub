begin;

-- L'account condiviso "Membri Business" non ha ruoli di sistema né area_memberships, quindi
-- private.staff_ready() è falso per lui e non vedeva i form. Qui si controlla direttamente
-- che l'account sia attivo e senza cambio password obbligatorio.
create or replace function private.can_manage_business_forms()
returns boolean language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.status = 'active' and not p.must_change_password
  ) and (
    private.is_admin()
    or exists (select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
               where m.user_id = auth.uid() and m.ended_at is null and a.slug = 'business' and a.active)
    or exists (select 1 from public.area_shared_accounts s join public.areas a on a.id = s.area_id
               where s.user_id = auth.uid() and a.slug = 'business' and a.active)
  );
$$;

commit;
