-- Look at the incoming-order queue. ⚠️⚠️ THIS FILE NO LONGER DELETES ANYTHING (v585).
--
-- What it was: a one-time cleanup, run right after the fixed backoffice app was deployed, because the old app
-- could import the same customer order again and again. It emptied the queue of rows older than an hour.
--
-- ⚠️⚠️ WHY THE DELETE IS GONE. ⚠️ That queue is **the only copy of an order until a phone imports it**, and a
-- delete run "just once" again is a delete that cannot be undone. ⚠️ **If both phones are off overnight — or
-- for a long weekend — the queue holds real orders, and running this file deleted them.** ⭐ "Run once" was a
-- comment, not a guard.
--
-- ⭐ What to do instead:
--   · The fixed app imports each row ONCE and deletes it itself, so leftovers are rare.
--   · A row it cannot read is shown in the app under Orders ("orders from the shop are waiting"), with the
--     reason. Fix the reason (usually a product it does not know) and the order comes in on its own.
--   · If rows still look wrong, look at them below and tell me what you see. Nothing here is changed by
--     running this file, so it is safe to run any number of times.

select
  id,
  created_at,
  -- How old it is, in words she can read at a glance.
  now() - created_at as waiting_for,
  status,
  -- The first part of the payload: enough to recognise the order without printing a whole address on screen.
  left(data, 90) as starts
from incoming_orders
order by created_at asc;

-- ⚠️ AND IF A ROW REALLY MUST GO, IT IS DELETED BY ITS OWN id — one order, one decision, never a sweep.
-- Copy the id from the list above and run this ONE line for that ONE row:
--
--   delete from incoming_orders where id = 'PASTE-THE-ID-HERE';
