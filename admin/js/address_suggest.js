// address_suggest.js — while she types an address, ask Google what she might be typing (v228).
//
// MOVED HERE FROM views/orders.js (v303). It was written for the order's delivery address box,
// and it is not about orders at all: **the Self collection Point's own address box needed the
// same help and did not have it** — she asked *"there is no address auto complete for collection
// point?"*, and she was right. A Point's address is what the driver is sent to and what its pin
// is looked up from, so it is the box where a correctly typed postcode matters most.
//
// One function, so the two boxes behave identically: the same minimum length before Google is
// asked, the same pause after her last keystroke, and the same promise that **nothing here can
// block anything** — a failure shows nothing at all, and a save never waits on the network.

import { el } from "./ui.js";
import { suggestAddresses } from "./couriers/api.js";

export // ── the address box asks Google as she types (v228) ─────────────────────────
//
// v227 fills the delivery address from HER OWN history, which cannot help a customer
// she has never served — and a NEW customer is precisely the case she wanted help
// with ("if it is a new customer, i need help to key in the address"). This is the
// other half: while she types, Google is asked what she might be typing, and she taps
// a full address with its postcode instead of pecking the whole thing into a phone.
//
// NOTHING HERE CAN BLOCK ANYTHING, and that is the load-bearing property. The input's
// own `oninput` still does `draft.address = this.value` synchronously and
// unconditionally, exactly as it did before this version existed; this block only gets
// told about the keystroke afterwards. A failure therefore shows nothing at all, a save
// never waits on the network, and an order with no signal saves exactly as it always
// has. Anything this file ever grows that gates a save on a suggestion would be a
// regression against that, not a feature.
//
// A TAP REPLACES THE BOX — the OPPOSITE of v227's rule, deliberately. v227's
// never-overwrite rule protects a delivery from being moved by a SIDE EFFECT (picking
// a customer). Here the tap IS the instruction, so the box must become the address she
// picked.
const ADDRESS_MIN_CHARS = 4; // mirrors MIN_QUERY in supabase/functions/courier/suggest.ts
const ADDRESS_WAIT_MS = 400; // the pause after her last keystroke before Google is asked

// The one ask in flight, and it is at MODULE scope on purpose. Both forms are rebuilt
// while she is typing — the Edit pop-up on a fulfillment change, the New-order card on a
// sync pull — and each rebuild strands the previous suggester's closure. A closure can
// still hold a live timer and a live request, and a rebuild is not a reason for either to
// stop. So every build clears the pending timer and bumps this counter, and every answer
// checks it before it speaks.
//
// IT HOLDS NO DOM, and it must not: `applyPopupEdits` copies draft fields onto the order
// rows with Object.assign, so anything parked on `draft` would be written onto her orders
// as a field of its own. A number and a timer id are not draft fields.
const addrAsk = { gen: 0, timer: 0 };

// Modal-private helper for both address boxes. Returns { panel, typed }.
export function addressSuggester(state, onPick) {
  // The marker is how a test names THIS panel rather than the customer one above it:
  // `.sugg-panel` is a shared style worn by three different lists, so it identifies a
  // look, not a panel.
  const panel = el("div", { class: "sugg-panel", "data-sugg": "address", hidden: true });
  let asked = ""; // the one query slot: the last thing actually sent, never a map
  // ⚠️ ONCE THE SERVER SAYS IT CANNOT SUGGEST AT ALL, STOP ASKING AND SAY SO (v311).
  //
  // HER REPORT: __"the suggestion list never appear"__. It was true, and the app never said why:
  // a failed ask called `hide()` and the box went quiet, so a phone whose suggestions were not set
  // up looked exactly like a phone that simply had nothing to offer. **A feature that is off and
  // does not say so is the same bug as a control that does nothing.**
  //
  // AND IT IS SAID ONCE, NOT PER KEYSTROKE. `setup` marks a problem that will not pass on its own
  // (no session, a key the server does not have); a network hiccup is NOT marked and stays silent,
  // because a line about the signal under a box she is typing in is noise — and the feature comes
  // back by itself the moment the signal does.
  let setupSaid = false;

  // Supersede everything older the moment this form is built.
  clearTimeout(addrAsk.timer);
  addrAsk.timer = 0;
  addrAsk.gen += 1;

  // Close the list and retire anything in flight. The generation bump is what makes a
  // late answer DROP its words rather than paint them under her thumb after she has
  // already moved on — which is the whole reason this is not simply `panel.hidden`.
  const hide = () => {
    addrAsk.gen += 1;
    clearTimeout(addrAsk.timer);
    addrAsk.timer = 0;
    panel.hidden = true;
    panel.replaceChildren();
  };

  const ask = async (q) => {
    const mine = ++addrAsk.gen;
    asked = q; // recorded when SENT, so a repeat of the same words costs no second request
    const out = await suggestAddresses(state, q);
    // Superseded while it was in flight — she has typed on, tapped, or the form was
    // rebuilt. Discard the answer; do not speak it.
    if (mine !== addrAsk.gen) return;
    if (!out.ok) {
      if (out.setup) saidit(out.reason);
      else hide();
      return;
    }
    if (!out.places.length) { hide(); return; }
    panel.replaceChildren(...out.places.map((p) => el("button", {
      class: "list-item sugg-row", type: "button",
      onclick: () => { hide(); onPick(p.text); },
    },
      el("div", { class: "li-main" },
        el("div", { class: "li-title" }, el("span", {}, p.text))))));
    panel.hidden = false;
  };

  // The one quiet line, where the suggestions would have been. Never a button, never a
  // paragraph: one sentence naming what is wrong, in the place the list would have appeared.
  const saidit = (why) => {
    setupSaid = true;
    panel.replaceChildren(el("p", { class: "sugg-note" }, String(why || "Address suggestions are not available on this phone.")));
    panel.hidden = false;
  };

  const typed = (text) => {
    const q = String(text || "").trim();
    // ⚠️ AND NOTHING IS ASKED AGAIN once we know. Not hiding the line, and not spending a request
    // to be told the same thing on every keystroke for the rest of the form.
    if (setupSaid) return;
    if (q.length < ADDRESS_MIN_CHARS) { hide(); return; }
    // The same words she paused on last time are already answered. Keep what is
    // showing rather than spend a request to be told the same thing.
    if (q === asked) return;
    hide(); // whatever is on screen belongs to the previous words, so it goes now
    addrAsk.timer = setTimeout(() => { ask(q); }, ADDRESS_WAIT_MS);
  };

  return { panel, typed };
}
