-- Phase 1B: apply only after a confirmed administrator can sign in.
-- This changes permissions only; it never updates business rows or balances.
do $$
begin
  if not exists (
    select 1 from public.app_members m join auth.users u on u.id=m.user_id
    where m.role='admin' and m.is_active and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until < now())
  ) then
    raise exception 'Activation blocked: provision and verify an active administrator first';
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename in
    ('items','stock_moves','recon_sessions','recon_lines','customer_orders','customer_order_lines','import_batches','import_batch_lines')) then
    raise exception 'Activation blocked: existing business policies require review';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
    and policyname not in ('public_images 10abb02_0','public_images 10abb02_1','public_images 10abb02_2','public_images 10abb02_3')) then
    raise exception 'Activation blocked: unexpected storage policies require review';
  end if;
end $$;

alter table public.items enable row level security;
revoke all on public.items from public, anon, authenticated;
grant select, insert, update, delete on public.items to authenticated;
create policy members_read on public.items for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.items for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.items for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.items for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.stock_moves enable row level security;
revoke all on public.stock_moves from public, anon, authenticated;
grant select, insert, update, delete on public.stock_moves to authenticated;
create policy members_read on public.stock_moves for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.stock_moves for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.stock_moves for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.stock_moves for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.recon_sessions enable row level security;
revoke all on public.recon_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.recon_sessions to authenticated;
create policy members_read on public.recon_sessions for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.recon_sessions for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.recon_sessions for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.recon_sessions for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.recon_lines enable row level security;
revoke all on public.recon_lines from public, anon, authenticated;
grant select, insert, update, delete on public.recon_lines to authenticated;
create policy members_read on public.recon_lines for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.recon_lines for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.recon_lines for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.recon_lines for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.customer_orders enable row level security;
revoke all on public.customer_orders from public, anon, authenticated;
grant select, insert, update, delete on public.customer_orders to authenticated;
create policy members_read on public.customer_orders for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.customer_orders for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.customer_orders for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.customer_orders for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.customer_order_lines enable row level security;
revoke all on public.customer_order_lines from public, anon, authenticated;
grant select, insert, update, delete on public.customer_order_lines to authenticated;
create policy members_read on public.customer_order_lines for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.customer_order_lines for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.customer_order_lines for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.customer_order_lines for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.import_batches enable row level security;
revoke all on public.import_batches from public, anon, authenticated;
grant select, insert, update, delete on public.import_batches to authenticated;
create policy members_read on public.import_batches for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.import_batches for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.import_batches for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.import_batches for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

alter table public.import_batch_lines enable row level security;
revoke all on public.import_batch_lines from public, anon, authenticated;
grant select, insert, update, delete on public.import_batch_lines to authenticated;
create policy members_read on public.import_batch_lines for select to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy admins_insert on public.import_batch_lines for insert to authenticated
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_update on public.import_batch_lines for update to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy admins_delete on public.import_batch_lines for delete to authenticated
  using (exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

-- Public image URLs remain readable; mutations require an active administrator.
drop policy if exists "public_images 10abb02_0" on storage.objects;
drop policy if exists "public_images 10abb02_1" on storage.objects;
drop policy if exists "public_images 10abb02_2" on storage.objects;
drop policy if exists "public_images 10abb02_3" on storage.objects;
create policy inventory_images_read on storage.objects for select to authenticated
  using (bucket_id='item-images' and exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role in ('admin','viewer')));
create policy inventory_images_insert on storage.objects for insert to authenticated
  with check (bucket_id='item-images' and exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy inventory_images_update on storage.objects for update to authenticated
  using (bucket_id='item-images' and exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'))
  with check (bucket_id='item-images' and exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));
create policy inventory_images_delete on storage.objects for delete to authenticated
  using (bucket_id='item-images' and exists (select 1 from public.app_members m where m.user_id = (select auth.uid()) and m.is_active and m.role='admin'));

