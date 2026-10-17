// admin/js/health.js — the app's own checks on HER data (v446).
//
// WHY THIS EXISTS. Her question, and she says she always asks it:
//
//   __"is the system robust enough in many ways. What measure, what test, we can do to effectively
//   measure it?"__
//
// ⚠️⚠️ AND ON 11 OCT 2026 HER APP HAD 3,335 PASSING TESTS WHILE THREE PAID ORDERS WERE MISSING. Those
// tests check **what the code does**, and everything they were pointed at worked correctly. **Her loss
// was a fact about her DATA, and nothing in this app had ever looked at her data.** ⭐ So "the tests pass"
// is not a measure of robustness, and this module is the other kind: it reads what she actually has.
//
// ⭐ ROBUSTNESS HAS TWO HALVES — DETECTION AND RECOVERY. v444 gave her RECOVERY (a removed order is kept
// and can be put back). **This is detection**, and it was the missing half.
//
// ⚠️⚠️ THE RULE THIS MODULE IS BUILT ON, AND IT IS THE REGISTER'S OWN OLDEST RULE: **a check that could
// not run must NEVER report as a pass.** Every result is `pass`, `fail` or **`skipped`** — and a skipped
// check says why. A verdict that counted "I could not look" as "it is fine" would be worse than no verdict
// at all, because she would stop looking. ([[feedback-repeat-bug-reports]] in a new dress.)
//
// ⚠️ AND IT NEVER NAMES A CAUSE. It reports what it found and what it means. What removed an order is not
// knowable from the data that is left — which is the whole reason v444 keeps a copy of it.

import { byId, codeFromId, groupOrders, orderCode, orderLinePrice } from "./state.js";
import { isCollected } from "./money.js";
import { receiptNoOfGroup } from "./receipts.js";
import { listFields } from "./sync.js";

// The order-level facts every row of ONE order must agree on. ⚠️ DELIBERATELY NOT THE PER-LINE ONES —
// `qty`, `unitPrice`, `unitCost` and `lineNote` are each row's own business, and a check that flagged
// them would cry wolf on every ordinary multi-item order.
const ORDER_LEVEL = [
  "status", "paidReceived", "paidMethod", "customerName", "whatsapp", "fulfillment", "address",
  "pointId", "note", "trackingNo", "courierDay", "deliveryWindow", "pickupTime", "orderDate",
  "groupId", "receiptNo", "promo", "referredBy",
];

// ⚠️ EVERY CHECK REPORTS A MEANING, NOT A COUNT. "3 rows disagree" is a number she cannot act on; the
// `why` says what it is and the `fix` says what she can do about it. A check that only says "failed" is
// a check she learns to ignore.
const pass = (id, title) => ({ id, title, status: "pass", count: 0 });
const fail = (id, title, detail, why, fix) =>
  ({ id, title, status: "fail", count: detail.length, detail, why, fix });
const skipped = (id, title, why) => ({ id, title, status: "skipped", count: 0, why });

// ── the checks that need only this phone ────────────────────────────────────

export function localChecks(state) {
  const orders = Array.isArray(state && state.orders) ? state.orders : [];
  const shelf = Array.isArray(state && state.removedOrders) ? state.removedOrders : [];
  const days = Array.isArray(state && state.deliveryDates) ? state.deliveryDates : [];
  const out = [];

  // ── 1 · no order appears twice ──────────────────────────────────────────
  {
    const seen = new Map();
    for (const o of orders) if (o && o.id) seen.set(o.id, (seen.get(o.id) || 0) + 1);
    const dup = [...seen.entries()].filter(([, n]) => n > 1).map(([id]) => `#${codeOf({ id })}`);
    out.push(dup.length
      ? fail("dup", "No order appears twice", dup,
        "The same order is in your list more than once, so its treats are counted twice and its money reads as two sales.",
        "Open each of these and remove the extra one. It will be kept on the Removed list, so nothing is lost by trying.")
      : pass("dup", "No order appears twice"));
  }

  // ── 2 · nothing is on both lists at once ────────────────────────────────
  {
    const live = new Set(orders.filter(Boolean).map((o) => o.id));
    const both = shelf.filter((r) => r && live.has(r.id)).map((r) => `#${codeOf(r)}`);
    out.push(both.length
      ? fail("both", "Nothing is on the orders list and the Removed list at once", both,
        "An order is in your live list AND on the Removed list. Its treats may be counted once by the kitchen and once as gone.",
        "Press Run again in a moment. If it stays, open the order and save it — that settles which list it belongs to.")
      : pass("both", "Nothing is on the orders list and the Removed list at once"));
  }

  // ── 3 · every order sits on a real bake day ─────────────────────────────
  {
    const bad = orders.filter((o) => o && !(o.deliveryDateId && byId(days, o.deliveryDateId)));
    out.push(bad.length
      ? fail("day", "Every order sits on a real delivery date", bad.map((o) => `#${codeOf(o)}`),
        "These orders are not on any delivery date you have, so no Orders screen can show them — they are in your data and invisible.",
        "Open the Removed list, or find each order by its number in the Orders search box, and set its delivery date.")
      : pass("day", "Every order sits on a real delivery date"));
  }

  // ── 4 · every line of one order agrees about the order ──────────────────
  {
    const groups = groupOrders(orders).filter((g) => g.orders.length > 1);
    const bad = [];
    for (const g of groups) {
      const first = g.orders[0];
      for (const field of ORDER_LEVEL) {
        if (g.orders.some((o) => JSON.stringify(o[field]) !== JSON.stringify(first[field]))) {
          bad.push(`#${orderCode(first)} · ${field}`);
          break;
        }
      }
    }
    out.push(bad.length
      ? fail("agree", "Every line of one order agrees about the order", bad,
        "One order's lines disagree about something that belongs to the whole order — the money, the status, the day or the address. That is the shape of every fault this app has had on this screen.",
        "Open each of these orders and press Save. That writes one answer onto every line.")
      : pass("agree", "Every line of one order agrees about the order"));
  }

  // ── 5 · every line of one order wears the same number ───────────────────
  {
    const groups = groupOrders(orders).filter((g) => g.orders.length > 1);
    const bad = groups.filter((g) => new Set(g.orders.map((o) => orderCode(o))).size > 1);
    out.push(bad.length
      ? fail("code", "Every line of one order wears the same order number", bad.map((g) => `#${orderCode(g.orders[0])}`),
        "One order is wearing more than one number, so a receipt or a WhatsApp message can point at half of it.",
        "Open the order and press Save. Its lines are then numbered together.")
      : pass("code", "Every line of one order wears the same order number"));
  }

  // ── 6 · no PAID order has a line nothing can price ──────────────────────
  {
    const bad = [];
    for (const g of groupOrders(orders)) {
      if (!isCollected(g)) continue;
      const un = g.orders.filter((o) => o && o.productId && orderLinePrice(state, o) == null);
      if (un.length) bad.push(`#${orderCode(g.orders[0])}`);
    }
    out.push(bad.length
      ? fail("price", "Every paid order can be priced", bad,
        "Money was recorded on these orders but a line on them has no price, so what the customer paid for is not knowable from the order.",
        "Open each order and type the price that line was sold at, then Save.")
      : pass("price", "Every paid order can be priced"));
  }

  // ── 7 · the Removed list says when each row came off ────────────────────
  {
    const bad = shelf.filter((r) => r && !r.removedAt);
    out.push(bad.length
      ? fail("shelf", "Every removed order says when it came off", bad.map((r) => `#${codeOf(r)}`),
        "A row on the Removed list has no date on it, so the list cannot be trusted to say how old it is.",
        "Nothing to do — this one is the app's own bookkeeping and tells us the list was written by an older version.")
      : pass("shelf", "Every removed order says when it came off"));
  }

  return out;
}

// ── the checks that need the register (shared data) ─────────────────────────

// `register` is the rows `pullReceiptRegister` returns, or null when it could not be read — and
// ⚠️ NULL MEANS SKIPPED, NEVER PASSED. That distinction is the whole reason this file has three states.
export function registerChecks(state, register, voided) {
  const orders = Array.isArray(state && state.orders) ? state.orders : [];
  const shelf = Array.isArray(state && state.removedOrders) ? state.removedOrders : [];
  if (!Array.isArray(register)) {
    return [
      skipped("hasOrder", "Every receipt has an order behind it", "Your receipts could not be read from the cloud — sign in to shared data and run this again."),
      skipped("carried", "Every receipt's number is on the order it names", "Your receipts could not be read from the cloud — sign in to shared data and run this again."),
    ];
  }

  // ⚠️ THE SAME TWO NUMBERS THE REGISTER ITSELF MATCHES ON — the one an order wears today, and the one
  // it wore before it was grouped (v441). A check that only knew the first would report a false fault on
  // every order that has ever gained an item.
  const live = new Map();
  const groups = new Map();
  for (const g of groupOrders(orders)) {
    const first = g.orders[0];
    if (!first) continue;
    for (const key of [orderCode(first), codeFromId(first)]) {
      if (key && key !== "??????") { live.set(key, first); groups.set(key, g); }
    }
  }
  const removedCodes = new Set();
  for (const r of shelf) {
    for (const key of [orderCode(r), codeFromId(r)]) if (key && key !== "??????") removedCodes.add(key);
  }

  // ── 8 · every receipt has an order behind it (or one on the Removed list) ──
  {
    // ⚠️ A RECEIPT FOR AN ORDER ON THE REMOVED LIST IS **NOT** A FAULT — that is the v444 shelf doing
    // exactly its job. ⭐ AND NEITHER IS ONE SHE HAS DECLARED VOID (v448): **a recorded decision is not an
    // unexplained hole.** ⚠️ Without this the check could never go green on those rows, and **a warning
    // that can never be satisfied is one she learns to ignore** — which would cost her the whole page.
    const voidedNos = new Set((Array.isArray(voided) ? voided : [])
      .map((v) => Math.floor(Number(v && v.no))).filter((n) => Number.isFinite(n) && n > 0));
    // ★★★ AND A RECEIPT IS ALSO EXPLAINED BY AN ORDER CARRYING ITS NUMBER (v470).
    // ⚠️⚠️ HER INSTRUCTION: __"fix the number matching"__ — asked about `#DE1F19`, a receipt naming a code
    // **no order on the phone wears**, while her Mac's identical check passes.
    // ⭐⭐ **THE CODE IS THE WRONG THING TO MATCH ON, AND THIS FILE ALREADY KNOWS IT.** v441 moved the order
    // number onto the order's own row so it stops moving; **v445 then found the code can still be stale,
    // and the answer was to read the RECEIPT NUMBER from the WHOLE ORDER** (`receiptNoOfGroup`, above).
    // ⭐ **That is the fact a receipt and an order ALWAYS share** — the receipt is numbered, and that number
    // is stamped onto the order when the money is taken.
    // ⭐ So a receipt is accounted for if **any order in the book carries its number**, whatever code that
    // order wears today. ⚠️ **AND THE REVERSE STILL HOLDS: if NO order carries it, the receipt is reported
    // exactly as before — because then the order really is not here.** The fix cannot hide a real loss.
    // ⚠️ Read from the WHOLE ORDER and not from one row, for the reason v445 gives: which row of a split
    // order comes first is not fixed, so one row may not know the number.
    const carriers = new Set();
    for (const g of groupOrders(orders)) {
      const n = Math.floor(Number(receiptNoOfGroup(g.orders)));
      if (Number.isFinite(n) && n > 0) carriers.add(n);
    }
    for (const o of shelf) {
      const n = Math.floor(Number(o && o.receiptNo));
      if (Number.isFinite(n) && n > 0) carriers.add(n);
    }
    const codeOfRow = (r) => String((r && r.order_code) || "").trim().toUpperCase();
    const bad = register
      .filter((r) => !voidedNos.has(Math.floor(Number(r && r.number))))
      .filter((r) => !carriers.has(Math.floor(Number(r && r.number))))
      .filter((r) => { const c = codeOfRow(r); return c && !live.has(c) && !removedCodes.has(c); });
    // ⚠️⚠️ AND IT NAMES THE RECEIPT ITSELF, NOT ONLY THE CODE (v472). Her words: __"how phone flag
    // DE1F19, as i cannot find DE1F19 anywhere other then the Check My System run"__.
    // ⭐ **`DE1F19` is not something the check invents — it is the `order_code` stored on a receipt row in
    // the cloud, and that is the code the order wore WHEN THE MONEY WAS TAKEN (`supabase/receipts.sql:32`).**
    // ⚠️ **A code alone cannot be looked up: the order's code has moved since, which is v441's fault and is
    // exactly why the receipt keeps the old one. ⭐ SO THE ROW NOW CARRIES ITS RECEIPT NUMBER AND DATE** —
    // **the two facts that are on the register row itself and that no order can change** — so she can find
    // it in the register in one look, and so can anyone reading this later.
    const nameOfRow = (r) => {
      const n = Math.floor(Number(r && r.number));
      const no = Number.isFinite(n) && n > 0 ? `receipt #${String(n).padStart(6, "0")}` : "receipt (no number)";
      const when = String((r && r.issued_at) || "").slice(0, 10);
      return `${no} · #${codeOfRow(r)}${when ? ` · ${when}` : ""}`;
    };
    return [
      bad.length
        ? fail("hasOrder", "Every receipt has an order behind it", bad.map(nameOfRow),
          // ⚠️⚠️ AND THE REASON NAMES THE INNOCENT CASE (v473). Her own finding, in her words: __"DE1F19 is
          // with invoice 0001, that i already deleted"__ — ⭐ **a receipt for money, standing with no order,
          // because she removed the order herself.** ⚠️ **The check could not tell that from a loss, so it
          // read as a fault for six days, and I chased three wrong theories before she found it.**
          // ⭐ **TWO FACTS MAKE IT INNOCENT, AND BOTH ARE NOW ON THE PAGE: a receipt is never rewritten, and
          // a removed order is only kept for 48 hours — so past two days there is nothing left to connect
          // the two, and that is normal, not a fault.**
          "A receipt was issued for money you took, and there is no order wearing that number on this phone or on the Removed list. The receipt stands and the money is recorded — a receipt is never rewritten, even when the order behind it is removed. And a removed order is only kept for 48 hours, so a removal older than that leaves nothing to connect the two.",
          // ⭐ AND THE WAY OUT LEADS WITH THE ONE PRESS THAT CLEARS IT, because for a deliberate removal that
          // is the whole answer. ⚠️ The second half stays: for a real order that has gone it is the only way
          // back, and a check that dropped it would leave her a fault with no way out.
          "If this was an order you removed yourself: open the Receipt register, find that receipt, and press Mark as void. The line clears, because a decision you have recorded is not a hole. If instead it is a real order that has gone, search WhatsApp for the number and enter the order again by hand.")
        : pass("hasOrder", "Every receipt has an order behind it"),
      // ── 9 · every receipt's number is carried by the order it names ────────
      (() => {
        const wrong = [];
        for (const r of register) {
          const code = String((r && r.order_code) || "").trim().toUpperCase();
          const g = groups.get(code);
          if (!g) continue;
          const has = receiptNoOfGroup(g.orders);
          const want = String(Math.floor(Number(r && r.number))).padStart(6, "0");
          if (has !== want) wrong.push(`#${code} · receipt #${want}, order says ${has ? `#${has}` : "none"}`);
        }
        return wrong.length
          ? fail("carried", "Every receipt's number is on the order it names", wrong,
            "A number was issued for these orders and the order is not carrying it, so your filing page can print \"none yet\" beside a receipt your register can name in full.",
            "Open the order's own receipt — or open the order and press Save, then Paid again. Either way the app asks for the number again and gets back the SAME one, never a new one.")
          : pass("carried", "Every receipt's number is on the order it names");
      })(),
    ];
  }
}

// ── the check on her own safety net ─────────────────────────────────────────

// `copies` is `backups.listBackups`' rows, or null when it could not be read.
export function copyChecks(copies, now = new Date()) {
  if (!Array.isArray(copies)) {
    return [skipped("copies", "Your saved copies are recent and readable",
      "Your saved copies could not be read — sign in to shared data and run this again.")];
  }
  if (!copies.length) {
    return [fail("copies", "Your saved copies are recent and readable", ["none"],
      "This phone holds no saved copy of your data at all, so there is nothing to go back to if something goes wrong.",
      "Open the app with shared data on — a copy is saved every day you open it.")];
  }
  const newest = copies
    .map((r) => String((r && r.created_at) || ""))
    .filter(Boolean)
    .sort()
    .pop() || "";
  const ageDays = newest ? Math.floor((now.getTime() - new Date(newest).getTime()) / 86400000) : Infinity;
  // ⚠️ THREE DAYS, because a copy is written on the days she OPENS the app: a bakery that has not opened
  // it in three days has no recent copy, and the day it matters is the day it is missing.
  return [ageDays > 3
    ? fail("copies", "Your saved copies are recent and readable", [newest ? `newest ${newest.slice(0, 10)}` : "none"],
      `Your newest saved copy is ${Number.isFinite(ageDays) ? `${ageDays} days old` : "missing"}. If an order goes missing now, there is little to go back to.`,
      "Open the app with shared data on — a copy is saved every day you open it.")
    : pass("copies", "Your saved copies are recent and readable")];
}

// ── the check that would have caught HER loss on the day it happened ────────

// `copy` is the PARSED data of one saved copy (or null when it could not be opened), and `when` is that
// copy's own date, for the words. ⚠️ NULL MEANS SKIPPED, NEVER PASSED — the same rule as everywhere here.
//
// ⚠️⚠️ WHY THIS EXISTS, AND WHY IT IS THE HALF THAT WAS STILL MISSING. v444 made a removal recoverable and
// v446 taught the app to look at her records — but every check so far compares **one part of her live data
// against another part of her live data**. ⭐ **If an order leaves, both sides leave together and every
// check stays green.** ⭐⭐ A SAVED COPY IS THE ONLY THING IN THE APP THAT REMEMBERS WHAT WAS THERE BEFORE
// — so it is the only thing that can see an order disappear.
//
// ⭐ AND THE COPY CARRIES THE REMOVED LIST TOO, because `removedOrders` is itself a synced list. So a copy
// is a complete picture of one moment: what was live, and what had been taken off. **That is what makes a
// comparison possible without guessing.**
//
// ⚠️ THE LIMIT, SAID OUT LOUD, because a check that cries wolf is a check she stops reading: an order
// removed by hand **before v444 kept a Removed list** has no row to explain it, and it looks exactly like a
// loss. Those copies age out of the window within about a week, so this settles by itself — and the `why`
// below says so rather than leaving her to work it out.
//
// ⚠️⚠️ AND THERE IS A SECOND INNOCENT CASE, WHICH HER OWN SCREEN FOUND (v527). ⭐ **The Removed list keeps a
// row for 48 HOURS, and this check opens a copy about a WEEK old** — so an order she took off herself three
// days ago is in the copy, gone from the phone, and has nothing left to explain it. ⭐⭐ **Measured on her
// data: `#4B00A9`, removed on her other phone on 11 Oct at 10:47 pm, was on the Removed shelf when she
// looked at it that night — and by the 16th the row was pruned, so this check named it as a loss.** ⭐ **A
// window that looks back further than the shelf can remember will always see a deliberate removal as a
// disappearance.** The `why` now names both cases, because a check that names one cause while two exist is
// telling her something untrue about her own data.
export function backupChecks(state, copy, when = "") {
  const TITLE = "No order has left this phone's list without a trace";
  if (!copy || typeof copy !== "object") {
    return [skipped("stable", TITLE,
      "Your saved copies could not be opened — sign in to shared data and run this again.")];
  }
  // ⚠️ BOTH WAYS AN ORDER CAN BE RECOGNISED, exactly as `registerChecks` does it: the code it wears today
  // and the one it wore before it was grouped (v441). A check that knew only the first would report a
  // false loss for every order that has ever gained an item.
  const codesOf = (list) => {
    const s = new Set();
    for (const o of Array.isArray(list) ? list : []) {
      if (!o) continue;
      for (const k of [orderCode(o), codeFromId(o)]) if (k && k !== "??????") s.add(k);
    }
    return s;
  };
  const here = codesOf(state && state.orders);
  const shelf = codesOf(state && state.removedOrders);
  const shelfThen = codesOf(copy.removedOrders);
  // ⚠️ AND THE COPY'S OWN LIST COUNTS: an order she took off a week ago, whose shelf row has since been
  // pruned, is still explained by the copy that was written while it was on the shelf.
  //
  // ★★★ AND SO DOES A RECEIPT SHE HAS DECLARED VOID (v527) — **the same carve-out the receipt check has had
  // since v448, in almost the same words: a recorded decision is not an unexplained hole.** ⭐ **Marking a
  // receipt void IS her saying "this order is gone and I have dealt with the money"** — so it is the app's own
  // record of that order's fate, and this check was not asking for it. ⚠️ **It reads `voidedReceipts` from
  // BOTH sides** (this phone now, and the copy), for the same reason the Removed list is read from both: the
  // record has to travel, and the copy is what remembers it if this phone's row is gone.
  const voidRecs = [
    ...(Array.isArray(state && state.voidedReceipts) ? state.voidedReceipts : []),
    ...(Array.isArray(copy.voidedReceipts) ? copy.voidedReceipts : []),
  ];
  const voidedNos = new Set();
  const voidedCodes = new Set();
  for (const v of voidRecs) {
    const n = Math.floor(Number(v && v.no));
    if (Number.isFinite(n) && n > 0) voidedNos.add(n);
    const c = String((v && v.code) || "").trim().toUpperCase();
    if (c && c !== "??????") voidedCodes.add(c);
  }
  // ⚠️ MATCHED BOTH WAYS, exactly as `registerChecks` does it: the code the record names, and the receipt
  // number the order carries — ⭐ **the two facts a receipt and an order always share.** A void record made
  // before v441 may name a code the order no longer wears, and reading the number as well is what stops that
  // becoming a false loss.
  const declaredGone = new Set();
  for (const g of groupOrders(Array.isArray(copy.orders) ? copy.orders : [])) {
    const first = g.orders[0];
    if (!first) continue;
    const codes = [orderCode(first), codeFromId(first)].filter((c) => c && c !== "??????");
    const n = Math.floor(Number(receiptNoOfGroup(g.orders)));
    const hit = codes.some((c) => voidedCodes.has(String(c).toUpperCase()))
      || (Number.isFinite(n) && n > 0 && voidedNos.has(n));
    if (hit) for (const c of codes) declaredGone.add(c);
  }
  const missing = [...codesOf(copy.orders)]
    .filter((c) => !here.has(c) && !shelf.has(c) && !shelfThen.has(c) && !declaredGone.has(c))
    .sort();

  return [missing.length
    ? fail("stable", TITLE, missing.map((c) => `#${c}`),
      // ⚠️ AND IT NAMES BOTH INNOCENT CASES (v527). It named one, and the one it named was not hers: **the
      // copy looks back about a week, and the Removed list remembers 48 hours** — so the whole band in
      // between is an order she took off deliberately, with nothing left to explain it.
      `The copy saved on ${when || "an earlier day"} holds ${missing.length === 1 ? "an order" : "orders"} that this phone no longer has — and ${missing.length === 1 ? "it is" : "they are"} not on the Removed list either, so the app has no record of taking ${missing.length === 1 ? "it" : "them"} off. TWO innocent cases look exactly the same, so check the dates before worrying: a removal made before the Removed list existed, and — because the Removed list keeps a row for only 48 hours — an order you took off yourself more than two days ago, which this copy is old enough to remember.`,
      "Open Backup and safety and put that copy back if these are orders you took, or search WhatsApp for the number and enter the order again by hand.")
    : pass("stable", TITLE)];
}

// ── the check that asks whether this phone's records REACHED the other one ───

// `cloud` is `sync.cloudKeys`' answer — `{ ok, keys }` or a reason — and `local` is `sync.localKeys`' list
// of everything this phone holds. ⚠️ NULL/UNREADABLE MEANS SKIPPED, NEVER PASSED, as everywhere here.
//
// ⚠️⚠️ WHY THIS EXISTS. Her report: __"i add a bake date 10/10, other user dont see it"__, and before it
// __"why my other user dont see some order that is on my device?"__. ⭐ **EVERY CHECK IN THIS APP COMPARED
// THIS PHONE WITH ITSELF** — its own lists, its own copies, its own receipts. ⭐⭐ **Nothing had ever asked
// the one question her report is about: is what is on this phone actually IN the shared data?**
// ⚠️ And the journal records a change as handed over when it is QUEUED, not when it leaves — so a change
// whose queue was lost would sit here for ever with nothing to say so. **This is what says so.**
export function reachedCloudCheck(state, cloud, local) {
  const TITLE = "Everything on this phone has reached your shared data";
  if (!cloud || !cloud.ok) {
    return [skipped("reached", TITLE,
      (cloud && cloud.reason) || "Your shared data could not be read — sign in and run this again.")];
  }
  const held = cloud.keys instanceof Set ? cloud.keys : new Set(Array.isArray(cloud.keys) ? cloud.keys : []);
  const missing = (Array.isArray(local) ? local : []).filter((k) => !held.has(k));
  // ⭐ NAMED THE WAY SHE CAN LOOK THEM UP — an order by its number, a bake day by its date.
  const nameOf = (key) => {
    const at = String(key).indexOf(":");
    const kind = String(key).slice(0, at);
    const id = String(key).slice(at + 1);
    if (kind === "orders") return `#${codeOf({ id })}`;
    if (kind === "deliveryDates") {
      const d = (state && state.deliveryDates || []).find((x) => x && x.id === id);
      return d && d.date ? `delivery date ${d.date}` : "a delivery date";
    }
    return kind;
  };
  return [missing.length
    ? fail("reached", TITLE, missing.map(nameOf),
      "These are on this phone and NOT in your shared data, so no other phone can see them. The record itself is safe here — what is missing is the hand-over.",
      "Open Settings → Shared data and press Sync now, then run this check again. If they are still missing after that, the change was lost on its way out.")
    : pass("reached", TITLE)];
}

// ── and the SAME QUESTION THE OTHER WAY ROUND ────────────────────────────────

// Her instruction: __"build the reverse check"__ — asked while two orders sat in her 6 October copy and
// on **neither** device, ⚠️ **and I could not tell her whether they were still in the shared data.**
//
// ⭐⭐ **THE CHECK ABOVE GOES THIS PHONE → THE SHARED DATA.** This one goes **THE SHARED DATA → THIS
// PHONE**: is there anything in the shared data that is NOT here? ⭐ **That is the difference between a
// record that is LOST and a record that is merely not yet pulled** — and it is the question that could not
// be answered at all until now.
//
// ⚠️⚠️ AND IT MUST NOT CRY WOLF. **An order she removed on purpose is gone from this phone and its row
// stays in the shared data until the tombstone lands** — so **anything on this phone's own Removed list is
// excluded**, the same carve-out the receipt check makes. ⭐ A warning that fires on a deliberate removal is
// one she learns to ignore.
export function cloudOnlyCheck(state, cloud, local) {
  const TITLE = "Nothing is sitting in your shared data that is not on this phone";
  if (!cloud || !cloud.ok) {
    return [skipped("cloudOnly", TITLE,
      (cloud && cloud.reason) || "Your shared data could not be read — sign in and run this again.")];
  }
  const held = cloud.keys instanceof Set ? cloud.keys : new Set(Array.isArray(cloud.keys) ? cloud.keys : []);
  const here = new Set(Array.isArray(local) ? local : []);
  // ⚠️ THE SHELF IS THE EXPLANATION FOR A RECORD THAT IS NOT IN THE LIVE LIST, so it is allowed for.
  const shelf = new Set();
  for (const r of (state && state.removedOrders) || []) {
    if (r && r.id) { shelf.add(`orders:${r.id}`); shelf.add(`orders:${codeOf(r)}`); }
  }
  const extra = [...held].filter((k) => !here.has(k) && !shelf.has(k));
  const nameOf = (key) => {
    const at = String(key).indexOf(":");
    const kind = String(key).slice(0, at);
    const id = String(key).slice(at + 1);
    if (kind === "orders") return `#${codeFromId({ id })}`;
    return kind;
  };
  return [extra.length
    ? fail("cloudOnly", TITLE, extra.map(nameOf),
      `${extra.length} record${extra.length === 1 ? " is" : "s are"} in your shared data and NOT on this phone — so ${extra.length === 1 ? "it is" : "they are"} either waiting to come down, or sitting only on your other device. Either way ${extra.length === 1 ? "it is" : "they are"} NOT lost.`,
      "Press Sync now on this phone — a record held in your shared data comes down on the next sync. If it stays here after that, open the other device and check there.")
    : pass("cloudOnly", TITLE)];
}

// ── and the deepest one: do the two sides hold the SAME FACTS? ───────────────

// Her instruction: __"build the content comparison"__ — asked after her **Mac passed** `#DE1F19` and her
// **phone failed it, on the same version, both reporting everything synced.**
// ⭐⭐ **THE TWO CHECKS ABOVE COMPARE WHICH RECORDS EXIST. NEITHER LOOKS INSIDE THEM** — so **a record that
// is present on both sides and DIFFERENT inside is invisible to both.** ⚠️ **That is exactly what her two
// screens showed: the Mac's copy of one order carried its receipt number and the phone's did not.**
//
// ⚠️⚠️ AND THE CARVE-OUT THAT MAKES IT USABLE: **a record this phone has QUEUED AND NOT YET SENT is supposed
// to differ** — reporting that would fire the check on every edit the moment she makes it, which is the
// "warning she learns to ignore" fault this page keeps having to avoid.
// ⚠️ **AND `settings` IS EXCLUDED OUTRIGHT**: it is the one kind that carries things true of ONE device —
// which is why the app strips them before sending it at all. **Comparing it would report every phone's
// settings as wrong.**
export function contentCheck(state, cloud, payloads, pending) {
  const TITLE = "The records on this phone hold the same facts as your shared data";
  if (!cloud || !cloud.ok || !(cloud.data instanceof Map)) {
    return [skipped("content", TITLE,
      (cloud && cloud.reason) || "Your shared data could not be read — sign in and run this again.")];
  }
  const queued = pending instanceof Set ? pending : new Set(Array.isArray(pending) ? pending : []);
  const nameOf = (key) => {
    const at = String(key).indexOf(":");
    const kind = String(key).slice(0, at);
    const id = String(key).slice(at + 1);
    if (kind === "orders") {
      const o = (state && state.orders || []).find((x) => x && x.id === id);
      return o ? `#${codeOf(o)}` : `#${codeFromId({ id })}`;
    }
    if (kind === "deliveryDates") {
      const d = (state && state.deliveryDates || []).find((x) => x && x.id === id);
      return d && d.date ? `delivery date ${d.date}` : "a delivery date";
    }
    return kind;
  };
  const differing = [];
  for (const [key, mine] of (payloads instanceof Map ? payloads : [])) {
    const kind = String(key).slice(0, String(key).indexOf(":"));
    if (kind === "settings") continue;                 // ⚠️ carries per-device facts on purpose
    if (queued.has(key)) continue;                     // ⚠️ queued = meant to differ, not a fault
    const theirs = cloud.data.get(key);
    if (theirs === undefined) continue;                // ⚠️ not in the shared data — the check above owns that
    if (theirs !== mine) differing.push(key);
  }
  return [differing.length
    ? fail("content", TITLE, differing.map(nameOf),
      `${differing.length} record${differing.length === 1 ? " is" : "s are"} on this phone AND in your shared data, but ${differing.length === 1 ? "holds" : "hold"} different facts — so this phone and your other one would show the same record differently. Nothing is missing; the two copies simply disagree.`,
      "Open each of these on this phone and press Save. That writes this phone's copy up to your shared data, and your other device then picks it up. If the other device is showing the RIGHT version, save it THERE instead.")
    : pass("content", TITLE)];
}

// ★ AND WHAT IS STILL WAITING TO LEAVE (v466). ⚠️ **THIS IS THE NUMBER THAT DECIDED WHETHER THE PAGE ABOVE
// IS A FAULT OR A PHOTOGRAPH OF A PHONE MID-SEND** — and until now nothing could show it at all. ⭐ It needs
// no network: it is a local count.
export function waitingCheck(waiting = 0, queued = null, state = null, lastFail = null) {
  const TITLE = "Nothing on this phone is still waiting to be sent";
  const n = Number.isFinite(Number(waiting)) ? Math.max(0, Math.floor(Number(waiting))) : 0;
  // ⚠️⚠️ AND IT NAMES THEM, INSTEAD OF COUNTING THEM (v476). Her report: __"did the 2 changes clear after
  // syncing v475, no"__ ⭐ **and the page could say "2 changes" and nothing else — so neither she nor I could
  // see WHAT was stuck.** ⚠️ **A count she cannot look up is a number she cannot act on** — the same rule
  // every other check on this page follows, and the one this check was breaking.
  // ⭐ **AND IT NAMES THE UN-KEYABLE ONES TOO: an order with no number of its own is exactly the shape that
  // cannot travel, and it is invisible in a count.**
  // ★★★ AND v528 TOOK THAT RULE THE REST OF THE WAY. Her report: __"yes, look into the stuck records"__, and
  // __"the phone and mac having different error"__. ⚠️⚠️ **The page named them as "a removed order" and
  // "uoms" — a KIND, not a record** — so neither she nor I could find the thing that was stuck. ⭐ **The
  // first name was not specific enough to look up, which is the same fault v476 fixed one step up.**
  // ⭐ And with the kind we now have the record, so an order is named by its NUMBER (what she searches) and
  // everything else by the name she gave it.
  const NOUN = {
    orders: "an order", removedOrders: "a removed order", products: "a product",
    productCategories: "a category", ingredients: "an ingredient", suppliers: "a supplier",
    parcelCouriers: "a carrier", uoms: "a unit", deliveryDates: "a delivery date",
    bakedDays: "a baking day", purchaseOrders: "a shopping list", expenses: "an expense",
    deposits: "money in", credits: "a credit", rewards: "a reward", points: "a Point",
    pointAreas: "a Point area", deliveryRoutes: "a van route", occasions: "an occasion",
    promoCodes: "a promo code", customers: "a customer", declinedCoupons: "a declined code",
    voidedReceipts: "a void receipt", settings: "settings",
  };
  const fields = listFields();
  const keys = queued instanceof Set ? [...queued] : Array.isArray(queued) ? queued : [];
  const nameOf = (key) => {
    const s = String(key);
    const at = s.indexOf(":");
    const kind = s.slice(0, at);
    const id = s.slice(at + 1);
    const noun = NOUN[kind] || kind;
    const field = fields[kind];
    const rec = field && state && Array.isArray(state[field])
      ? state[field].find((r) => r && String(r.id) === id) : null;
    if (kind === "orders" || kind === "removedOrders") {
      // ⚠️⚠️ AND A RECORD WITH NO NUMBER OF ITS OWN STILL SAYS SO (kept from v476). ⭐ **It is the shape that
      // cannot travel at all, and it is invisible in a count** — so it must never be dressed up as an order
      // she could search for. ⚠️ An id-less record reaches here as the STRING `"undefined"` (`JSON.stringify`
      // turned the missing value into that when the key was written), ⭐ **and `codeFromId` would happily mint
      // a number out of it** — the fault this whole family is about: a value that looks right and is wrong.
      const badId = !id || id === "undefined" || id === "null" || id === "0";
      const code = badId ? "" : (rec ? (orderCode(rec) || codeFromId(rec)) : codeFromId({ id }));
      return code && code !== "??????" ? `${noun} #${code}` : `${noun} with no number`;
    }
    if (!rec) return noun;
    const who = rec.name || rec.label || rec.title || rec.date || rec.customerName;
    return who ? `${noun} ${String(who)}` : noun;
  };
  const named = keys.map(nameOf);
  // ★★★ AND WHY THEY DID NOT GO (v528). ⚠️⚠️ **The app COUNTED the stuck changes and NAMED them, and could
  // not say WHY** — because `refresh` handed the reason to whichever button pressed it and then forgot it,
  // so the shared-data card said "Sync failed: …" for as long as it took her to read it and no other screen
  // ever knew. ⭐ **"No error" and "the number never moves" were both true, on the same phone, and nothing
  // could join them.** ⚠️ It is the LAST attempt only, and it is cleared on a success — **a stale reason
  // would send her looking for a fault that has already gone.**
  // ⭐ AND IT NAMES THE RECORD THE SERVER WOULD NOT TAKE, not just the reason — **the reason alone still leaves
  // her (and me) hunting eight changes for the one that is refused.**
  const failNote = lastFail && (lastFail.reason || lastFail.key)
    ? ` The last time this phone tried${lastFail.phase === "read" ? " to READ your shared data" : " to hand these over"}, it was refused${lastFail.key ? ` — ${nameOf(lastFail.key)}` : ""}: ${lastFail.reason || "no reason given"}.`
    : "";
  return [n > 0
    ? fail("waiting", TITLE, named.length ? named : [`${n} change${n === 1 ? "" : "s"}`],
      `${n} change${n === 1 ? " is" : "s are"} on this phone and ${n === 1 ? "has" : "have"} not been handed to your shared data yet, so no other phone can see ${n === 1 ? "it" : "them"}.${named.length ? " They are listed below." : ""}${failNote} If this number does not go down on its own, press Sync now.`,
      "Open Settings → Shared data and press Sync now. If the number stays, this phone's sending queue needs looking at — and the records themselves are safe.")
    : pass("waiting", TITLE)];
}

// ── and the whole verdict, in one shape the screen can draw ─────────────────

// ⚠️ `register`, `copies` and `copy` absent = SKIPPED, and a skipped check is counted ON ITS OWN, never
// folded into the passes. The headline the screen draws is built from these three numbers and nothing else.
export function runHealthChecks(state, extra = {}) {
  const results = [
    ...localChecks(state),
    ...registerChecks(state, extra.register, state && state.voidedReceipts),
    ...copyChecks(extra.copies),
    ...backupChecks(state, extra.copy, extra.copyWhen),
    ...reachedCloudCheck(state, extra.cloud, extra.local),
    ...cloudOnlyCheck(state, extra.cloud, extra.local),
    ...contentCheck(state, extra.cloud, extra.payloads, extra.queued),
    ...waitingCheck(extra.waiting, extra.queued, state, extra.lastFail),
  ];
  return {
    results,
    failed: results.filter((r) => r.status === "fail").reduce((s, r) => s + r.count, 0),
    failedChecks: results.filter((r) => r.status === "fail").length,
    passedChecks: results.filter((r) => r.status === "pass").length,
    skippedChecks: results.filter((r) => r.status === "skipped").length,
    total: results.length,
  };
}

const codeOf = (o) => orderCode(o);
