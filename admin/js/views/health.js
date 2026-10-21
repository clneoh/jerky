// views/health.js — the screen she runs herself: "Check my system" (v446).
//
// HER QUESTION, and she says she always asks it: __"is the system robust enough in many ways. What measure,
// what test, we can do to effectively measure it?"__
//
// ⚠️⚠️ AND THE REASON THERE IS A SCREEN AND NOT JUST A FILE OF CHECKS: **a measure she cannot run is not a
// measure for her.** On 11 Oct 2026 this app had 3,335 passing tests while three of her paid orders were
// missing — because every one of those tests checks what the CODE does, and her loss was a fact about her
// DATA. The checks are in `health.js`; **this is the surface that lets her look.**
//
// ⚠️ THE VERDICT IS THREE NUMBERS, NEVER ONE. Passed, FAILED, and **could not run** — because a check that
// could not look must never be counted as fine. See the long note in `health.js`; the same rule the receipt
// register follows for an unreadable run.

import { el, button, confirmDialog, toast } from "../ui.js";
import { hideSparesBlocked, runHealthChecks } from "../health.js";
import { claimReceipt, pullReceiptRegister, maybeSync } from "../supabase.js";
import * as backups from "../backups.js";
import * as sync from "../sync.js";
import { save, saveFailure, duplicateIngredientPlan } from "../state.js";
import { fmtStockAmount } from "../purchasing.js";
import { STOCK_LOG_CAP, reconcileCards } from "../stock.js";

const MARK = { pass: "✓", fail: "✗", skipped: "—" };

// ⭐ WHICH COPY IS WORTH OPENING (v457). `listBackups` returns the newest first, and it mixes kinds —
// daily, weekly, monthly and her own manual copies — so **"the oldest row" can be a monthly from months
// ago**, and an order she removed back then has no Removed row to explain it. ⚠️ That would make the check
// cry wolf on its first run, which is how a warning gets ignored.
// ⭐ **The oldest DAILY copy is the right one: about a week back — far enough back to predate a loss, and
// near enough that the Removed list can still explain what is missing from it.**
function oldestDaily(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const dailies = list.filter((r) => r && r.kind === "daily" && r.id != null);
  const fallback = list.filter((r) => r && r.id != null);
  const pool = dailies.length ? dailies : fallback;
  return pool.length ? pool[pool.length - 1] : null;   // newest-first, so the last is the oldest
}

// ⚠️ `(root, state)` — THE APP'S ORDER, the one the router calls every screen with (`viewEl, state,
// params`). Written the other way round first, and the smoke pass caught it by name.
export function renderHealth(root, state) {
  let dead = false;

  const card = el("div", { class: "card" });
  const list = el("div", { class: "card" });

  function verdictLine(res, when) {
    if (!res) return "Nothing has been checked yet on this phone.";
    // ⚠️ PLAIN TEXT — `el` draws a string as-is, so markdown here would print its own asterisks.
    const bits = [`${res.total} checks`];
    bits.push(res.failedChecks ? `${res.failedChecks} FAILED` : "none failed");
    if (res.skippedChecks) bits.push(`${res.skippedChecks} could not run`);
    return `${bits.join(" · ")}${when ? ` · ${when}` : ""}`;
  }

  function paint(res) {
    card.replaceChildren(
      el("h3", { style: "margin:0 0 2px" }, "System check"),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Reads the records on this phone, your receipts in your shared data, and opens your oldest recent "
        + "saved copy to compare it with what you have now."),
      el("p", { class: "hc-verdict" }, verdictLine(res, res ? "just now" : "")),
      el("div", { class: "btn-row", style: "margin:0" },
        button("Run the check", () => run(false), "primary")),
      res && res.skippedChecks
        ? el("p", { class: "card-sub", style: "margin:10px 0 0" },
            "⚠️ A check that could not look is counted on its own — never as a pass. Sign in to shared data, "
            + "then run this again.")
        : null);
  }

  function paintList(res) {
    if (!res) return list.replaceChildren();
    const rows = res.results.map((r) => el("div", { class: `hc-row ${r.status}` },
      el("div", { class: "hc-head" },
        el("span", { class: "hc-mark" }, MARK[r.status] || "?"),
        el("span", { class: "hc-title" }, r.title),
        r.count ? el("span", { class: "hc-count" }, `${r.count}`) : null),
      r.status === "pass" ? null : el("p", { class: "hc-why" }, r.why),
      r.status === "fail" && r.fix ? el("p", { class: "hc-fix" }, r.fix) : null,
      // ⭐ THE PRESS THAT CLEARS IT (v563). ⚠️ A check she can only read is a check she cannot fix, and
      // this one had NO route at all: a stocktake writes the same amount and changes the sum by nothing.
      r.status === "fail" && r.repair === "stockCards"
        ? el("div", { class: "btn-row", style: "margin:8px 0 0" },
            button("Put the missing line on each card", () => repairCards(), "primary"))
        : null,
      // ⭐ AND THE DUPLICATED INGREDIENTS (v564) — hiding the spare, never deleting it.
      r.status === "fail" && r.repair === "dupeIngredient"
        ? el("div", { class: "btn-row", style: "margin:8px 0 0" },
            button("Hide the spare cards", () => hideSpares(), "primary"))
        : null,
      // ⭐ ONE PRESS FOR EVERY MISSING RECEIPT STAMP (v613). ⚠️ Fourteen orders is not fourteen presses.
      r.status === "fail" && r.repair === "receiptStamps" && (r.repairIds || []).length
        ? el("div", { class: "btn-row", style: "margin:8px 0 0" },
            button(`Put the ${r.repairIds.length} number${r.repairIds.length === 1 ? "" : "s"} back`,
              () => repairReceiptStamps(r.repairIds), "primary"))
        : null,
      // ⚠️ THE THINGS THEMSELVES, NAMED. A count she cannot look up is a number she cannot act on — every
      // failing check carries the rows it is about, by order number, so each one can be found.
      r.detail && r.detail.length
        ? el("p", { class: "hc-detail" }, r.detail.slice(0, 12).join(" · ")
            + (r.detail.length > 12 ? ` · and ${r.detail.length - 12} more` : ""))
        : null));
    list.replaceChildren(
      el("h3", { style: "margin:0 0 8px" }, "What each check found"),
      ...rows);
  }

  // ⭐⭐ PUT THE REGISTER'S NUMBERS BACK ON THEIR ORDERS (v613). ⚠️ It uses the Invoice card's OWN claim, which
  // returns the number the register already holds — ⭐ **the same number, never a new one** — and an order that
  // already carries its number is not touched. Failures are named, never silently counted as done.
  function repairReceiptStamps(ids) {
    const todo = [...new Set((ids || []).map(String))];
    if (!todo.length) return toast("Nothing to put back");
    confirmDialog(
      `This asks your receipt register for the number each of these ${todo.length} orders already has, and `
      + "writes it onto the order — the same number, never a new one. Orders that already carry theirs are "
      + "not touched.",
      async () => {
        let ok = 0;
        let failed = 0;
        let needsPaid = 0;
        for (const id of todo) {
          const row = (state.orders || []).find((o) => o && String(o.id) === id);
          if (!row) { failed += 1; continue; }
          // ⚠️ A RECEIPT IS FOR MONEY RECEIVED: an order the app does not believe is paid cannot be
          // claimed, and the press says so instead of counting it as a failure.
          if (!row.paidReceived) { needsPaid += 1; continue; }
          // ⚠️ FORCED: a number that disagrees with the register must still be asked about, or the press
          // reports success and the red line never clears (v615).
          // eslint-disable-next-line no-await-in-loop
          if (await claimReceipt(state, row, { force: true })) ok += 1;
          else failed += 1;
        }
        if (ok) {
          save(state);
          maybeSync(state);
        }
        toast(`${ok} number${ok === 1 ? "" : "s"} put back`
          + (needsPaid ? ` · ${needsPaid} need their payment marked first — open each and press Paid` : "")
          + (failed ? ` · ${failed} could not be reached — run the check again` : ""));
        run(true);
      },
      { yesLabel: "Put the numbers back" });
  }

  // ★★★ PUT THE MISSING LINE ON EVERY CARD THAT DOES NOT ADD UP (v563).
  // ⚠️ THE CONFIRM NAMES WHAT IT DOES AND WHAT IT DOES NOT DO, because it writes to every stock card at
  // once: one row each, the shelf untouched, nothing removed. ⭐ Her shelf (the amount at the top) is the
  // figure her kitchen agrees with; it is the RECORD that was incomplete.
  function repairCards() {
    confirmDialog(
      "This writes one line on each stock card whose rows do not add up to the amount at the top — "
      + "either the opening amount it never recorded, or a correction where a movement was counted twice. "
      + "Your shelf does not move: nothing is added and nothing is taken away, and no row is removed.",
      () => {
        const out = reconcileCards(state);
        if (out.done.length) {
          save(state);
          maybeSync(state);
          // ⚠️ AND A CARD IT SKIPPED IS NAMED (v587) — a "done" count beside a silent skip is half a sentence.
          toast(`${out.done.length} card${out.done.length === 1 ? "" : "s"} put back in step`
            + (out.skipped.length ? ` · ${out.skipped.length} at its ${STOCK_LOG_CAP}-row limit could not be: ${out.skipped.join(", ")}` : ""));
        } else if (out.skipped.length) {
          // ⚠️⚠️ "EVERY CARD ALREADY ADDS UP" WAS A LIE HERE (v587). ⚠️ A card at 49 rows is JUDGED by the
          // check and SKIPPED by this press (one more row would take it to the cap, where nothing can judge
          // it) — ⚠️ **so the line stayed red while the press told her every card was fine.**
          toast(`Nothing could be put in step here: ${out.skipped.join(", ")} ${out.skipped.length === 1 ? "is" : "are"} at the ${STOCK_LOG_CAP}-row limit — the card's history is too long for a repair line to explain it`);
        } else {
          toast("Every card already adds up");
        }
        run(true);
      },
      { yesLabel: "Put the lines on" });
  }

  // ★★ HIDE THE SPARE OF A DUPLICATED PAIR (v564). ⚠️ HIDING, NEVER DELETING — a hidden ingredient keeps
  // its stock card, its name and a way back (v544's Unhide), and her base rule is that anything a
  // transaction has used cannot be deleted. ⭐ The pair is only offered when HER OWN RECIPES settle it:
  // one is used, the other is not.
  function hideSpares() {
    const plan = duplicateIngredientPlan(state);
    if (!plan.length) return toast("Nothing to hide — the pairs are not decided by your recipes");
    // ⚠️⚠️ A CARD THAT HOLDS STOCK IS NOT HIDDEN (v580): the amount is named, and the press stops.
    const blocked = hideSparesBlocked(state, plan);
    if (blocked) return confirmDialog(blocked, () => {}, { yesLabel: "Got it" });
    const names = plan.map((p) => `${p.hide.name} (holds ${fmtStockAmount(state, p.hide, Number(p.hide.onHand) || 0)})`
      + ` — ${p.keep.name} is used in your recipes, the other is not`).join(". ");
    confirmDialog(
      `Hide ${plan.length === 1 ? "this card" : `these ${plan.length} cards`}? ${names}. Hiding keeps the stock card and its history, takes the card off your list, and can be undone with Unhide. Nothing is deleted.`,
      () => {
        for (const p of plan) p.hide.active = false;
        save(state);
        maybeSync(state);
        toast(`${plan.length} card${plan.length === 1 ? "" : "s"} hidden`);
        run(true);
      },
      { yesLabel: "Hide them" });
  }

  async function run(again) {
    if (run.busy) return;
    run.busy = true;
    paint(null);
    paintList(null);
    list.replaceChildren(el("p", { class: "card-sub" }, "Reading your records, your receipts and your copies…"));

    // ⚠️ EACH SOURCE IS READ SEPARATELY AND PASSED IN AS IT CAME OUT. If the register cannot be read the
    // checks that need it are SKIPPED — never passed — and the same for the copies. One unreadable source
    // must not take the checks that only need this phone down with it.
    const register = await pullReceiptRegister(state).then((r) => (r && r.ok ? r.rows : null)).catch(() => null);
    if (dead) return;
    const copies = await backups.listBackups(state).then((r) => (r && r.ok ? r.rows : null)).catch(() => null);
    if (dead) return;

    // ⭐ AND ONE COPY IS OPENED — THE OLDEST DAILY ONE. ⚠️ **It is the only thing in the app that remembers
    // what was on this phone BEFORE**, so it is the only thing that can see an order leave: every other
    // check compares one part of her live data against another part of her live data, and when an order
    // goes, both sides go together and they all stay green. ⚠️ **A copy that cannot be opened is left as
    // null, and the check is SKIPPED — never passed.**
    let copy = null;
    let copyWhen = "";
    const pick = oldestDaily(copies);
    if (pick) {
      const got = await backups.getBackup(state, pick.id).then((r) => (r && r.ok ? r.row : null)).catch(() => null);
      if (dead) return;
      if (got) {
        try { copy = JSON.parse(got.data); } catch { copy = null; }
        if (!copy || typeof copy !== "object") copy = null;
        copyWhen = backups.localWhen(got.created_at);
      }
    }

    // ⭐⭐ AND THE ONE QUESTION EVERY OTHER CHECK HERE HAD NEVER ASKED (v466): **is what is on this phone
    // actually in the shared data?** Her report: __"i add a bake date 10/10, other user dont see it"__.
    // ⚠️ `cloudKeys` is a READ of the shared data and writes nothing anywhere; `localKeys` is built from the
    // same list the sync itself uses; `pendingCount` needs no network at all. ⚠️ **A phone with shared data
    // off gets a SKIP with its reason, never a pass.**
    const cloud = await sync.cloudKeys(state).catch(() => null);
    // ⭐ AND HOW MANY ROWS THE SHARED DATA ACTUALLY HOLDS (17 October 2026) — the pull reads ONE capped
    // page, so this is the number that says whether everything can reach a phone at all.
    const records = await sync.cloudRowCount(state).catch(() => null);
    if (dead) return;
    let res;
    try {
      res = runHealthChecks(state, {
      register, copies, copy, copyWhen,
      cloud, local: sync.localKeys(state), waiting: sync.pendingCount(),
      records,
      // ⭐ WHY THE QUEUE DID NOT EMPTY (v528) — the reason `refresh` used to return once and forget.
      lastFail: sync.lastFailure(),
      // ⭐ HOW BIG THE BOOK IS (v531) — what the last complete read found, and the ceiling the read loop
      // itself uses, so the sentence and the loop can never disagree about the number.
      count: sync.lastCloudCount(), ceiling: sync.PULL_CEILING,
      // ⭐ AND WHETHER THIS PHONE COULD STORE WHAT IT CLAIMED TO STORE (v534) — `save()` used to fail into
      // the console, and the console is something she will never see.
      saveFail: saveFailure(),
      // ⭐ AND THE DEEPEST PAIR (v471): what this phone holds, and what it has queued — the same single
      // read of the shared data answers both, so this costs no extra round trip.
      payloads: sync.localPayloads(state), queued: sync.pendingKeys(),
      });
    } catch (err) {
      // ⚠️⚠️ ONE MALFORMED RECORD MUST NOT TAKE THE PAGE DOWN (v572). ⭐ A null in a list made a check throw,
      // there was no guard, and `run.busy` was never cleared — ⭐ **the screen stayed on "Reading your
      // records…" for ever and the Run button answered nothing.** ⭐ It says what happened and stays usable.
      res = null;
      if (!dead) {
        list.replaceChildren(el("p", { class: "card-sub" },
          "The check could not finish: one of your records is in a shape it cannot read. Nothing has been "
          + `changed. The message is: ${String((err && err.message) || err)}`));
      }
    } finally {
      run.busy = false;
    }
    if (!res) return;
    paint(res);
    paintList(res);
  }

  const about = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "What this is, and what it is not"),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "Your app has thousands of automatic tests, and on 11 Oct 2026 they were all passing while three of "
      + "your paid orders were missing — because those tests check what the app DOES, and the loss was in "
      + "your RECORDS. This page looks at your records instead."),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "⚠️ It is a floor, not a promise. A check can only find a fault somebody has already described, so "
      + "passing here does not prove your app is perfect — it means none of the known faults are present."),
    el("p", { class: "card-sub", style: "margin:0" },
      "Run it whenever you like. Nothing on this page changes anything: it reads, and writes nothing."));

  paint(null);
  paintList(null);
  root.replaceChildren(card, list, about);
  run(true);
  return () => { dead = true; };
}
