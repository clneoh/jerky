-- Order tracking: add the stage flags.
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → Run).
-- Safe to re-run: columns are added only if missing.
--
-- The customer's track page shows the same journey map as the backoffice app.
-- That map turns Confirmed green only once the baker pressed "Send confirmation"
-- and Paid green only once they pressed the "Paid" button — the status alone is
-- not enough. So the published row now carries those two flags.
--
-- Existing rows have no flags yet, and NULL reads as "already handled", which is
-- correct: their confirmation / payment really did go through. Newer rows store
-- false while that stage is waiting on the baker.

alter table order_tracking add column if not exists confirmed_sent boolean;
alter table order_tracking add column if not exists paid_received boolean;
