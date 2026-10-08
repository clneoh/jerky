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

import { el, button } from "../ui.js";
import { registerRows, registerSummary } from "../receipts.js";
import { pullReceiptRegister } from "../supabase.js";
import { orderHref } from "../state.js";

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
            "No receipt has been issued yet, and that is the honest answer rather than a blank. A number is drawn the first time you record money against an order — press Paid · Cash or Paid · TNG."),
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
            : `Order #${r.code} — not in this phone's orders`),
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

  async function load() {
    draw(null, "Reading your receipt numbers…");
    const r = await pullReceiptRegister(state);
    if (dead) return;
    if (!r.ok) {
      draw(null, "Could not read the receipts — the phone is offline, or the one-time receipts step has not been run in Supabase. Nothing has been changed, and nothing already issued is affected.");
      return;
    }
    draw(registerRows(r.rows, state.orders), "");
  }

  load();
  return () => { dead = true; };
}
