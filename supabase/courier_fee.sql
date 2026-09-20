-- Order tracking: add the courier's charge.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the column is added only if missing.
--
-- RUN THIS BEFORE DEPLOYING THE BUILD THAT NAMES IT. The backoffice publishes the
-- whole tracking row in one call; if this column does not exist yet, that call is
-- rejected as a whole and the customer's tracking page stops updating for EVERY
-- order — not only the ones with a charge. Order matters here.
--
-- The charge is published only when the CUSTOMER bears it — a charge you pay is
-- your own cost and never appears on the customer's card. NULL means there is none
-- on this order, and the customer's track card leaves the line out entirely rather
-- than printing an empty label. The flat nationwide postage is neither published
-- here nor anywhere else on that row: it stays private to your phones.

alter table order_tracking add column if not exists courier_fee numeric;
