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

import { byId, codeFromId, groupOrders, orderCode, orderLinePrice, removedKeepWords, storedBytes, duplicateOrderCodes, duplicateIngredientPlan, ingredientNameKey, round2, PHONE_STORE_LIMIT, PHONE_STORE_ALERT, phoneUsage } from "./state.js";
import { isCollected } from "./money.js";
import { receiptNoOfGroup } from "./receipts.js";
import { listFields, PULL_CEILING } from "./sync.js";
import { unaccountedOrders } from "./backups.js";
import { dayMonth } from "./dates.js";
import { fmtStockAmount } from "./purchasing.js";
import { STOCK_LOG_CAP } from "./stock.js";

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

  // ── 3 · every order can still be FOUND ─────────────────────────────────
  //
  // ⚠️⚠️ THIS USED TO FAIL EVERY ORDER ON A DAY SHE HAD DELETED (v572). ⭐ The app's own Delete button removes
  // a bake day and **keeps its orders on purpose**, and the Orders list draws exactly those with "its bake day
  // was removed — tap to put it on one". ⚠️ **So the check cried wolf on a normal tidy-up, for ever**, and its
  // sentence said the orders were "invisible" — which was not true of the app it was describing.
  // ⭐ A FAULT IS AN ORDER THAT CANNOT BE FOUND AT ALL: no bake day, and no day recorded on the order either.
  {
    const lost = orders.filter((o) => o
      && !(o.deliveryDateId && byId(days, o.deliveryDateId))
      && !String(o.deliveryDate || "").trim());
    out.push(lost.length
      ? fail("day", "Every order can still be found", lost.map((o) => `#${codeOf(o)}`),
        "These orders are on no delivery date and carry no day of their own, so nothing can place them — not the Orders list, not the calendar, not a search by day.",
        "Find each order by its number in the Orders search box and set its delivery date.")
      : pass("day", "Every order can still be found"));
  }

  // ── 4 · every line of one order agrees about the order ──────────────────
  {
    // ★★★⚠️ "NOTHING" HAS THREE SPELLINGS, AND THEY ARE THE SAME ANSWER (v602).
    // ⚠️⚠️ MEASURED ON HER BOOK, 19 Oct: `promo` was `""` on one line of an order and `null` on the other —
    // ⭐ **both mean "no code on this sale", yet `JSON.stringify("") !== JSON.stringify(null)` reported them
    // as disagreeing for ever.** ⚠️ **A check that reports a difference of SPELLING teaches her to ignore
    // the line, which is the failure this page exists to avoid.** ⚠️ `false` and `0` are ANSWERS and stay
    // distinct — only absent, null and empty string are one fact.
    const sameValue = (a, b) => JSON.stringify(a == null || a === "" ? "" : a)
      === JSON.stringify(b == null || b === "" ? "" : b);
    const groups = groupOrders(orders).filter((g) => g.orders.length > 1);
    const bad = [];
    for (const g of groups) {
      const first = g.orders[0];
      for (const field of ORDER_LEVEL) {
        if (g.orders.some((o) => !sameValue(o[field], first[field]))) {
          bad.push(`#${orderCode(first)} · ${field}`);
          break;
        }
      }
    }
    out.push(bad.length
      ? fail("agree", "Every line of one order agrees about the order", bad,
        "One order's lines disagree about something that belongs to the whole order — the money, the status, the day or the address. That is the shape of every fault this app has had on this screen.",
        // ⚠️⚠️ THE WAY OUT NAMES THE PRESS THAT ACTUALLY WRITES IT (v600). ⚠️ **`paidReceived` is written by
        // the PAID press, not by Save** — `markPaid` stamps the payment onto every row of the whole sale,
        // while the edit popup's Save carries the day, the address and the rest. ⭐ A way out that sent her to
        // the wrong press would leave the same red X after a correct action, which is the worst kind of
        // false alarm. **Save still settles the others, so it stays named for them.**
        "Open each of these and press Paid again — that writes the payment onto every line of the sale, and "
        + "it also draws the receipt's number. For a disagreeing status, day or address, press Save.")
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

  // ── 8 · no two ingredients share a NAME (v544) ──────────────────────────
  //
  // ⚠️⚠️ HER OWN CASE, AND IT IS THE ONE THAT MADE HER DOUBT THE WHOLE SCREEN. Two records called "Instant
  // yeast" — one at 70 g, one at 1.142 kg — and ⭐ **the stock card and the list row disagreed because they were
  // NOT THE SAME RECORD.** ⚠️ **The card and the row both read `onHand`, so an app can only show two figures for
  // one name if there are two ingredients.**
  // ⚠️ **AND NOTHING STOPS A SECOND ONE BEING MADE** — there is no name check when an ingredient is added, so
  // this is the same fault the app already guards for ORDERS ("No order appears twice"), in a list that never
  // had the guard. ⭐ **Her question named the consequence: __"it is not reliable"__** — and she was right for
  // exactly this reason.
  {
    const by = new Map();
    for (const i of (Array.isArray(state && state.ingredients) ? state.ingredients : [])) {
      if (!i) continue;
      // ⚠️⚠️ A HIDDEN CARD IS NOT A LIVE DUPLICATE (v564). ⭐ Hiding one of a pair is the resolution the
      // check itself recommends, so counting hidden records made the press unable to clear the line —
      // **it hid the spare and the check stayed red.** ⭐ The dangerous half of the old v544 case — a
      // recipe pointing at a HIDDEN ingredient, which is used on every bake and never topped up — is its
      // own check, and stays.
      if (i.active === false) continue;
      // ⚠️ The SAME key the Add warning uses (v568) — it collapses runs of spaces too, so the two cannot
      // disagree about which cards share a name.
      const k = ingredientNameKey(i.name);
      if (!k) continue;
      by.set(k, (by.get(k) || []).concat(i));
    }
    // ⚠️⚠️ AND EACH RECORD IS SHOWN WITH ITS OWN AMOUNT AND WHETHER A RECIPE USES IT (v564). ⭐ Her report,
    // 18 Oct 2026: __"for strong flour, on hand show 0, but open up the stock card says on hand 6kgs"__ —
    // and __"the yeast might have the same problem too"__. ⭐ **"Strong flour ×2" is true and useless**: it
    // does not say WHICH of the two cards she is looking at, or which one to keep. ⭐ The two facts that
    // answer that are the amount on each record and whether a recipe points at it.
    const usedBy = (id) => (Array.isArray(state && state.products) ? state.products : [])
      .filter((p) => p && (Array.isArray(p.recipe) ? p.recipe : []).some((l) => l && String(l.ingredientId || "") === String(id)))
      .length;
    const dupes = [...by.values()].filter((a) => a.length > 1)
      .map((a) => `${String(a[0].name || "(ingredient)")} ×${a.length} — `
        + a.map((x) => {
          const n = Math.max(0, Number(x.onHand) || 0);
          const uses = usedBy(x.id);
          return `${fmtStockAmount(state, x, n)}${uses ? `, used in ${uses} recipe${uses === 1 ? "" : "s"}` : ", no recipe uses this one"}`;
        }).join(" · "));
    if (dupes.length) {
      const repairOk = duplicateIngredientPlan(state).length > 0;
      const entry = fail("dupeIngredient", "No two ingredients share a name", dupes,
        "Two or more ingredients carry the same name. Their stock is separate, so a stock card can show one amount and the list another — and a recipe takes from whichever one it points at. Neither is wrong; they are simply two records with one name. Each one below carries its own amount, and says whether a recipe uses it.",
        // ⚠️⚠️ AND THE SENTENCE MUST NOT NAME A BUTTON THE SCREEN DID NOT DRAW (v572). ⭐ The press is offered
        // only when HER RECIPES settle the pair — exactly one of two is used. ⚠️ For two unused cards, two used
        // ones, or three sharing a name, it is not there, and "press the button below" pointed at nothing.
        repairOk
          ? "The one with no recipe behind it is the spare: press the button below to hide it (hiding keeps its stock card, and Unhide brings it back). Then set the stock on the one that is left, so the number means something."
          : "Open each card and see which one your recipes use, then hide or delete the other — Unhide brings a hidden card back. Then set the stock on the one that is left, so the number means something.");
      // ⭐ AND THE PRESS, when her own recipes decide it without ambiguity (v564).
      if (repairOk) entry.repair = "dupeIngredient";
      out.push(entry);
    } else {
      out.push(pass("dupeIngredient", "No two ingredients share a name"));
    }
  }

  // ── 9 · no recipe points at an ingredient you have HIDDEN (v544) ────────
  //
  // ⚠️⚠️ HER OWN CASE, AND IT TOOK TWO SCREENSHOTS TO SEE. She believed she had deleted a second "Instant
  // yeast" long ago. ⭐ **She had not — the app HIDES an ingredient a recipe uses rather than deleting it** (her
  // own base rule: anything a transaction already uses cannot be deleted). ⚠️ **And a hidden ingredient keeps
  // its stock figure**, so two "yeast" numbers lived on, one of them belonging to nothing she could see.
  // ⚠️⚠️ **THE RISK BEHIND IT IS THE PART THAT MATTERS:** the shopping list tops up only **active** ingredients,
  // ⚠️ **but a bake still consumes a hidden one** — so **if a recipe points at the hidden ingredient, that
  // ingredient is used on every bake and never appears on a list to be bought again.** ⭐ **It would run out and
  // nothing would say so.**
  // ⭐ **That is worth a check rather than a warning on one screen: it is a fact about her data, and this page is
  // where she looks when she is worried.**
  {
    const hidden = new Map();
    for (const i of (Array.isArray(state && state.ingredients) ? state.ingredients : [])) {
      if (i && i.id && i.active === false) hidden.set(i.id, String(i.name || "(ingredient)"));
    }
    const bad = [];
    if (hidden.size) {
      for (const p of (Array.isArray(state && state.products) ? state.products : [])) {
        if (!p) continue;
        for (const line of (Array.isArray(p.recipe) ? p.recipe : [])) {
          const name = line && hidden.get(String(line.ingredientId || ""));
          if (name) bad.push(`${p.name || "(product)"} → ${name}`);
        }
      }
    }
    out.push(bad.length
      ? fail("hiddenUsed", "No recipe uses an ingredient you have hidden", bad,
        "A recipe points at an ingredient that is hidden. A bake still takes that ingredient off your shelf, but a hidden ingredient is never put on a shopping list — so it is used and never topped up, and it can run out without anything saying so.",
        "Open the product's recipe and point that line at the ingredient you are actually using, or un-hide the hidden one if it is the right one.")
      : pass("hiddenUsed", "No recipe uses an ingredient you have hidden"));
  }

  // ── 9 · there is room on this phone for your data (v534) ────────────────
  //
  // ⚠️⚠️ WHY THIS IS ON THE PAGE AT ALL. Saving used to fail into a console she never sees, and the ONLY sign
  // was nothing at all — ⭐ **the same disease as the stuck queue: a promise with nothing behind it, and a
  // GROWTH fault that only appears once the book is big.** ⭐ **She asked the question this answers: "any risky
  // system handling that we should eliminate BEFORE the database builds up".**
  // ⭐ It is a PASS showing the number until the phone is nearly full, and only then a FAIL — **a red X a year
  // early is the warning she learns to ignore.**
  {
    // ⚠️⚠️ EVERY KEY, NOT ONLY THE BOOK (v569) — see `phoneUsage`. ⭐ The old measure read one of the three
    // files the app keeps, so the warning could not fire before saving began to fail.
    const usage = phoneUsage(state);
    const used = usage ? usage.total : null;
    if (used == null) {
      out.push(skipped("room", "There is room on this phone for your data",
        "This phone's storage could not be measured, so nobody can say how much room is left."));
    } else {
      const pct = Math.round((used / PHONE_STORE_LIMIT) * 100);
      const mb = (n) => `${(n / (1024 * 1024)).toFixed(2)} MB`;
      const size = `${mb(used)} of about ${mb(PHONE_STORE_LIMIT)} (${pct}%)`;
      // ⭐ WHAT THE THREE FILES COST, said plainly — so a number that looks too big has somewhere to point.
      const parts = usage.parts || {};
      const book = parts["bakeadmin.v1"] || 0;
      const rest = used - book;
      if (used >= PHONE_STORE_LIMIT * PHONE_STORE_ALERT) {
        out.push(fail("room", "There is room on this phone for your data",
          [size, `Your book is ${mb(book)} of that; the app's own working copies make up the other ${mb(Math.max(0, rest))}`],
          `What this phone stores is ${size} full. When a browser's storage fills up, SAVING STOPS — and until v534 that happened silently, so a change could be lost while the screen still looked normal. ⚠️ And since v569 this measures EVERY copy the app keeps, not only your book — the working copies behind the sync count too.`,
          "⚠️ Deleting cloud copies does NOT free this phone — they live in the cloud. What frees it is room elsewhere on the phone (other apps or photos), or letting a device with more room take over. Nothing is at risk: your shared data and your saved copies still hold everything."));
      } else {
        out.push({ ...pass("room", "There is room on this phone for your data"), detail: [size] });
      }
    }
  }

  // ── 10b · the stock card adds up to the shelf (v560) ───────────────────
  //
  // ⚠️⚠️ HER OWN CARD ASKED THE QUESTION. The strong-flour card showed **eight rows summing to +14 kg under
  // an "On hand" of 10 kg**, with two identical "0 g to 10 kg" stocktakes and two identical "Baked extra —
  // 2 ×" rows at the same minute. ⭐ **The amount at the top is right; the history over-counts.**
  // ⭐ THE MECHANISM, REPRODUCED: a stocktake sets an ABSOLUTE amount. Two phones holding the shelf at 0
  // each set 10 kg, so each writes "+10 kg" — the shelf merges to one 10 kg, the journal keeps both rows.
  // ⚠️ **Nothing looked at the relationship between the two, and it is the one invariant a stock card has:
  // every row is one movement, so the rows must add up to the amount at the top.**
  // ⚠️ A log that has hit its cap cannot add up by construction — those are SKIPPED and said so, never
  // passed, and never called a fault.
  {
    const bad = [];
    const capped = [];
    for (const ing of (Array.isArray(state && state.ingredients) ? state.ingredients : [])) {
      if (!ing) continue;
      const log = Array.isArray(ing.stockLog) ? ing.stockLog : [];
      if (!log.length) continue;
      // ⚠️ A log that has hit its cap has lost its oldest rows, so its sum cannot match by construction —
      // it cannot be JUDGED, which is not the same as being right.
      if (log.length >= STOCK_LOG_CAP) { capped.push(String(ing.name || "an ingredient")); continue; }
      const sum = round2(log.reduce((acc, e) => acc + (Number(e && e.delta) || 0), 0));
      const on = round2(Number(ing.onHand) || 0);
      if (Math.abs(sum - on) > 0.01) {
        bad.push(`${ing.name} — on hand ${fmtStockAmount(state, ing, on)}, the rows add to ${fmtStockAmount(state, ing, sum)}`);
      }
    }
    if (bad.length) {
      // ⚠️⚠️ TWO REASONS, AND THE FIRST SENTENCE ONLY DESCRIBED ONE (v563). Her eight cards were
      // **one** over-count (strong flour, rows +14 kg under a 10 kg shelf — two phones writing one
      // absolute stocktake) and **seven** whose rows add up to LESS than the shelf, because the amount
      // was on the shelf before the card kept any rows. ⭐ The same check, two opposite stories, and the
      // old text told all eight the over-count one.
      const why = "Every row on a stock card is one movement of your shelf, so the rows must add up to the amount at the top. On these they do not, and there are two reasons. A stocktake sets an AMOUNT rather than adding one, so when the same stocktake was recorded on two phones each phone writes its own row while the shelf takes the amount once — the history then counts MORE than the shelf. Or an amount was already on the shelf from before this card began keeping a history — the history then counts LESS than the shelf. Either way, the amount at the top is the one to trust: it is the history that is incomplete.";
      const fix = "Do NOT remove rows with the ✕ — the rows are what explain your shelf, and taking one off moves it. Press the button below instead: it writes the one line each card is missing, so the history adds up to the amount at the top. ⭐ Your shelf does not move — nothing is added to it and nothing is taken away.";
      const entry = fail("stockAddsUp", "The stock card adds up to the shelf", bad, why, fix);
      // ⭐ AND THE PRESS THAT CLEARS IT. Without one this check could never go green on her own book:
      // a stocktake writes the same amount and changes the sum not at all.
      entry.repair = "stockCards";
      out.push(entry);
    } else if (capped.length) {
      // ⭐ A real mismatch outranks this, so it is asked first; with none, part of her book still could not
      // be judged, and the rule this page is built on is that "I could not look" is never a pass.
      out.push(skipped("stockAddsUp", "The stock card adds up to the shelf",
        `Too many movements on ${capped.join(", ")} to add up — a stock card keeps its newest ${STOCK_LOG_CAP}.`));
    } else {
      out.push(pass("stockAddsUp", "The stock card adds up to the shelf"));
    }
  }

  // ── 11 · no two orders wear the same number (v554) ─────────────────────
  //
  // ⚠️⚠️ THE CODE IS SIX HEX CHARACTERS of the order's own id — about **3% by 1,000 orders** — and the
  // shared data keys BOTH the tracking card and the receipt register by it. ⭐ **Two orders on one code
  // share one tracking card and one receipt number: two customers reading each other's bread.** ⚠️ It
  // cannot be lengthened without moving every code already given out (v441's fault), so this FINDS it.
  {
    const dup = duplicateOrderCodes(orders);
    out.push(dup.length
      ? fail("dupCode", "No two orders wear the same order number", dup.map((d) => `#${d.code}`),
        "Two or more orders carry the same order number. That number is what a customer quotes, what their tracking card answers to, and what the receipt register keys its serials by — so those orders would share one card and one receipt number between them.",
        "Do not delete either order — each one is a real sale. This one needs the helper: send the numbers above, and a new number can be given to ONE of them without moving the other.")
      : pass("dupCode", "No two orders wear the same order number"));
  }

  // ── 12 · this phone could read its own saved copy (v548) ────────────────
  //
  // ⚠️⚠️ THE FAULT THIS ANSWERS. A damaged stored book used to make the app come up EMPTY and say nothing —
  // the only trace was a `console.warn`, and the next save wrote the empty book over the only local copy.
  // ⭐ **The damaged text is now kept under its own key, and this check speaks for it.**
  // ⭐ **AND IT CLEARS ITSELF** the moment a pull puts records back or a Restore/Import replaces the book —
  // ⚠️ **so it appears exactly when the cloud did NOT save her**, which is the only case that matters.
  {
    const bad = state && state.unreadableSave;
    const copyGone = !!(bad && bad.removedAt);
    out.push(bad
      ? fail("readable", "This phone could read its saved copy",
        [copyGone
          ? `${dayMonth(String(bad.at || "").slice(0, 10))} · the kept copy has since been deleted`
          : `${dayMonth(String(bad.at || "").slice(0, 10))} · ${Number(bad.chars) || 0} characters kept`],
        "On that opening, this phone's stored book was damaged and could not be read. A copy of the damaged text was kept on this phone, and the app came up with an empty book. Anything that had already reached your shared data is safe; anything that lived only on this phone is in that kept copy.",
        "Do not clear the app or the browser data. Let your shared data finish a sync (More → Settings) — if it is intact, the book refills and this note clears itself. If it does not refill, restore your newest backup instead."
        + (copyGone
          ? " ⭐ The kept copy was deleted, so this phone has no second chance from it — a sync or a restore is the way back."
          : " ⭐ And once you no longer need that kept text, it can be deleted from More → Settings → Backup & safety, which frees the room it takes."))
      : pass("readable", "This phone could read its saved copy"));
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
          `A receipt was issued for money you took, and there is no order wearing that number on this phone or on the Removed list. The receipt stands and the money is recorded — a receipt is never rewritten, even when the order behind it is removed. And a removed order is only kept for ${removedKeepWords()}, so a removal older than that leaves nothing to connect the two.`,
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
            // ⚠️ AND IT NAMES THE PRESS THAT EXISTS (v602). ⚠️ "Press Paid again" is impossible on an order that
        // already reads paid — the Pay press is not offered — so an advice that named it left her with a
        // red X and nothing to press. ⭐ The Invoice is the app's own second chance, and it draws the same
        // number the register already holds.
        "Open the order and press Invoice — the number is drawn and stamped then, and it is the SAME one "
        + "your register already holds, never a new one.")
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
  // ⚠️⚠️ AN UNREADABLE DATE IS NOT A RECENT COPY (v572). ⭐ `NaN > 3` is false, so a copy whose own date
  // could not be parsed reported **PASS** — ⚠️ the one direction this page must never fail in. ⭐ It says it
  // could not measure the age instead.
  const newestAt = newest ? new Date(newest).getTime() : NaN;
  if (!Number.isFinite(newestAt)) {
    return [skipped("copies", "Your saved copies are recent and readable",
      "Your saved copies were listed, but the newest one's own date could not be read — so its age cannot be measured.")];
  }
  const ageDays = Math.floor((now.getTime() - newestAt) / 86400000);
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
  // ★★★ AND THE COMPARISON IS NOT MADE HERE ANY MORE (v532). ⚠️⚠️ **ONE RULE, TWO CALLERS:** this check
  // NAMES the orders a copy holds that this phone cannot account for, and "Put back missing orders" PUTS THEM
  // BACK — and a second copy of the comparison is exactly how the two would come to disagree about the same
  // orders. ⭐ `unaccountedOrders` (backups.js) owns it: on this phone now · on the Removed list now · on the
  // copy's own Removed list · or covered by a receipt she has marked void, matched BOTH by the code the void
  // record names and by the receipt number the order carries.
  const found = unaccountedOrders(state, copy);
  const missing = found.map((x) => x.code);

  return [missing.length
    ? fail("stable", TITLE, missing.map((c) => `#${c}`),
      // ⚠️ AND IT NAMES BOTH INNOCENT CASES (v527). It named one, and the one it named was not hers: **the
      // copy looks back about a week, and the Removed list remembers 48 hours** — so the whole band in
      // between is an order she took off deliberately, with nothing left to explain it.
      // ⚠️⚠️ AND A THIRD INNOCENT CASE, WHICH HER OWN SCREEN FOUND (v550): **an order removed on her OTHER
      // phone while THIS phone had never received it.** ⭐ The shelf row is written on the phone that HELD the
      // order — this one has nothing to record, because it never had anything to take off — and the copy was
      // made when the order was still there. ⭐ **Measured in the code: `mergeCloudRows` writes no shelf row
      // for a tombstone whose order this phone does not have**, so a second phone makes this check cry wolf
      // about an order it never held.
      `The copy saved on ${when || "an earlier day"} holds ${missing.length === 1 ? "an order" : "orders"} that this phone no longer has — and ${missing.length === 1 ? "it is" : "they are"} not on the Removed list either, so the app has no record of taking ${missing.length === 1 ? "it" : "them"} off. THREE innocent cases look exactly the same, so check the dates before worrying: a removal made before the Removed list existed; an order you took off yourself longer ago than the ${removedKeepWords()} the Removed list keeps, which this copy is old enough to remember; and an order removed on your OTHER phone that this phone had never received — this phone has nothing to record for that, because it never had anything to take off.`,
      // ⚠️⚠️ AND THE WAY OUT NO LONGER OFFERS A REWIND (v532). ⭐ **"Put that copy back" meant Restore, which
      // takes the WHOLE app back to the day of the copy — here, in the shared data and on her other phone.**
      // ⭐ **It is the right tool for "put everything back", and the wrong one for one missing order** — and
      // this check was recommending it as though it were a repair. It now names the press that does exactly
      // this job, and says the thing she needs to hear: leaving them alone costs her nothing.
      "Open Backup and safety and press Put back missing orders — it puts back only these, and leaves everything you still have exactly as it is. Leaving them alone costs you nothing, and nothing else on this phone is changed. Or, if one of them is a real order you want back now, search WhatsApp for the number and enter it again by hand.")
    : pass("stable", TITLE)];
}

// ★★★ AND WHETHER THIS PHONE ACTUALLY SAVED WHAT IT SAID IT SAVED (v534).
//
// ⚠️⚠️ `save()` used to catch a full-phone error, write it to the console, and carry on — ⭐ **and the console
// is something she will never see.** ⚠️ **It then still queued the change, so "it saved" and "the phone is
// full" were BOTH TRUE, silently.**
// ⭐ `saveFail` is passed in rather than read from the module, so a test can drive this without leaving a
// global set for the tests after it.
export function saveCheck(saveFail) {
  const TITLE = "Every change is saved on this phone";
  if (!saveFail || typeof saveFail !== "object") return [pass("saved", TITLE)];
  const when = String(saveFail.at || "").slice(0, 10);
  return [fail("saved", TITLE, [saveFail.name || "Save failed"],
    `This phone could not store your last change${when ? ` (${when})` : ""}: ${saveFail.reason}. The change was still sent to your shared data, so it is not lost — but THIS phone could not keep its own copy of it, and on a reload this phone will take the shared data's version back down.`,
    "This happens when the browser's storage for the app is full. ⚠️ Deleting cloud copies does not free this phone — what frees it is room elsewhere on the phone, or a device with more room taking over. Nothing is lost: your shared data and your saved copies still hold everything.")];
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
export function reachedCloudCheck(state, cloud, local, queued = null) {
  const TITLE = "Everything on this phone has reached your shared data";
  if (!cloud || !cloud.ok) {
    return [skipped("reached", TITLE,
      (cloud && cloud.reason) || "Your shared data could not be read — sign in and run this again.")];
  }
  // ⚠️⚠️ A PARTIAL READ MUST NEVER NAME A RECORD AS MISSING (v569). ⭐ `cloudKeys` now pages, and it says
  // `complete: false` when the ceiling was reached — ⚠️ **comparing a partial cloud against a full phone
  // would report every record as "not in your shared data", which is a permanent false red X.**
  if (cloud.complete === false) {
    return [skipped("reached", TITLE,
      "Your shared data holds more records than this phone can read in one go, so this could not be checked. Nothing is known to be wrong — the check simply could not look at all of it.")];
  }
  // ⚠️⚠️ AND A CHECK WITH NOTHING ON ONE SIDE MUST NOT PASS (v572) — `local` absent answered "everything
  // reached the cloud", which is this module's own forbidden direction.
  if (!Array.isArray(local)) {
    return [skipped("reached", TITLE, "What this phone holds could not be listed, so nothing could be compared.")];
  }
  const held = cloud.keys instanceof Set ? cloud.keys : new Set(Array.isArray(cloud.keys) ? cloud.keys : []);
  // ⚠️⚠️ A CHANGE THAT HAS NOT BEEN SENT YET IS NOT A LOSS (v573). ⭐ `waiting` reports it once; this check
  // reported the same record a second time as "not in your shared data" the instant it was edited.
  const wait = queued instanceof Set ? queued : new Set();
  const missing = local.filter((k) => !held.has(k) && !wait.has(k));
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
export function cloudOnlyCheck(state, cloud, local, queued = null) {
  const TITLE = "Nothing is sitting in your shared data that is not on this phone";
  if (!cloud || !cloud.ok) {
    return [skipped("cloudOnly", TITLE,
      (cloud && cloud.reason) || "Your shared data could not be read — sign in and run this again.")];
  }
  // ⚠️⚠️ A PARTIAL READ MUST NEVER NAME A RECORD AS MISSING (v569). ⭐ `cloudKeys` now pages, and it says
  // `complete: false` when the ceiling was reached — ⚠️ **comparing a partial cloud against a full phone
  // would report every record as "not in your shared data", which is a permanent false red X.**
  if (cloud.complete === false) {
    return [skipped("cloudOnly", TITLE,
      "Your shared data holds more records than this phone can read in one go, so this could not be checked. Nothing is known to be wrong — the check simply could not look at all of it.")];
  }
  const held = cloud.keys instanceof Set ? cloud.keys : new Set(Array.isArray(cloud.keys) ? cloud.keys : []);
  const here = new Set(Array.isArray(local) ? local : []);
  // ⚠️⚠️ AND A DELETION STILL IN THE QUEUE IS STILL IN THE CLOUD — BY DESIGN (v573). ⭐ Without this, removing
  // an order raised a red X until the tombstone landed, then cleared itself.
  const wait = queued instanceof Set ? queued : new Set();
  // ⚠️ THE SHELF IS THE EXPLANATION FOR A RECORD THAT IS NOT IN THE LIVE LIST, so it is allowed for.
  const shelf = new Set();
  for (const r of (state && state.removedOrders) || []) {
    if (r && r.id) { shelf.add(`orders:${r.id}`); shelf.add(`orders:${codeOf(r)}`); }
  }
  const extra = [...held].filter((k) => !here.has(k) && !shelf.has(k) && !wait.has(k));
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
  // ⚠️⚠️ A PARTIAL READ MUST NEVER NAME A RECORD AS MISSING (v569). ⭐ `cloudKeys` now pages, and it says
  // `complete: false` when the ceiling was reached — ⚠️ **comparing a partial cloud against a full phone
  // would report every record as "not in your shared data", which is a permanent false red X.**
  if (cloud.complete === false) {
    return [skipped("content", TITLE,
      "Your shared data holds more records than this phone can read in one go, so this could not be checked. Nothing is known to be wrong — the check simply could not look at all of it.")];
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
      "Open each of these on this phone and press Save. That writes this phone's copy up to your shared data, and your other device then picks it up. If the other device is showing the RIGHT version, save it THERE instead. ⚠️ And on a phone that has just been set up, let its first sync finish before saving anything — until it has, this phone's copy is the one that is behind.")
    : pass("content", TITLE)];
}

// ★ AND WHAT IS STILL WAITING TO LEAVE (v466). ⚠️ **THIS IS THE NUMBER THAT DECIDED WHETHER THE PAGE ABOVE
// IS A FAULT OR A PHOTOGRAPH OF A PHONE MID-SEND** — and until now nothing could show it at all. ⭐ It needs
// no network: it is a local count.
// ★★★ HOW BIG HER SHARED DATA IS — INFORMATION, NOT A WARNING (v531).
//
// ⚠️⚠️ WHY IT IS ON THE PAGE AT ALL. The read used to be ONE request capped at 1,000 rows, and **`which`
// thousand could differ from one read to the next** — so records arrived and then did not, on two devices that
// never agreed, with nothing saying why. ⭐ **A cap on a business's records is not a capacity, it is an expiry
// date**, and an order is one record per ITEM, so a working bakery reaches it in months.
// ⭐ **She asked to see the number: __"you asked to see the count first"__.** It is a PASS when the book is
// inside what one read can take, and it FAILS only at the ceiling — the one point where a record could still
// fail to arrive. ⚠️ **Unknown is SKIPPED, never a pass**, and ⚠️ **`Number(null)` IS 0**, so an unmeasured
// count must never be printed as "0 records".
export function recordsCheck(count, ceiling) {
  const TITLE = "How many records your shared data holds";
  if (count == null || !Number.isFinite(Number(count))) {
    return [skipped("records", TITLE, "This phone has not read your shared data yet, so it has no count to give. Sign in to shared data and run this again.")];
  }
  const n = Math.max(0, Math.floor(Number(count)));
  const cap = Number.isFinite(Number(ceiling)) ? Number(ceiling) : 0;
  const words = `${n.toLocaleString("en")} record${n === 1 ? "" : "s"}`;
  if (!cap || n < cap) {
    // ⚠️ A PASS RENDERS THE TITLE AND ITS DETAIL AND NOTHING ELSE — so the detail carries the number, and the
    // sentence underneath it is the reassurance that the read no longer stops at a thousand.
    return [{ ...pass("records", TITLE), detail: [`${words} — and every one of them reaches every phone, because the sync reads them a page at a time instead of stopping at a thousand`] }];
  }
  return [fail("records", TITLE, [words],
    `Your shared data holds ${words}, which is at the limit of what one read can take. Past this a record can still fail to arrive — and it would not be lost, but it would not show on this phone either.`,
    "Tell the person who looks after the app: the read's page limit needs raising. Nothing on this phone will fix it, and no record has been changed.")];
}

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

// ── how many records the shared data holds ─────────────────────────────────

// ⚠️⚠️ THE PULL IS PAGED NOW (17 October 2026): it reads a page at a time until the data runs out, so the
// old 1,000-row cap — a record set with an expiry date — is gone. ⭐ **This row stays anyway, for two
// reasons: she asked for the number before anything was redesigned, and a count is the one thing that says
// how big the book has grown.** ⚠️ **It fails only at `sync.PULL_CEILING`, the reader's own hard stop —
// the one point where records really CAN still stop arriving.** The threshold is IMPORTED rather than
// typed again, so the sentence and the loop cannot disagree about where that is.
export function recordCountCheck(count) {
  const TITLE = "How many records your shared data holds";
  if (!count || !count.ok) {
    return [skipped("records", TITLE, (count && count.reason) || "Your shared data could not be read.")];
  }
  const n = Number(count.count) || 0;
  if (!count.atLeast && n < PULL_CEILING) {
    return [pass("records",
      `Your shared data holds ${n} record${n === 1 ? "" : "s"} — and every one of them reaches every phone, because the sync now reads them a page at a time instead of stopping at a thousand.`)];
  }
  const seen = count.atLeast ? `at least ${PULL_CEILING}` : String(n);
  return [fail("records",
    `Your shared data holds ${seen} records — more than one sync can read`,
    [`${seen} records`],
    `The sync reads the shared data a page at a time, up to ${PULL_CEILING} records in one pass. Past that it stops — the same cliff as before, only far further out. ⚠️ Nothing is deleted; it simply cannot all be read in one go.`,
    "Tell your developer — the next step is reading only what has CHANGED since the last sync instead of all of it every time, which needs the server to stamp the change time.")];
}

// ── and the whole verdict, in one shape the screen can draw ─────────────────

// ⚠️ `register`, `copies` and `copy` absent = SKIPPED, and a skipped check is counted ON ITS OWN, never
// folded into the passes. The headline the screen draws is built from these three numbers and nothing else.
// ⚠️⚠️ A CARD THAT HOLDS STOCK MUST NEVER BE THE ONE THAT IS HIDDEN SILENTLY (v580). ⭐ The duplicate plan
// picks the card to hide by which one a RECIPE uses — and the measured case was one "Salt" used by a recipe
// with **0 on hand** beside an unused one with **6 kg**: the press hid the 6 kg card, ⚠️ **so that stock left
// every list and the confirmation named no amount.** ⭐ The stock is real; moving or counting it is a decision
// she makes on the stock cards, so the press names it and stops rather than taking it away.
export function hideSparesBlocked(state, plan) {
  const stocked = (Array.isArray(plan) ? plan : [])
    .filter((p) => p && p.hide && (Number(p.hide.onHand) || 0) > 0);
  if (!stocked.length) return "";
  return stocked.map((p) => `${String(p.hide.name || "").trim()} (the spare) holds `
    + `${fmtStockAmount(state, p.hide, Number(p.hide.onHand) || 0)} — hiding it would take that stock off `
    + `every list. Count ${String(p.keep.name || "").trim()}, the card your recipes use, up to that amount, and this one down to 0 `
    + `on their stock cards — then hide it.`).join(" ");
}

export function runHealthChecks(state, extra = {}) {
  const results = [
    ...localChecks(state),
    ...registerChecks(state, extra.register, state && state.voidedReceipts),
    ...copyChecks(extra.copies),
    ...backupChecks(state, extra.copy, extra.copyWhen),
    ...reachedCloudCheck(state, extra.cloud, extra.local, extra.queued),
    ...cloudOnlyCheck(state, extra.cloud, extra.local, extra.queued),
    ...contentCheck(state, extra.cloud, extra.payloads, extra.queued),
    ...recordsCheck(extra.count, extra.ceiling),
    ...saveCheck(extra.saveFail),
    ...waitingCheck(extra.waiting, extra.queued, state, extra.lastFail),
    ...recordCountCheck(extra.records),
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
