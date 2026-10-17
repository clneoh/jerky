-- ============================================================================
-- sync_cursor.sql — ONE paste, run in the Supabase SQL editor.
--
-- ⭐ WHAT IT DOES: it gives the `bakery` table a number that the DATABASE stamps
-- on every write, strictly higher than every number before it. The app can then
-- ask "what changed since 41,208?" instead of downloading the whole book every
-- 30 seconds.
--
-- ⚠️⚠️ WHY IT CANNOT BE THE PHONE'S CLOCK. The obvious way to ask "what changed
-- since 10:23?" is to trust the time. Your two phones are not the same clock — a
-- phone running behind writes its edits with a time in the PAST, and a search for
-- "everything after 10:23" would never look there again. With a full read that
-- only costs speed; with a "since" read a missed record is missed for EVER.
-- So the number comes from the database, not from any phone.
--
-- ⚠️ SAFE TO RUN TWICE. Every line is guarded, and running it a second time
-- stamps nothing again.
--
-- ⚠️ IT CHANGES NO RECORD. No order, product, ingredient or bake day is edited
-- or deleted. It adds one column, fills it, and adds one trigger.
--
-- ⭐ NOTHING BREAKS IF THE APP IS NOT UPDATED YET. This script only ADDS a column
-- and a trigger. The current app never reads or writes `seq`, so your phones keep
-- working exactly as they do now until the new build arrives — and that build can
-- be deployed after this, in either order.
--
-- ⚠️ TO UNDO IT (not normally needed), run the four lines at the very bottom.
-- ============================================================================


-- 1. THE COUNTER. An ordinary sequence: every call hands out the next number,
--    and it never goes backwards.
create sequence if not exists bakery_seq;

-- ⚠️⚠️ AND THE PHONES MUST BE ALLOWED TO ASK IT FOR A NUMBER. A trigger runs with
-- the privileges of whoever is writing — which is the signed-in baker, not you.
-- ⚠️ Without this line every write from a phone fails with "permission denied for
-- sequence bakery_seq", which would break syncing completely. Supabase usually
-- grants this by default, but "usually" is not good enough for the one thing every
-- write depends on, and granting it twice does no harm.
grant usage, select on sequence bakery_seq to authenticated;


-- 2. THE COLUMN.
alter table bakery add column if not exists seq bigint;


-- 3. STAMP THE ROWS THAT ARE ALREADY THERE. ⚠️ This runs BEFORE the trigger
--    below is created, so it stamps these rows exactly once. On a second run
--    there are no NULLs left, so it touches nothing.
update bakery set seq = nextval('bakery_seq') where seq is null;


-- 4. AND A NEW ROW THAT ARRIVES WITHOUT ONE still gets a number.
alter table bakery alter column seq set default nextval('bakery_seq');


-- 5. ⚠️⚠️ THE IMPORTANT HALF: EVERY WRITE TAKES A NEW NUMBER — INCLUDING AN EDIT.
--    A plain column default is NOT enough: a default only fires when a row is
--    INSERTED, so an order she EDITS would keep its old number and sit behind the
--    cursor for ever. That is why this is a trigger on both insert and update.
create or replace function bakery_stamp_seq() returns trigger
language plpgsql as $$
begin
  new.seq := nextval('public.bakery_seq');
  return new;
end $$;

-- ⚠️ Dropped first so a second run replaces it instead of failing.
drop trigger if exists bakery_stamp_seq on bakery;
create trigger bakery_stamp_seq
  before insert or update on bakery
  for each row execute function bakery_stamp_seq();


-- 6. EVERY ROW NOW HAS ONE, AND THE "SINCE" READ IS FAST.
--    ⚠️ `set not null` is safe here only because step 3 filled every row — if it
--    ever fails, it fails LOUDLY rather than leaving unstampable rows behind.
alter table bakery alter column seq set not null;
create index if not exists bakery_seq_idx on bakery (seq);


-- 7. PROVE IT — READ THESE NUMBERS BACK. ⭐ `rows` and `stamped` must be the SAME,
--    and `highest` must be bigger than `lowest`. If `rows` and `stamped` differ,
--    stop and tell me before going any further.
select
  count(*)                     as rows,
  count(seq)                   as stamped,
  min(seq)                     as lowest,
  max(seq)                     as highest
from bakery;


-- ── TO UNDO IT (only if something is wrong) ──────────────────────────────────
-- drop trigger if exists bakery_stamp_seq on bakery;
-- drop function if exists bakery_stamp_seq();
-- alter table bakery drop column if exists seq;
-- drop sequence if exists bakery_seq;
-- ⚠️ The app would then fall back to reading the whole book, which is slower and
--    never wrong. Nothing is lost.
