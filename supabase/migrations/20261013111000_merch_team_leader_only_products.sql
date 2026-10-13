-- I prodotti con visibilita' "Solo Team Leader" restano ordinabili solo da Team Leader (e Amministrazione),
-- ma li possono vedere anche il Capo Logistica e i membri Logistica (sola consultazione, senza ordinare).
-- L'ordine continua a passare da private.can_view_merch_product, che non cambia.
create or replace function private.is_logistics_staff()
returns boolean language sql stable security definer set search_path to '' as $$
  select exists(select 1 from public.profiles p
      where p.id = auth.uid() and p.status = 'active' and not p.must_change_password)
    and (
      exists(select 1 from public.area_memberships m join public.areas a on a.id = m.area_id
        where m.user_id = auth.uid() and m.ended_at is null and a.slug = 'logistica' and a.active)
      or exists(select 1 from public.area_shared_accounts m join public.areas a on a.id = m.area_id
        where m.user_id = auth.uid() and a.slug = 'logistica' and a.active)
    );
$$;
revoke all on function private.is_logistics_staff() from public, anon;
grant execute on function private.is_logistics_staff() to authenticated;

drop policy if exists merch_products_visible on public.merch_products;
create policy merch_products_visible on public.merch_products for select to authenticated
  using (private.can_manage_merchandising()
    or (active and (private.can_view_merch_product(visibility, auth.uid())
      or (visibility = 'team_leader' and private.is_logistics_staff()))));

drop policy if exists merch_variants_visible on public.merch_variants;
create policy merch_variants_visible on public.merch_variants for select to authenticated
  using (private.can_manage_merchandising()
    or (active and exists(select 1 from public.merch_products p
      where p.id = merch_variants.product_id and p.active
        and (private.can_view_merch_product(p.visibility, auth.uid())
          or (p.visibility = 'team_leader' and private.is_logistics_staff())))));
