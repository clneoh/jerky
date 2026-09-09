// test/product-state.test.js — a product's three states (Engine v66):
// On the shop (live), Draft (still being built, not yet for sale) and Hidden
// (taken down). Pure module, no DOM.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import { isLive, isDraft, isHidden, stateOf, newDraftRow } from "../admin/js/productState.js";

test("a product with neither flag is live — the historical default", () => {
  assert.equal(isLive({ name: "Focaccia" }), true);
  assert.equal(isLive({ name: "Focaccia", active: true }), true);
  assert.equal(isLive({}), true);
});

test("a draft is draft:true and never live or hidden", () => {
  const d = { active: false, draft: true };
  assert.equal(isDraft(d), true);
  assert.equal(isLive(d), false);
  assert.equal(isHidden(d), false);
});

test("a hidden product is active:false without a draft flag", () => {
  const h = { active: false };
  assert.equal(isHidden(h), true);
  assert.equal(isLive(h), false);
  assert.equal(isDraft(h), false);
});

test("stateOf names each state, and missing rows read hidden", () => {
  assert.equal(stateOf({ name: "Focaccia" }), "live");
  assert.equal(stateOf({ active: true }), "live");
  assert.equal(stateOf({ active: false, draft: true }), "draft");
  assert.equal(stateOf({ active: false }), "hidden");
  assert.equal(stateOf(null), "hidden");
  assert.equal(stateOf(undefined), "hidden");
});

test("a corrupted hand-set draft (active:true + draft:true) still reads as a draft, never live", () => {
  const bad = { active: true, draft: true };
  assert.equal(isDraft(bad), true, "the draft flag wins so a half-published draft can never sell");
  assert.equal(isLive(bad), false);
  assert.equal(isHidden(bad), false);
  assert.equal(stateOf(bad), "draft");
});

test("newDraftRow is the shape every brand-new product starts as", () => {
  assert.deepEqual(newDraftRow(), { active: false, draft: true });
  assert.notEqual(newDraftRow(), newDraftRow(), "a fresh object each call, so two adds never share one row");
});
