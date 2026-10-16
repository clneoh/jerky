// views/receipt_register.js — the run of receipt numbers (v366).
//
// She asked for this the day after she removed a paid order and watched #000001 stay spent:
// *"build the receipt register screen"*. The numbers were already being issued, stored and
// never re-used; what was missing was any way to LOOK at them.
//
// ⚠️ THIS SCREEN IS READ-ONLY, AND THAT IS THE POINT. A register you can edit is not a
// register. There is no control here that changes a number, because the one thing this run
// exists to guarantee is that no number is ever re-used or removed — including by her, by
// accident, on a bad evening.
//
// ⚠️ AND IT READS EVERY TIME IT IS OPENED. No cache: a register that showed yesterday's run
// while a receipt had been issued this morning would be the one kind of wrong that matters
// here. The list is short and the read is one request.

import { el, button, showPopup, toast } from "../ui.js";
import { lastSeenIn, registerRows, registerSummary } from "../receipts.js";
import { maybeSync, pullReceiptRegister } from "../supabase.js";
import { newVoidRecord, orderHref, save } from "../state.js";

import * as backups from "../backups.js";

// ★★ HOW MANY SAVED COPIES TO LOOK THROUGH WHEN SHE ASKS (v443). The app keeps 7 daily, 4 weekly and 3
// monthly, so 12 reaches back past a monthly copy — and the search STOPS at the first copy that knows the
// code, so the ordinary answer (the order was here this morning) costs ONE request, not twelve.
const COPIES_TO_LOOK_IN = 12;

// ⚠️ `location.hash` DIRECTLY rather than the app's router, the same choice history.js
// documents: it keeps this view testable under Node, where there is no router running.
const navigate = (hash) => { location.hash = hash; };

// "8 Oct 2026, 14:02" — a register wants the MOMENT, not just the day, because two receipts
// issued on one afternoon are otherwise indistinguishable. Read on her own clock, so the
// screen and the paper agree.
const MON3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stamp(iso) {
  const s = String(iso || "");
  if (!s) return "";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s.slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getDate()} ${MON3[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function renderReceiptRegister(root, state) {
  let dead = false;

  const cur = (state.settings && state.settings.currency) || "RM";

  const draw = (reg, note) => {
    if (dead) return;
    const head = el("h2", { class: "section" }, "Receipt register");

    // ── could not be read ───────────────────────────────────────────────────
    // ⚠️ TWO DIFFERENT BLANKS, SAID DIFFERENTLY. "Could not be read" must never be drawn as
    // an empty register: on this screen an empty register reads as "no receipts exist",
    // which is the opposite of true and the one mistake here that would actually matter.
    if (!reg) {
      root.replaceChildren(head,
        el("div", { class: "card" },
          el("p", { class: "card-title" }, "Receipts issued"),
          el("p", { class: "card-sub", style: "margin:0" }, note),
          el("div", { class: "btn-row", style: "margin-top:10px" },
            button("Read again", () => load(), "soft small"))));
      return;
    }

    if (!reg.count) {
      root.replaceChildren(head,
        el("div", { class: "card" },
          el("p", { class: "card-title" }, "Receipts issued"),
          el("p", { class: "card-sub", style: "margin:0" },
            "No receipt has been issued yet, and that is the honest answer rather than a blank. A number is drawn the first time you record money against an order — press Pay on the order row."),
          el("div", { class: "btn-row", style: "margin-top:10px" },
            button("Read again", () => load(), "soft small"))));
      return;
    }

    // ── one row per receipt ─────────────────────────────────────────────────
    // ★★ THE ORDER NUMBER IS NOW A DOOR (v381). Her words: __"can make the order number
    // clickable to bring us to the order so i can admen it, or look at it detail"__.
    //
    // ⚠️ THIS REVERSES A v366 DECISION, ON PURPOSE, AND THE OLD REASON IS WORTH KEEPING: the row
    // had NO press, because a control that landed on the Orders screen *without opening that
    // order* would not do what it says — and the code was printed for her to retype into the
    // Orders screen's own finder, with a sentence underneath saying so. **What changed is that
    // the link can now genuinely open the order**, so the press does what it promises and the
    // sentence became unnecessary.
    //
    // ⚠️ WHAT DID NOT CHANGE: nothing here edits a NUMBER. This screen is still read-only in the
    // sense that matters — the run of numbers is untouchable, including by her on a bad evening.
    // A door to the order does not touch the register.
    const orderPress = (code) => el("a", {
      class: "ord-open",
      href: orderHref(code),
      // ⚠️ A real `href` AND a handler: the address is what makes it a link (long-pressable,
      // copiable), and the handler is what makes the tap reliable on a phone — the same pair
      // every other jump in this app uses.
      onclick: (ev) => { ev.preventDefault(); navigate(orderHref(code)); },
    }, `Order #${code}`);

    const row = (r) => el("div", { class: "reg-row" },
      el("span", { class: "reg-no" }, `#${r.no}`),
      el("span", { class: "reg-what" },
        el("span", { class: "reg-name" },
          r.order
            // ⚠️ ONLY WHEN THE ORDER IS ON THIS PHONE. A receipt whose order is not here has
            // nothing to open, so it stays plain text with its own honest sentence — a press
            // there could only land on an empty Orders screen.
            ? [String(r.order.customerName || "").trim() || "—", " · ", orderPress(r.code)]
            // ⚠️⚠️ AND NOW IT CAN ANSWER THE QUESTION IT USED TO ONLY POSE (v443). *"Not in this phone's
            // orders"* is true of an order she removed on purpose, an order a fault swept away, and an
            // order this phone never had — **and those are three completely different problems wearing
            // one sentence.** The press looks through her own saved copies and says when the order was
            // still there. Nothing about it changes anything: it reads copies, and writes none.
            // ★★ AND A THIRD SHAPE: A ROW SHE HAS EXPLAINED (v448). ⚠️ **Marked, never removed** — the
            // number stays spent and the row stays on the page, because a register you can edit is not a
            // register. What changes is that it stops reading as an unexplained hole.
            : r.voided
              ? [ `Order #${r.code} — void`,
                  el("span", { class: "reg-ask" },
                    el("span", { class: "reg-void" },
                      `voided ${stamp(r.voided.at)}${r.voided.reason ? ` · ${r.voided.reason}` : ""}`),
                    button("Put it back", () => unvoid(r), "ghost small")) ]
              : [ `Order #${r.code} — not in this phone's orders`,
                  " ",
                  (() => {
                    const said = el("span", { class: "reg-seen" }, "");
                    const ask = button("When was it last here?", () => lookBack(r.code, said, ask), "ghost small");
                    // ⚠️ AND THE WAY TO EXPLAIN IT. A row nobody can ever settle is a row she will read
                    // every time she opens this screen — the four that are left on hers would otherwise
                    // recite themselves for ever.
                    const mark = button("Mark as void", () => askVoid(r), "ghost small");
                    return el("span", { class: "reg-ask" }, ask, mark, said);
                  })() ]),
        el("span", { class: "reg-when" }, stamp(r.issuedAt)),
        // ★ AND HOW MUCH (v370) — read from the register, so it shows even for a receipt whose
        // order is not on this phone.
        r.refundedAt ? el("span", { class: "reg-tag" },
          r.refundedAmount > 0 ? `refunded ${cur} ${r.refundedAmount.toFixed(2)}` : "refunded") : null));

    const gapTxt = reg.gaps.map((n) => `#${String(n).padStart(6, "0")}`).join(", ");

    root.replaceChildren(head,
      el("div", { class: "card" },
        el("p", { class: "card-title" }, "Receipts issued"),
        el("p", { class: "card-sub", style: "margin:0 0 8px" }, registerSummary(reg)),

        // ★ THE GAP IS THE ONE THING AN AUDITOR ASKS ABOUT, so it is not left to a sentence at
        // the top where a long run could push it out of sight. When there is one it wears a
        // banner of its own; when there is not, the summary above has already said so and a
        // second "no gaps" line would be noise.
        reg.gaps.length
          ? el("p", { class: "reg-warn" },
              `${reg.gaps.length} number${reg.gaps.length === 1 ? "" : "s"} missing from the run: ${gapTxt}. `,
              "A missing number is one the sequence drew and never issued. It cannot be filled in afterwards — using it would put two receipts on one number — so keep this page: it is the record that says which numbers were never issued.")
          : null,

        // ⚠️ AND A VOID RECEIPT IS STATED AS OBSERVED, not as a verdict. See the long note in
        // `registerRows`: the run is shared, but this phone's orders are not.
        reg.notOnThisPhone
          ? el("p", { class: "card-sub", style: "margin:8px 0 0" },
              `${reg.notOnThisPhone} number${reg.notOnThisPhone === 1 ? "" : "s"} above ${reg.notOnThisPhone === 1 ? "is" : "are"} for an order that is not in this phone's orders — usually because the order was removed. `,
              "The receipt stands, the money moved, and the number stays spent. If the phone has simply not finished syncing, opening this again later will fill the names in.")
          : null,

        el("div", { class: "reg-list" }, ...reg.rows.map(row)),

        el("p", { class: "card-sub", style: "margin:10px 0 0" },
          "Press an Order number to open that order, so you can look at it or amend it. A receipt whose order is not on this phone has nothing to open and says so."),
        el("div", { class: "btn-row", style: "margin-top:10px" },
          button("Read again", () => load(), "soft small"))),

      el("div", { class: "card" },
        el("p", { class: "card-title" }, "What this run is for"),
        el("p", { class: "card-sub", style: "margin:0" },
          "Above RM150,000 of gross takings in twelve months, receipts must be serially numbered (Income Tax Act 1967, s.82(1)(b)). This is that series. The counter lives in your own Supabase project and not on a phone, because two phones keeping a counter of their own would either clash or leave a hole."),
        el("p", { class: "card-sub", style: "margin:8px 0 0" },
          "A number belongs to the ORDER and is drawn once, when the money is recorded. Printing the receipt again, opening it on your other phone, or marking it refunded all leave the number exactly where it is — and removing the order does not give it back. Nothing on this screen changes anything.")));
  };

  // ★★ THE ANSWER TO *"WHERE DID IT GO?"* (v443), IN HER OWN WORDS.
  //
  // __"you should say that something entered abt 8am, is deleted later in the afternoon, by me or by the
  // system error itself"__
  //
  // ⚠️⚠️ SO IT SAYS A WINDOW, NOT A MOMENT. `lastSeenIn` hands back the newest copy that still HAS the order
  // and the copy one step newer that does not — **it was there at the first and gone by the second, so it
  // left in between.** ⭐ A single time would read as the moment it vanished, which the app cannot know.
  //
  // ⚠️ AND IT NAMES BOTH POSSIBLE REMOVERS AND CHOOSES NEITHER. "By you, or by the app itself" — the data
  // cannot tell those apart, and a sentence that picked one would be the same mistake as reading "this fits"
  // as "this is it", written into her records.
  // ★★ "THIS ONE IS VOID, AND HERE IS WHY" (v448).
  //
  // ⚠️⚠️ HER WORDS: __"can you have me to clear the invoice, or rearrange it, ok for me in this software
  // trial stage"__ ⭐ **AND THE ANSWER IS MARK, NEVER DELETE.** The number stays spent, the row stays on the
  // page — **a register you can edit is not a register**, and this one exists because she once removed a
  // paid order and watched `#000001` stay spent. What she gets instead is the honest form of "clear": a row
  // with HER reason on it, so the run still adds up and the row stops reading as a mystery.
  //
  // ⚠️ AND IT IS A DECISION, SO IT IS REVERSIBLE — "Put it back" is right beside it. A mark she cannot undo
  // would be a delete wearing a different word.
  function askVoid(r) {
    const why = el("input", { class: "input", type: "text", maxlength: "120",
      placeholder: "e.g. trial order — no money received" });
    showPopup("Mark this receipt void", (refresh, close) => el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        `Receipt #${r.no}${r.code ? ` · Order #${r.code}` : ""}. ` +
        "The number stays spent and is never re-used — this records WHY there is no order behind it."),
      why,
      el("div", { class: "btn-row", style: "margin-top:10px" },
        button("Mark it void", () => {
          if (!Array.isArray(state.voidedReceipts)) state.voidedReceipts = [];
          state.voidedReceipts = state.voidedReceipts.filter((v) => Math.floor(Number(v && v.no)) !== r.number);
          // ★★★ AND IT CARRIES AN ID, OR IT CAN NEVER REACH HER OTHER PHONE (v518).
          //
          // ⚠️⚠️ THIS LINE SHIPPED WITHOUT ONE, AND IT COST HER A WEEK OF "MY DEVICES DO NOT SYNC" — the
          // whole chain, proved from her own two screens:
          //   · the check tells her to **Mark as void** for a receipt with no order behind it, and it says
          //     the line will clear *"because a decision you have recorded is not a hole"*;
          //   · she did it **on the Mac**, and the record was written **with no `id`**;
          //   · ⚠️ **a record that cannot be keyed cannot travel** — `sync.js` excludes it from the POST and
          //     sweeps it (v475), so it is silently dropped;
          //   · ⭐ **so the phone never learns the receipt was voided, and keeps showing the SAME error, for
          //     ever** — telling her to press a button she has already pressed.
          // ⭐ And the record itself — WITH its id — is built by the data model, so the button and the repair
          // for an older record cannot disagree about how a void is keyed.
          state.voidedReceipts.push(newVoidRecord(r.number, r.code, why.value));
          save(state);
          maybeSync(state);
          close();
          toast("Marked void — the number stays spent");
          load();
        }, "primary"),
        button("Cancel", () => close(), "ghost"))));
  }

  // ⚠️ And back again — the same door, opened the other way.
  function unvoid(r) {
    state.voidedReceipts = (state.voidedReceipts || [])
      .filter((v) => Math.floor(Number(v && v.no)) !== r.number);
    save(state);
    maybeSync(state);
    toast("Put back — it reads as an order with no order behind it again");
    load();
  }

  async function lookBack(code, said, ask) {
    if (ask.disabled) return;
    ask.disabled = true;
    said.textContent = " Looking through your saved copies…";
    const copies = await recentCopies();
    if (dead) return;
    if (!copies.ok) {
      said.textContent = ` ${copies.reason}`;
      ask.disabled = false;
      return;
    }
    const { hit, goneBy } = lastSeenIn(copies.list, code);
    if (!hit) {
      // ⚠️ ONE OF TWO THINGS, AND BOTH ARE SAID: never on this phone, or gone before the oldest copy.
      said.textContent = ` Not in any of the ${copies.list.length} saved copies looked at — so it was never`
        + " on this phone, or it left before the oldest copy you have.";
      // ⚠️ THE PRESS STAYS LIVE HERE: a copy is made every day the app is opened, so tomorrow's search
      // reaches further back than today's. On a real answer it goes inert, because the answer cannot improve
      // and a press that changed nothing would read as a broken control.
      ask.disabled = false;
      return;
    }
    const wasThere = `Still in your data in the copy saved ${backups.localWhen(hit.createdAt)}`;
    said.textContent = goneBy
      ? ` ${wasThere}, and gone from the copy saved ${backups.localWhen(goneBy.createdAt)} — so it was`
        + " removed between those two, by you or by the app itself."
      : ` ${wasThere} — your newest copy — and it is not in your data now, so it was removed after that,`
        + " by you or by the app itself.";
  }

  // The saved copies, newest first, each one's orders parsed and then discarded as the next is fetched —
  // one copy in memory at a time, which is what keeps this affordable on a phone.
  async function recentCopies() {
    // ⚠️⚠️ `listMeta` ANSWERS WITH `{ ok, rows }`, NOT WITH A LIST. Reading it as an array silently found
    // nothing at all, so every press said "there are no saved copies to look in" **on a phone that had
    // fourteen of them** — a control that always says the same thing reads as broken, and it would have
    // shipped looking exactly like a correct answer. The view test caught it.
    let meta = null;
    try { meta = await backups.listMeta(state); } catch { meta = null; }
    // ⚠️⚠️ "I COULD NOT LOOK" MUST NEVER BE SAID AS "THERE ARE NONE" — the register's own oldest rule. A
    // copy list that failed to load (shared data off, signed out, no signal) came back as an empty answer,
    // and *"there are no saved copies to look in"* is a **false statement about her data** — it would tell
    // her the app keeps no copies, which is the opposite of true, at the exact moment she is asking where
    // an order went. The reason travels up and is what she reads.
    if (!meta || !meta.ok) {
      return { ok: false, reason: (meta && meta.reason) || "Your saved copies could not be read." };
    }
    const list = (Array.isArray(meta.rows) ? meta.rows : [])
      .filter((r) => r && r.id)
      .slice()
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
      .slice(0, COPIES_TO_LOOK_IN);
    if (!list.length) return { ok: false, reason: "There are no saved copies to look in." };
    const out = [];
    for (const row of list) {
      const g = await backups.getBackup(state, row.id);
      if (dead) return { ok: false, reason: "" };
      if (!g || !g.ok) continue;
      let data = null;
      try { data = JSON.parse(g.row.data); } catch { continue; }
      out.push({
        id: row.id,
        createdAt: row.created_at,
        label: backups.labelFor(row.kind, row.created_at),
        orders: (data && Array.isArray(data.orders)) ? data.orders : [],
      });
    }
    if (!out.length) return { ok: false, reason: "No saved copy could be read." };
    return { ok: true, list: out };
  }

  async function load() {
    draw(null, "Reading your receipt numbers…");
    const r = await pullReceiptRegister(state);
    if (dead) return;
    if (!r.ok) {
      draw(null, "Could not read the receipts — the phone is offline, or the one-time receipts step has not been run in Supabase. Nothing has been changed, and nothing already issued is affected.");
      return;
    }
    draw(registerRows(r.rows, state.orders, state.voidedReceipts), "");
  }

  load();
  return () => { dead = true; };
}
