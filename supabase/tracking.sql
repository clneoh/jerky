-- Order tracking table.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: table is created only if missing, policies are dropped and
-- recreated.
--
-- order_tracking: one row per customer order (keyed by its 6-char order code).
-- When the baker confirms an order, the backoffice publishes the order's
-- status here; the customer looks it up on the storefront's "Track your order"
-- card (or via the WhatsApp confirmation link) and sees the current status,
-- delivery details and a TNG QR to pay. The customer never sees the
-- backoffice's private orders — only the few fields the baker publishes here.

create table if not exists order_tracking (
  code            text primary key,      -- 6-char order code, e.g. 'A3F9C2'
  status          text not null,         -- one of: new / confirmed / paid / baking / ready / delivered
  delivery        text not null,         -- "9 Sep · Self collect" or "… · Courier · 12 Jalan Bunga"
  items           text not null,         -- "Focaccia ×2, Sandwich ×1"
  total           text not null,         -- "RM 46.00"
  customer        text not null,         -- customer name shown on the track page
  updated_at      timestamptz not null default now(),
  confirmed_sent  boolean,               -- NULL/true: "Send confirmation" pressed (Confirmed green on the map)
  paid_received   boolean                -- NULL/true: "Paid" pressed (Paid green on the map)
);

-- Anyone can read (the storefront shows tracking to every visitor).
alter table order_tracking enable row level security;
drop policy if exists "public read" on order_tracking;
create policy "public read" on order_tracking
  for select to anon
  using (true);

-- Only logged-in users (the backoffice app) can publish the status.
drop policy if exists "baker write" on order_tracking;
create policy "baker write" on order_tracking
  for all to authenticated
  using (true) with check (true);
