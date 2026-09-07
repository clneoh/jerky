-- Empty the incoming-order queue.
-- Run this ONCE, right after redeploying the fixed backoffice app.
--
-- Why: the old app imported storefront orders every 30 seconds and the
-- "mark as imported" step could silently fail, so the same order came back as
-- a "new" duplicate again and again. Rows that were never cleared are still
-- sitting in this queue. The fixed app imports each row exactly once — but any
-- leftover rows would still show up one more time. This clears them.
--
-- Safe to re-run (deleting from an empty table does nothing).
-- Careful: only run it when you've already seen every order you want. A brand
-- new order a customer places right now is also in this table and would be
-- deleted too. So: redeploy → clear the queue → then let new orders flow in.

delete from incoming_orders;
