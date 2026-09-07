-- Bakester live availability tables.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: tables are created only if missing, policies are dropped
-- and recreated.
--
-- availability: one row per upcoming delivery date —
--   slots_left = day's capacity - units already ordered
--   the day pill shows "Sold out" when this hits 0
--
-- product_availability: one row per (date, product) —
--   slots_left = that product's daily limit - units already ordered
--   each product card shows an "Only N left" / "Sold out" stamp

create table if not exists availability (
  date       text primary key,           -- 'YYYY-MM-DD'
  slots_left integer not null,
  capacity   integer not null,
  updated_at timestamptz not null default now()
);

-- Anyone can read (the storefront shows live counts to every visitor).
alter table availability enable row level security;
drop policy if exists "public read" on availability;
create policy "public read" on availability
  for select to anon
  using (true);

-- Only logged-in users (the backoffice app) can write the counts.
drop policy if exists "baker write" on availability;
create policy "baker write" on availability
  for all to authenticated
  using (true) with check (true);

create table if not exists product_availability (
  date       text not null,              -- 'YYYY-MM-DD'
  product    text not null,              -- product name as shown on the storefront
  slots_left integer not null,
  capacity   integer not null,
  updated_at timestamptz not null default now(),
  primary key (date, product)
);

alter table product_availability enable row level security;
drop policy if exists "public read" on product_availability;
create policy "public read" on product_availability
  for select to anon
  using (true);
drop policy if exists "baker write" on product_availability;
create policy "baker write" on product_availability
  for all to authenticated
  using (true) with check (true);
