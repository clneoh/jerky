-- Promo labels: how many times a label's link was opened.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the table, index and view are created only if missing, and the
-- policies are dropped and recreated.
--
-- WHAT THIS IS FOR. A promo code can be printed on a card or pasted into WhatsApp as a
-- link, and both land on /store/?promo=CODE. The bakery can already see what a code SOLD
-- (recounted from her own orders); this is what tells her whether the label was picked up
-- AT ALL. "Nobody opened it" and "forty opened it and two bought" are different problems
-- with different answers — print more, or change the offer.
--
-- ONE ROW PER OPEN, not a counter. She asked for the last few weeks day by day, and a
-- counter would need the public key to UPDATE — a bigger grant, and a read-modify-write
-- that loses counts when two phones arrive at the same moment.
--
-- WHAT THIS NUMBER IS NOT. It counts OPENS, not people: a reload counts again (her choice),
-- a phone that leaves the page open counts once, and a link preview from WhatsApp or Facebook
-- counts as an open with no human behind it. It is a pulse for alive-versus-cold, not a
-- headcount, and it is worth saying that where she reads the figure.

create table if not exists promo_visits (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- The same shape admin/js/promo.js's codeNameOk accepts, so a real code always fits and
  -- the table cannot be used as free text storage.
  code       text not null check (code ~ '^[A-Z0-9]{3,16}$'),

  -- A client may SUPPLY created_at — the default above only fires when it is omitted — so
  -- without this a script could back-date thousands of opens and seed weeks of fake history
  -- into the day-by-day strip she is about to be shown. This makes an honest insert land and
  -- a back-dated one fail. IT DOES NOT STOP A LIVE FLOOD, and it is not meant to: the same
  -- public key already writes to incoming_orders and reviews.
  constraint promo_visits_recent
    check (created_at between now() - interval '10 minutes' and now() + interval '1 minute')
);

alter table promo_visits enable row level security;

-- The shop may ADD an open and nothing else. No select, no update, no delete — so the public
-- key can record a visit, cannot read the table, cannot alter a row, and cannot erase evidence.
drop policy if exists "a label was opened" on promo_visits;
create policy "a label was opened" on promo_visits
  for insert to anon
  with check (true);

-- The baker reads her own opens. Also the only role that may prune the table.
drop policy if exists "the baker reads her opens" on promo_visits;
create policy "the baker reads her opens" on promo_visits
  for all to authenticated
  using (true) with check (true);

-- The read is always "these codes, by day", which is exactly this index.
create index if not exists promo_visits_code_day on promo_visits (code, created_at);

-- A DAILY COUNT, so the read stays bounded however many opens there are. PostgREST cannot
-- GROUP BY, so without this the admin app would pull every open ever recorded just to add
-- them up — fine at three, seconds of JSON at three thousand. The total she sees is the sum
-- of these rows, so one small read answers both halves of what she asked for.
--
-- `security_invoker = on` IS NOT OPTIONAL. A view normally runs as its OWNER, which would
-- bypass the table's row-level security and hand anyone holding the public key a read of
-- every visit. With it on, the querying role's own policies apply — so the baker reads rows
-- and anon, having no select policy, reads nothing.
--
-- The day is MALAYSIAN time. A visit at 8am in Penang is today's, not yesterday's UTC row.
create or replace view promo_visit_days
with (security_invoker = on) as
  select code,
         (created_at at time zone 'Asia/Kuala_Lumpur')::date as day,
         count(*)::int as n
  from promo_visits
  group by code, (created_at at time zone 'Asia/Kuala_Lumpur')::date;

grant select on promo_visit_days to authenticated;
revoke all on promo_visit_days from anon;
