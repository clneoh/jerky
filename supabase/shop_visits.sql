-- Shop looks: how many times the shop page was opened, day by day.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the table, index and view are created only if missing, and the policies are
-- dropped and recreated.
--
-- ⭐ WHY THIS EXISTS, IN HER WORDS: she asked to know __"how many people looked and did not buy"__.
--
-- ⚠️⚠️ WHAT THIS NUMBER IS NOT, AND IT IS SAID WHERE SHE READS IT. It counts **LOOKS**, not people:
-- no cookie, no device fingerprint, no IP is stored — so the same person looking three times is three
-- looks, a phone left open on the page is one, and a link preview from WhatsApp can be one with nobody
-- behind it. ⭐ It is enough to answer the question she actually has — *did anyone come, and did they
-- order?* — and it cannot answer "how many customers". Any figure that claimed to would be invented.
--
-- ⚠️ ONE ROW PER LOOK, not a counter: a counter would need the PUBLIC key to UPDATE, which is a bigger
-- grant and a read-modify-write that loses counts when two phones arrive at once. The same reasoning as
-- promo_visits, which this is deliberately a copy of.

create table if not exists shop_visits (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  -- Which page: the shop, or the homepage. A closed list, so the table cannot be used as free storage.
  page       text not null check (page in ('shop', 'home')),

  -- ⚠️ A client may SUPPLY created_at, so without this a script could back-date thousands of looks and
  -- seed weeks of fake history into the strip she reads. An honest insert lands; a back-dated one fails.
  -- It does not stop a live flood and is not meant to.
  constraint shop_visits_recent
    check (created_at between now() - interval '10 minutes' and now() + interval '1 minute')
);

alter table shop_visits enable row level security;

-- ⚠️⚠️ FIRST, TAKE AWAY WHAT SUPABASE GRANTS BY DEFAULT (the v648 lesson). A new table arrives with ALL
-- granted to anon, and the fix is to revoke before granting the one thing that is wanted — otherwise the
-- grant survives even though row-level security is what actually refuses the read.
revoke all on public.shop_visits from anon;

-- The shop may ADD a look and nothing else. No select, no update, no delete: the public key can record a
-- visit, cannot read the table, cannot alter a row, and cannot erase evidence.
drop policy if exists "the shop was looked at" on shop_visits;
create policy "the shop was looked at" on shop_visits
  for insert to anon
  with check (true);

grant insert on public.shop_visits to anon;
grant usage on sequence shop_visits_id_seq to anon;

-- The owner reads her own looks. Also the only role that may prune the table.
drop policy if exists "the owner reads the visits" on shop_visits;
create policy "the owner reads the visits" on shop_visits
  for all to authenticated
  using (true) with check (true);

-- The read is always "by day", which is exactly this index.
create index if not exists shop_visits_day on shop_visits (created_at);

-- A DAILY COUNT, so the read stays bounded however many looks there are. PostgREST cannot GROUP BY, so
-- without this the admin app would pull every look ever recorded just to add them up.
--
-- ⚠️ `security_invoker = on` IS NOT OPTIONAL: a view normally runs as its OWNER, which would bypass the
-- table's row-level security and hand anyone holding the public key a read of every look.
--
-- ⚠️ The day is MALAYSIAN time: a look at 8am in Penang is today's, not yesterday's UTC row.
create or replace view shop_visit_days
with (security_invoker = on) as
  select page,
         (created_at at time zone 'Asia/Kuala_Lumpur')::date as day,
         count(*)::int as n
  from shop_visits
  group by page, (created_at at time zone 'Asia/Kuala_Lumpur')::date;

grant select on shop_visit_days to authenticated;
revoke all on shop_visit_days from anon;

-- A READ-BACK, so she can SEE it worked rather than be told. ⚠️ `anon_can_add` must be true and
-- `anon_can_read` must be false — a true read means the default grant survived and the shop's key can
-- read every look.
select
  to_regclass('public.shop_visits') is not null as table_exists,
  (select count(*) from pg_policies where schemaname = 'public' and tablename = 'shop_visits') as policy_count,
  has_table_privilege('anon', 'public.shop_visits', 'insert') as anon_can_add,
  has_table_privilege('anon', 'public.shop_visits', 'select') as anon_can_read,
  (select count(*) from shop_visit_days) as days_recorded;
