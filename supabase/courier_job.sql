-- Order tracking: add the booked trip — who is carrying the parcel, where it has got to,
-- and who is driving.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: each column is added only if missing.
--
-- RUN THIS BEFORE DEPLOYING THE BUILD THAT NAMES IT. The backoffice publishes the whole
-- tracking row in ONE call, and PostgREST rejects the whole call if it names a column that
-- is not there. The publish is deliberately silent about its own failures, so the failure
-- would not look like a failure: every customer's tracking page would simply stop
-- updating, for every order, with nothing on any screen saying why. Order matters here.
--
-- All five are NULL on an order the app knows nothing about, and the customer's card
-- leaves each line out entirely rather than printing an empty label.
--
--   courier_name    the carrier holding a PARCEL, e.g. "J&T Express" (v226). Published
--                   only for a parcel — a booked trip reaches the customer through the
--                   driver line instead, and its own name is deliberately not published,
--                   so a trip whose status this build has no phase for can never gain a
--                   carrier line it never had. The name is the one frozen onto the order
--                   when she recorded the parcel, so renaming or deleting a carrier in
--                   her own list never rewrites what a customer was told.
--   courier_phase   ONE of a handful of neutral words — finding, on_the_way, collected,
--                   delivered, stopped, nodriver — never the courier's own status string.
--                   The storefront carries its own words for these in all three
--                   languages, so it stays ignorant of who is carrying the box.
--   courier_driver  the driver's name, once the courier has matched one.
--   courier_plate   the vehicle's plate number.
--   courier_phone   a number the customer can ring. Published on purpose: on a courier
--                   order the person at the door is a stranger the customer has to meet,
--                   and one who cannot find the gate has no other way to be reached.
--
-- The order's own row in the app carries more than this (the trip's id, the quotation it
-- was booked at, the fee, the customer's share link). None of that is the customer's, and
-- none of it is published: the share link rides in the tracking slot the card already had.

alter table order_tracking add column if not exists courier_name text;
alter table order_tracking add column if not exists courier_phase text;
alter table order_tracking add column if not exists courier_driver text;
alter table order_tracking add column if not exists courier_plate text;
alter table order_tracking add column if not exists courier_phone text;
