-- Storefront config + order intake tables.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: tables are created only if missing, policies are dropped
-- and recreated.
--
-- storefront_config: one row holding everything the customer page shows —
--   bakery name, tagline, WhatsApp number, social links, delivery days,
--   cut-off time, capacity and the menu (products). The backoffice app
--   publishes it (Settings → Storefront) and the storefront reads it, so a
--   menu or WhatsApp edit goes live without a redeploy.
--
--   data is `text` (not jsonb) on purpose: PostgREST's
--   `resolution=merge-duplicates` key-merges jsonb, which would resurrect
--   cleared fields. A text column is replaced wholesale on conflict.
--
-- incoming_orders: a customer's order placed on the storefront. Anyone can
--   insert (the order page is public) but only signed-in bakers can read or
--   delete, so order details stay private. The backoffice imports new rows
--   into its order list, then deletes them.

create table if not exists storefront_config (
  id         text primary key default 'default',
  data       text not null default '{}',
  updated_at timestamptz not null default now()
);

alter table storefront_config enable row level security;
drop policy if exists "public read" on storefront_config;
create policy "public read" on storefront_config
  for select to anon
  using (true);
drop policy if exists "baker write" on storefront_config;
create policy "baker write" on storefront_config
  for all to authenticated
  using (true) with check (true);

create table if not exists incoming_orders (
  id         uuid primary key default gen_random_uuid(),
  data       text not null,           -- { customer, date, lines, total, note, whatsapp }
  status     text not null default 'new',
  created_at timestamptz not null default now()
);

alter table incoming_orders enable row level security;
drop policy if exists "customer place order" on incoming_orders;
create policy "customer place order" on incoming_orders
  for insert to anon
  with check (true);
drop policy if exists "baker read orders" on incoming_orders;
create policy "baker read orders" on incoming_orders
  for select to authenticated
  using (true);
drop policy if exists "baker mark orders" on incoming_orders;
create policy "baker mark orders" on incoming_orders
  for update to authenticated
  using (true) with check (true);
drop policy if exists "baker clear orders" on incoming_orders;
create policy "baker clear orders" on incoming_orders
  for delete to authenticated
  using (true);
