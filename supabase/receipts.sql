-- ─────────────────────────────────────────────────────────────────────────────
-- RECEIPT NUMBERS — a serial, issued once per order, never re-used.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the table and the sequence are created only if missing, and
-- the functions are replaced.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- WHY THIS EXISTS. Above RM150,000 of gross takings in a twelve-month period, a
-- business must issue SERIALLY NUMBERED receipts (Income Tax Act 1967, s.82(1)(b)).
-- The bakery's orders already carry a unique reference — the order's own code —
-- but a code is not a SERIES: it is deliberately not sequential, and it says
-- nothing about how many receipts were issued or whether any is missing.
--
-- ⚠️⚠️ AND A SERIES IS A SHARED COUNTER, WHICH IS THE ONE THING THIS APP REFUSES TO
-- KEEP. Two phones take orders and payments, and a counter living on a phone would
-- either collide with the other phone's or leave a gap — and a gap in a receipt
-- sequence is precisely what an auditor asks about. So the counter lives HERE, in
-- the database, where a number can be handed out exactly once.
--
-- ★★ THE NUMBER BELONGS TO THE ORDER, NOT TO THE PRESS. `claim_receipt_number`
-- returns the order's existing number if it already has one, and only draws a new
-- one when it does not. So pressing Paid twice, or pressing it on the other phone,
-- or printing the receipt ten times, all return THE SAME NUMBER and consume
-- nothing. That is what makes an accidental press harmless.
--
-- ⚠️ AND A REFUND NEVER REMOVES A NUMBER. Money that was taken and given back is
-- still money that moved, so the row stays and is MARKED — `refunded_at` — rather
-- than deleted. A receipt that vanished would leave the gap this whole table
-- exists to prevent.

create table if not exists receipt_numbers (
  order_code   text primary key,          -- the order's own 6-character code
  number       bigint not null unique,    -- the serial, from the sequence below
  issued_at    timestamptz not null default now(),
  refunded_at  timestamptz                -- NULL = not refunded. SET = refunded, and kept.
);

-- ★★ HOW MUCH WENT BACK (v370). A refund can be a PART of an order now, and a mark alone
-- cannot say how much — the two phones would disagree about the same order.
-- ⚠️ A row written before this column existed keeps NULL, which reads as "the whole order" —
-- exactly what the old boolean meant, so a refund made before v370 still lands right.
alter table receipt_numbers add column if not exists refunded_amount numeric;

-- ⚠️ THE SEQUENCE IS THE COUNTER, AND IT IS THE DATABASE'S. `nextval` is atomic, so
-- two phones claiming at the same instant cannot draw the same number, and no
-- number is ever handed out twice.
create sequence if not exists receipt_number_seq start 1;

-- ── claim one order's number ────────────────────────────────────────────────
-- Idempotent by construction: an order that already has a number gets that number
-- back and nothing is consumed.
--
-- ⚠️ DROPPED FIRST, AND IT HAS TO BE. This function RETURNS A TABLE, and v370 adds a column
-- to that table — Postgres refuses `create or replace` when the row type changes. Dropping
-- takes the grant with it, which is why the grant at the foot of this file is repeated after
-- every create rather than assumed.
drop function if exists public.claim_receipt_number(text);

create function public.claim_receipt_number(p_order_code text)
returns table (number bigint, refunded_at timestamptz, refunded_amount numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_num  bigint;
  v_ref  timestamptz;
  v_amt  numeric;
begin
  -- An empty code is not an order, and must never be given a number.
  if v_code = '' then
    return;
  end if;

  -- ★★ THE RACE THAT USED TO LEAVE A HOLE, CLOSED (v366).
  --
  -- `nextval` is evaluated BEFORE the insert knows whether the row will land, so if the
  -- other phone inserted this order's row in the gap between the select below and the
  -- insert, `on conflict do nothing` fired and THE VALUE DRAWN WAS SIMPLY LOST — a missing
  -- number in a run whose entire legal purpose is to have no missing numbers. v360 wrote
  -- that down as a known trade. It does not have to be one.
  --
  -- An advisory lock on the ORDER CODE serialises the select-then-insert for one order and
  -- leaves every other order free to draw at the same instant, so `on conflict` can no
  -- longer fire for this code and no value is ever skipped. `_xact_` releases it when the
  -- transaction ends, including on an error, so there is nothing to unlock by hand.
  perform pg_advisory_xact_lock(hashtext(v_code)::bigint);

  select r.number, r.refunded_at, r.refunded_amount into v_num, v_ref, v_amt
    from receipt_numbers r where r.order_code = v_code;

  if v_num is null then
    -- The insert is now the only writer for this code, so it always lands. `on conflict`
    -- stays as the belt-and-braces guard it always was — it should now never fire.
    insert into receipt_numbers (order_code, number)
      values (v_code, nextval('receipt_number_seq'))
      on conflict (order_code) do nothing
      returning receipt_numbers.number into v_num;

    if v_num is null then
      select r.number, r.refunded_at, r.refunded_amount into v_num, v_ref, v_amt
        from receipt_numbers r where r.order_code = v_code;
    end if;
  end if;

  if v_num is null then
    return;
  end if;
  return query select v_num, v_ref, v_amt;
end;
$$;

-- ── mark one order's receipt refunded ───────────────────────────────────────
-- ⚠️ IT MARKS; IT NEVER DELETES. The number stays spent for ever, so the sequence
-- keeps its shape and a refund reads as a refund rather than as a missing receipt.
--
-- ★ AND IT RECORDS HOW MUCH (v370). The amount is what lets the SECOND phone learn the size of the
-- refund rather than merely that one happened — without it the same order reads as a RM5 refund on
-- one handset and a RM22 refund on the other.
--
-- ⚠️ `p_amount` DEFAULTS TO NULL, which is the honest answer for a call that does not say: NULL
-- reads as "the whole order", so an amount-less call behaves exactly as it did before v370.
-- ⚠️ THE OLD ONE-ARGUMENT FUNCTION IS DROPPED FIRST. A two-argument version with a default would
-- otherwise leave BOTH callable, and Postgres would refuse to choose between them.
drop function if exists public.refund_receipt(text);

create function public.refund_receipt(p_order_code text, p_amount numeric default null)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_num  bigint;
begin
  if v_code = '' then
    return null;
  end if;
  update receipt_numbers
     set refunded_at     = coalesce(refunded_at, now()),
         -- ⚠️ ONCE AN AMOUNT IS RECORDED IT IS NOT OVERWRITTEN BY A LATER CALL THAT CARRIES NONE,
         -- and a later call that carries one does replace it: the refund press is the one place
         -- this is set, and it always sends what she chose.
         refunded_amount = coalesce(p_amount, refunded_amount)
   where order_code = v_code
   returning number into v_num;
  return v_num;
end;
$$;

-- ── take the refund mark back off ──────────────────────────────────────────
-- ⚠️ THIS IS THE ONLY WAY A MARK COMES OFF, AND IT BRINGS NOTHING BACK TO LIFE. It clears
-- `refunded_at` on a receipt that stays in the run, with its number — which is a press she
-- can undo if she refunded the wrong order, and not a way to erase a sale. The NUMBER is
-- never touched by it, here or anywhere: a receipt that vanished would leave the gap the
-- whole table exists to prevent.
create or replace function public.unrefund_receipt(p_order_code text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_num  bigint;
begin
  if v_code = '' then
    return null;
  end if;
  update receipt_numbers
     -- ★ BOTH GO TOGETHER (v370): an amount left behind while the mark came off would leave the
     -- register saying money went back on a receipt that reads as untouched.
     set refunded_at     = null,
         refunded_amount = null
   where order_code = v_code
   returning number into v_num;
  return v_num;
end;
$$;

-- ── who may call these ──────────────────────────────────────────────────────
-- ⚠️ THE BACKOFFICE ONLY, AND ONLY SIGNED IN. These are the bakery's own books: the
-- public shop must never be able to draw a receipt number, or anyone who read the
-- shop's page could burn through the sequence.
revoke all on function public.claim_receipt_number(text) from public;
revoke all on function public.refund_receipt(text, numeric) from public;
revoke all on function public.unrefund_receipt(text) from public;
-- ⚠️ THE GRANT MUST MATCH THE SIGNATURE EXACTLY, and v370 changed two of them: `claim` returns a
-- wider row and `refund` takes an amount. A grant that names the OLD signature silently grants
-- nothing, and the function is then callable by nobody.
grant execute on function public.claim_receipt_number(text) to authenticated;
grant execute on function public.refund_receipt(text, numeric) to authenticated;
grant execute on function public.unrefund_receipt(text) to authenticated;

-- The register reads this table directly, and it is the backoffice's own book.
alter table receipt_numbers enable row level security;

drop policy if exists "baker reads receipts" on receipt_numbers;
create policy "baker reads receipts" on receipt_numbers
  for select to authenticated
  using (true);
