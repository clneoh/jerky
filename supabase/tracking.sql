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
  status          text not null,         -- one of: new / confirmed / paid / baking / ready / delivered (Posted/Collected to the customer)
  delivery        text not null,         -- "9 Sep · Self collect" or "… · Courier · 12 Jalan Bunga"
  items           text not null,         -- "Focaccia ×2, Sandwich ×1"
  total           text not null,         -- "RM 46.00"
  customer        text not null,         -- customer name shown on the track page
  updated_at      timestamptz not null default now(),
  confirmed_sent  boolean,               -- NULL/true: "Send confirmation" pressed (Confirmed green on the map)
  paid_received   boolean,               -- NULL/true: "Paid" pressed (Paid green on the map)
  tracking_no     text                   -- the courier's tracking number, shown on the customer's card; NULL = none
);

-- ─────────────────────────────────────────────────────────────────────────────
-- THE PUBLIC'S WAY IN: one order, by its code. Never the table.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- ⚠️ WHY THIS IS A FUNCTION AND NOT A READ POLICY (7 Oct 2026). This table used
-- to carry a read policy `for select to anon using (true)`. `using (true)` is not
-- a filter — it is a statement that every row is public. The anon key is public
-- BY DESIGN (it ships in the shop's own JavaScript, store/config.js), so anyone
-- could ask PostgREST for the whole table and receive EVERY customer's name and
-- delivery address, plus the courier driver's name and phone. The shop asked for
-- one code, but asking is not enforcing: nothing stopped a caller from simply not
-- asking for one.
--
-- RLS cannot express "only if you know the code", because a policy may look at a
-- ROW but never at what the caller intended to ask for. So the read moves into a
-- SECURITY DEFINER function, which is the only place a code can be matched before
-- any row is chosen. The table's read policy is dropped, so the table itself is
-- no longer readable by anyone — only this function, one row at a time.
--
-- ⚠️ THE COLUMN LIST BELOW IS LOAD-BEARING, and it has moved here from the shop.
-- The tracking card draws whatever this function returns, and a column the
-- backoffice publishes that this list omits is a line the customer's card can
-- never draw — and it fails with NO ERROR ANYWHERE. test/store-trip.test.js reads
-- THIS FILE to prove every column the card needs is named. So a new column the
-- customer should see has to be added in two places: the backoffice's publish,
-- and this list.
create or replace function public.track_order(p_code text)
returns table (
  status          text,
  confirmed_sent  boolean,
  paid_received   boolean,
  delivery        text,
  items           text,
  total           text,
  tracking_no     text,
  courier_fee     numeric,
  courier_cod     boolean,
  promo_code      text,
  promo_rm        numeric,
  customer        text,
  updated_at      timestamptz,
  courier_name    text,
  courier_phase   text,
  courier_driver  text,
  courier_plate   text,
  courier_phone   text,
  -- ⚠️ JERKY-ONLY, ADDED BY THIS PROJECT (supabase/postage_mode.sql, 28 Sep 2026). The rest of
  -- this list came from the bakery and this column did NOT exist there. A `returns table` list
  -- and the SELECT under it are POSITIONAL — a column here must have its counterpart there, in
  -- the same place, or the function will not create. Without it the customer's card cannot tell
  -- an order whose delivery cost is still to be quoted from one with nothing left to pay, and
  -- would quietly say neither (see the guardrail in CLAUDE.md).
  postage_quoted  boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    t.status, t.confirmed_sent, t.paid_received, t.delivery, t.items, t.total,
    t.tracking_no, t.courier_fee, t.courier_cod, t.promo_code, t.promo_rm,
    t.customer, t.updated_at, t.courier_name, t.courier_phase, t.courier_driver,
    t.courier_plate, t.courier_phone, t.postage_quoted
  from order_tracking t
  where t.code = upper(trim(p_code))
  limit 1;
$$;

-- Only the shop may call it, and it may call nothing else on this table.
revoke all on function public.track_order(text) from public;
grant execute on function public.track_order(text) to anon;

alter table order_tracking enable row level security;

-- Drop the permissive read. With RLS on and no read policy left, the table is
-- readable by nobody — which is the point. The function above is the only door.
drop policy if exists "public read" on order_tracking;

-- Only logged-in users (the backoffice app) can publish the status.
drop policy if exists "baker write" on order_tracking;
create policy "baker write" on order_tracking
  for all to authenticated
  using (true) with check (true);
