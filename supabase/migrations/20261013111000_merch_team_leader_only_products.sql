-- I prodotti con visibilita' "Solo Team Leader" li vedono e li gestiscono Team Leader e Amministrazione (stesse funzioni):
-- i capi area e gli altri non li vedono, anche se gestiscono il Merchandising.
create or replace function private.can_manage_merch_product(p_visibility text)
returns boolean language sql stable security definer set search_path to '' as $$
  select private.can_manage_merchandising()
    and (p_visibility <> 'team_leader' or private.is_admin());
$$;
revoke all on function private.can_manage_merch_product(text) from public;
grant execute on function private.can_manage_merch_product(text) to authenticated;

drop policy if exists merch_products_manage on public.merch_products;
create policy merch_products_manage on public.merch_products for all to authenticated
  using (private.can_manage_merch_product(visibility))
  with check (private.can_manage_merch_product(visibility));

drop policy if exists merch_products_visible on public.merch_products;
create policy merch_products_visible on public.merch_products for select to authenticated
  using (private.can_manage_merch_product(visibility)
    or (active and private.can_view_merch_product(visibility, auth.uid())));

drop policy if exists merch_variants_manage on public.merch_variants;
create policy merch_variants_manage on public.merch_variants for all to authenticated
  using (exists(select 1 from public.merch_products p
    where p.id = merch_variants.product_id and private.can_manage_merch_product(p.visibility)))
  with check (exists(select 1 from public.merch_products p
    where p.id = merch_variants.product_id and private.can_manage_merch_product(p.visibility)));

drop policy if exists merch_variants_visible on public.merch_variants;
create policy merch_variants_visible on public.merch_variants for select to authenticated
  using (exists(select 1 from public.merch_products p
    where p.id = merch_variants.product_id
      and (private.can_manage_merch_product(p.visibility)
        or (p.active and merch_variants.active and private.can_view_merch_product(p.visibility, auth.uid())))));
