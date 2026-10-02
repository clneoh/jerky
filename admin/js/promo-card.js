// promo-card.js — the printed card a customer takes home (v279, step 6 of 11).
//
// This is the other end of the code she hands out. On the screen, printing a code
// freezes its offer; on paper, this page is what the customer actually holds — the
// bakery's name, what the code gives, the code itself, and a way back to the shop
// without typing anything.
//
// WHAT THE CARD DELIBERATELY DOES NOT CARRY, and why. No end date and no count.
// A card is a promise in someone else's hand that cannot be amended or called
// back, so both of those are promises it could not keep: a date is one she might
// have to move, and "the first fifty orders" is one the card cannot count. The
// offer itself is frozen the moment this card prints (see frozenProblem in
// promo.js), so everything that IS on the card goes on being true.
//
// The ceiling IS the reason the freeze has a gate: with no number and no date,
// the only thing left bounding what a card can cost is her own ceiling, so a code
// with no ceiling is refused a card rather than printed with one (freezeProblem).
//
// The square is drawn here, not fetched: qr.js is a hand-written encoder, so the
// card needs no library, no image file and no network, and prints crisply at any
// size because it is a path rather than a picture.
//
// SPLIT ON PURPOSE. cardFields() is pure data — no DOM, no storage, no clock — so
// the round-trip test can hold every field of a frozen code against the card in
// Node, with no browser. renderCard() and boot() are the page.

import { el } from "./ui.js";
import { loadState } from "./state.js";
import { findCode, minimumOf, normalizeCode, normCode, offerOf } from "./promo.js";
import { qrMatrix, qrSvg } from "./qr.js";

// The brand when her own storefront settings are still blank. Read from
// index.html, the brand of record — never retyped from a config placeholder.
const FALLBACK_BRAND = { name: "Munchies Furkidz", tagline: "Handmade Dehydrated Pet Treats" };

// The offer in the customer's words, composed from the same parts the shop uses.
// English, because the card is one printed object rather than a page that can
// answer in three languages, and because the offer's own grammar ("RM10 off on
// RM30 and above") is the shop's sentence with the code taken out of it.
export function offerLine(code) {
  const o = offerOf(normalizeCode(code));
  if (o.kind === "delivery") return "Free delivery";
  if (o.kind === "pct") return `${o.value}% off${o.cap > 0 ? `, up to RM${o.cap}` : ""}`;
  return `RM${o.value} off`;
}

// Where a scan lands. Built from the PUBLISHING page's own address rather than a
// hardcoded domain, so the card cannot point at a host that is not the one she is
// printing from — and the same string is printed under the square in words, so a
// card that ever pointed somewhere wrong would be wrong visibly, on the paper,
// before it was handed to anyone.
export function shopLink(code, base) {
  return new URL(`../store/?promo=${encodeURIComponent(normCode(code))}`, base).href;
}

/* EVERY FIELD THE CARD CARRIES, as data. The test holds this against a frozen
   code and fails if a family is missing — a card that omits what the shop judges
   is a card that disagrees with the shop — and equally fails if a date or a count
   ever appears here, because those are the two promises the paper cannot keep.

   `base` is the ADDRESS OF THE PAGE THE CARD IS BUILT FROM, not the link that ends
   up on it. Passing the page's own address is what lets shopLink() work the shop's
   location out for itself — and a caller that handed over the address of the page
   in the belief it was the link would print a square pointing back at the admin
   screen, which is the one mistake on this card nobody would notice until a
   customer scanned it.                                             */
export function cardFields(code, brand = {}, base = "") {
  const c = normalizeCode(code);
  const min = minimumOf(c);
  const rules = [];
  if (c.who.type === "first") rules.push("First order only");
  if (c.often.type === "once") rules.push("One per customer");
  if (c.beside.type === "nocredit") rules.push("Not with the bring-a-friend welcome discount");
  const url = shopLink(c.code, base || "https://munchies.com.my/admin/promo-card.html");
  const host = (() => { try { return new URL(url).host; } catch { return ""; } })();
  return {
    name: String(brand.name || "").trim() || FALLBACK_BRAND.name,
    tagline: String(brand.tagline || "").trim() || FALLBACK_BRAND.tagline,
    code: c.code,
    offer: offerLine(c),
    minimum: min,
    minimumLine: min > 0 ? `on RM${min} and above` : "",
    rules,
    sentence: c.say,
    url,
    where: host ? `Scan to order, or type it at ${host}/store/` : "Scan to order",
  };
}

// One card, as DOM. Built from the same fields object the test reads, so the
// paper and the test can never be looking at two different cards.
//
// The square is drawn by jerky's OWN encoder (js/qr.js, written for the printed QR
// labels and carrying a PNG path the bakery's does not need). It throws on a string
// past its capacity rather than answering null, so a card whose link somehow could
// not be drawn leaves the square out instead of failing the whole page.
function cardEl(f) {
  let square = null;
  try { square = qrSvg(qrMatrix(f.url), { quiet: 4, dark: "#2b1d14", light: "#ffffff" }); }
  catch { square = null; }
  return el("article", { class: "card6" },
    el("p", { class: "c-brand" }, f.name),
    el("p", { class: "c-tag" }, f.tagline),
    el("div", { class: "c-mid" },
      el("p", { class: "c-offer" }, f.offer),
      f.minimumLine ? el("p", { class: "c-min" }, f.minimumLine) : null,
      f.sentence ? el("p", { class: "c-say" }, f.sentence) : null,
      f.rules.length ? el("p", { class: "c-rules" }, f.rules.join(" · ")) : null),
    el("div", { class: "c-code" }, f.code),
    el("div", { class: "c-qr" }, square ? el("div", { html: square }) : null),
    el("p", { class: "c-where" }, f.where));
}

// Four to a sheet, which is what an A4 page holds of A6 exactly — a stack of
// identical cards from one press, with a hairline guide to cut along. The same
// card four times rather than four different cards: a promotion is one code
// handed to many people, and four different codes on one sheet would be four
// things to keep apart by hand.
export function renderCard(root, fields) {
  root.replaceChildren(
    el("div", { class: "sheet" }, ...Array.from({ length: 4 }, () => cardEl(fields))));
}

// A page that says why there is no card, rather than a blank sheet she would
// print by mistake. Every one of these is a card she should not hand out.
export function renderNotice(root, wanted, reason) {
  const lines = {
    nocode: "This page prints one promo card, so it needs to be told which code. Open it from the Promo codes screen — the Print it press on a code's row.",
    unknown: `"${wanted}" is not a code on this device. A card's offer is read from your own codes, so print from the phone that holds them.`,
  };
  // The Print button goes with the card: on a page that has none it would be a
  // control that does nothing but print this message. Hidden by a CLASS rather
  // than the `hidden` attribute — the bar is laid out with `display:flex`, which
  // outranks the browser's own [hidden] rule, so the attribute would leave it
  // sitting there looking ready to press.
  const doc = root.ownerDocument;
  const bar = doc && doc.querySelector ? doc.querySelector(".bar") : null;
  if (bar) bar.classList.add("is-off");
  root.replaceChildren(el("div", { class: "notice" },
    el("p", {}, lines[reason] || lines.nocode),
    el("p", { class: "hint" },
      "Nothing has been changed. Printing is the only thing that freezes an offer, and nothing was printed.")));
}

// The page. Kept out of module scope so this file can be imported in Node (the
// test reads cardFields) without a document having to exist first.
export function boot(win = globalThis) {
  const doc = win.document;
  const root = doc.getElementById("card");
  if (!root) return;
  const wanted = new URLSearchParams(win.location.search).get("code") || "";
  if (!wanted) return renderNotice(root, "", "nocode");
  const state = loadState();
  const code = findCode(state.promoCodes, wanted);
  if (!code) return renderNotice(root, wanted, "unknown");
  const brand = (state.settings && state.settings.storefront) || {};
  renderCard(root, cardFields(code, brand, win.location.href));
  const print = doc.getElementById("print-btn");
  if (print) print.addEventListener("click", () => win.print());
}
