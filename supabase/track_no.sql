-- Order tracking: add the courier's tracking number.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the column is added only if missing.
--
-- The tracking number is typed on a posted order (on the order's row from Packed
-- onwards via Note / tracking, or in the Edit pop-up). It goes into the posted
-- WhatsApp message AND onto the customer's own track card, so the customer can
-- read it back to the courier without asking. NULL means there is none — a
-- self-collect order, or one not posted yet — and the customer's card leaves the
-- line out entirely rather than printing an empty label.

alter table order_tracking add column if not exists tracking_no text;
