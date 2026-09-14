// test/order-move.test.js — moveOrderGroup (admin/js/state.js): the pure helper
// behind "move an order to another delivery day". A move rewrites EVERY row of
// the group so the live pointer (deliveryDateId) and the ISO snapshot
// (deliveryDate) stay in step — including a group whose rows were somehow split
// across dates, which a per-row patch would leave half-moved.

import { test } from "node:test";
import assert from "node:assert/strict";
import { moveOrderGroup } from "../admin/js/state.js";

const dest = { id: "dd_sat", date: "2026-09-19" };

test("moveOrderGroup re-points every row of a multi-item group", () => {
  const o1 = { id: "ord_1", groupId: "g1", deliveryDateId: "dd_fri", deliveryDate: "2026-09-18" };
  const o2 = { id: "ord_2", groupId: "g1", deliveryDateId: "dd_fri", deliveryDate: "2026-09-18" };
  const group = { orders: [o1, o2] };
  const moved = moveOrderGroup(group, dest);
  assert.deepEqual(moved, [o1, o2]);
  for (const o of [o1, o2]) {
    assert.equal(o.deliveryDateId, "dd_sat");
    assert.equal(o.deliveryDate, "2026-09-19");
  }
});

test("moveOrderGroup moves a single-item order (no groupId)", () => {
  const o = { id: "ord_1", deliveryDateId: "dd_fri", deliveryDate: "2026-09-18" };
  moveOrderGroup({ orders: [o] }, dest);
  assert.equal(o.deliveryDateId, "dd_sat");
  assert.equal(o.deliveryDate, "2026-09-19");
});

test("moveOrderGroup unifies a group whose rows were split across dates", () => {
  const a = { id: "ord_1", deliveryDateId: "dd_fri", deliveryDate: "2026-09-18" };
  const b = { id: "ord_2", deliveryDateId: "dd_sun", deliveryDate: "2026-09-20" };
  moveOrderGroup({ orders: [a, b] }, dest);
  assert.equal(a.deliveryDateId, "dd_sat");
  assert.equal(b.deliveryDateId, "dd_sat");
  assert.equal(a.deliveryDate, "2026-09-19");
  assert.equal(b.deliveryDate, "2026-09-19");
});

test("moveOrderGroup accepts a bare group (no .orders) and never crashes on junk", () => {
  const o = { id: "ord_1", deliveryDateId: "dd_fri", deliveryDate: "2026-09-18" };
  moveOrderGroup({ orders: [o] }, dest);
  assert.equal(o.deliveryDateId, "dd_sat");

  assert.deepEqual(moveOrderGroup(null, dest), []);
  assert.deepEqual(moveOrderGroup({ orders: [o] }, null), []);
  assert.deepEqual(moveOrderGroup({ orders: [o] }, { id: "" }), [], "a destination with no id moves nothing");
  // A null row inside the group is skipped, not thrown on.
  const only = { id: "ord_2", deliveryDateId: "dd_fri" };
  const moved = moveOrderGroup({ orders: [null, only] }, dest);
  assert.deepEqual(moved, [only]);
  assert.equal(only.deliveryDateId, "dd_sat");
});

test("moveOrderGroup does not mutate the destination record", () => {
  const before = JSON.stringify(dest);
  moveOrderGroup({ orders: [{ id: "o", deliveryDateId: "dd_fri" }] }, dest);
  assert.equal(JSON.stringify(dest), before);
});
