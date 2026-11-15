drop policy if exists "Anyone can insert product configs (TODO admin auth)" on public.product_configs;

drop policy if exists "Anyone can update product configs (TODO admin auth)" on public.product_configs;

create policy "admin_insert_product_configs" on public.product_configs for insert to authenticated with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');

create policy "admin_update_product_configs" on public.product_configs for update to authenticated using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se') with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');

drop policy if exists "Anyone can insert sync state (TODO admin auth)" on public.shopify_sync_state;

drop policy if exists "Anyone can update sync state (TODO admin auth)" on public.shopify_sync_state;

create policy "admin_insert_sync_state" on public.shopify_sync_state for insert to authenticated with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');

create policy "admin_update_sync_state" on public.shopify_sync_state for update to authenticated using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se') with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'akram@arthena.se');