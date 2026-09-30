// test/courier-run.test.js — one trip, several doorsteps (v191, 25 Sep 2026).
//
// The consolidation arithmetic, the load it carries, and the delivery WINDOW that a
// consolidated trip can honestly promise. Four things here can be wrong in a way that
// costs her money or a customer's patience, and each is pinned rather than trusted:
//
//   1. THE SPLIT MUST ADD UP. A run's fee is divided over the customers on it, and the
//      parts have to sum to the fee EXACTLY. Rounding each part on its own gives
//      RM14.00 over three orders as 4.67 three times — 14.01, a cent in her books and
//      in no customer's box.
//
//   2. ONE STOP PER CUSTOMER. A customer who bought three things in one order is ONE
//      doorstep. Counting lines instead of orders sends the same van to the same door
//      three times, and the courier charges a stop fee for each one.
//
//   3. THE WINDOW IS A PROMISE. It is published to customers through the day's own
//      words, so a window that reads wrongly ("11-2 pm" for eleven in the morning) or
//      one that ends before it starts must not be able to become published words.
//
//   4. THE SAVING IS A NUMBER, NOT A CLAIM. If the courier prices the run dearer than
//      the same stops one at a time, that has to come back NEGATIVE and be sayable,
//      not floored at zero — a screen that rounds a real loss up to "you saved RM0.00"
//      is a screen that talked her into it.
//
// Pure — no DOM, no fetch, no key.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  windowAt, windowParts, validWindow, windowProblem, fmtWindow, windowSuffix,
  loadOf, savingOf, runLimitProblem, stampTrip, tripCalledOff,
} = await import("../admin/js/courier_job.js");
const { splitEven, runChargeAmounts } = await import("../admin/js/courier.js");

// A state with a product list, so a line that carries no frozen name still resolves.
function stateWith(products = []) {
  return { settings: { currency: "RM" }, products, orders: [] };
}

// One customer's order: ONE group, however many lines it holds.
function group(lines) {
  return { code: lines[0].id, orders: lines };
}

// ── the delivery window ───────────────────────────────────────────────────

test("the two boxes pack into one value and come apart again", () => {
  assert.equal(windowAt("14:00", "17:00"), "14:00-17:00");
  assert.equal(windowAt("9:30", "11:00"), "09:30-11:00", "a single-digit hour is zero-padded in what is stored");
  assert.equal(windowAt("", "17:00"), "", "half a window is not a window");
  assert.equal(windowAt("14:00", ""), "");
  assert.equal(windowAt("25:00", "17:00"), "");
  assert.equal(windowAt("14:70", "17:00"), "");
  assert.equal(windowAt("2pm", "5pm"), "", "the app's own time boxes speak 24-hour, and a stray free-text hour is refused");

  assert.deepEqual(windowParts("14:00-17:00"), { from: "14:00", to: "17:00" });
  assert.deepEqual(windowParts("09:30-11:00"), { from: "09:30", to: "11:00" });
  assert.equal(windowParts(""), null);
  assert.equal(windowParts("2-5 pm"), null, "the words it PRINTS are not the value it stores");
  assert.equal(windowParts("14:00-"), null);
});

test("a window is only a window when it ends after it starts", () => {
  assert.equal(validWindow("14:00-17:00"), true);
  assert.equal(validWindow("14:00-14:30"), true);
  assert.equal(validWindow("17:00-14:00"), false, "an end before its start is not an earlier delivery, it is a mistake");
  assert.equal(validWindow("14:00-14:00"), false, "a zero-length window promises a van at one instant");
  assert.equal(validWindow(""), false, "no window is not a valid window — it is the day's promise, and the caller says which it holds");
  assert.equal(validWindow("nonsense"), false);
});

test("an empty window is not a problem, and a half-filled one is", () => {
  // "No window" is the promise the shop already makes — a day — so asking for a window
  // and getting nothing is not an error. This is the difference between a form that
  // helps and one that nags.
  assert.equal(windowProblem("", ""), "");
  assert.equal(windowProblem("14:00", "17:00"), "");
  assert.notEqual(windowProblem("14:00", ""), "", "one end filled is a promise with a hole in it");
  assert.notEqual(windowProblem("", "17:00"), "", "and so is the other end alone");
  assert.notEqual(windowProblem("2pm", "5pm"), "", "unreadable times are said, not silently dropped");
  assert.notEqual(windowProblem("17:00", "14:00"), "", "an end before its start is refused in words");
  assert.notEqual(windowProblem("14:00", "14:00"), "");
});

test("the window reads the way she would say it", () => {
  assert.equal(fmtWindow("14:00-17:00"), "2-5 pm");
  assert.equal(fmtWindow("09:00-11:00"), "9-11 am");
  // The repeated meridiem is dropped only when both ends share it. "11-2 pm" would read
  // as eleven at night, and a delivery promise is not the place to be terse.
  assert.equal(fmtWindow("11:00-14:00"), "11 am-2 pm");
  assert.equal(fmtWindow("12:00-15:00"), "12-3 pm", "noon is 12 pm, not 0 pm");
  assert.equal(fmtWindow("00:00-01:00"), "12-1 am", "and midnight is 12 am");
  assert.equal(fmtWindow("11:30-14:00"), "11:30 am-2 pm", "a half hour is kept only where it exists");
  assert.equal(fmtWindow("14:30-17:00"), "2:30-5 pm");
  assert.equal(fmtWindow(""), "");
  assert.equal(fmtWindow("rubbish"), "");
});

test("what a window adds to a day's own words, comma and all", () => {
  // The comma is inside the string so that the published card, the three WhatsApp
  // messages and the order's own line cannot each decide for themselves whether one
  // belongs there.
  assert.equal(windowSuffix({ deliveryWindow: "14:00-17:00" }), ", 2-5 pm");
  assert.equal(windowSuffix({ deliveryWindow: "17:00-14:00" }), "", "a window that could not be typed is not published either");
  assert.equal(windowSuffix({ deliveryWindow: "" }), "");
  assert.equal(windowSuffix({}), "");
  assert.equal(windowSuffix(null), "");
});

// ── what the run carries ──────────────────────────────────────────────────

test("a customer is ONE stop however many lines they ordered", () => {
  // The fault this pins: a three-line order counted per line is three stops at one
  // door, and the courier charges a stop fee for each. She would be paying three times
  // to send one van to one house.
  const s = stateWith();
  const load = loadOf(s, [
    group([
      { id: "o1", productName: "Focaccia", qty: 3 },
      { id: "o1", productName: "Focaccia Set", qty: 1 },
      { id: "o1", productName: "Focaccia", qty: 2 },
    ]),
  ]);
  assert.equal(load.stops, 1, "one customer, one doorstep");
  assert.equal(load.items, 6, "and every line still counts");
});

test("the load counts stops and items over the whole run, and names them", () => {
  const s = stateWith();
  const load = loadOf(s, [
    group([{ id: "o1", productName: "Focaccia", qty: 3 }]),
    group([{ id: "o2", productName: "Focaccia", qty: 4 }, { id: "o2", productName: "Focaccia Set", qty: 2 }]),
  ]);
  assert.equal(load.stops, 2);
  assert.equal(load.items, 9);
  assert.equal(load.summary, "Focaccia ×7  ·  Focaccia Set ×2", "named in the app's own house style, name then qty");
});

test("a line with no frozen name still resolves, and a gone product is an 'item'", () => {
  const s = stateWith([
    { id: "p1", name: "Focaccia" },
  ]);
  assert.equal(loadOf(s, [group([{ id: "o1", productId: "p1", qty: 2 }])]).summary, "Focaccia ×2");
  // The placeholder is folded to "item", the same reading the customer's own card makes
  // of it — the app does not grow a third way of naming a deleted product.
  assert.equal(loadOf(s, [group([{ id: "o1", productId: "gone", qty: 2 }])]).summary, "item ×2");
});

test("a missing or unreadable quantity counts as nothing rather than as NaN", () => {
  // `Number(null)` is 0 and `Number("")` is 0, but `Number("two")` is NaN — and a NaN
  // added into the item count would print "NaN items" beside a real run.
  const s = stateWith();
  const load = loadOf(s, [
    group([
      { id: "o1", productName: "Focaccia", qty: 3 },
      { id: "o1", productName: "Focaccia", qty: null },
      { id: "o1", productName: "Focaccia", qty: "two" },
    ]),
  ]);
  assert.equal(load.items, 3);
  assert.equal(load.stops, 1);
});

test("an empty run is nothing, not an error", () => {
  assert.deepEqual(loadOf(stateWith(), []), { stops: 0, items: 0, summary: "" });
  assert.deepEqual(loadOf(stateWith(), null), { stops: 0, items: 0, summary: "" });
});

test("a very mixed run stays one line rather than spilling down the screen", () => {
  const s = stateWith();
  const names = ["A", "B", "C", "D", "E", "F"];
  const load = loadOf(s, names.map((n, i) => group([{ id: `o${i}`, productName: n, qty: 1 }])));
  assert.equal(load.stops, 6);
  assert.equal(load.summary, "A ×1  ·  B ×1  ·  C ×1  ·  D ×1  ·  and 2 more");
});

// ── the money ─────────────────────────────────────────────────────────────

test("one trip against the same stops priced one at a time", () => {
  const out = savingOf(22, [8.5, 8.5, 8.5]);
  assert.deepEqual(out, { one: 22, sum: 25.5, saving: 3.5 });
});

test("a run that costs MORE comes back negative rather than as no saving", () => {
  // A thing that really happens: a small run on a big vehicle. Rounding this up to zero
  // would turn an argument against consolidating into one for it.
  const out = savingOf(30, [8.5, 8.5]);
  assert.equal(out.saving, -13);
  assert.ok(out.saving < 0, "a negative saving must survive the arithmetic so the screen can say it");
});

test("the saving is not invented from a missing price", () => {
  assert.equal(savingOf(22, []), null, "nothing priced separately is not a zero-sized saving");
  assert.equal(savingOf(22, null), null);
  assert.equal(savingOf(null, [8.5]), null);
  assert.equal(savingOf("", [8.5]), null);
  assert.equal(savingOf(22, [8.5, null]), null, "one unreadable price makes the whole sum a guess");
  assert.equal(savingOf(22, [8.5, "rubbish"]), null);
});

test("cents survive the sum — floating point must not decide what she saved", () => {
  // 0.1 + 0.2 is famously 0.30000000000000004. Three prices that each end in a half
  // cent would otherwise put a phantom fraction on a screen about money.
  const out = savingOf(10, [3.33, 3.33, 3.34]);
  assert.equal(out.sum, 10);
  assert.equal(out.saving, 0);
});

// ── the split ─────────────────────────────────────────────────────────────

test("the split adds up to the fee EXACTLY, and the odd cents are on the last order", () => {
  const parts = splitEven(14, 3);
  assert.deepEqual(parts, [4.66, 4.66, 4.68], "not 4.67 three times, which is 14.01");
  assert.equal(parts.reduce((a, b) => a + b, 0), 14, "the parts are the whole, by construction");
});

test("every share is a whole number of cents, whatever the fee and the count", () => {
  // Walked rather than spot-checked, because the fault this guards is a rounding rule
  // that works for RM14 over three orders and not for the next one.
  for (const total of [0.01, 0.05, 8.5, 14, 22, 99.99, 100]) {
    for (let n = 1; n <= 9; n++) {
      const parts = splitEven(total, n);
      assert.equal(parts.length, n);
      const cents = parts.map((p) => Math.round(p * 100));
      assert.equal(cents.reduce((a, b) => a + b, 0), Math.round(total * 100), `${total} over ${n} must add up`);
      for (const c of cents) assert.equal(c, Math.round(c), `${total}/${n}: every share is whole cents`);
    }
  }
});

test("splitting over nothing is nothing to do, not an error", () => {
  assert.deepEqual(splitEven(14, 0), []);
  assert.deepEqual(splitEven(14, -1), []);
  assert.deepEqual(splitEven(14, null), []);
  assert.deepEqual(splitEven(null, 3), [0, 0, 0], "a zero fee splits into zero shares, which write no charge at all");
});

test("one order on a run bears the whole fee", () => {
  assert.deepEqual(splitEven(14, 1), [14]);
});

// ── which amounts each order carries, decided by who bears it ─────────────
//
// Her rule, in her words: "the benefit of consolidated charges, should go to merchant, not
// the customer. And if the courier charges were reveal to them, it will shown as the
// original cost." A customer-borne charge is therefore each customer's OWN doorstep cost,
// taken verbatim from what the courier quoted for that doorstep alone — never the one-trip
// fee and never a share of it. The one-trip fee is apportioned only when SHE bears it, and
// then it is a number about her own books.

test("a customer bears their own doorstep's cost, taken exactly as the courier quoted it", () => {
  const originals = [13.5, 9.25, 7];
  assert.deepEqual(runChargeAmounts("customer", 22, originals, 3), originals,
    "the originals verbatim — not the 22 one trip costs her, and not 22 over three");
});

test("the originals are judged on the CUSTOMER's behalf, so a wrong length is no charge", () => {
  // Half a list of prices is not a smaller truth, it is a guess: a customer charged a figure
  // nobody asked the courier for is worse than a customer charged nothing at all. So a list
  // that does not match the run is refused as a whole rather than padded, truncated or
  // filled in from the fee — and `[]` is what writeCourierCharge reads as "no charge".
  assert.deepEqual(runChargeAmounts("customer", 22, [13.5, 9.25], 3), [], "one short");
  assert.deepEqual(runChargeAmounts("customer", 22, [13.5, 9.25, 7, 4], 3), [], "one too many");
  assert.deepEqual(runChargeAmounts("customer", 22, [], 2), [], "nothing asked for at all");
  assert.deepEqual(runChargeAmounts("customer", 22, null, 2), [], "and no list is the same as none");
});

test("a charge SHE bears is the trip's fee apportioned, and it sums to the fee", () => {
  assert.deepEqual(runChargeAmounts("me", 22, [], 2), [11, 11]);
  const three = runChargeAmounts("me", 22, [], 3);
  assert.deepEqual(three, [7.33, 7.33, 7.34], "worked in cents, the odd cent last");
  assert.equal(Math.round(three.reduce((a, b) => a + b, 0) * 100) / 100, 22,
    "the parts are the whole, which is what makes the books reconcile");
  // The originals are irrelevant here — when she bears it there is nothing of the
  // customers' own costs to use, and a stale list must not leak into the arithmetic.
  assert.deepEqual(runChargeAmounts("me", 22, [13.5, 13.5], 2), [11, 11]);
});

test("no payer means no charge, and no orders means nothing to do", () => {
  // An unanswered payer is an unassigned charge, and the v127 rule is that the three keys
  // travel together — so nothing is chosen here for anyone to write.
  assert.deepEqual(runChargeAmounts("", 22, [13.5, 13.5], 2), []);
  assert.deepEqual(runChargeAmounts(null, 22, [13.5, 13.5], 2), []);
  assert.deepEqual(runChargeAmounts("customer", 22, [13.5], 0), [], "a run with nobody on it");
  assert.deepEqual(runChargeAmounts("me", 22, [], 0), []);
});

// ── the trip stamped onto every customer ──────────────────────────────────

test("a booked run puts the same trip on every order it carries", () => {
  const first = [{ id: "o1" }, { id: "o1b" }];
  const second = [{ id: "o2" }];
  const job = { jobId: "LLM-1", link: "https://lalamove.com/t/abc", status: "ASSIGNING_DRIVER" };
  stampTrip(first, job, "Lalamove");
  stampTrip(second, job, "Lalamove");
  for (const o of [...first, ...second]) {
    assert.equal(o.courierJob.jobId, "LLM-1");
  }
  assert.equal(first[0].courierJob, first[1].courierJob, "and it is one trip, not a copy each");
});

test("the trip's ONE link never reaches a customer on a run of several doorsteps (v218)", () => {
  // Her report: "the courier link ... when the customer track it, they become aware of the
  // other drop off point". One link covers the whole trip, so a run carrying several
  // doorsteps must not hand it to any of them. Default-off: a caller that says nothing
  // shares nothing, which is the only failure direction that cannot leak.
  const rows = [{ id: "o1" }, { id: "o2" }];
  stampTrip(rows, { jobId: "LLM-9", link: "https://lalamove.com/t/whole-trip" }, "Lalamove");
  for (const o of rows) {
    assert.equal(o.trackingNo, undefined, "no link on the customer's order");
    assert.equal(o.courierJob.jobId, "LLM-9", "but the trip itself is still recorded, so the card can still say where it is");
  }
});

test("a trip that carries one doorstep alone still hands its link over (v218)", () => {
  // The carve-out she chose: a single-customer trip is the bakery to their door and
  // nothing else, so its link reveals no third party, and live tracking is worth having.
  const rows = [{ id: "o1" }];
  stampTrip(rows, { jobId: "LLM-10", link: "https://lalamove.com/t/solo" }, "Lalamove", { alone: true });
  assert.equal(rows[0].trackingNo, "https://lalamove.com/t/solo", "the only customer on the trip gets the link");
});

test("a courier with no link must never blank a number she typed by hand", () => {
  // The rule worth having in exactly one place. An empty link is the courier telling us
  // nothing, not the courier telling us the customer has no reference.
  const rows = [{ id: "o1", trackingNo: "LLM-TYPED-BY-HAND" }];
  stampTrip(rows, { jobId: "LLM-2", link: "" }, "Lalamove");
  assert.equal(rows[0].trackingNo, "LLM-TYPED-BY-HAND");
  assert.equal(rows[0].courierJob.jobId, "LLM-2", "the trip itself is still recorded");
});

test("a run's withheld link must not blank a number she typed by hand either (v218)", () => {
  // The same rule from the other side, and the one v218 could most easily break: the
  // courier DID send a link, the app is choosing not to publish it, and her own typed
  // reference must still be sitting there afterwards.
  const rows = [{ id: "o1", trackingNo: "LLM-TYPED-BY-HAND" }];
  stampTrip(rows, { jobId: "LLM-11", link: "https://lalamove.com/t/whole-trip" }, "Lalamove");
  assert.equal(rows[0].trackingNo, "LLM-TYPED-BY-HAND", "her reference is hers, not the courier's to replace");
  assert.equal(rows[0].courierJob.jobId, "LLM-11");
});

test("the trip carries the courier's own name, from the provider's label", () => {
  const rows = [{ id: "o1" }];
  const named = stampTrip(rows, { jobId: "LLM-3", courierName: "Whatever" }, "Lalamove");
  assert.equal(named.courierName, "Lalamove", "the label passed in wins");
  assert.equal(rows[0].courierJob.courierName, "Lalamove");
  // And with no label to pass, whatever the job already said is kept rather than erased.
  const kept = stampTrip([{ id: "o2" }], { jobId: "LLM-4", courierName: "Kept" }, "");
  assert.equal(kept.courierName, "Kept");
});

test("the trip is stamped on the rows it is handed and nothing else", () => {
  const rows = [{ id: "o1" }, null, undefined];
  stampTrip(rows, { jobId: "LLM-5" }, "Lalamove");
  assert.equal(rows[0].courierJob.jobId, "LLM-5");
  assert.equal(rows[1], null, "a null in the list is skipped, not turned into an object");
});

// ── a trip she called off, as a record (v242) ─────────────────────────────
//
// It lives here rather than in the delivery run's own file because TWO screens can call a
// trip off — the order's card and the run — and this is the one place both of them write
// through. A record only one screen knew how to write is a trip the other still believes
// is running, which is a second van at a door.

test("calling a trip off finishes it and stamps the moment, in one record (v242)", () => {
  const job = {
    jobId: "LLM-SOLO-1", provider: "lalamove", courierName: "Lalamove",
    status: "ON_GOING", link: "https://lalamove.com/t/solo",
  };
  const off = tripCalledOff(job, "2026-09-30T04:00:00.000Z");

  assert.equal(off.done, true, "finished — which is what `liveJobOf` reads to stop believing it");
  assert.equal(off.cancelledAt, "2026-09-30T04:00:00.000Z", "and when, so a card can say how long ago");
  assert.equal(off.jobId, "LLM-SOLO-1", "it is still the SAME trip, so what it was is not lost");
  assert.equal(off.status, "ON_GOING");
});

test("calling a trip off invents no status word the courier never sent (v242)", () => {
  // A DELETE answers with nothing at all, so the courier has no word for what became of the
  // trip. Writing "CANCELLED" here would be this app putting words in its mouth — and it
  // would be a word that made it onto the customer's own card.
  const off = tripCalledOff({ jobId: "LLM-2", status: "ASSIGNING_DRIVER" }, "2026-09-30T04:00:00.000Z");
  assert.equal(off.status, "ASSIGNING_DRIVER", "the last thing the courier really said is what is kept");
  assert.equal("CANCELLED" in off, false);
});

test("calling a trip off never touches the record it was handed (v242)", () => {
  // The order's row and the app's own state both hold the same object. A helper that edited
  // it in place would rewrite every order on the trip before the write-back had been decided.
  const job = { jobId: "LLM-3", status: "ON_GOING" };
  const off = tripCalledOff(job, "2026-09-30T04:00:00.000Z");
  assert.notEqual(off, job, "a new record, not the same one");
  assert.equal(job.done, undefined, "and the original is exactly as it was");
  assert.equal("cancelledAt" in job, false);
});

test("calling off a trip that is not there answers with nothing, rather than throwing (v242)", () => {
  assert.equal(tripCalledOff(null, "2026-09-30T04:00:00.000Z"), null);
  assert.equal(tripCalledOff(undefined), undefined);
});

test("a called-off trip is not live, so that customer can go on a run again (v242)", async () => {
  // The two halves joined up, through the app's own predicate rather than a re-reading of
  // `done`: what the delivery run believes about an order is what this record makes it believe.
  const { liveJobOf } = await import("../admin/js/courier_job.js");
  const order = { id: "o1", courierJob: { jobId: "LLM-4", status: "ON_GOING" } };
  assert.ok(liveJobOf(order), "before the call-off the trip is running");
  order.courierJob = tripCalledOff(order.courierJob, "2026-09-30T04:00:00.000Z");
  assert.equal(liveJobOf(order), null, "and after it, the order is free again");
});

// ── the courier's own limit, warned about rather than enforced ────────────

test("a trip over the courier's documented 16 stops is warned about, never blocked", () => {
  // Lalamove's documents disagree with each other — the API says 16, the consumer app
  // advertises 20 — so the lower number is the one that could refuse her. It is SAID and
  // not enforced: the courier has the last word, and a screen that blocks a booking the
  // courier would have taken is the app inventing a rule. Her standing instruction is
  // guide, never a gate.
  assert.equal(runLimitProblem(16), "");
  assert.equal(runLimitProblem(2), "");
  assert.equal(runLimitProblem(0), "");
  assert.notEqual(runLimitProblem(17), "");
  assert.match(runLimitProblem(18), /18/, "the count is in the sentence, so it is about HER run and not about a rule");
});
