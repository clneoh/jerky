-- Order tracking: say whether the courier's charge is COD.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: the column is added only if missing.
--
-- RUN THIS BEFORE DEPLOYING THE BUILD THAT NAMES IT. The backoffice publishes the
-- whole tracking row in one call; if this column does not exist yet, that call is
-- rejected as a whole and the customer's tracking page stops updating for EVERY
-- order — not only the ones with a COD charge. Order matters here. (The same trap
-- courier_fee.sql set, and the reason that file says the same thing.)
--
-- TRUE means the customer hands the charge to the courier when the order reaches
-- them, so it is deliberately NOT inside the published total — otherwise the same
-- money is asked for twice, once by you and once by the courier. NULL means the
-- charge (if there is one) is paid with the order, and the card's courier line
-- reads exactly as it did before this column existed.

alter table order_tracking add column if not exists courier_cod boolean;
