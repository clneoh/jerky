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

import { el, button } from "../ui.js";
import { runHealthChecks } from "../health.js";
import { pullReceiptRegister } from "../supabase.js";
import * as backups from "../backups.js";
import * as sync from "../sync.js";
import { saveFailure } from "../state.js";

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
    const res = runHealthChecks(state, {
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
    run.busy = false;
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
