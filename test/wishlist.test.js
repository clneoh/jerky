// test/wishlist.test.js — the software wish list on More: add / rename / remove /
// toggle, and the guarantee that it never touches the weekly routine's data.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { addWish, removeWish, renameWish, toggleWish, wishList } from "../admin/js/wishlist.js";

function state() {
  return {
    settings: {
      weekCheck: { week: "2026-09-06", done: { orders: true } },
      tasks: [{ id: "orders", label: "Reply to new orders" }],
    },
  };
}

test("wishList is empty until the first wish is added (nothing seeded in settings)", () => {
  const st = state();
  assert.deepEqual(wishList(st), []);
  assert.ok(!("wishList" in st.settings), "no wishList key before the baker ever edits it");
});

test("addWish appends a ticking wish; blank labels are rejected", () => {
  const st = state();
  assert.equal(addWish(st, ""), false);
  assert.equal(addWish(st, "   "), false);
  assert.equal(addWish(st, "Remind me when stock is low"), true);
  const list = wishList(st);
  assert.equal(list.length, 1);
  assert.ok(list[0].id.startsWith("wsh_"));
  assert.equal(list[0].label, "Remind me when stock is low");
  assert.equal(list[0].done, false);
});

test("toggleWish ticks an item and keeps that tick after leaving the screen (no weekly reset)", () => {
  const st = state();
  addWish(st, "Print labels from the phone");
  const id = wishList(st)[0].id;
  assert.equal(toggleWish(st, id), true);
  assert.equal(wishList(st)[0].done, true);
  assert.equal(toggleWish(st, id), true);
  assert.equal(wishList(st)[0].done, false, "toggling again untick");
  // The week never changes — this is not the weekly routine.
  assert.equal(st.settings.weekCheck.week, "2026-09-06");
});

test("renameWish edits the label and leaves the tick; unknown id is a no-op", () => {
  const st = state();
  addWish(st, "old idea");
  toggleWish(st, wishList(st)[0].id);
  const id = wishList(st)[0].id;
  assert.equal(renameWish(st, id, "renamed idea"), true);
  assert.equal(wishList(st)[0].label, "renamed idea");
  assert.equal(wishList(st)[0].done, true, "renaming keeps the tick");
  assert.equal(renameWish(st, "wsh_missing", "x"), false);
  assert.equal(renameWish(st, id, ""), false, "blank rename is rejected");
});

test("removeWish deletes one row and never revives it", () => {
  const st = state();
  addWish(st, "one");
  addWish(st, "two");
  const [a] = wishList(st);
  assert.equal(removeWish(st, a.id), true);
  assert.deepEqual(wishList(st).map((w) => w.label), ["two"]);
  assert.equal(removeWish(st, a.id), false, "already gone is a no-op");
});

test("wish list edits never touch weekCheck or the to-do tasks", () => {
  const st = state();
  addWish(st, "Auto-restock suggestion");
  toggleWish(st, wishList(st)[0].id);
  addWish(st, "A yearly recap screen");
  removeWish(st, wishList(st)[0].id); // removes the "Auto-restock" one
  assert.equal(st.settings.weekCheck.week, "2026-09-06", "week anchor unchanged");
  assert.deepEqual(st.settings.weekCheck.done, { orders: true }, "weekly ticks unchanged");
  assert.deepEqual(st.settings.tasks, [{ id: "orders", label: "Reply to new orders" }], "to-do tasks unchanged");
});
