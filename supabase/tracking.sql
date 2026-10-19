-- Order tracking table. ★ RUN THIS FILE FIRST on a fresh project.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: table is created only if missing, policies are dropped and
-- recreated.
-- ⚠️⚠️ AND IT IS SELF-CONTAINED (v585). ⚠️ The lookup below reads columns that FOUR other files also add
-- (courier_job, courier_fee, courier_cod, promo_track) — ⚠️ **on a fresh project, running this file before them
-- failed as a whole and nothing anywhere said what to run first.** ⭐ Every column the lookup reads is created
-- here, `if not exists`, so this file stands alone and the other four add nothing new.
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

-- ⚠️⚠️ AND THE PHONE THE ORDER WAS PLACED WITH (v558) — a SECOND KEY on the way in.
-- ⭐ A six-character code is about 16.7 million values and this lookup is open to anyone, so at a few
-- hundred orders a stranger making requests could reach a real order and read that customer's name,
-- address and driver's phone. ⭐ The phone is not published anywhere public, so a guess must now know
-- BOTH. ⚠️ A row published before this change carries '' here — see the function below for how those
-- stay findable while they are republished.
alter table order_tracking add column if not exists whatsapp text not null default '';

-- ⚠️⚠️ AND WHICH KIND OF BRING-A-FRIEND DISCOUNT IT WAS (v571). ⭐ The card had ONE sentence — "Bring-a-friend
-- you were sent" — so a customer spending the reward they EARNED was shown somebody else's coupon. ⚠️ The
-- figures always agreed; only the words were wrong.
-- ⭐ Values: '' (no friend discount), 'friendOff' (the friend's first-order discount) or 'reward' (the
-- referrer's own reward) — the app's own two role names, so no third spelling exists.
-- ⚠️ A row published before this carries '' and reads exactly as it did — nothing on an old card changes.
alter table order_tracking add column if not exists promo_role text not null default '';

-- ─────────────────────────────────────────────────────────────────────────────
-- THE PUBLIC'S WAY IN: one order, by its code AND its phone. Never the table.
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
-- ⚠️⚠️ AND THE TWO-ARGUMENT FUNCTION IS DROPPED FIRST, BEFORE IT IS RECREATED (v571).
-- ⭐ Its list of returned columns gained one, and **`create or replace` REFUSES to change those** — run below
-- the create, this file fails before it reaches the line that would have fixed it. ⚠️ **HER OWN ERROR, WORD
-- FOR WORD:** `ERROR: 42P13: cannot change return type of existing function. DETAIL: Row type defined by OUT
-- parameters is different. HINT: Use DROP FUNCTION track_order(text,text) first.` ⭐ The hint is right, and the
-- reason the first version failed is that the drop sat UNDER the create.
-- ⭐ EVERY COLUMN THE LOOKUP READS, created here so this file runs on its own (no-ops where another file
-- already added them). ⚠️ A column the function names but the table lacks makes the whole file fail.
alter table order_tracking add column if not exists courier_fee   numeric;
alter table order_tracking add column if not exists courier_cod   boolean;
alter table order_tracking add column if not exists courier_name  text;
alter table order_tracking add column if not exists courier_phase text;
alter table order_tracking add column if not exists courier_driver text;
alter table order_tracking add column if not exists courier_plate text;
alter table order_tracking add column if not exists courier_phone text;
alter table order_tracking add column if not exists promo_code    text;
alter table order_tracking add column if not exists promo_rm      numeric;
-- ⚠️ MUNCHIES' OWN (postage_mode.sql adds it too; idempotent). The lookup reads it, so a fresh
-- project must not fail whole for want of it.
alter table order_tracking add column if not exists postage_quoted boolean;

drop function if exists public.track_order(text, text);

create or replace function public.track_order(p_code text, p_phone text default null)
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
  promo_role      text,
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
    t.tracking_no, t.courier_fee, t.courier_cod, t.promo_code, t.promo_rm, t.promo_role,
    t.customer, t.updated_at, t.courier_name, t.courier_phase, t.courier_driver,
    t.courier_plate, t.courier_phone, t.postage_quoted
  from order_tracking t
  where t.code = upper(trim(p_code))
    -- ⚠️⚠️ AND THE PHONE MUST MATCH TOO (v558). ⭐ Compared on DIGITS ONLY, and on the LAST NINE of them,
    -- so 012-345 6789, 0123456789 and 60123456789 are the same number — the customer's own fingers decide
    -- the spelling, and a lookup that refused because of a dash would be a bug, not a security rule.
    -- ⚠️⚠️ AND THERE IS NO CODE-ONLY DOOR ANY MORE (v585). ⚠️ A row whose `whatsapp` was '' stayed findable
    -- by its code alone "while it was republished" — ⚠️ **so every phone-less order was readable by anyone who
    -- knew six characters: name, delivery address and the driver's phone.** ⭐ An order with no phone on it has
    -- no second key, and a code is not a key: it is not published, and she can tell that customer the status
    -- herself. ⚠️ A row with no phone finds nothing now, which is the honest answer.
    and (
        -- ⚠️ A TYPED NUMBER SHORTER THAN EIGHT DIGITS IS NOT A KEY AT ALL — below this, a guess stops being a guess.
        length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) >= 8
        and (
          right(regexp_replace(t.whatsapp, '[^0-9]', '', 'g'), 9)
            = right(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), 9)
          -- ⚠️⚠️ OR THE TYPED NUMBER IS A SUFFIX OF THE STORED ONE (v561). ⭐ A Malaysian number typed
          -- with or without its 60 matches on the nine digits above; ⚠️ a FOREIGN one does not — a
          -- Singapore number stored as 6581234567, typed as 8123 4567, shares only eight. ⭐ The customer's
          -- own fingers decide how much of their number they write, and a lookup that refused over the
          -- country code would be a bug, not a security rule. ⚠️ Eight digits is the floor: below that a
          -- guess would stop being a guess.
          or right(regexp_replace(t.whatsapp, '[^0-9]', '', 'g'), length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')))
             = regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')
        )
    )
  limit 1;
$$;

-- ⚠️⚠️ AND THE OLD ONE-CODE FUNCTION IS DROPPED, OR IT WOULD BE THE DOOR THAT BYPASSES THIS (v558).
drop function if exists public.track_order(text);
-- Only the shop may call it, and it may call nothing else on this table.
revoke all on function public.track_order(text, text) from public;
grant execute on function public.track_order(text, text) to anon;

alter table order_tracking enable row level security;

-- Drop the permissive read. With RLS on and no read policy left, the table is
-- readable by nobody — which is the point. The function above is the only door.
drop policy if exists "public read" on order_tracking;

-- Only logged-in users (the backoffice app) can publish the status.
drop policy if exists "baker write" on order_tracking;
create policy "baker write" on order_tracking
  for all to authenticated
  using (true) with check (true);
