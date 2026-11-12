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

-- Team Leader, Amministrazione e Capo Business gestiscono i form ma non rispondono: possono compilare
-- solo i Capi Area, e chi ha un ruolo di sistema non compare in "Chi manca".
create or replace function private.can_answer_business_forms()
returns boolean language sql stable security definer set search_path = ''
as $$
  select private.staff_ready() and not private.is_admin() and exists (
    select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
    where m.user_id = auth.uid() and m.role = 'area_lead' and m.ended_at is null and a.active
  ) and not exists (
    select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
    where m.user_id = auth.uid() and m.ended_at is null and a.slug = 'business' and a.active
  );
$$;

create or replace function public.business_form_pending_leads(p_form uuid)
returns table(user_id uuid, name text, area_names text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.can_manage_business_forms() then raise exception 'BUSINESS_FORM_FORBIDDEN'; end if;
  return query
  select p.id, coalesce(p.display_name, 'Utente'), string_agg(a.name, ', ' order by a.name)
  from public.area_memberships m
  join public.areas a on a.id = m.area_id and a.active and a.slug <> 'business'
  join public.profiles p on p.id = m.user_id and p.status = 'active'
  where m.role = 'area_lead' and m.ended_at is null
    and not exists (select 1 from public.system_roles sr where sr.user_id = p.id)
    and not exists (select 1 from public.business_form_responses r where r.form_id = p_form and r.respondent_id = p.id)
  group by p.id, p.display_name
  order by 2;
end; $$;

commit;
