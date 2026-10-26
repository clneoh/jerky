// test/nudge.test.js — the quiet nudge (P4 of the customer plan).
//
// ⭐ WHO GETS IT, AND WHO MUST NEVER: bought before · quiet for eight weeks · no order for an upcoming day ·
// has a number · **and never a person whose details were deleted at their own request**.
// ⭐ WHAT IT SAYS: the bake day and the cut-off, read from her settings — ⚠️ **no discount, no "special", no
// announcement**, which is her standing rule and the difference between a nudge and a campaign.

import { test } from "node:test";
import assert from "node:assert/strict";

import { quietCustomers, nudgeText, clockWords, nudgeCfg, QUIET_DAYS } from "../admin/js/nudge.js";

const d = (n) => {
  const dt = new Date(2026, 9, 25);
  dt.setDate(dt.getDate() - n);
  const p = (x) => String(x).padStart(2, "0");
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
};
const order = (o) => ({
  id: `o${Math.random().toString(16).slice(2)}`, qty: 1,
  orderDate: d(70), deliveryDate: d(70), customerName: "A", whatsapp: "60111111111", ...o,
});
const book = (orders) => ({ orders, settings: { cutoff: "18:00", defaultCapacity: 12 } });
const TODAY = "2026-10-25";

test("★★★ quiet means quiet: bought before, and nothing for eight weeks (v646)", () => {
  const st = book([
    order({ customerName: "Quiet", whatsapp: "60111111111", orderDate: d(70), deliveryDate: d(70) }),
    order({ customerName: "Recent", whatsapp: "60222222222", orderDate: d(10), deliveryDate: d(10) }),
  ]);
  const out = quietCustomers(st, { today: TODAY });
  assert.deepEqual(out.map((r) => r.name), ["Quiet"]);
  assert.equal(QUIET_DAYS, 56);
});

test("★★★ NEVER someone who asked to be forgotten (v646)", () => {
  const st = book([
    order({ customerName: "Forgotten", whatsapp: "60111111111", redactedKey: "60111111111", orderDate: d(70), deliveryDate: d(70) }),
  ]);
  assert.deepEqual(quietCustomers(st, { today: TODAY }), [],
    "★ a person whose details were deleted at their request was lined up for a message");
});

test("★★★ NEVER someone already coming (v646)", () => {
  const st = book([
    order({ customerName: "Coming", whatsapp: "60111111111", orderDate: d(70), deliveryDate: d(70) }),
    order({ customerName: "Coming", whatsapp: "60111111111", orderDate: d(2), deliveryDate: "2026-10-28" }),
  ]);
  assert.deepEqual(quietCustomers(st, { today: TODAY }), [],
    "★ a customer with an order for an upcoming bake day was nudged that a bake day exists");
});

test("★★ someone with no number, or no order, is not on the list (v646)", () => {
  const st = book([
    order({ customerName: "No number", whatsapp: "", orderDate: d(70), deliveryDate: d(70) }),
    order({ customerName: "No date", whatsapp: "60333333333", orderDate: "", deliveryDate: "" }),
  ]);
  assert.deepEqual(quietCustomers(st, { today: TODAY }), []);
});

test("★★ the longest-quiet come first, with how long it has been (v646)", () => {
  const st = book([
    order({ customerName: "Six months", whatsapp: "60111111111", orderDate: d(180), deliveryDate: d(180) }),
    order({ customerName: "Ten weeks", whatsapp: "60222222222", orderDate: d(70), deliveryDate: d(70) }),
  ]);
  const out = quietCustomers(st, { today: TODAY });
  assert.deepEqual(out.map((r) => r.name), ["Six months", "Ten weeks"]);
  assert.equal(out[1].days, 70);
});

test("★★★ the words are the week and the deadline — never a discount (v646)", () => {
  const text = nudgeText({ dayText: "Monday, 26 Oct", cutoff: "18:00" });
  assert.match(text, /Monday, 26 Oct/);
  assert.match(text, /order by 6pm the day before/);
  assert.match(text, /munchies\.com\.my\/store\//);
  for (const banned of ["discount", "promo", "offer", "special", "last chance", "sale", "free", "announce"]) {
    assert.ok(!new RegExp(banned, "i").test(text), `★ the nudge says "${banned}" — that is a campaign, not a nudge`);
  }
  // ⚠️ and with no cut-off stated it does not invent one
  assert.match(nudgeText({ dayText: "Monday, 26 Oct", cutoff: "" }), /order the day before/);
  assert.equal(nudgeText({ dayText: "" }), "", "no day, no message — an empty nudge is not sent");
});

test("★★ a time reads the way she writes it (v646)", () => {
  assert.equal(clockWords("18:00"), "6pm");
  assert.equal(clockWords("06:30"), "6.30am");
  assert.equal(clockWords("12:00"), "12pm");
  assert.equal(clockWords("by 6pm"), "by 6pm", "words she typed are left alone");
});

test("★★★ the criteria are hers, clamped, and travel with her settings (v647)", () => {
  const st = book([
    order({ customerName: "Once", whatsapp: "60111111111", orderDate: d(70), deliveryDate: d(70) }),
    order({ customerName: "Twice", whatsapp: "60222222222", orderDate: d(70), deliveryDate: d(70) }),
    order({ customerName: "Twice", whatsapp: "60222222222", orderDate: d(80), deliveryDate: d(80) }),
  ]);
  // ⚠️ both last ordered on the same day, so the order is the list's own stable tie — what matters is that BOTH
  // are here under "at least one order" and only one survives under "at least two".
  assert.deepEqual(quietCustomers(st, { today: TODAY }).map((r) => r.name).sort(), ["Once", "Twice"],
    "the default asks for at least one order");
  st.settings.nudge = { weeks: 8, minOrders: 2 };
  assert.deepEqual(quietCustomers(st, { today: TODAY }).map((r) => r.name), ["Twice"],
    "★ 'at least two orders' did not narrow the list");
  st.settings.nudge = { weeks: 30, minOrders: 1 };
  assert.equal(quietCustomers(st, { today: TODAY }).length, 0,
    "★ a 30-week quiet stretch still listed people who ordered ten weeks ago");
  // ⚠️ clamped: nonsense is pulled back into a range that means something
  st.settings.nudge = { weeks: 0, minOrders: 0 };
  const cfg = nudgeCfg(st);
  assert.equal(cfg.weeks, 2, "★ a nudge every week is not a nudge");
  assert.equal(cfg.minOrders, 1, "★ 'at least zero orders' would message people who never bought");
});

test("★★★ the sentence is hers too — tokens are filled, her own words are sent as typed (v647)", () => {
  const filled = nudgeText({ dayText: "Monday, 26 Oct", cutoff: "18:00", template: "Baking {day}. Order by {by} — {link}" });
  assert.equal(filled, "Baking Monday, 26 Oct. Order by 6pm — https://munchies.com.my/store/");
  const own = nudgeText({ dayText: "Monday, 26 Oct", cutoff: "18:00", template: "We are back this week — same as always." });
  assert.equal(own, "We are back this week — same as always.",
    "★ her sentence was rewritten by a template she did not use");
  // and with no template at all, the shop's own default sentence is used
  assert.match(nudgeText({ dayText: "Monday, 26 Oct", cutoff: "18:00" }), /^we're baking on Monday, 26 Oct/);
});
