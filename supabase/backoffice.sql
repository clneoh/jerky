-- Shared backoffice data across phones. Run this in the Supabase SQL editor
-- alongside availability.sql. Every record in the backoffice app becomes a row:
--   kind       'orders' | 'products' | 'ingredients' | 'deliveryDates' | 'purchaseOrders' | 'settings'
--   id         the app's record id ('settings' uses id 'default')
--   data       the full record as a JSON *string* (text, not jsonb) — see note below
--   _deleted   true = a tombstone (the record was removed on another phone)
--   updated_at client timestamp (ISO string) — the newest edit wins
--
-- data is `text` on purpose: PostgREST's `resolution=merge-duplicates` does a
-- key-level merge on jsonb columns (keys absent from the new payload survive),
-- which would resurrect cleared fields on the other phone. A text column is
-- replaced wholesale on conflict, which is exactly what we want.
--
-- Private data: only logged-in bakers can read or write (unlike the public
-- availability tables, which the storefront reads via the anon key).
create table if not exists bakery (
  kind text not null,
  id text not null,
  data text not null default 'null',
  _deleted boolean not null default false,
  updated_at text not null,
  primary key (kind, id)
);
alter table bakery enable row level security;
create policy "baker read"  on bakery for select to authenticated using (true);
create policy "baker write" on bakery for all    to authenticated using (true) with check (true);
