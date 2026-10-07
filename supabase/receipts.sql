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

-- ⚠️ THE SEQUENCE IS THE COUNTER, AND IT IS THE DATABASE'S. `nextval` is atomic, so
-- two phones claiming at the same instant cannot draw the same number, and no
-- number is ever handed out twice.
create sequence if not exists receipt_number_seq start 1;

-- ── claim one order's number ────────────────────────────────────────────────
-- Idempotent by construction: an order that already has a number gets that number
-- back and nothing is consumed.
create or replace function public.claim_receipt_number(p_order_code text)
returns table (number bigint, refunded_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := upper(trim(coalesce(p_order_code, '')));
  v_num  bigint;
  v_ref  timestamptz;
begin
  -- An empty code is not an order, and must never be given a number.
  if v_code = '' then
    return;
  end if;

  select r.number, r.refunded_at into v_num, v_ref
    from receipt_numbers r where r.order_code = v_code;

  if v_num is null then
    -- `on conflict do nothing` is the second guard: if the other phone inserted this
    -- order's row between the select above and this insert, nothing happens here and
    -- the number it drew is read back below. The sequence may therefore skip a value
    -- in that one race — which is why the read-back is here rather than a retry.
    insert into receipt_numbers (order_code, number)
      values (v_code, nextval('receipt_number_seq'))
      on conflict (order_code) do nothing
      returning receipt_numbers.number into v_num;

    if v_num is null then
      select r.number, r.refunded_at into v_num, v_ref
        from receipt_numbers r where r.order_code = v_code;
    end if;
  end if;

  if v_num is null then
    return;
  end if;
  return query select v_num, v_ref;
end;
$$;

-- ── mark one order's receipt refunded ───────────────────────────────────────
-- ⚠️ IT MARKS; IT NEVER DELETES. The number stays spent for ever, so the sequence
-- keeps its shape and a refund reads as a refund rather than as a missing receipt.
create or replace function public.refund_receipt(p_order_code text)
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
     set refunded_at = coalesce(refunded_at, now())
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
     set refunded_at = null
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
revoke all on function public.refund_receipt(text) from public;
revoke all on function public.unrefund_receipt(text) from public;
grant execute on function public.claim_receipt_number(text) to authenticated;
grant execute on function public.refund_receipt(text) to authenticated;
grant execute on function public.unrefund_receipt(text) to authenticated;

-- The register reads this table directly, and it is the backoffice's own book.
alter table receipt_numbers enable row level security;

drop policy if exists "baker reads receipts" on receipt_numbers;
create policy "baker reads receipts" on receipt_numbers
  for select to authenticated
  using (true);
