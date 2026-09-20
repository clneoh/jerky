-- Visits to the landing page a printed label opens.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New editor → Run).
-- Safe to re-run: the table is created only if missing and the policies are
-- dropped and recreated.
--
-- One row per page view, written by /taster/ when the visitor answers the
-- dog-or-cat question (or, if that question is switched off, as soon as the page
-- opens). It answers one question — how many people a label reached — so the
-- columns are deliberately the smallest set that can: which label, which pet,
-- which language.
--
-- WHO CAN DO WHAT. Anyone may ADD a visit (the page is public) and NOBODY may
-- read them back anonymously: the landing page has no reason to show a count,
-- and a public read would let a stranger count your customers. You read them
-- from the app's Shops & codes screen, which signs in and so arrives as
-- `authenticated`. The counts therefore stay yours.
--
-- pet is '' when the visitor did not answer (the question is off, or they
-- skipped it) — an unanswered visit still counts as a visit.
-- code is the label's short code, UPPER-CASE, or '' for a page opened without
-- one (a typed link, or the homepage). '' counts towards the total only.

create table if not exists taster_visits (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  code       text not null default '' check (char_length(code) <= 16),
  pet        text not null default '' check (pet in ('', 'dog', 'cat')),
  lang       text not null default 'en' check (lang in ('en', 'zh', 'ms'))
);

alter table taster_visits enable row level security;

drop policy if exists "visitor lands on a page" on taster_visits;
create policy "visitor lands on a page" on taster_visits
  for insert to anon
  with check (true);

-- No anon SELECT policy on purpose: the counts are yours, not the public's.
drop policy if exists "owner reads the visits" on taster_visits;
create policy "owner reads the visits" on taster_visits
  for select to authenticated
  using (true);

-- The list is read newest-first and grouped by code; this keeps both cheap as
-- the rows pile up.
create index if not exists taster_visits_created_idx on taster_visits (created_at desc);
create index if not exists taster_visits_code_idx on taster_visits (code);
