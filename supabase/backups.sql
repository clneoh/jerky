-- Automatic cloud backups — daily / weekly / monthly snapshots of the app's data.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the table and policy are created only if missing / recreated.
--
-- backup_snapshots: one full-state copy, taken automatically by the admin app.
--   Every day the app opens signed-in it saves a 'daily' copy; each Monday you
--   open it a 'weekly' copy; on the 1st a 'monthly' copy. 'manual' copies are
--   made when the owner taps "Back up to cloud now" (and one is saved before
--   every restore, so a restore is never one-way). The app keeps the newest
--   7 daily / 4 weekly / 3 monthly and prunes the rest; manual copies stay
--   until the owner deletes them.
--
--   data holds the full app state as a JSON *string* (text column, the same
--   trick the bakery sync table uses) with the per-device settings removed —
--   the connection config and app password never leave the phone. Restoring a
--   copy writes it back over the phone and the normal sync re-pushes it to the
--   cloud, so it also steps the shared cloud back to that point.
--
--   Only signed-in bakers can read/write these (RLS authenticated), so
--   customers and the public can never see the copies.

create table if not exists backup_snapshots (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind       text not null,           -- 'daily' | 'weekly' | 'monthly' | 'manual'
  label      text not null,           -- "Daily · 8 Sep 2026"
  engine     text,                    -- app engine version at capture
  summary    text,                    -- "72 orders · 31 products · 18 ingredients"
  data       text not null            -- sanitized state as a JSON string
);

alter table backup_snapshots enable row level security;

drop policy if exists "baker reads and manages backups" on backup_snapshots;
create policy "baker reads and manages backups" on backup_snapshots
  for all to authenticated
  using (true) with check (true);
