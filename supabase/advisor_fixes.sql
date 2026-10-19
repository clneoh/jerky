-- supabase/advisor_fixes.sql — the Supabase advisors, part that a file can fix safely (v588 follow-up).
--
-- Run this whole file once in the SQL Editor. It changes nothing a customer or the app can see.
-- It answers two advisor findings; every other finding is the app's deliberate design and is
-- listed at the bottom of this file so it is not "fixed" again by someone who has not read it.
--
-- ⚠️ SIDE FILES OUTRANK THIS ONE. If order_alerts.sql, instant_slots.sql or shared_pool_slots.sql is
-- re-run ever again, re-run the two revoke lines in section 1 afterwards. `create or replace` keeps
-- an existing function's grants, so this file's revokes survive an edit — but a DROP and CREATE
-- (as some of those files do by design) hands the default PUBLIC EXECUTE back.


-- 1. THE TWO TRIGGER FUNCTIONS SHOULD NOT BE CALLED DIRECTLY.
--
-- The advisor lists alert_new_order and decrement_slots_on_order as callable by anon. They were
-- created without an explicit grant, so PostgreSQL gave them its default: PUBLIC may execute.
--
-- They are not buttons: each runs ONLY as a trigger on incoming_orders (order_alert_trg and
-- incoming_order_slots_trg). A trigger does not need an EXECUTE grant to fire — the grant only
-- matters if somebody calls the function by name. So revoking it changes nothing the app does and
-- closes the one door the advisor is pointing at.
--
-- Kept for postgres and service_role: the database itself and Supabase's own tooling.

-- ⚠️⚠️ GUARDED, SO THE FILE NEVER ABORTS ON A PROJECT THAT HAS NOT RUN THE OTHER SCRIPTS (v592). ⚠️ A revoke
-- naming a function that does not exist is an ERROR (42883), and it would stop this file BEFORE the primary-key
-- repair below. ⭐ Each revoke runs only where its function exists.
do $$
begin
  if to_regprocedure('public.alert_new_order()') is not null then
    execute 'revoke execute on function public.alert_new_order() from public, anon, authenticated';
    raise notice 'Revoked the direct call on alert_new_order.';
  else
    raise notice 'alert_new_order() does not exist here — skipped.';
  end if;
  if to_regprocedure('public.decrement_slots_on_order()') is not null then
    execute 'revoke execute on function public.decrement_slots_on_order() from public, anon, authenticated';
    raise notice 'Revoked the direct call on decrement_slots_on_order.';
  else
    raise notice 'decrement_slots_on_order() does not exist here — skipped.';
  end if;
end $$;


-- 2. order_alert_errors HAS NO PRIMARY KEY ON THE LIVE TABLE.
--
-- The table was made before the script asked for `id bigserial primary key`, and `create table if
-- not exists` cannot add a key to a table that already exists. A key is what the advisor's
-- "table with no primary key" suggestion asks for, and it is also how a duplicate row would be
-- refused rather than quietly counted twice.
--
-- ⚠️ MEASURED on 19 Oct 2026: the LIVE table was built by an older shape of the script and has
-- FIVE columns — order_id, happened_at, err, detail, context — and no `id` at all. So the guard
-- below adds the id column (a bigserial fills every existing row with its own number) before it
-- adds the key. If an id already exists, the old duplicate/null guard applies instead.
--
-- ⚠️ Guarded: it refuses rather than guesses. If any id is null or two rows share an id, NOTHING
-- is changed and the notice says what was found.

do $$
declare
  has_id  boolean;
  n_rows  bigint;
  n_ids   bigint;
  n_nulls bigint;
begin
  -- ⚠️⚠️ A PROJECT WITHOUT THE ALERT TABLE MUST NOT ABORT THE FILE (v596). ⚠️ `::regclass` on a missing table
  -- raises 42P01 and stops everything after it — including the revokes above, which had already run.
  if to_regclass('public.order_alert_errors') is null then
    raise notice 'order_alert_errors does not exist here — nothing to key.';
    return;
  end if;
  if exists (select 1 from pg_constraint
              where conrelid = 'public.order_alert_errors'::regclass and contype = 'p') then
    raise notice 'order_alert_errors already has a primary key. Nothing to do.';
    return;
  end if;

  select exists (select 1 from information_schema.columns
                  where table_schema = 'public'
                    and table_name = 'order_alert_errors'
                    and column_name = 'id')
    into has_id;

  select count(*) into n_rows from public.order_alert_errors;

  if not has_id then
    alter table public.order_alert_errors add column id bigserial primary key;
    raise notice 'id added as the primary key on order_alert_errors (% rows numbered).', n_rows;
    return;
  end if;

  select count(*), count(distinct id), count(*) filter (where id is null)
    into n_rows, n_ids, n_nulls
    from public.order_alert_errors;

  if n_nulls > 0 or n_ids <> n_rows then
    raise notice 'NOT changed: % rows, % distinct ids, % null. A key needs a person to look.', n_rows, n_ids, n_nulls;
    return;
  end if;

  alter table public.order_alert_errors add primary key (id);
  raise notice 'Primary key added on order_alert_errors (% rows).', n_rows;
end $$;


-- 3 · SHOW THE RESULT
select p.proname as function,
       coalesce(array_to_string(p.proacl, ' '), 'DEFAULT: PUBLIC may execute') as grants
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in ('alert_new_order', 'decrement_slots_on_order')
 order by p.proname;

-- ⚠️ THE LAST SELECT IS GUARDED TOO (v598) — a `::regclass` here raised 42P01 on a project without the table,
-- the exact abort the block above is guarded against. ⭐ `to_regclass` answers NULL instead of raising.
select conname as key_on_order_alert_errors
  from pg_constraint
 where to_regclass('public.order_alert_errors') is not null
   and conrelid = to_regclass('public.order_alert_errors')
   and contype = 'p';


-- ── LEFT ALONE ON PURPOSE — each of these is the app's design, not a fault ─────────────────────
--
-- ⭐ EVERY always-true policy. The shop must let a stranger place an order, leave a review, open a
--    promo label, and read the published days, prices and shop details; your signed-in phone must
--    manage everything. Each policy names the right audience (anon / authenticated); "always true"
--    says WHAT they may do, not WHO they are. ⚠️ The whole model rests on one Auth setting:
--    Authentication → Sign In / Providers → "Allow new users to sign up" MUST STAY OFF. If it is
--    ever switched on, anybody who registers becomes "authenticated" and can read the whole book.
--
-- ⭐ track_order callable by the public. The customer's tracking card calls it with no login. It
--    already requires the order code AND the last 9 digits of the phone (v548).
--
-- ⭐ claim_receipt_number, refund_receipt, unrefund_receipt callable by signed-in users. Those are
--    the backoffice's own presses; anon was revoked in v585/v586.
--
-- ⭐ review-photos being a PUBLIC bucket. That is how an approved review's picture shows on the
--    homepage without a login. Unapproved pictures live in the PRIVATE review-photos-pending
--    bucket and only move across on Publish (v584).
--
-- ⭐ The three order_alert_* tables with RLS on and no policy. They are written only by the
--    security-definer triggers above; with no policy, the app and the API can read nothing from
--    them. Adding a policy to silence the warning would open the alert log to the API.
--
-- ⚠️ pg_net registered in public — NOT moved. Its functions live in the net schema and the alert
--    function calls net.http_post by name. Moving the extension would either fail or move those
--    functions, and a silent failure here means the order alert stops. The warning is cosmetic;
--    the alert working is not. Leave it unless the alert has been re-proved after a move.
