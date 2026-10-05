// views/referrals.js — bring-a-friend, as a screen of its own (v314).
//
// ⚠️ THIS CARD USED TO LIVE INSIDE SETTINGS, and that was the wrong address for
// it. Settings holds "defaults, backup, transfer" — the machinery of the app.
// Bring-a-friend is a CUSTOMER OFFER, and it sat far from the two it belongs
// with, Promo codes and Reviews. Her words: __"can be brought to The Shop,
// rather than in Settings."__ The markup below is the same card that was there,
// moved whole, so nothing about the scheme itself changed.
//
// ⚠️ **AND IT IS THE LINK HALF, NOT A SECOND PROMO SCREEN.** Her own decision,
// kept from v289: **both schemes stay, and the axis is the ARTEFACT, not the
// reward** — a link costs nothing to issue and travels, a code and a label is
// for a partner who prints brochures. **Do not propose replacing one with the
// other again.** What is new here is only that the two can now be READ together,
// which is what she asked for: __"can we make to more seamless with other
// promo?"__ → "One place, read as a family".

import { el, toast, menuRow } from "../ui.js";
import { save } from "../state.js";
import { schemeOf } from "../referrals.js";

export function renderReferrals(root, state) {
  const cur = state.settings ??= {};
  const ref = cur.referrals ??= {};

  // The switch. Its two real effects are named, because a switch whose
  // consequences are invisible reads as a switch that does nothing: it turns on
  // the Share press on a customer's card, and the Give-coupon block on an order
  // that arrived through someone's link.
  const refOn = el("input", { type: "checkbox", checked: ref.enabled === true,
    onchange: () => {
      ref.enabled = refOn.checked;
      save(state);
      toast(ref.enabled ? "Bring-a-friend on — share presses appear on Customers" : "Bring-a-friend off");
      paintPreview();
    } });

  const refFriend = el("input", { class: "input", type: "number", inputmode: "decimal", min: 0, step: "1",
    value: (Number(ref.friendRM) || 3), style: "max-width:110px",
    onchange: () => {
      const v = Number(refFriend.value);
      ref.friendRM = Number.isFinite(v) && v > 0 ? v : 3;
      refFriend.value = ref.friendRM;
      save(state); toast("Saved");
      paintPreview();
    } });

  const refReferrer = el("input", { class: "input", type: "number", inputmode: "decimal", min: 0, step: "1",
    value: (Number(ref.referrerRM) || 3), style: "max-width:110px",
    onchange: () => {
      const v = Number(refReferrer.value);
      ref.referrerRM = Number.isFinite(v) && v > 0 ? v : 3;
      refReferrer.value = ref.referrerRM;
      save(state); toast("Saved");
      paintPreview();
    } });

  const refDays = el("input", { class: "input", type: "number", inputmode: "numeric", min: 0,
    placeholder: "90", value: ref.validDays === "" || ref.validDays == null ? "" : String(ref.validDays),
    style: "max-width:110px",
    onchange: () => {
      const raw = String(refDays.value).trim();
      if (raw === "") { ref.validDays = ""; }
      else {
        const v = Math.floor(Number(raw));
        ref.validDays = Number.isFinite(v) && v > 0 ? v : "";
      }
      refDays.value = ref.validDays === "" ? "" : String(ref.validDays);
      save(state); toast("Saved");
      paintPreview();
    } });

  // ⚠️ THE THREE NUMBERS ARE NOT DECORATION, and the preview says so by using
  // them exactly as the app does. They are written into the message a customer
  // FORWARDS to their friend, and into the credit records the Give-credit press
  // writes. Changing one and never seeing where it lands is how a scheme ends up
  // promising a number the app does not use.
  const preview = el("div", { class: "card", style: "margin-top:10px" });
  function paintPreview() {
    const s = schemeOf(state);
    const cur = state.settings.currency || "RM";
    const money = (n) => `${cur} ${Number(n).toFixed(2)}`;
    preview.replaceChildren(
      el("p", { class: "card-title" }, "What your customer forwards"),
      el("p", { class: "card-sub", style: "margin:0" },
        `A friend who is NEW to us gets ${money(s.friendRM)} off their FIRST order, and your customer gets a ${money(s.referrerRM)} coupon for a future order — one coupon per order.`),
      el("p", { class: "card-sub", style: "margin:6px 0 0" },
        s.validDays === "" || s.validDays == null
          ? "Each coupon never runs out."
          : `Each coupon is valid ${s.validDays} days from when the friend orders.`));
  }
  paintPreview();

  const schemeCard = el("div", { class: "card" },
    el("label", { class: "daycheck", style: "display:inline-flex" },
      refOn, " ", "Show bring-a-friend on Customers & new referred orders"),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "Friend's first-order discount (RM)"), refFriend),
      el("div", {}, el("label", {}, "Their coupon (RM)"), refReferrer)),
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "Coupon valid for … days (blank = never)"),
      refDays),
    preview,
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      "You apply the discount yourself when you confirm on WhatsApp — the app records what is owed, it never changes a price."));

  // ── ★ A link, or a code — the family, in one card ───────────────────────
  // The whole point of moving this screen here. Both halves give a customer
  // something off; what differs is what she hands over, and that is the choice
  // this card exists to make plain.
  const familyCard = el("div", { class: "card" },
    el("p", { class: "card-title" }, "A link, or a code"),
    el("p", { class: "card-sub", style: "margin:0 0 4px" },
      "Both give a customer something off. What differs is what you hand over: a link costs nothing to issue and travels — forward it and it still works; a code and a label is for a partner who prints brochures or a card."),
    el("p", { class: "card-sub", style: "margin:0" },
      "A customer's own link is on their card, on Customers. The code half is on Promo codes."));

  root.replaceChildren(
    el("h2", { class: "section" }, ref.enabled === true ? "Bring a friend" : "Bring a friend (off)"),
    schemeCard,
    el("h2", { class: "section" }, "The other half"),
    familyCard,
    el("div", { style: "margin-top:10px" },
      el("div", { class: "card", style: "padding:4px 14px" },
        menuRow("#/promo", "🎟 Promo codes", "A code a customer types, with its own label"),
        menuRow("#/customers", "📇 Customers", "Open a customer to copy their own link"))));
}
