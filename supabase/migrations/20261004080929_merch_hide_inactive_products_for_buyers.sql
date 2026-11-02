begin;

drop policy if exists merch_products_visible on public.merch_products;
create policy merch_products_visible on public.merch_products for select to authenticated
  using (
    private.can_manage_merchandising()
    or (active and private.can_view_merch_product(visibility,auth.uid()))
  );

commit;

