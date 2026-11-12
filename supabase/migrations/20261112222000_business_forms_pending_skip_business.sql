begin;

-- "Chi manca": il Capo Business gestisce i form, quindi non è tra i Capi Area che devono rispondere.
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
    and not exists (select 1 from public.business_form_responses r where r.form_id = p_form and r.respondent_id = p.id)
  group by p.id, p.display_name
  order by 2;
end; $$;

commit;
