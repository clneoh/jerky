-- Order tracking: carry the promo code on the order, and what it took off.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: each column is added only if missing.
--
-- RUN THIS BEFORE DEPLOYING THE BUILD THAT NAMES IT. The backoffice publishes the
-- whole tracking row in one call; if these columns do not exist yet, that call is
-- rejected as a whole and the customer's tracking page stops updating for EVERY
-- order — not only the ones that carried a code. Order matters here. (The same trap
-- courier_fee.sql and courier_cod.sql set, and the reason they say the same thing.)
--
-- promo_code is the code the customer typed, as the shop recorded it — upper-cased
-- and trimmed, the one spelling it is always matched by. NULL means no code.
--
-- promo_rm is the ringgit that code took off THIS order, worked out on the baker's
-- side from the code's own terms and the price each line was actually SOLD at. It is
-- published as an amount rather than left for the customer's card to work out,
-- because a code the baker has since deleted is no longer in the published code list
-- and the card would then be unable to price an order it is showing. NULL means
-- nothing came off, and the card leaves the line out rather than printing an empty
-- label.
--
-- The published total already has this amount taken out of it. The card adds it back
-- to work out the subtotal it prints above the total, which is why the two columns
-- must be written together.

alter table order_tracking add column if not exists promo_code text;
alter table order_tracking add column if not exists promo_rm numeric;
