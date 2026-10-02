// views/orders.js — per-delivery-date order intake (manual, warn-not-block).

import { addDays, deliveryStatus, fmtPlaced, longDate, shortDate, todayISO, weekdayName } from "../dates.js";
import { capacityStatus, dayCapacityParts, dayRuleRows, parseDayDelta, productRemaining, saveDayAdjustments } from "../bom.js";
import { dayMoney, groupValue, isCollected } from "../money.js";
import { el, button, select, fillMeter, emptyState, confirmDialog, toast, showPopup } from "../ui.js";
import { dateField } from "../datepicker.js";
import { DOW, WINDOW_WEEKS, deliveryWindow, occColour, occForDate, rollingWeeks,
  windowTitle } from "../calendar.js";
import { boxClass, nameDay, occBox, occPapers, tipEl } from "../occgrid.js";
// A product's sell days — the shared root copy the shop reads, so the day this
// pop-up counts a product on is exactly the day the shop offers it.
import { availSummary, sellOpen } from "../../../availability.js";
// The cap and the trimming rule for a customer's note on ONE item (v236) — the
// same pair the shop applies, from the one module both sides read, so a note can
// never be longer on this side than the box that collected it allowed.
import { lineNoteOf, LINE_NOTE_MAX } from "../../../storefront-fields.js";
import { byId, fmtRM, groupOrders, moveOrderGroup, newId, orderCode, orderLineName, orderLinePrice, save, stampOrderLine, updateOrderBadge, waNumber } from "../state.js";
import { strictestCancelDays } from "../../../store/pool.js";
import { buildConfirmation } from "../confirm.js";
import { buildPaymentReminder, buildPickupReminder, buildShippedMessage } from "../messages.js";
import { maybePublishTracking, maybeSync, publishTracking } from "../supabase.js";
import { writeCourierCharge, courierFeeOf, courierPayerOf, courierCodOf, isCourierOrder, codeMissed, codeNotApplied, customerTotal, receiptNote, receiptRows, promoOn, promoValue } from "../courier.js";
import { methodsOf } from "../accounts.js";
import { schemeOf, referralFlag, giveCredits, validCredits, markOneUsed, referrerName } from "../referrals.js";
import { promoOf, KIND_LABEL, offerLine } from "../codes.js";
import { adjustForStatus } from "../stock.js";
import { customerList, keyOf } from "../customers.js";
import { strictNumber } from "../courier_place.js";
import { fmtStamp, jobOf } from "../courier_job.js";
// The second KIND of courier (v226): a parcel she books herself and the app only
// records. See js/parcel.js for why it is a record and not a provider.
import { parcelOf, parcelHanded, setParcel, markHanded, clearParcel, notParcelable } from "../parcel.js";
import { courierQuoteSection } from "./courier_quote.js";
import { attachProfiles, customerNameMatches, customerRowName, syncContactFromOrder } from "../profiles.js";
// The half-typed address suggestions (v228). Reached through the same channel the
// pin's lookup uses, so the Google key stays on the server and never touches this page.
import { suggestAddresses } from "../couriers/api.js";
// The one spelling a promo code is recognised by (v270). An order's own code is
// read back through it, so a stray lowercase in some older record cannot make two
// spellings of one code look like two codes on the row.
import { normCode } from "../promo.js";

let orderStatusFilter = "";
// Text in the "Find an order" box at the top of the Orders screen (empty = box
// unused). Kept across in-place rebuilds so a sync pull or a row action doesn't
// drop what the baker is searching for; renderOrders clears it for a fresh visit.
let orderQuery = "";
// Set just before an in-place rebuild that came from a row's own control
// (status dropdown, Edit). renderAll then keeps THAT order row pinned to its
// current screen spot across the rebuild — the row the baker is touching must
// never move, no matter how the New-orders box or the form above change size.
let anchorRowId = null;
// The week the Orders screen's calendar is showing, as { offset } — whole weeks
// forward from today's own week, null until the first render settles it on the day
// that opens. It lives out here, not inside the render, so paging forward to look
// at a later week survives a rebuild the baker did not ask for (a sync pull, a
// status change).
let ordersCalView = null;
// Whether the ＋ New order card is open. Also module scope, because the card is
// rebuilt whenever anything around it changes — including when a day is tapped in
// its own calendar — and folding under her finger at that moment would be mad.
let newFormOpen = false;
// THE WHOLE DRAFT of the ＋ New order card, held out here for the same reason as the fold
// above: the card is rebuilt whenever anything around it changes, and that includes
// tapping a day in the card's OWN calendar (onPick is selectDate, which redraws the
// screen). A draft built fresh inside orderForm therefore loses everything you typed —
// and not only the customer boxes. Measured in v237: `items` was declared inside
// orderForm as well, so the item rows went with it too; the old comment on this line
// claimed "only the item rows ever came back", and that was never true. Now that the
// day line sits UNDER the items, picking a day from this card is an ordinary thing to do
// part-way through an order, so the whole draft — items included — has to outlive the
// rebuild. Cleared on a fresh visit to the screen (with the fold) and when an add
// actually completes — never when one is merely asked for, since the capacity and
// closed-day warnings can still be cancelled.
let newOrderDraft = null;
// Whether the card's day calendar is unfolded under its one-line day, and which week it
// is paged to. Both module scope for that same rebuild reason. `newFormDayView` is
// handed straight to deliveryCal, which mutates it in place when its arrows are pressed —
// so paging forward to look at a later week survives a rebuild for free.
let newFormDayOpen = false;
let newFormDayView = null;

const STATUSES = [
  ["new", "New"],
  ["confirmed", "Confirmed"],
  ["paid", "Paid"],           // TNG payment received, right after Confirmed
  ["baking", "Preparing"],    // internal id unchanged — no schema migration
  ["ready", "Packed"],
  // The last stage is one label covering both endings. v97 named it per order
  // (Collected here, Shipped there); she asked for the pair itself instead, so the
  // stage reads the same on every row and in every list (16 Sep 2026).
  ["delivered", "Collected / Posted"],
];
// Where the money stage sits in that list. Used to tell "past Paid" from "on Paid", so a
// regular who pays at the counter has no Paid step on their route at all.
const PAID_AT = STATUSES.findIndex(([id]) => id === "paid");
// Where the label's stage sits: from Baked onwards there is a bag to kit, and the order
// label is offered at all of them rather than only on Baked itself (v268).
const BAKED_AT = STATUSES.findIndex(([id]) => id === "baking");
// Paid and everything after it: moving an order into any of these without the money recorded
// means that order is owed money, not that it was paid.
const STAGES_AT_OR_PAST_PAID = STATUSES.slice(PAID_AT).map(([id]) => id);

// A small route map shown when a delivery date has no orders yet, so the screen
// still explains the journey: New → Confirmed → Paid → Preparing → Packed →
// Collected / Posted. Real rows carry their own mini journey below them instead.
function statusFlowEl() {
  const kids = [];
  STATUSES.forEach(([, label], i) => {
    if (i) kids.push(el("span", { class: "flow-arrow", "aria-hidden": "true" }, "→"));
    kids.push(el("span", { class: "flow-step" }, label));
  });
  return el("div", { class: "status-flow", "aria-label": "Order status flow" }, ...kids);
}

// How far an order has actually travelled, as a prefix of done steps. New is
// done the moment the order arrives. Confirmed only finishes when the baker
// presses "Send confirmation" (order.confirmedSent), and Paid only when they
// press the "Paid" button (order.paidReceived) — just picking those in the
// dropdown leaves them as the next thing to do. Preparing/Packed/Delivered
// finish the moment they are picked (no extra action). Orders saved before these
// fields existed have no flag, which reads as already done, so old confirmed /
// paid orders don't light up as if they were never handled.
export function journeyMarks(order) {
  const status = String((order && order.status) || "new");
  const idx = STATUSES.findIndex(([id]) => id === status);
  const at = idx < 0 ? 0 : idx;
  const confirmedDone = (order && order.confirmedSent) !== false;
  const paidDone = (order && order.paidReceived) !== false;
  // Some regulars pay at the counter, so their order goes from Confirmed straight to Preparing
  // and never passes through Paid. Once an order is PAST that stage owing money, the step
  // stays exactly where it is but wears an X instead of a tick — a mark that says "gone past,
  // not paid" — and it must never turn green (17 Sep 2026). Leaving the step out was tried
  // first and rejected: the customer's line and yours have to read the same, in the same
  // places. Press Paid · Cash / Paid · TNG and the X becomes the green tick.
  const paidSkipped = !paidDone && at > PAID_AT;

  // Which steps are behind the order, then the first one that is not becomes the live step —
  // exactly one pulsing dot, as the row has always shown.
  const done = STATUSES.map((_, i) => {
    if (i < at) return true;                     // already moved past
    if (i > at) return false;
    if (i === 0) return true;                    // New: done on arrival
    if (i === 1) return confirmedDone;           // Confirmed: after Send confirmation
    if (i === PAID_AT) return paidDone;          // Paid: after the Paid button
    return true;                                 // Preparing/Packed/Collected-Posted: on selection
  });
  let live = false;
  return STATUSES.map((_, i) => {
    if (i === PAID_AT && paidSkipped) return "skipped";
    if (done[i]) return "done";
    if (!live) { live = true; return "now"; }
    return "todo";
  });
}

// Every order row shows its own copy of the journey with where THAT order sits:
// reached steps are green with a tick, the step waiting for the baker is the
// pulsing amber dot, later steps stay grey. The baker sees at a glance, under
// each row, where every order is on the route — and watches the dot move as the
// status changes and the Send confirmation / Paid / pickup-reminder actions are
// done. An order at the last stage shows the whole line green, matching what the
// customer sees.
function orderJourneyEl(order) {
  const root = el("div", { class: "oj", "aria-label": "Order status journey" });
  const marks = journeyMarks(order);
  STATUSES.forEach(([, label], i) => {
    const state = marks[i];
    const mark =
      state === "done" ? el("span", { class: "oj-check" }, "✓")
      // Gone past without the money: the step keeps its place and wears an X, so the order's
      // route reads the same as everyone else's and the one step that is owed is visible.
      : state === "skipped" ? el("span", { class: "oj-cross" }, "✕")
      : state === "now" ? el("span", { class: "oj-dot" }) : null;
    root.append(el("div", { class: `oj-step ${state}` }, [
      el("div", { class: "oj-track" }, [el("div", { class: "oj-node" }, mark)]),
      el("div", { class: "oj-label" }, label),
    ]));
  });
  return root;
}

// Picking Confirmed in the dropdown is what marks the moment the baker starts
// confirming — and confirming needs the customer's WhatsApp number to send the
// confirmation message. So an order without a number can't be moved to
// Confirmed. Later stages don't block: they advance the physical order even for
// a walk-in with no number (their Send/Paid buttons simply stay disabled until
// one is added). Exported so the gate is testable without a DOM.
export function statusNeedsWhatsapp(status) {
  return ["confirmed"].includes(status);
}

// Apply shared detail edits to every order in a storefront group (customer
// name, phone, delivery method, address, note, order date) plus each item's new
// quantity from its stepper. Pure — exported so the group-edit behaviour is
// testable without a DOM.
export function filterOrderGroups(groups, status) {
  if (!status) return groups;
  // Match the status the group *displays* (its first item's), not "any item in
  // the group". A storefront group shows one status dropdown that applies to the
  // whole order, so filtering by any item would make a mixed-status group appear
  // under every filter at once — e.g. a leftover Delivered order still showing
  // when another status is selected.
  return (groups || []).filter((g) => (((g.orders && g.orders[0]) || {}).status || "new") === status);
}

export function applyGroupPatch(orders, patch, qtyOf) {
  for (const o of orders || []) {
    if (qtyOf) o.qty = qtyOf(o.id);
    o.customerName = patch.customerName;
    o.whatsapp = patch.whatsapp;
    o.fulfillment = patch.fulfillment;
    o.address = patch.address;
    o.note = patch.note;
    o.orderDate = patch.orderDate;
  }
  return orders;
}

// The customer's own words for one item, bracketed exactly as a line spells them
// — the one place that bracket is written, so the underline on the row and on the
// printed label wraps the same characters the search and the tests read (v244).
export function lineNoteSuffix(rawNote) {
  const note = lineNoteOf(rawNote);
  return note ? ` (${note})` : "";
}

// One ordered item as one line of text, with the note that belongs to IT in
// brackets — "Focaccia 800g ×2 (no nuts)". This is the single place the order
// list, the packing slip and the label sheet spell a line, so the customer's
// words can never appear on one of them and be missing from another (v236).
export function orderLineText(state, o) {
  return `${orderLineName(state, o)} ×${Number(o && o.qty) || 1}${lineNoteSuffix(o && o.lineNote)}`;
}

// That same line, split at the note's bracket, for the two places that underline
// it (v244): the head is everything up to the bracket, the suffix is the bracket
// itself. A line with no note comes back whole with an empty suffix, so a caller
// can always draw the pair without first asking whether there is a note.
export function splitOrderLine(state, o) {
  const text = orderLineText(state, o);
  const suffix = lineNoteSuffix(o && o.lineNote);
  return { head: suffix ? text.slice(0, text.length - suffix.length) : text, suffix };
}

// A line drawn with the customer's words underlined, so a note is never lost in
// the grey beside a busy row or on a printed sheet (v244). Built from the one
// string orderLineText owns, so the screen, the label and the search cannot
// disagree about what the line says — only about how it is drawn.
function orderLineNodes(state, o) {
  const { head, suffix } = splitOrderLine(state, o);
  return suffix ? [head, el("span", { class: "line-note" }, suffix)] : [head];
}

// A dot-separated line drawn from pieces, where any piece may be marked to wear
// the same underline the per-item note does (v245) — the order row's sub-line is
// name · number · delivery note, and only the last of those is the customer's own
// words. Blank pieces are dropped, and the separator goes only BETWEEN the pieces
// that survive, so no dangling dot can print.
function subLineNodes(parts) {
  const nodes = [];
  for (const p of parts) {
    const text = String(p.text == null ? "" : p.text).trim();
    if (!text) continue;
    if (nodes.length) nodes.push(" · ");
    nodes.push(p.mark ? el("span", { class: "line-note" }, text) : text);
  }
  return nodes;
}

// A sheet row is [class, text] or [class, text, mark], where `mark` names what
// the sheet underlines — the customer's own words, never a re-spelling of them.
// A row that holds ONE item carries one run, and it is the tail of `text` (v244).
// The Compact row joins every item, so it carries a list of runs instead, in the
// order the items print (v245). A row with nothing to mark stays the plain pair
// it always was, which is what keeps the sheet's own tests honest about the
// no-note case.
export function sheetItemRow(state, o, cls) {
  const line = orderLineText(state, o);
  const mark = lineNoteSuffix(o && o.lineNote);
  return mark ? [cls, line, mark] : [cls, line];
}

// Every item on ONE row — the Compact style. The line is the same joined text it
// always was; what it must not do is drop the notes, which is exactly what it did
// while the items were joined as plain strings: a "no nuts" on the second of four
// items printed on the sheet as ordinary words, with nothing to pick it out
// (v245). One run per noted item, in printing order, so the sheet can underline
// each where it falls. No noted item means the plain pair it always was.
export function sheetItemsRow(state, orders, cls = "items") {
  const lines = orders.map((o) => orderLineText(state, o));
  if (!lines.length) return null;
  const marks = orders.map((o) => lineNoteSuffix(o && o.lineNote)).filter(Boolean);
  return marks.length ? [cls, lines.join(" · "), marks] : [cls, lines.join(" · ")];
}

// The order's OWN note as a sheet row (v245). It is the delivery note, and it
// applies to a self-collect order exactly as much as to a courier one, so the one
// row is pushed by every style that prints the order's fields rather than written
// out three times. The note itself is the marked run, leaving the "Note: " label
// to the sheet's own styling.
export function sheetNoteRow(noteText, cls = "note") {
  const note = String(noteText || "").trim();
  return note ? [cls, `Note: ${note}`, note] : null;
}

// Packing labels print from a small pure model so the on-screen preview and the
// printed sheet always match, and the model is testable without a DOM. `style`
// picks the density: "full" = every useful field (one line per item, the note,
// the courier address), "compact" = code + customer + items on one line (courier
// address still shown), "name" = code + customer in the largest type, for a bag
// matched at a glance. Blank fields are dropped so no empty rows print.
export function packingLabelData(state, group, style = "full") {
  const orders = (group && group.orders) || [];
  const first = orders[0] || {};
  const dateEl = first.deliveryDateId ? byId(state.deliveryDates, first.deliveryDateId) : null;
  const dateStr = (dateEl && dateEl.date) || first.deliveryDate || "";
  const dateLine = dateStr ? shortDate(dateStr) : "";
  const courier = first.fulfillment === "courier";
  const method = courier ? "Post (nationwide)" : "Collect (local)";
  const customer = String(first.customerName || "").trim();
  const note = String(first.note || "").trim();
  const address = courier ? String(first.address || "").trim() : "";
  const bakery = String((state.settings && state.settings.storefront
    && state.settings.storefront.name) || "Munchies Furkidz").trim();
  const code = `#${orderCode(first)}`;

  // Unknown styles fall back to full so the returned style is always one the
  // sheet CSS and pill row understand.
  if (style !== "name" && style !== "compact" && style !== "mailing") style = "full";

  if (style === "mailing") {
    // A parcel label: three addressed blocks. FROM comes from the bakery's own
    // "mailing address" (typed once in Settings), TO is the customer, and the
    // order block is the reference the parcel is packed against.
    const senderRaw = String((state.settings && state.settings.mailingAddress) || "").trim();
    const senderLines = senderRaw.split(/\n+/).map((s) => s.trim()).filter(Boolean);
    const recipientAddress = address
      ? address.split(/\n+/).map((s) => s.trim()).filter(Boolean) : [];
    const rows = [];
    rows.push(["mail-sec", "FROM"]);
    if (senderLines.length) {
      for (const ln of senderLines) rows.push(["mail-line", ln]);
    } else {
      rows.push(["mail-line", "Set your business address in Settings → Mailing labels"]);
    }
    rows.push(["mail-sec", "TO"]);
    if (customer) rows.push(["mail-name", customer]);
    const phone = String(first.whatsapp || "").trim();
    if (phone) rows.push(["mail-line", phone]);
    for (const ln of recipientAddress) rows.push(["mail-line", ln]);
    rows.push(["mail-sec", "ORDER"]);
    rows.push(["mail-line", [code, dateLine && `Post ${dateLine}`].filter(Boolean).join(" · ")]);
    for (const o of orders) rows.push(sheetItemRow(state, o, "mail-line"));
    const mailNote = sheetNoteRow(note, "mail-line");
    if (mailNote) rows.push(mailNote);
    return { style, rows };
  }

  const rows = [["brand", bakery]];
  if (style === "name") {
    rows.push(["code", code]);
    if (customer) rows.push(["customer", customer]);
    else if (dateLine) rows.push(["date", dateLine]);
    return { style, rows };
  }
  if (style === "compact") {
    rows.push(["code", code]);
    if (customer) rows.push(["customer", customer]);
    const itemsRow = sheetItemsRow(state, orders);
    if (itemsRow) rows.push(itemsRow);
    // The delivery note prints here too (v245). It used to be the one field
    // Compact dropped, which meant a note about the doorstep vanished the moment
    // she picked the denser label — on a self-collect order as much as a courier
    // one. It sits exactly where the full style puts it: after the items, before
    // the courier address.
    const compactNote = sheetNoteRow(note);
    if (compactNote) rows.push(compactNote);
    if (address) rows.push(["address", address]);
    return { style, rows };
  }
  if (dateLine || method) rows.push(["meta", [dateLine, method].filter(Boolean).join(" · ")]);
  rows.push(["code", code]);
  if (customer) rows.push(["customer", customer]);
  for (const o of orders) rows.push(sheetItemRow(state, o, "item"));
  const fullNote = sheetNoteRow(note);
  if (fullNote) rows.push(fullNote);
  if (address) rows.push(["address", `Post to: ${address}`]);
  return { style, rows };
}

// ── The ＋ New order card folds away ─────────────────────────────────────────
// It sits on every delivery day and is not what the screen is for day to day, so
// it starts shut. One document listener serves it, and a card taken off the page
// is simply dropped from the list on the next tap — nothing has to be unhooked
// when a rebuild replaces it. Installed from renderOrders rather than at module
// scope, because this module is imported by tests whose `document` is a shim, and
// a few of those shims have no addEventListener to install onto.
const openOrderCards = new Set();
let orderCollapseInstalled = false;
// The layers that sit ABOVE the page — a confirmation, a pop-up, the lock. A press
// that lands on one of them has not landed on the page behind it, so it must not fold
// a card: the card that opened the confirmation is the one it is asking about.
const OVERLAY_LAYERS = ["popup-layer", "confirm-layer", "lock-layer"];

function installOrderCollapseOutside() {
  if (orderCollapseInstalled || typeof document === "undefined"
      || typeof document.addEventListener !== "function") return;
  orderCollapseInstalled = true;
  document.addEventListener("pointerdown", (ev) => {
    // A press that lands on a layer ABOVE the page — the confirmation the card
    // itself opened, a pop-up, the lock — is not a press on the page behind it,
    // and the card that opened it must survive it. Without this the door's
    // "Look this address up again" asked, she tapped "Reset the pin" in the
    // confirmation, and the order card she was writing folded out from under
    // her while the look-up went on to write the order.
    for (const id of OVERLAY_LAYERS) {
      const layer = document.getElementById(id);
      if (layer && !layer.hidden && layer.contains && layer.contains(ev.target)) return;
    }
    for (const ctl of [...openOrderCards]) {
      if (ctl.card.isConnected === false) { openOrderCards.delete(ctl); continue; }
      if (!ctl.card.contains(ev.target)) ctl.close();
    }
  });
}

export function renderOrders(root, state, params) {
  orderStatusFilter = "";
  orderQuery = ""; // a fresh visit to Orders starts with an empty finder box
  newFormOpen = false;  // …and with the New-order card shut
  newFormDayOpen = false; // …its day calendar folded back up
  newFormDayView = null; // …and paged to the day that opens
  newOrderDraft = null; // …and with nothing half-typed inside it
  ordersCalView = null; // …and on the week of the day that opens
  installOrderCollapseOutside();
  renderAll(root, state, params);
  // Everything built above goes away with this screen — forget the open cards so
  // a later tap cannot reach into one that is no longer on the page.
  return () => openOrderCards.clear();
}

// ---- Finder: search every order (any date, any status) ----

// One compact "searchable text" per order group covering everything the baker
// might type: customer name, the order's #code, the WhatsApp number (as typed
// and digits-only), item names, note, address, delivery method and delivery
// day. Lowercased so matches are case-insensitive.
function groupSearchText(state, group) {
  const words = [];
  const digitChunks = [];
  for (const o of group.orders || []) {
    const product = o.productId ? byId(state.products, o.productId) : null;
    words.push(orderLineName(state, o)); // the name this order was sold under
    const code = orderCode(o);
    words.push(`#${code}`, code);
    words.push(o.customerName);
    words.push(o.whatsapp);
    const wa = waNumber(o.whatsapp);
    if (wa) digitChunks.push(wa);
    words.push(o.note);
    // The note on THIS item (v236), so typing "nuts" finds the order that asked
    // for no nuts — the same reason the order-level note is searchable above.
    words.push(o.lineNote);
    words.push(o.address);
    words.push(o.fulfillment === "courier" ? "post (nationwide)" : "collect (local)");
    if (product && product.name) words.push(product.name);
    if (o.deliveryDate) words.push(o.deliveryDate); // "2026-09-07" works too
    const date = o.deliveryDateId ? byId(state.deliveryDates, o.deliveryDateId) : null;
    if (date) words.push(shortDate(date.date));
  }
  return {
    text: words.filter(Boolean).join(" ").toLowerCase(),
    digits: digitChunks.join(" "),
  };
}

// Order groups whose every search word shows up somewhere in the order: a name,
// a code ("#A3F9C2" or just its digits), a WhatsApp number typed with or
// without dashes/+, an item name, the note, the address or a delivery day. All
// words must match (so "ain focaccia" narrows to one order). Recency-sorted,
// most recent first. Pure — the finder box wires this up to the DOM.
export function matchingGroups(state, query) {
  const tokens = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  return groupOrders(state.orders || []).filter((group) => {
    const hay = groupSearchText(state, group);
    return tokens.every((tok) => {
      if (hay.text.includes(tok)) return true;
      const digits = tok.replace(/[^0-9]/g, "");
      return digits.length >= 2 && hay.digits.includes(digits);
    });
  }).sort((a, b) => String(b.orders[0].createdAt || "")
    .localeCompare(String(a.orders[0].createdAt || "")));
}

// ── The delivery-day calendar ────────────────────────────────────────────────
// What the Orders screen shows at the top instead of the old sideways strip of
// date pills: the same calendar the shop shows its customers, with each day the
// bakery delivers carrying how booked it is. A strip could only ever show a
// handful of days and made a distant date something to hunt for.
//
// It draws the shop's ROLLING WINDOW and not a month (v243): five Sun-first weeks
// beginning with the week just gone, so the row above today is always last week,
// today is always in the second row, and no cell is ever empty padding. The arrows
// slide one week and are GONE at the ends of the days she has set, where a month
// grid greyed them out — and at the end of a month most of what it drew was days
// already gone.
//
// `days` is deliveryDayList(state) on this screen (the Edit pop-up passes its own
// shorter list); a day in it is tapped to open it, and a day on the grid with no
// delivery record is drawn quietly and does nothing. `getActiveId()` is read on
// every paint rather than captured, so a rebuild marks the day actually on screen,
// and `view` is the caller's own { offset } — whole weeks forward from today's own
// — paged in place, so the week she is looking at survives that rebuild.
//
// `noteMisses` turns on one extra thing: tapping a day the bakery does not deliver
// is ANSWERED instead of swallowed — the calendar says the day is not a delivery
// day, and where it gets added. The baker is on these screens to put an order
// somewhere, so a tap that does nothing is a dead end she has to guess her way out
// of (15 Sep 2026: she tapped a marked 16 Sep, read "Malaysia Day", and had no way
// of knowing why no order could go on it). The state is this calendar's own, in
// its closure: nothing outside the grid answers for it.
export function deliveryCal({ state, days, getActiveId, view, onPick, noteMisses = false }) {
  const list = (days || []).filter((d) => d && d.id && d.date);
  const today = todayISO();
  let missedIso = null; // the day she asked about and the bakery does not deliver
  const byDate = new Map(list.map((d) => [d.date, d.id]));
  // How far the arrows may go, and where an unsettled view opens: the ends of the
  // days she has actually set, so neither arrow ever leads to a week with nothing
  // on it.
  const bounds = deliveryWindow(today, list.map((d) => d.date));
  let slide = 0; // which way the last arrow moved — an arrival, never a redraw

  const wrap = el("div", { class: "cal-wrap" });

  // The answer to a tap the calendar cannot act on: the day she asked about, said
  // plainly, and where it is added. It is a line under the grid and not a bubble
  // over the day — a bubble is where a marked day names itself, but this sentence
  // is a whole line long and would run off the side of a phone.
  function missNote() {
    if (!missedIso) return null;
    return el("p", { class: "cal-miss" },
      `${shortDate(missedIso)} is not a delivery day. Add it in More → Delivery Dates.`);
  }

  function paint() {
    const active = getActiveId();
    // A view the caller has not settled yet — or has just cleared — opens on the
    // day the calendar is on: today's own week when that day is near today, and
    // otherwise the week that brings it into today's row. A calendar that opened
    // on today instead would leave the Edit pop-up showing nothing of the order
    // whose day she came to move.
    if (view.offset == null) {
      const activeDate = list.find((d) => d.id === active)?.date;
      view.offset = activeDate ? windowForDay(today, activeDate) : bounds.home;
    }
    view.offset = Math.min(bounds.max, Math.max(bounds.min, view.offset));
    const go = (delta) => {
      const next = Math.min(bounds.max, Math.max(bounds.min, view.offset + delta));
      if (next === view.offset) return; // no week that way; the arrow is not drawn either
      view.offset = next;
      slide = delta;
      paint();
    };
    // Where there is nowhere to go the arrow is not drawn at all, so a tap can
    // never do nothing — a greyed button reads as a bug ([feedback-affordances]).
    const prev = view.offset > bounds.min
      ? button("‹", () => go(-1), "ghost small cal-nav")
      : el("span", { class: "cal-slot" });
    const next = view.offset < bounds.max
      ? button("›", () => go(1), "ghost small cal-nav")
      : el("span", { class: "cal-slot" });

    const weeks = rollingWeeks(today, { offset: view.offset });
    const cells = weeks.flat().map((iso) => {
      // The baker's own occasion marks are drawn here too — a holiday she marked
      // is worth seeing while she is deciding which day to open, and a day the
      // bakery does not deliver has no other way of saying so.
      const past = iso < today;
      const box = boxClass(occBox(state.occasions, iso, past));
      const num = el("span", { class: "cal-num" }, String(Number(iso.slice(8, 10))));
      const tip = tipEl(state.occasions, iso, past);
      const dateId = byDate.get(iso);
      // A day the bakery does not deliver: a quiet number, nothing to open — but a
      // marked day still says its name when tapped, or a holiday falling on a day
      // she does not deliver would be the one day on the grid with no way to be
      // read (the customer's shop page names that day too).
      if (!dateId) {
        // A day already gone takes `past` on top of `off`, so the whole past — the
        // days she delivers and the days she does not — is the shop's one grey.
        // Without this the past came out in two shades: .off at .6 for the days she
        // does not deliver, .past for the days she does.
        const cls = `cal-cell off${past ? " past" : ""}${iso === today ? " today" : ""}${box}`;
        // A day already gone is asked nothing: there is nothing left to add to it,
        // and the past is reviewed in the list below, not on the grid.
        const askable = noteMisses && !past;
        if (!tip && !askable) return el("span", { class: cls, dataset: { date: iso } }, num);
        return el("button", {
          class: `${cls} ${tip ? "tippable" : "tappable"}`,
          dataset: { date: iso },
          onclick: () => {
            nameDay(state.occasions, iso, past); // names a marked day, exactly as everywhere else
            if (askable) missedIso = iso;
            paint();
          },
        }, num, tip);
      }
      const cap = capacityStatus(state, dateId);
      const st = deliveryStatus(iso, state.settings);
      const full = cap.capacity > 0 && cap.total >= cap.capacity;
      let cls = "cal-cell deliv stacked";
      // A day already gone still opens — she backfills and reviews old days — so
      // it is dimmed rather than disabled, and a day at capacity still opens too.
      if (dateId === active) cls += " sel";
      else if (st.past) cls += " past";
      if (iso === today) cls += " today";
      if (st.closed && !st.past) cls += " closed";
      if (full) cls += " full";
      cls += box;
      // Naming the day comes BEFORE opening it: the pick usually re-renders the
      // whole screen, calendar included, and the rebuilt grid draws its bubbles
      // from the day this module was just told about.
      return el("button", {
        class: `${cls} tappable`,
        dataset: { date: iso },
        // Naming the day comes BEFORE opening it, as it always has; the repaint
        // before handing over is what takes the "not a delivery day" answer away,
        // so the grid never relies on the caller to tidy up after it.
        onclick: () => {
          missedIso = null;
          nameDay(state.occasions, iso, past);
          paint();
          onPick(dateId);
        },
      }, num, el("span", { class: "cal-count" }, full ? "FULL" : `${cap.total}/${cap.capacity}`), tip);
    });

    const note = missNote();
    // The slide is read and cleared in the same breath, so the new week arrives
    // once and an ordinary redraw never replays it (store/app.js does the same).
    const sl = slide;
    slide = 0;
    wrap.replaceChildren(
      el("div", { class: "cal-head weeks" },
        prev,
        el("span", { class: "cal-title" },
          windowTitle(weeks[0][0], weeks[WINDOW_WEEKS - 1][6])),
        next),
      el("div", { class: "cal-grid", dataset: sl ? { slide: sl > 0 ? "up" : "down" } : null },
        ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
        ...cells,
        ...occPapers(state.occasions, weeks, today)),
      ...(note ? [note] : []));
  }

  paint();
  return { el: wrap, repaint: paint };
}

// The week a day is shown in: today's own when the day is anywhere near it, and
// otherwise the week that brings the day into today's row. It is the same rule
// deliveryWindow uses for a whole list, asked about one day.
function windowForDay(today, iso) {
  return deliveryWindow(today, iso ? [iso] : []).home;
}

function renderAll(root, state, params) {
  const dates = [...state.deliveryDates].sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) {
    root.replaceChildren(emptyState("No delivery dates yet",
      "Add delivery dates first — go to More → Delivery Dates."));
    return;
  }
  // In-place rebuilds (status change, add, edit, remove) must not let the
  // screen jump under the baker's finger: the New-orders inbox above the
  // calendar grows/shrinks as orders are handled, and the New/Edit form changes
  // height, so everything below would otherwise snap up or down. Pin the row
  // the baker is acting on (set via anchorRowId) back to its screen spot; when
  // that row is gone (e.g. removed, or filtered out) pin the Orders list top
  // instead. A fresh route render (the router cleared #view first) finds
  // neither and starts at the top as usual.
  const scroller = () => document.scrollingElement || document.documentElement;
  const listBefore = root.querySelector('[data-role="orders-list"]');
  const anchorTop = listBefore ? listBefore.getBoundingClientRect().top : null;
  let rowTop = null;
  if (anchorRowId) {
    const rowEl = root.querySelector(`[data-order="${anchorRowId}"]`);
    if (rowEl && typeof rowEl.getBoundingClientRect === "function") {
      rowTop = rowEl.getBoundingClientRect().top;
    }
  }
  const requested = params.get("date");
  let activeId = (requested && dates.some((d) => d.id === requested))
    ? requested
    : (dates.find((d) => d.date >= todayISO())?.id || dates[dates.length - 1].id);

  if (!ordersCalView) ordersCalView = { offset: null };
  const topCal = deliveryCal({
    state,
    days: deliveryDayList(state),
    getActiveId: () => activeId,
    view: ordersCalView,
    onPick: (id) => selectDate(id),
    noteMisses: true,
  });
  const content = el("div", {});

  const renderContent = () => {
    const date = byId(state.deliveryDates, activeId);
    if (!date) {
      content.replaceChildren(emptyState("Delivery date missing",
        "This order's delivery date was deleted. Remove it from the New Orders box."));
      return;
    }
    content.replaceChildren(dateContent(state, date, root, selectDate));
  };

  // Switch dates in place instead of navigating: only the order area below the
  // calendar is rebuilt, so the calendar keeps the week she paged it to. The URL
  // still updates (without firing the router) so the current date stays shareable.
  const selectDate = (id) => {
    activeId = id;
    // Opening a day the grid is NOT on brings the grid with it — a New-orders row a
    // season away must not leave the calendar showing a week it isn't on. A day
    // already on screen leaves the window exactly where she put it, so opening one
    // day never slides the week out from under her finger.
    const dest = byId(state.deliveryDates, id);
    if (dest && ordersCalView && ordersCalView.offset != null) {
      const shown = rollingWeeks(todayISO(), { offset: ordersCalView.offset }).flat();
      if (!shown.includes(dest.date)) ordersCalView.offset = windowForDay(todayISO(), dest.date);
    }
    topCal.repaint();
    renderContent();
    if (history && history.replaceState) {
      history.replaceState(null, "", `#/orders?date=${id}`);
    }
  };

  renderContent();
  const inbox = newOrdersInbox(state, selectDate, root);
  // The screen is two stacked parts: the finder card up top, then everything
  // else (New-orders inbox, the delivery calendar, that date's orders) in one
  // container. While a search is active the container hides so only matches show.
  const body = el("div", {});
  if (inbox) body.append(inbox);
  body.append(topCal.el, content);
  const finder = orderFinderEl(state, root, selectDate, body);
  root.replaceChildren(finder, body);
  let delta = null;
  if (rowTop != null) {
    const rowAfter = root.querySelector(`[data-order="${anchorRowId}"]`);
    if (rowAfter) delta = rowAfter.getBoundingClientRect().top - rowTop;
  }
  if (delta == null && anchorTop != null) {
    const listAfter = root.querySelector('[data-role="orders-list"]');
    if (listAfter) delta = listAfter.getBoundingClientRect().top - anchorTop;
  }
  if (delta) scroller().scrollTop += delta;
  anchorRowId = null;
}

// What ends a revealed row's glow: the baker getting to the row.
const SETTLE_ON = ["pointerenter", "pointermove", "pointerdown", "mouseenter", "touchstart"];

// Put an order's row under the baker's eye on the date view just shown: flash
// it and slide the page until it sits mid-screen. Landing on the right delivery
// date is not enough on a busy day — the row can be far down a long list, and
// the baker should not have to hunt for the order they just tapped. The list
// draws one row per customer order, tagged with its first item's id, so try
// every id in the group; a group whose items were somehow left with different
// statuses is tagged with whichever item the date view lists first, so fall
// back to the group id the row also carries.
function revealOrderRow(root, group) {
  const orders = (group && group.orders) || [];
  if (!root || typeof root.querySelector !== "function" || !orders.length) return;
  let row = null;
  for (const o of orders) {
    row = root.querySelector(`[data-order="${o.id}"]`);
    if (row) break;
  }
  if (!row) {
    const gid = orders.find((o) => o.groupId)?.groupId;
    if (gid) row = root.querySelector(`[data-group="${gid}"]`);
  }
  if (!row) return;
  row.classList.add("hit");
  // The glow stays lit until the baker reaches the row. A fixed moment can pass
  // while her eye is still travelling down a long day, and the whole point of the
  // flash is to be found — so it is the pointer arriving on the row that ends it,
  // not the clock. "pointerenter"/"pointermove" cover a mouse or a finger coming
  // to the row (and a cursor already sitting where the row lands); "pointerdown"
  // covers the tap that opens it; the mouse/touch pair is for a browser without
  // pointer events at all.
  const settle = () => {
    row.classList.remove("hit");
    for (const type of SETTLE_ON) row.removeEventListener(type, settle);
  };
  for (const type of SETTLE_ON) row.addEventListener(type, settle);
  if (typeof row.scrollIntoView === "function") {
    row.scrollIntoView({ block: "center", behavior: "smooth" });
  }
}

// Inbox card at the top of the Orders screen: every order still waiting to be
// handled (status New), across all delivery dates, oldest first. Tap a row to
// jump to that delivery date, scroll the order into view and flash it. The red
// tab badge counts the same set, so a new storefront order surfaces here without
// digging through dates. A storefront order with several items is one row
// ("Focaccia + Sandwich"), not one row per item.
export function newOrdersInbox(state, selectDate, root) {
  const unread = (state.orders || [])
    .filter((o) => (o.status || "new") === "new")
    .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
  if (!unread.length) return null;

  const rows = groupOrders(unread).map((g) => {
    const first = g.orders[0];
    const date = byId(state.deliveryDates, first.deliveryDateId);
    const orphan = !date;
    const title = g.orders.map((o) => orderLineName(state, o)).join(" + ");
    const qtyTotal = g.orders.reduce((s, o) => s + o.qty, 0);
    const sub = [first.customerName || "No name", date ? shortDate(date.date) : "",
      `Placed ${fmtPlaced(first.createdAt, first.orderDate)}`]
      .filter(Boolean).join(" · ");
    const main = el("div", { class: "li-main" },
      el("div", { class: "li-title" }, title, orderCodeTag(first),
        referredTag(first),
        promoTag(first),
        g.orders.some((o) => o.source === "storefront") ? el("span", { class: "src-tag" }, "storefront") : null),
      el("div", { class: "li-sub" }, sub));
    const meta = el("div", { class: "li-right" },
      el("span", { class: "qty-chip" }, `×${qtyTotal}`),
      orphan ? null : el("span", { class: "inbox-arrow" }, "›"));
    // An orphaned order (its delivery date was deleted) has no date to open, so
    // it renders as a plain row — but it still gets a ✕ so it can be removed.
    const nav = orphan
      ? el("span", { class: "inbox-main" }, main, meta)
      : el("a", {
          class: "inbox-main",
          href: `#/orders?date=${first.deliveryDateId}`,
          // Switch dates in place (not native hash navigation, which is flaky on
          // iOS) so the tap reliably opens the order's date.
          onclick: (ev) => {
            ev.preventDefault();
            // A status filter could hide the row on its own date — clear it, the
            // same way the finder does, so the flash has something to land on.
            orderStatusFilter = "";
            selectDate(first.deliveryDateId);
            revealOrderRow(root, g);
          },
        }, main, meta);
    return el("div", { class: "inbox-item" },
      nav,
      el("button", {
        class: "inbox-del",
        "aria-label": "Remove order",
        onclick: () => removeOrder(state, g, root, first.deliveryDateId),
      }, "✕"));
  });

  return el("div", { class: "card inbox" },
    el("h3", { style: "margin:0 0 2px" },
      `📥 ${rows.length} new order${rows.length === 1 ? "" : "s"}`),
    el("p", { class: "card-sub", style: "margin:0 0 6px" },
      "Tap a row to jump to that order on its delivery date and confirm it."),
    el("div", { class: "inbox-list" }, ...rows));
}

// The "Find an order" box pinned to the top of the Orders screen. Typing hides
// the date view below and lists every matching order (any date, any status) as
// tappable rows; picking one jumps to its delivery date, scrolls the order into
// view and flashes it so you see exactly where it is. Matches live-update
// as you type — only the results list is rebuilt, never the input, so the
// keyboard stays open. (Result rows carry no controls, so nothing can trigger a
// rebuild while the box is showing.)
function orderFinderEl(state, root, selectDate, body) {
  const resultsEl = el("div", { class: "finder-results", hidden: true });

  const showResults = () => { body.hidden = true; resultsEl.hidden = false; };
  const hideResults = () => { body.hidden = false; resultsEl.hidden = true; };

  const resultRow = (group) => {
    const first = group.orders[0];
    const date = byId(state.deliveryDates, first.deliveryDateId);
    const orphan = !date;
    const items = group.orders.map((o) => orderLineName(state, o));
    const qtyTotal = group.orders.reduce((s, o) => s + o.qty, 0);
    const statusName = (STATUSES.find(([v]) => v === (first.status || "new")) || [])[1];
    const sub = [first.customerName || "No name",
      date ? shortDate(date.date) : "delivery date removed", statusName]
      .filter(Boolean).join(" · ");
    const main = el("div", { class: "li-main" },
      el("div", { class: "li-title" }, items.join(" + "), orderCodeTag(first),
        referredTag(first),
        promoTag(first),
        group.orders.some((o) => o.source === "storefront")
          ? el("span", { class: "src-tag" }, "storefront") : null),
      el("div", { class: "li-sub" }, sub));
    const meta = el("div", { class: "li-right" },
      el("span", { class: "qty-chip" }, `×${qtyTotal}`),
      orphan ? null : el("span", { class: "inbox-arrow" }, "›"));
    // An orphan (its delivery date was deleted) has no date to jump to, so it
    // renders as a plain row without an arrow.
    const nav = orphan
      ? el("span", { class: "inbox-main" }, main, meta)
      : el("a", {
          class: "inbox-main",
          href: `#/orders?date=${first.deliveryDateId}`,
          onclick: (ev) => { ev.preventDefault(); open(group); },
        }, main, meta);
    return el("div", { class: "inbox-item" }, nav);
  };

  const paint = (query) => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      resultsEl.replaceChildren(
        el("h3", { style: "margin:0 0 6px" }, "🔎 Find an order"),
        el("p", { class: "card-sub" },
          "Keep typing — try a customer name, the #order code, or a phone number."));
      return;
    }
    const groups = matchingGroups(state, trimmed);
    resultsEl.replaceChildren(
      el("h3", { style: "margin:0 0 6px" },
        `🔎 ${groups.length} order${groups.length === 1 ? "" : "s"} found`),
      groups.length
        ? el("div", { class: "inbox-list" }, ...groups.map(resultRow))
        : el("p", { class: "muted" },
          `No order matches "${trimmed}" — try a name, #code, phone or item.`));
  };

  const input = el("input", {
    class: "input finder-input",
    type: "search",
    placeholder: "Find an order — name, #code, phone…",
    value: orderQuery,
    autocomplete: "off",
    oninput: function () {
      orderQuery = this.value;
      const trimmed = orderQuery.trim();
      if (!trimmed) { hideResults(); return; }
      showResults();
      paint(orderQuery);
    },
  });

  // Tap a result: clear the finder, land on that order's delivery date and make
  // the row flash so she sees where it is. Clearing any list status filter first
  // guarantees the order is actually visible under that date.
  const open = (group) => {
    const first = group.orders[0];
    const date = byId(state.deliveryDates, first.deliveryDateId);
    orderQuery = "";
    input.value = "";
    hideResults();
    if (!date) {
      toast("This order's delivery date was deleted — remove it from the New Orders box.");
      return;
    }
    orderStatusFilter = "";
    selectDate(date.id); // renderContent already put the order's row in the DOM
    revealOrderRow(root, group);
  };

  if (orderQuery.trim()) { showResults(); paint(orderQuery); } // a rebuild while searching
  return el("div", { class: "card finder" },
    el("div", { class: "finder-bar" },
      el("span", { class: "finder-ico", "aria-hidden": "true" }, "🔍"),
      input),
    resultsEl);
}

function dateContent(state, date, root, selectDate) {
  const st = deliveryStatus(date.date, state.settings);
  const cap = capacityStatus(state, date.id);
  const dateLabel = `${weekdayName(date.date)}, ${longDate(date.date)}`;
  const rules = dayRuleRows(state, date.date);
  const adjusted = rules.rows.filter((r) => r.delta !== 0).length;

  // A day the bakery has marked names itself beside the date, in the mark's own
  // colour. On a calendar the name is asked for (the shop's bubble, the day
  // tapped); here the day is already the one on screen, so the name just sits
  // next to it. Nothing is drawn on an unmarked day.
  const occ = occForDate(state.occasions, date.date);
  const header = el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, dateLabel),
        el("p", { class: "card-sub" },
          st.past ? "Past delivery"
            : st.closed ? `Orders closed at ${state.settings.cutoff} yesterday`
              : `Open · cut-off in ${st.countdown}`),
        occ ? el("span", { class: `occ-tag occ-${occColour(occ)}`, style: "margin-top:6px" },
          occ.label) : null),
      el("span", { class: "qty-chip" }, `${cap.total}/${cap.capacity}`)),
    fillMeter(cap.total, cap.capacity),
    moneyLine(state, date.id),
    cap.exceeded ? el("div", { class: "danger-banner" },
      `Over capacity by ${cap.total - cap.capacity}. Add more only if you can make extra.`) : null,
    !st.past && rules.rows.length ? el("div", { class: "btn-row", style: "margin-top:10px" },
      button(adjusted ? `Set day's availability · ${adjusted} adjusted` : "Set day's availability", () =>
        openDayAdjustPopup(state, date, () => renderAll(root, state, new URLSearchParams({ date: date.id }))), "soft")) : null);

  const form = orderForm(state, date.id, root, selectDate);
  const list = orderList(state, date.id, root);

  return el("div", {}, header, form, list);
}

// "Set day's availability" — the owner raises or lowers each product's usual
// daily limit for THIS delivery date only, straight from the Orders screen.
// Value packs share their base product's pool, so they aren't listed here —
// adjust the base and they follow.
export function openDayAdjustPopup(state, date, refresh) {
  const rules = dayRuleRows(state, date.date);
  if (!rules.rows.length) return toast("No product has a daily limit yet — set one under More → Products first.");

  const inputs = rules.rows.map((rule) => {
    const inp = el("input", { class: "input day-adj-input", type: "number", inputmode: "numeric",
      value: rule.delta === 0 ? "" : String(rule.delta), placeholder: "0",
      "aria-label": `Change ${rule.name}` });
    return { rule, inp };
  });

  const todayOf = (rule, inp) => {
    const { delta } = parseDayDelta(inp.value);
    return Math.max(0, rule.usual + (delta || 0));
  };
  const preview = (rule, inp) => {
    const today = todayOf(rule, inp);
    return today === 0 ? "(sold out)" : `Today: ${today}`;
  };
  // Is this product on sale on this date at all? A product that is not sold that
  // day can never have an order put on it, so its limit is not the day's capacity
  // (see effectiveCapacity in bom.js — the same rule, so this sum and the number
  // the store uses are the one number).
  const counts = (rule) => sellOpen(byId(state.products, rule.productId), date.date);

  // "How the day adds up", under the rows the owner is editing: which product
  // contributes what to the day, ending on the same number the order page uses for
  // it (effectiveCapacity in bom.js — one rule, so the two can never disagree).
  // She asked for this on 15 Sep 2026: the Orders chip said "1/42" and there was
  // no way to see where the 42 came from, or why a product she does not sell that
  // day was in it.
  const sumEl = el("div", {});
  const paintSum = () => {
    // What she has typed, as the limit each product would have today — handed to
    // the same function the day's capacity itself comes from, so the sum on screen
    // and the number the order page uses are one computation.
    const typed = {};
    for (const { rule, inp } of inputs) typed[rule.productId] = todayOf(rule, inp);
    const { counted, off, total, fallback } = dayCapacityParts(state, date.date, typed);

    const grid = el("div", { class: "cost-grid" });
    const row = (op, val, name, isTotal) =>
      el("div", { class: `cost-row${isTotal ? " cost-total-row" : ""}` },
        el("div", { class: "cost-op" }, op),
        el("div", { class: "cost-val" }, String(val)),
        el("div", { class: "cost-name" }, name));
    if (fallback) {
      // Nothing on sale that day has a daily limit: the day uses the Settings
      // default. Say so rather than show an empty sum, which would read as 0 —
      // and 0 would mean Sold out.
      grid.append(row("=", total,
        "the day's default capacity (Settings) — nothing on sale this day has a daily limit", true));
    } else {
      counted.forEach((p, k) => {
        grid.append(row(k === 0 ? "·" : "+", p.limit, p.name + (p.limit === 0 ? "  (sold out)" : "")));
      });
      grid.append(row("=", total, "what the order page can take that day", true));
    }

    const cap = capacityStatus(state, date.id);
    // replaceChildren() stringifies a null argument into the text "null" (unlike
    // el(), which drops it) — so the optional line has to be filtered out, not
    // passed as null.
    sumEl.replaceChildren(
      ...[
        el("div", { class: "cost-sum" },
          el("p", { class: "cost-sum-title" }, "How the day adds up:"),
          grid),
        off.length ? el("p", { class: "card-sub", style: "margin:8px 0 0" },
          `Not counted: ${off.map((p) => p.name).join(", ")} — not sold on this day, so no order can go on them here.`) : null,
        el("p", { class: "card-sub", style: "margin:6px 0 0" },
          cap.total >= total
            ? `Booked so far: ${cap.total} — the order page shows this day full.`
            : `Booked so far: ${cap.total}. The order page can still take ${total - cap.total}.`),
      ].filter(Boolean));
  };

  showPopup(el("div", { class: "popup-title-row" }, "Availability for this day"), (refreshBody, close) => {
    const rows = el("div", { class: "day-adj-rows" },
      ...inputs.map(({ rule, inp }) => {
        const todayEl = el("span", { class: "day-adj-preview" }, preview(rule, inp));
        inp.addEventListener("input", () => { todayEl.textContent = preview(rule, inp); paintSum(); });
        return el("div", { class: "day-adjust-row" },
          el("div", { style: "min-width:0" },
            el("p", { style: "margin:0" }, rule.name),
            el("p", { class: "card-sub", style: "margin:0" }, `Usual ${rule.usual}/day`)),
          el("div", { class: "day-adj-right" },
            todayEl,
            inp));
      }));
    paintSum(); // the sum as the day stands, before she types anything

    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 12px" },
        `For ${weekdayName(date.date)}, ${longDate(date.date)} only: how many more (+) or fewer (−) than usual to make. 0 = Sold out that day. Other dates are untouched.`),
      rows,
      sumEl,
      rules.packs.length ? el("p", { class: "card-sub", style: "margin:10px 0 0" },
        `Value packs — ${rules.packs.join(", ")} — share their base product, so they follow the numbers above.`) : null,
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Save", () => {
          const adjustments = {};
          for (const { rule, inp } of inputs) {
            const { delta, error } = parseDayDelta(inp.value);
            if (error) return toast(error);
            adjustments[rule.productId] = delta;
          }
          saveDayAdjustments(state, date.id, adjustments);
          save(state);
          maybeSync(state); // republish availability so customers see the change
          toast("Day's availability updated");
          close();
          refresh();
        }, "primary")));
  }, { wide: true });
}

// Where each kind of choice sits in the picker, and what its section is called —
// see productOptions.
const TONE_RANK = { ok: 0, warn: 1, off: 2 };
const TONE_SECTION = { ok: "On the shop", warn: "Unavailable", off: "Taken down" };

// Product choices for adding/editing an order. Unlike the customer menu, the
// backoffice pickers show EVERY product — including hidden ones (marked
// "(hidden)") — so you can still add or edit an order for a product you
// have temporarily taken off the menu. They come in three kinds, listed in that
// order and grouped under those three names, each section carrying the tone it
// is drawn in (18 Sep 2026).
//
// The three kinds answer one question — is the SHOP offering this product for
// this delivery date? — because the picker is a guide while you sell, never a
// gate: you make to a plan of your own, so a product the shop has no orders for
// is still one you may sell from the fridge or to a walk-in. So a sold-out item
// and a not-sold-this-day item are one bucket ("Unavailable"), not two: they are
// both active products you can still choose.
//
// The shop's order-by deadline (a product's closeDays) is deliberately NOT
// asked. That deadline stops a stranger ordering; it says nothing about what you
// may sell by hand, and counting it would leave a near delivery date with an
// empty "On the shop" section, which is the opposite of a guide.
//
// (You settled this on 18 Sep 2026 — "say everyday the kitchen will produce 12
// packets, but day before 6pm order will closed but not necessarily the 12 will
// be sell off... what I want is some guide when I sell the product.
// Flexible but not too much.")
export function productOptions(state, dateId, excludeOrderId = null) {
  const dateStr = (state.deliveryDates || []).find((d) => d.id === dateId)?.date;
  // Drafts are never for sale yet, so they have no orders — keep them out of
  // the backoffice picker too. Hidden products stay (marked below) so an order
  // for something temporarily off the menu can still be added or edited.
  return state.products
    .filter((p) => p.draft !== true)
    .map((p) => {
      const hidden = p.active === false;
      // Taken down outranks both others: a hidden product is off the menu
      // whatever its sell days or its count for the day say.
      if (hidden) {
        const pr = productRemaining(state, dateId, p.id, excludeOrderId);
        const count = pr ? ` — ${pr.remaining <= 0 ? "sold out" : `${pr.remaining} left`}` : "";
        return { value: p.id, label: `${p.name}${count} (hidden)`, tone: "off", group: TONE_SECTION.off };
      }
      // A product the shop does not sell on this date is never offered for it,
      // so its count for the day means nothing here — name the days it IS sold
      // instead. Ask this BEFORE the count: an off-day product's remaining can
      // read 0, which would mislabel it "sold out".
      if (!sellOpen(p, dateStr)) {
        return { value: p.id, label: `${p.name} — only ${availSummary(p)}`,
          tone: "warn", group: TONE_SECTION.warn };
      }
      const pr = productRemaining(state, dateId, p.id, excludeOrderId);
      const label = pr ? `${p.name} — ${pr.remaining <= 0 ? "sold out" : `${pr.remaining} left`}` : p.name;
      const tone = pr && pr.remaining <= 0 ? "warn" : "ok";
      return { value: p.id, label, tone, group: TONE_SECTION[tone] };
    })
    .sort((a, b) => TONE_RANK[a.tone] - TONE_RANK[b.tone]);
}

// The order's shareable code as a small tag, e.g. "#A3F9C2". Shown on inbox
// rows, order rows and the edit pop-up so a WhatsApp message can always be
// matched back to the order it belongs to.
function orderCodeTag(order) {
  return el("span", { class: "ord-code" }, `#${orderCode(order)}`);
}

// A small "🎁 referred" chip on inbox/finder rows so the owner spots an order
// that came through a customer's share link before she opens it. Shown whenever
// the stamp is present (the new-vs-existing decision stays on the date row).
function referredTag(order) {
  return waNumber(order && order.referredBy)
    ? el("span", { class: "ref-tag" }, "🎁 referred")
    : null;
}

// A small "🎟 FRESH10" chip on every row the order is read on (v270). The code a
// customer ordered with arrives on the order and, until now, stayed inside her
// data where she could not see it — she reported exactly that: "i dont see the
// promo code fresh10 send over to app together with the order". Drawn only when
// the order carries one, so every order without a code is the row this screen
// drew before.
//
// The code ITSELF, not the word "promo": she takes the discount off by hand in
// WhatsApp, and which code it was is what tells her how much — FRESH10 and
// AUNTY5 are different amounts, so a chip that named neither would send her into
// the order to look it up, which is the trip this chip exists to save.
function promoTag(order) {
  const code = normCode(order && order.promo);
  return code ? el("span", { class: "promo-tag" }, `🎟 ${code}`) : null;
}

// An order's money as a RECEIPT (v276) — one row per fact, words left, figure right,
// a rule above the Total. Drawn from the shared rows in courier.js, so the two screens
// that show an order's money (the Edit form and the Note / tracking card) and the
// customer's own message are all listing the same sum. `parts` is whatever the caller
// priced — a saved order, or the lines she is typing.
function receiptEls(state, parts) {
  const rows = receiptRows(state, parts).map((r) =>
    el("div", { class: "info-row" + (r.total ? " pl-total" : "") },
      el("span", {}, r.note ? `${r.label} — ${r.note}` : r.label),
      el("span", { class: "info-val" }, r.value)));
  const note = receiptNote(state, parts);
  return note ? [...rows, el("p", { class: "hint", style: "margin:6px 0 0" }, note)] : rows;
}

// The price box on an order line, shared by the ＋ New order card and the Edit
// pop-up (16 Sep 2026). It starts on what the product costs, and whatever she types
// is frozen onto THAT order (o.unitPrice, state.js) — so the confirmation, the later
// reminders, the receipt, her own money numbers and the customer's page all quote
// the price she actually agreed, and a menu price changed tomorrow never rewrites a
// sale already made. Blank means "whatever the product costs", which is how an
// unpriced product has always behaved.
function linePriceBox(line, on) {
  return el("input", { class: "input line-price", type: "number", inputmode: "decimal",
    min: "0", step: "0.01", placeholder: "RM", "aria-label": "Selling price",
    value: line.price == null ? "" : String(line.price),
    oninput: function () {
      line.price = this.value === "" ? null : Number(this.value);
      on();
    } });
}

// What a line's price box should hold when a product is picked or swapped.
function priceForProduct(state, productId) {
  const p = byId(state.products, productId);
  const price = p && p.price != null && p.price !== "" ? Number(p.price) : NaN;
  return Number.isFinite(price) ? price : null;
}

// The day's till, under its capacity meter (16 Sep 2026): what came in as cash,
// what came in by transfer, and how many orders are still to collect — the line she
// checks her purse and her phone against at the end of a delivery day. Nothing shows
// until the day has an order, and a day where nobody has paid yet shows only the
// "to collect" count.
function moneyLine(state, dateId) {
  const m = dayMoney(state, dateId);
  if (!m.count) return null;
  const cur = state.settings.currency || "RM";
  const bits = [];
  if (m.cash) bits.push(`Cash ${fmtRM(m.cash, cur)}`);
  if (m.tng) bits.push(`TNG ${fmtRM(m.tng, cur)}`);
  if (m.unmarked) bits.push(`${fmtRM(m.unmarked, cur)} paid, no method`);
  if (m.toCollectCount) bits.push(`${m.toCollectCount} to collect`);
  return bits.length ? el("p", { class: "card-sub money-line" }, bits.join(" · ")) : null;
}

// Typing a customer's name in either order form offers the people you have already
// served, drawn from your own order history — the same list the Customers screen
// shows. A tap fills the name and the number; the delivery day, the items and
// collect/courier stay yours (18 Sep 2026).
//
// The panel sits in the form's own grid, under the name box and across both
// columns — in the normal flow, like the date picker's panel, never a floating
// overlay: the Edit pop-up's body scrolls, and a floating panel inside it would be
// clipped at its edge. It is hidden rather than emptied when there is nothing to
// show, because an empty grid item still takes the grid's row gap.
function customerSuggester(state, onPick) {
  // Your order history does not change while you type, so the list is built once
  // on the first keystroke that could show anything — not on every render of the
  // screen, where the card is rebuilt far more often than it is typed into.
  let rows = null;
  const people = () => {
    if (!rows) rows = attachProfiles(state, customerList(state, "recent", "all", todayISO()));
    return rows;
  };

  const panel = el("div", { class: "sugg-panel", "data-sugg": "customer", hidden: true });
  const hide = () => { panel.hidden = true; panel.replaceChildren(); };

  const paint = (query) => {
    const q = String(query || "").trim();
    // Two letters, the same floor the shop's finders use: one letter matches half
    // your customers, which is a wall of names rather than a suggestion.
    if (q.length < 2) { hide(); return; }
    const hits = people().filter((r) => customerNameMatches(r, q)).slice(0, 5);
    if (!hits.length) { hide(); return; }
    panel.replaceChildren(...hits.map((r) => el("button", {
      class: "list-item sugg-row", type: "button", onclick: () => { hide(); onPick(r); },
    },
      el("div", { class: "li-main" },
        el("div", { class: "li-title" }, el("span", {}, customerRowName(r))),
        el("div", { class: "li-sub" }, suggestionSub(r))))));
    panel.hidden = false;
  };

  return { panel, paint, hide };
}

// The number to use for a suggested person. Normally the one on their orders, but
// a record saved before the two copies were kept in step can hold the only one.
function suggestionNumber(row) {
  return String((row && row.whatsapp) || ((row && row.profile && row.profile.whatsapp) || "")).trim();
}

// What sits under a suggested name: the number, how many orders you have taken from
// them, and what they buy most — the three things that tell two similar names
// apart at a glance. A part you have no answer for is left out rather than shown
// as a blank.
function suggestionSub(row) {
  const orders = Number(row.orders) || 0;
  return [
    suggestionNumber(row) || "No number saved",
    orders === 1 ? "1 order" : `${orders} orders`,
    row.fav ? `usually ${row.fav}` : "",
  ].filter(Boolean).join(" · ");
}

// The delivery address a suggestion may fill in: where they were last delivered,
// but only into a box that is still EMPTY. It is a DEFAULT, never an overwrite —
// an address she has typed, or the one already on the order she is editing, is
// hers, and a pick that replaced it would quietly move their delivery to another
// door. Blank when there is nothing to offer, so the caller writes nothing rather
// than blanking a box.
function suggestedAddress(row, input) {
  if (String(input.value || "").trim()) return "";
  return String((row && row.lastAddress) || "").trim();
}

// ── the address box asks Google as she types (v228) ─────────────────────────
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
function addressSuggester(state, onPick) {
  // The marker is how a test names THIS panel rather than the customer one above it:
  // `.sugg-panel` is a shared style worn by three different lists, so it identifies a
  // look, not a panel.
  const panel = el("div", { class: "sugg-panel", "data-sugg": "address", hidden: true });
  let asked = ""; // the one query slot: the last thing actually sent, never a map

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
    if (!out.ok || !out.places.length) { hide(); return; }
    panel.replaceChildren(...out.places.map((p) => el("button", {
      class: "list-item sugg-row", type: "button",
      onclick: () => { hide(); onPick(p.text); },
    },
      el("div", { class: "li-main" },
        el("div", { class: "li-title" }, el("span", {}, p.text))))));
    panel.hidden = false;
  };

  const typed = (text) => {
    const q = String(text || "").trim();
    if (q.length < ADDRESS_MIN_CHARS) { hide(); return; }
    // The same words she paused on last time are already answered. Keep what is
    // showing rather than spend a request to be told the same thing.
    if (q === asked) return;
    hide(); // whatever is on screen belongs to the previous words, so it goes now
    addrAsk.timer = setTimeout(() => { ask(q); }, ADDRESS_WAIT_MS);
  };

  return { panel, typed };
}

// The manual "＋ Add order" card, always at the top of a delivery date. Takes
// several items at once — they become ONE customer order (a shared group), the
// same shape a multi-item storefront order arrives as, so the list/inbox/confirm
// all treat it as a single order. Editing an order never replaces this card:
// Edit opens a pop-up over the screen instead.
function orderForm(state, dateId, root, selectDate) {
  const date = byId(state.deliveryDates, dateId);
  const products = productOptions(state, dateId);
  if (!products.length) {
    return el("div", { class: "card" },
      el("p", { class: "muted" }, "No products yet. Add products with their recipes first — More → Products."));
  }

  // The form edits a *draft*, not the orders directly, so a mid-edit re-render (a sync
  // pull, a fresh storefront import, or a day tapped in this card's own calendar)
  // rebuilds this form with what you actually typed. Nothing is written until Add order
  // is pressed. The draft lives at MODULE scope (see newOrderDraft) so that is true of
  // every field and not only the customer's name and number.
  const draft = newOrderDraft || (newOrderDraft = {
    customerName: "", whatsapp: "",
    fulfillment: "collect", address: "", note: "", orderDate: todayISO(),
    trackingNo: "", carrierId: "", handedAt: "",
    items: [{ productId: "", qty: 1, price: null }],
  });
  // The day is the SCREEN's, not the draft's: picking one switches the screen, because
  // the product list and each day's limits are built for the date on screen. So the
  // draft simply follows whatever day is on screen, on every build.
  draft.deliveryDateId = dateId;
  draft.deliveryDate = date.date;
  // The card's own charge box, rebuilt with the courier block and read by `submit`. Held
  // out here because the block is built on every Fulfillment change and `submit` has to
  // reach whichever one is standing — null whenever the block is not on screen.
  let courierCharge = null;
  // Filling in from a suggestion has to write both the boxes and the draft: the
  // draft is what the other controls read, the boxes are what you see. The
  // address comes too, but only into an empty box — see suggestedAddress.
  const suggester = customerSuggester(state, (r) => {
    draft.customerName = customerRowName(r);
    draft.whatsapp = suggestionNumber(r);
    customer.value = draft.customerName;
    whatsapp.value = draft.whatsapp;
    const addr = suggestedAddress(r, address);
    if (addr) { draft.address = addr; address.value = addr; }
  });
  const customer = el("input", { class: "input", placeholder: "Customer name (optional)",
    value: draft.customerName,
    oninput: function () {
      draft.customerName = this.value;
      suggester.paint(this.value);
    } });
  const whatsapp = el("input", { class: "input", type: "tel", inputmode: "tel",
    placeholder: "e.g. 012-345 6789", "data-suggest": "012-345 6789",
    value: draft.whatsapp,
    oninput: function () { draft.whatsapp = this.value; } });
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; paintCourier(); });
  // The address box also offers what she might be typing, from Google (v228). A tap
  // writes BOTH the draft (what the other controls read) and the box (what she sees),
  // the same pair the customer suggestion writes.
  const addressSug = addressSuggester(state, (text) => {
    draft.address = text;
    address.value = text;
  });
  // Multi-line on purpose: a courier address is four or five lines on a phone, so a
  // one-line field hid most of it. Taller, and draggable — see textarea.input in app.css.
  const address = el("textarea", { class: "input", rows: 4, placeholder: "Postal address (for posting)",
    value: draft.address,
    oninput: function () {
      draft.address = this.value; // synchronous and unconditional — never gated on the network
      addressSug.typed(this.value);
    } });
  // The order-level note is the DELIVERY note now that every item carries its own
  // (v236). It stays the same field on the order — only what it is for has changed.
  const note = el("input", { class: "input note-input", placeholder: "Collect time, delivery time, etc.",
    value: draft.note, oninput: function () { draft.note = this.value; } });
  const orderDate = dateField(draft.orderDate, (iso) => { draft.orderDate = iso; },
    { occasions: state.occasions });

  // "Which day am I adding to?" — the same calendar the top of the screen shows, so the
  // two can never disagree about which days exist. It is drawn on ONE LINE and unfolds
  // only when that line is tapped (v237): the card stands on every delivery day, so a
  // full month grid in front of the first thing she has to type was mostly a wall of
  // dates she did not need. Choosing a day still SWITCHES THE SCREEN rather than filling
  // a draft, because the product list and each day's limits are built for the date on
  // screen — a day held only in the draft would offer items not sellable on it.
  // The week is held at MODULE scope so paging it forward survives a rebuild — the day
  // line now sits under the items, so touching it part-way through an order is ordinary.
  // deliveryCal mutates the object it is handed in place when its arrows are pressed,
  // which is what makes handing it the same object each build enough.
  const dayCal = deliveryCal({
    state,
    days: deliveryDayList(state),
    getActiveId: () => dateId,
    view: newFormDayView || (newFormDayView = { offset: null }),
    // The panel shuts BEFORE the screen switches, so it cannot spring open again under
    // her on the rebuilt card.
    onPick: (id) => { newFormDayOpen = false; selectDate(id); },
    noteMisses: true,
  });

  const rowsEl = el("div", {});
  const totalEl = el("p", { class: "card-sub", style: "margin:8px 0 0" });
  // The rows are the DRAFT's own array, not a fresh one — so a rebuild (a day tapped in
  // this card's own calendar above all) repaints what she has entered instead of wiping
  // it back to one empty row.
  const items = draft.items;
  const paintTotal = () => {
    const priced = items.filter((it) => it.productId && it.price != null);
    totalEl.textContent = priced.length
      ? `Items total: ${fmtRM(priced.reduce((sum, it) => sum + it.qty * Number(it.price), 0),
          state.settings.currency)}`
      : "";
  };
  const renderRows = () => {
    rowsEl.replaceChildren(...items.map((it, i) => {
      const prodSel = select(products, it.productId,
        () => {
          it.productId = prodSel.value;
          // Picking a product fills the price with what it costs, and swapping one
          // re-fills it — a line must never keep the last product's price by accident.
          it.price = priceForProduct(state, it.productId);
          renderRows();
        }, "Product…");
      const qtySpan = el("span", { class: "stepper-val" }, String(it.qty));
      // A note that belongs to THIS line (v236) — "no nuts", "write Happy Birthday".
      // Offered once a product is picked, because a note with no item to belong to
      // has nowhere to go; and offered on EVERY line whatever that product's own
      // switch says, because the switch decides what the CUSTOMER is asked and must
      // never decide what she may write down from a phone call — the standing rule
      // that no setting may block or hide a sale she takes by hand.
      const lineNoteBox = it.productId
        ? el("input", { class: "input line-note", type: "text",
            maxlength: String(LINE_NOTE_MAX),
            placeholder: "Note for this item (optional) — e.g. no nuts",
            value: it.note || "",
            oninput: function () { it.note = this.value; } })
        : null;
      // Two lines, built as two: the product across the top so its name is readable,
      // then its controls — how many, the price, remove. Letting flexbox wrap them
      // instead left the dropdown 2px wide with the price box eating the row. The
      // note box is a third child on its own full-width line for the same reason.
      return el("div", { class: "add-item" },
        prodSel,
        el("div", { class: "add-item-ctl" },
          el("div", { class: "stepper" },
            el("button", { onclick: () => { it.qty = Math.max(1, it.qty - 1); qtySpan.textContent = String(it.qty); paintTotal(); } }, "−"),
            qtySpan,
            el("button", { onclick: () => { it.qty = it.qty + 1; qtySpan.textContent = String(it.qty); paintTotal(); } }, "＋")),
          linePriceBox(it, paintTotal),
          el("button", { class: "inbox-del", "aria-label": "Remove item",
            onclick: () => { items.splice(i, 1); renderRows(); } }, "✕")),
        lineNoteBox);
    }));
    paintTotal();
  };
  renderRows();

  const submit = () => {
    const picked = items.filter((it) => it.productId);
    if (!picked.length) return toast("Choose a product");
    const customerName = customer.value.trim();
    const phone = waNumber(whatsapp.value.trim());
    const fulfillment = fulfillmentSel.value;
    const addressText = address.value.trim();
    const noteText = note.value.trim();
    const placed = draft.orderDate;
    // The courier half is settled BEFORE anything is created (v237). A charge with an
    // amount in the box and nobody named as the payer is REFUSED in words — the same
    // words the Edit pop-up uses, because courierControls.problem is the one guard. Asked
    // here rather than after the order is written, so a refused Add order leaves the card
    // exactly as she left it and no half-written order behind it.
    const shared = {};
    if (fulfillment === "courier" && courierCharge) {
      const why = courierCharge.problem();
      if (why) return toast(why);
      shared.courier = courierCharge.read();
      shared.trackingNo = draft.trackingNo.trim();
      shared.parcel = { carrierId: draft.carrierId, handedAt: draft.handedAt };
    }
    if (picked.length === 1) {
      // The line's own note rides with it (v236); `noteText` beside it is the
      // ORDER-level note, which is a different thing and stays exactly as it was.
      addNew(state, date, picked[0].productId, picked[0].qty, picked[0].price ?? null,
        customerName, phone, fulfillment, addressText, noteText,
        lineNoteOf(picked[0].note), placed, shared, root);
    } else {
      addGroupNew(state, date, picked, customerName, phone, fulfillment, addressText, noteText, placed, shared, root);
    }
  };

  // ── the day, on ONE line ─────────────────────────────────────────────────
  // The same affordance the Order date field already uses (datepicker.js): a soft button
  // that names the value and unfolds a panel under it. The panel holds deliveryCal rather
  // than datepicker's own month grid, because only deliveryCal knows which days she
  // delivers on, what each is already carrying, and which are closed.
  const dayBtn = el("button", {
    class: "btn soft block datepick-btn", type: "button",
    "aria-expanded": newFormDayOpen ? "true" : "false",
    onclick: () => {
      newFormDayOpen = !newFormDayOpen;
      // Unfolding re-homes the calendar on the day the card is on: it may have
      // changed since she last looked, and a view left where she paged it before
      // would unfold on a week this order is not on. The null sentinel is what
      // deliveryCal re-homes on, so this needs no other hook.
      if (newFormDayOpen) { newFormDayView.offset = null; dayCal.repaint(); }
      paintDay();
    },
  });
  const dayPanel = el("div", { class: "datepick-panel" });
  function paintDay() {
    dayBtn.setAttribute("aria-expanded", newFormDayOpen ? "true" : "false");
    dayBtn.replaceChildren(
      el("span", { class: "datepick-val" }, `Delivering ${shortDate(date.date)}`),
      el("span", { class: "datepick-ico", "aria-hidden": "true" },
        newFormDayOpen ? "· close" : "· change"));
    // replaceChildren is not el(): it prints a bare null as the text "null" on her screen,
    // so the panel is emptied with a spread of nothing rather than handed a null child.
    dayPanel.replaceChildren(...(newFormDayOpen ? [dayCal.el] : []));
  }
  paintDay();
  const dayLine = el("div", { class: "datepick" }, dayBtn, dayPanel);

  // ── the courier's half of the order ──────────────────────────────────────
  // Everything a courier order needs that the card used to be missing: the address, the
  // parcel, its tracking number, the charge and a price. They unfold only when Fulfillment
  // says Courier delivery, and that is the point — the card no longer has to be added and
  // then reopened under Edit to become a courier order (v237).
  //
  // The block is BUILT on every change, never built once and unhidden. `isCourierOrder` is
  // captured ONCE at construction inside courierQuoteSection (courier_quote.js): a price
  // section built while Fulfillment said self-collect would keep a permanently dead map and
  // a permanently dead quote half for the rest of the card's life. Only the Fulfillment
  // handler calls this, so nothing else she has typed is disturbed by it — never renderAll.
  //
  // The address NODE is built once at the top of this form and merely MOVED in and out of
  // here, because the customer suggester writes into it: it holds `address`, and the
  // suggestion panel belongs under it. Everything else in the block is fresh each build.
  //
  // The parcel's carrier picker repaints ITSELF (`paintParcel` below), and the tracking box
  // with it, rather than the whole block, so naming a carrier cannot throw away the charge
  // she has just typed — the same rule courier_pay_questions already follows for its own two
  // questions.
  const courierBox = el("div", {});
  function buildCourierBlock() {
    const parcelSlot = el("div", {});
    const trackingSlot = el("div", {});
    const charge = courierControls(state, draft, () => {});
    courierCharge = charge;
    const tracking = el("input", { class: "input", placeholder: "e.g. JT123456789",
      autocomplete: "off", value: draft.trackingNo,
      oninput: function () { draft.trackingNo = this.value; } });
    // The tracking box is a PARCEL's box, so it is drawn only where a parcel is in
    // play: a carrier named, a number already in it (she typed one under a carrier,
    // or a booked trip's own share link was written into it), or a booked trip
    // owning the order. Asking Lalamove for a fee and taking it is a TRIP — and the
    // empty box left standing beside the finished price is what read as an order
    // still to fill in (v265). It comes back the moment it has something to say.
    function trackingApplies() {
      return !!draft.carrierId
        || !!String(draft.trackingNo || "").trim()
        || !!jobOf(draft);
    }
    const trackingField = el("div", { class: "field" },
      el("label", {}, "Courier tracking number (optional)"), tracking,
      el("p", { class: "hint" }, "For a parcel this is the consignment number the carrier gave you."));
    // Only touched when the answer CHANGES. `paintParcel` runs on every carrier pick, and
    // a `replaceChildren` that re-inserts the box would detach the input she is typing in —
    // a repaint must not move her. `null` so the first paint always draws the real state.
    let trackingShown = null;
    function paintParcel() {
      const p = parcelSection({
        state, group: { orders: [draft] }, draft, refresh: paintParcel,
        // This block draws the box UNDER the parcel section, and under nothing at all
        // until a carrier is named — so the hint must not point at a box that is not
        // there.
        consignmentWhere: null,
      });
      parcelSlot.replaceChildren(...(p ? [p] : []));
      if (trackingApplies() !== trackingShown) {
        trackingShown = trackingApplies();
        trackingSlot.replaceChildren(...(trackingShown ? [trackingField] : []));
      }
    }
    // A fresh slot every build: a hoisted one would still be holding the Leaflet mount
    // from the previous block.
    const doorSlot = el("div", {});
    const quote = courierQuoteSection({
      state, orders: [draft], doorSlot, canBook: false,
      // [Use this fee] writes through THIS block's own charge box, so there is still one
      // charge editor in the app. `onCommit` and `onCollected` are both null in
      // price-only mode: booking writes a trip onto an order, and this order has no id
      // until Add order is pressed.
      onUseFee: (q) => charge.set(q.amount),
    });
    paintParcel();
    return [
      el("div", { class: "field" },
        el("label", {}, "Delivery address (if courier)"),
        address,
        addressSug.panel),
      doorSlot,
      parcelSlot,
      trackingSlot,
      charge.el,
      quote,
    ];
  }
  function paintCourier() {
    courierCharge = null;
    courierBox.replaceChildren(...(draft.fulfillment === "courier" ? buildCourierBlock() : []));
  }
  paintCourier();

  // Shut until its title is tapped: the card stands on every delivery day and is not what
  // the screen is for day to day. Inside, the DAY comes first but as a single line, then
  // the two things she is actually holding when a customer is on the phone — the items,
  // then who ordered them. The courier's fields follow the Fulfillment choice further down.
  const body = el("div", { class: "fold-body", hidden: !newFormOpen },
    el("div", { class: "field", style: "margin-bottom:10px" },
      el("label", {}, "Delivery day"),
      dayLine),
    el("div", { class: "field" },
      el("label", {}, "Items"),
      rowsEl,
      button("＋ Add another item", () => { items.push({ productId: "", qty: 1, price: null }); renderRows(); }, "ghost"),
      totalEl),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Everything in the Items list becomes one customer order — add every item, then press Place Order."),
    el("div", { class: "form-grid order-sugg" },
      el("div", {}, el("label", {}, "Customer"), customer),
      suggester.panel,
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel)),
    // The courier's half, unfolding under the Fulfillment choice above it (v237) — the
    // address and the suggester's panel with it, which is why the grid no longer holds it.
    courierBox,
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Order date = when it was placed (defaults to today). WhatsApp is kept in your delivery history for marketing follow-ups."),
    el("div", { class: "field" }, el("label", {}, "Delivery note (optional)"), note),
    button("＋ Place Order", submit, "block primary"));

  const caret = el("span", { class: "fold-caret" }, newFormOpen ? "▾" : "▸");
  const controller = { card: null, open: false, close: null };
  const shutCard = () => {
    newFormOpen = false; // the card is rebuilt often — the module flag is the truth
    body.hidden = true;
    caret.textContent = "▸";
    controller.open = false;
    openOrderCards.delete(controller);
  };
  const head = el("button", { class: "fold-head", type: "button" },
    el("span", {}, "＋ New order"),
    caret);
  head.addEventListener("click", () => {
    if (controller.open) { shutCard(); return; }
    newFormOpen = true;
    controller.open = true;
    controller.close = shutCard;
    body.hidden = false;
    caret.textContent = "▾";
    openOrderCards.add(controller);
  });
  const card = el("div", { class: "card" }, head, body);
  controller.card = card;
  // A rebuild while she was working in the card (a sync pull, a status change,
  // the day calendar inside it being tapped): come back open, and register the
  // new element with the outside-tap rule.
  if (newFormOpen) {
    controller.open = true;
    controller.close = shutCard;
    openOrderCards.add(controller);
  }
  return card;
}

// Every delivery day, soonest first — the one list behind the screen's calendar
// and the New-order card's, so the two can never disagree about which days exist
// or what order they come in.
function deliveryDayList(state) {
  return [...state.deliveryDates]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((d) => ({ id: d.id, date: d.date }));
}

// The days the Edit-order pop-up's "Delivery day" calendar offers: every day
// still to come, plus the order's own day even if that has passed (so an order
// left on an old date still shows where it is).
function deliveryDayOptions(state, curId) {
  const today = todayISO();
  return deliveryDayList(state).filter((d) => d.date >= today || d.id === curId);
}

// Soft notes under the "Delivery day" select: the window the customer was told,
// whether the new day falls inside it, and anything the new day cannot take.
// Nothing here blocks the move — the baker always overrides by hand.
function moveNoteLines(state, group, destId) {
  const dest = byId(state.deliveryDates, destId);
  if (!dest) return [];
  const out = [];
  const products = group.orders.map((o) => byId(state.products, o.productId)).filter(Boolean);
  const win = strictestCancelDays(products);
  if (win != null && win >= 1) {
    out.push(`This order's change/cancel window: ${win} day${win === 1 ? "" : "s"} before delivery.`);
  }
  const moved = group.orders.some((o) => o.deliveryDateId !== dest.id);
  if (!moved) return out;
  if (win != null && win >= 1 && dest.date < addDays(todayISO(), win)) {
    out.push(`Moving this inside the ${win}-day window — the customer may not expect the change.`);
  }
  const st = deliveryStatus(dest.date, state.settings);
  if (st.past) out.push("That delivery day is already past.");
  else if (st.closed) out.push("Orders for that delivery day have already closed.");
  const short = [];
  for (const o of group.orders) {
    const pr = productRemaining(state, dest.id, o.productId, o.id);
    if (pr && pr.remaining < o.qty) {
      const p = byId(state.products, o.productId);
      short.push(`${p ? p.name : "An item"}: ${Math.max(0, pr.remaining)} left, need ${o.qty}`);
    }
  }
  if (short.length) out.push(`That day is short — ${short.join("; ")}.`);
  return out;
}

// Edit opens this pop-up over the Orders screen (the New-order card above stays
// put). It shows the order's own line items — each with a product picker that
// includes hidden products — plus quantity steppers and the shared customer
// details, so the baker can fix anything on the order, add another item, or
// remove one. Changes only apply when "Save changes" is pressed.
function openEditPopup(state, group, dateId, root) {
  const first = group.orders[0];
  if (!first) return;
  const date = byId(state.deliveryDates, dateId) ||
    (first.deliveryDateId ? byId(state.deliveryDates, first.deliveryDateId) : null);
  // A missing date record no longer stops the pop-up opening: the "Delivery day"
  // calendar is exactly what puts an orphaned order back onto a real day.

  // Each line carries the price it is sold at, so the pop-up can show it and she can
  // change it (16 Sep 2026). orderLinePrice gives the frozen price when there is one
  // and the product's own price when there is not — the same number the confirmation
  // would quote, so the box always opens on the truth.
  const lines = group.orders.map((o) => ({
    id: o.id, productId: o.productId || "", qty: o.qty,
    price: orderLinePrice(state, o),
    // This line's own note (v236), held on the draft so a repaint re-reads it and
    // she can change it here as well as in the New-order card. Line-level, so it
    // is edited per row and never travels in the shared fields below.
    lineNote: o.lineNote || "",
  }));
  const draft = {
    customerName: first.customerName || "",
    whatsapp: waNumber(first.whatsapp || ""),
    fulfillment: first.fulfillment || "collect",
    address: first.address || "",
    note: first.note || "",
    trackingNo: first.trackingNo || "",
    orderDate: first.orderDate || String(first.createdAt || "").slice(0, 10) || todayISO(),
    deliveryDateId: (date && date.id) || "",
    // The parcel record, held as two plain strings rather than the record itself:
    // the draft is what a repaint re-reads, and handing it a live object would let
    // a half-made choice reach the order without ever being saved. Absent on an
    // order with no parcel, so an order she never touched is byte-identical.
    carrierId: (parcelOf(first) || {}).carrierId || "",
    handedAt: (parcelOf(first) || {}).handedAt || "",
  };

  const title = el("div", { class: "popup-title-row" },
    "Edit order",
    orderCodeTag(first),
    promoTag(first));
  showPopup(title, (refresh, close) => popupEditBody(state, date, group, first, lines, draft, refresh, close, root, dateId));
}

function popupEditBody(state, date, group, first, lines, draft, refresh, close, root, dateId) {
  const curId = draft.deliveryDateId || (date && date.id) || "";
  const products = productOptions(state, curId);
  // Filling in from a suggestion writes the draft and both boxes. Unlike the
  // New-order card this draft already lives outside the body, so the values
  // survive a repaint with no help; the number goes through waNumber because
  // that is the form this box opens on.
  const suggester = customerSuggester(state, (r) => {
    draft.customerName = customerRowName(r);
    draft.whatsapp = waNumber(suggestionNumber(r));
    customer.value = draft.customerName;
    whatsapp.value = draft.whatsapp;
    const addr = suggestedAddress(r, address);
    if (addr) { draft.address = addr; address.value = addr; }
  });
  const customer = el("input", { class: "input", placeholder: "Customer name (optional)",
    value: draft.customerName,
    oninput: function () { draft.customerName = this.value; suggester.paint(this.value); } });
  const whatsapp = el("input", { class: "input", type: "tel", inputmode: "tel",
    placeholder: "e.g. 012-345 6789", "data-suggest": "012-345 6789",
    value: draft.whatsapp, oninput: function () { draft.whatsapp = this.value; } });
  // Changing how the order leaves repaints the pop-up, because the parcel controls
  // below are offered only for a courier order — and a control that arrives one
  // reopen late reads as missing rather than as conditional (v226). The draft holds
  // every other field already, so a repaint keeps what she has typed, the same way
  // the day calendar below already does.
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; refresh(); });
  // The same box, the same suggester (v228). This form is rebuilt in place by
  // `refresh()` above, which strands the closure below and starts a fresh one — the
  // module-level counter in addressSuggester is what stops the stranded one speaking.
  const addressSug = addressSuggester(state, (text) => {
    draft.address = text;
    address.value = text;
  });
  // The same multi-line box as the New order form, for the same reason — an address
  // she can read back in full while editing it.
  const address = el("textarea", { class: "input", rows: 4, placeholder: "Postal address (for posting)",
    value: draft.address,
    oninput: function () {
      draft.address = this.value; // synchronous and unconditional — never gated on the network
      addressSug.typed(this.value);
    } });
  // The order-level note is the DELIVERY note now that every item carries its own
  // (v236). It stays the same field on the order — only what it is for has changed.
  const note = el("input", { class: "input note-input", placeholder: "Collect time, delivery time, etc.",
    value: draft.note, oninput: function () { draft.note = this.value; } });
  // The courier's tracking number, editable here as well as on the row: a number
  // read back over the phone, or one typed wrong, gets fixed in the pop-up.
  const tracking = el("input", { class: "input", placeholder: "e.g. JT123456789",
    value: draft.trackingNo, oninput: function () { draft.trackingNo = this.value; } });
  const orderDate = dateField(draft.orderDate, (iso) => { draft.orderDate = iso; },
    { occasions: state.occasions });
  // Picking a day writes the draft and repaints the pop-up, so the soft notes
  // below re-read against the new day — the move itself is unchanged. The
  // calendar is always open here: a pop-up the baker opened on purpose has no
  // room for another thing to unfold. Its view is settled fresh on every rebuild
  // (see deliveryCal), which is what keeps it on the day this order is actually on.
  const deliveryPick = deliveryCal({
    state,
    days: deliveryDayOptions(state, curId),
    getActiveId: () => draft.deliveryDateId || curId,
    view: { offset: null },
    onPick: (id) => { draft.deliveryDateId = id; refresh(); },
    noteMisses: true,
  }).el;
  const deliveryNotes = el("div", { class: "card-sub", style: "margin:6px 0 0" },
    ...moveNoteLines(state, group, curId).map((t) => el("p", { style: "margin:2px 0" }, t)));

  const totalEl = el("div", { class: "receipt", style: "margin:8px 0 0" });
  // The label the order came in on, filled by paintTotal below: it is given the
  // very sum the total above it is built from, so the two can never disagree while
  // she is editing the items.
  const promoWrap = el("div", {});
  // A charge the customer bears belongs in this total, because this is the number she
  // reads to know what the order is worth. Named when it is there, so a figure RM8
  // above the items explains itself rather than looking like a mistake; a charge SHE
  // bore is her own cost and stays out, exactly as it does on her books (19 Sep 2026).
  //
  // A COD charge is the order's worth too, but it is NOT in this total: the courier
  // collects it, so it is named under the total instead (19 Sep 2026).
  //
  // Read off the charge's own controls rather than off the saved order, so this figure
  // follows the fee box as she types it here — the form can change the charge now, and a
  // total that only moved after a save would be a figure she cannot check (19 Sep 2026).
  // Whether this order is going by courier, as the draft has it right now — the
  // fulfilment select above repaints this whole body, so this follows her answer live.
  //
  // A charge recorded while the order WAS a courier delivery is not deleted when she
  // switches to self collect, deliberately: she may switch back, and re-typing a fee is
  // not something an app should ask of her. So the block is PARKED and NAMED rather than
  // silently hidden — the same choice v265 made for a recorded parcel — and it stays
  // reachable, because the way she deletes a charge is the payer box under it.
  const courierOrder = draft.fulfillment === "courier";
  const parkedCharge = !courierOrder && (courierFeeOf(first) > 0 || !!courierPayerOf(first));
  const showCharge = courierOrder || parkedCharge;

  function paintTotal() {
    const priced = lines.filter((l) => l.productId && l.price != null);
    const itemsTotal = priced.reduce((sum, l) => sum + l.qty * Number(l.price), 0);
    // Read off the draft's fulfilment rather than off the charge's own controls, because
    // this total is the CUSTOMER's and a self-collect order has no courier for a charge
    // to reach them through (1 Oct 2026).
    const { fee, who, collect } = courierOrder
      ? charge.read() : { fee: 0, who: "", collect: false };
    const courierCharge = who === "customer" ? fee : 0;
    const courierCod = who === "customer" && collect;
    const here = courierCod ? 0 : courierCharge;
    // The code, valued against the DRAFT's own basket and the charge this form is
    // currently showing — not against the saved order, so the figure moves with the
    // lines as she types them, exactly as the items total above it does.
    const promo = promoValue(state, first.promo, itemsTotal, courierCharge);
    const off = promo.money;
    // The same question the message answers, asked of the DRAFT's basket rather than the
    // saved order's, so this card explains a code that gave nothing exactly as the
    // customer's confirmation will (v276).
    const missed = off > 0 ? null : codeMissed(state, first.promo, itemsTotal);
    totalEl.replaceChildren(...(priced.length ? receiptEls(state, {
      items: itemsTotal,
      courier: here,
      cod: courierCod ? courierCharge : 0,
      promo: off,
      promoCode: off ? promo.code : "",
      notApplied: missed ? missed.code : "",
      promoMinimum: missed ? missed.minimum : 0,
      total: Math.max(0, itemsTotal + here - off),
    }) : []));
    // The label the order came in on compares against the items alone — a courier charge
    // is delivery, not spend on product, and the offer's minimum is about the treats
    // (20 Sep 2026).
    const labelPromo = promoBlockEl(state, group, itemsTotal);
    promoWrap.replaceChildren(...(labelPromo ? [labelPromo] : []));
  }
  // The courier charge, asked for here as well as in the Note / tracking box (19 Sep
  // 2026): the charge is part of what this order is, and Edit is where she changes what
  // an order is. One shared block, so both doors settle the amount, the payer and the
  // COD flag identically.
  const charge = courierControls(state, first, paintTotal);
  const rowFor = (line, i) => {
    const prodSel = select(products, line.productId,
      () => {
        line.productId = prodSel.value;
        // A swapped line takes the new product's price — the old one's would be a
        // price for something she is no longer selling.
        line.price = priceForProduct(state, line.productId);
        refresh();
      }, "Product…");
    const qtySpan = el("span", { class: "stepper-val" }, String(line.qty));
    // This line's own note (v236), the same box the New-order card offers and on the
    // same terms: shown once there is a product, and shown whether or not that
    // product's shop switch is on — a note already collected must stay readable and
    // editable here even after she turns the switch off, and she must be able to add
    // one she took over the phone whatever the shop asks.
    const lineNoteBox = line.productId
      ? el("input", { class: "input line-note", type: "text",
          maxlength: String(LINE_NOTE_MAX),
          placeholder: "Note for this item (optional) — e.g. no nuts",
          value: line.lineNote || "",
          oninput: function () { line.lineNote = this.value; } })
      : null;
    return el("div", { class: "add-item" },
      prodSel,
      el("div", { class: "add-item-ctl" },
        el("div", { class: "stepper" },
          el("button", { onclick: () => { line.qty = Math.max(1, line.qty - 1); qtySpan.textContent = String(line.qty); paintTotal(); } }, "−"),
          qtySpan,
          el("button", { onclick: () => { line.qty = line.qty + 1; qtySpan.textContent = String(line.qty); paintTotal(); } }, "＋")),
        linePriceBox(line, paintTotal),
        el("button", { class: "inbox-del", "aria-label": "Remove item",
          onclick: () => { lines.splice(i, 1); refresh(); } }, "✕")),
      lineNoteBox);
  };

  const rowsEl = el("div", {}, ...lines.map(rowFor));
  paintTotal();

  // NOT named `save`. This body already imports the STORE's `save` from state.js, and a
  // function-scoped `const` shadows a module import for the WHOLE body — which is how the
  // door block's `onCommit` below ("Save changes" is the other door onto the same record)
  // came to press THIS function instead of persisting: the reset succeeded, the card saved
  // itself, toasted "Order updated" and closed, dropping her on the Orders list with no
  // price asked. One press, three versions of the report. See test/edit-popup-relook.test.js.
  const saveEdits = () => {
    const chosen = lines.filter((l) => l.productId);
    if (!chosen.length) return toast("Choose a product");
    const destId = draft.deliveryDateId || curId;
    if (!destId || !byId(state.deliveryDates, destId)) return toast("Choose a delivery day");
    // This door refuses a charge with no payer in the same words the Note / tracking card
    // uses — one shared answer, so the two cannot drift apart. See courierControls.problem.
    //
    // Asked on a self-collect order too, and that is not the same thing as standing in
    // front of an order she takes by hand: this guard can only speak when there is an
    // amount in the box with no owner, and the box is on screen whenever that is true —
    // an amount is either one the order already carried (which parks the box open) or one
    // she has just typed into it. What it stops is not the order, it is the OTHER half of
    // her own 27 Sep 2026 report: a Save that says "Order updated" having written nothing,
    // because an amount with no payer is not a charge. Letting a self-collect order skip
    // it would drop that fault back in for those orders alone (1 Oct 2026).
    const whyCharge = charge.problem();
    if (whyCharge) return toast(whyCharge);
    applyPopupEdits(state, date, group, first, chosen, {
      customerName: customer.value.trim(),
      whatsapp: waNumber(whatsapp.value.trim()),
      fulfillment: fulfillmentSel.value,
      address: address.value.trim(),
      note: note.value.trim(),
      trackingNo: tracking.value.trim(),
      // The courier charge rides as one object rather than three loose keys, because its
      // four answers have to be written together: the amount, who bore it, whether the
      // courier collects it, and how SHE paid it decide an order row AND an expense row,
      // and a charge written half-way is a charge that disagrees with itself.
      //
      // Written even on a self-collect order, because a parked charge is still HER
      // record of what she paid or was owed, and the only way she deletes one is the
      // payer box under it (`problem`'s carve-out). The box opens on what the order
      // already says, so an untouched Save writes back exactly what was there — the
      // charge is neither applied nor lost by switching the fulfilment over (1 Oct 2026).
      courier: charge.read(),
      // The parcel travels beside the charge and for the same reason: it is a nested
      // object, and the row fields above are copied onto every line of an order group
      // with Object.assign — a record riding along there would be saved onto every row
      // as a field of its own. Two strings, read off the draft, so a repaint cannot let
      // a half-made choice reach the order.
      parcel: { carrierId: draft.carrierId || "", handedAt: draft.handedAt || "" },
      orderDate: draft.orderDate,
      deliveryDateId: destId,
    }, close, root);
  };

  // Where the price section draws the door block (v201). Under the address row rather than
  // at the very top of this card: the first thing the block says is the delivery address,
  // and a map three fields away from the box that holds it reads as belonging to nothing.
  const doorSlot = el("div", {});

  // Which day, then who, then what — deliberately NOT the ＋ New order card's order any
  // more. v237 moved that card to day, then items, then customer, because a customer on the
  // phone is telling her what they want first. A pop-up she opened on ONE known order has
  // nothing to decide that way: the order is already in front of her, so it keeps the order
  // it has always had, and the two screens are allowed to differ.
  return el("div", {},
    el("div", { class: "field", style: "margin-bottom:10px" },
      el("label", {}, "Delivery day"),
      deliveryPick,
      deliveryNotes),
    el("div", { class: "form-grid order-sugg" },
      el("div", {}, el("label", {}, "Customer"), customer),
      suggester.panel,
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel),
      // Both columns: the longest field in the form, and the cell beside it was empty.
      el("div", { class: "span2" }, el("label", {}, "Delivery address (if courier)"), address),
      // Under the address box and across both columns, exactly as the customer
      // suggester's panel sits under the name box — in the grid's normal flow, so it
      // is never clipped by the Edit pop-up's scrolling body.
      addressSug.panel),
    doorSlot,
    el("div", { class: "field" }, el("label", {}, "Delivery note (optional)"), note),
    el("div", { class: "field" },
      el("label", {}, "Courier tracking number (optional)"),
      tracking,
      el("p", { class: "hint" }, "For a parcel this is the consignment number the carrier gave you.")),
    parcelSection({ state, group, draft, refresh }),
    // Drawn for a courier order as it always was, and also for a self-collect order that
    // still carries a charge — so a parked charge is never invisible to the only person
    // who can settle it (1 Oct 2026).
    parkedCharge ? parkedChargeNote(state, first) : null,
    showCharge ? charge.el : null,
    // Same price section as the Note / tracking box carries, for the same reason that
    // box carries the charge: the fee is part of what this order IS, so both doors to
    // the charge open on the same way of filling it in (25 Sep 2026). Booking a trip
    // (v189) writes the share link onto the order here, so `onCommit` refreshes THIS
    // card's own copy of it — the draft is what `Object.assign` writes back over the
    // order on Save, and a booking the card never heard about would be undone by the
    // next Save. A booked trip is saved the moment it is booked rather than on Save:
    // a real vehicle on a real road must not be discardable by closing a form.
    //
    // Asked for only when there is something for it to do (1 Oct 2026): a self-collect
    // order has no delivery to price, which is already why the ＋ New order card drops
    // this whole block the moment she picks Self collect. A BOOKED TRIP is the exception
    // and stays reachable however the order leaves — the card that cancels the trip lives
    // in here, and a trip she cannot call off is worse than a price she cannot ask for.
    //
    // [Use this fee] follows the box it fills: offered whenever the charge box is on
    // screen, because a tap that writes into a box nobody can see is the fault this app
    // keeps finding (v266). It is null when the box is not drawn, and a null `onUseFee`
    // is how courierQuoteSection already knows not to offer the button at all.
    showCharge || jobOf(first) ? courierQuoteSection({
      state, orders: [first], onUseFee: showCharge ? (q) => charge.set(q.amount) : null, doorSlot,
      onCollected: onCollectedMove(state, group, root, dateId),
      onCommit: (o) => {
        draft.trackingNo = String((o && o.trackingNo) || "");
        tracking.value = draft.trackingNo;
        save(state);
        maybeSync(state);
        maybePublishTracking(state, group);
      },
    }) : null,
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "Items"),
      el("p", { class: "card-sub", style: "margin:0 0 6px" },
        "The price beside each item is what THIS order is sold at. Change it here and the confirmation, every later message and the customer's total follow it — your menu price is untouched."),
      rowsEl,
      button("＋ Add another item", () => { lines.push({ productId: "", qty: 1, price: null }); refresh(); }, "ghost"),
      totalEl,
      promoWrap),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Hidden products are listed as \"(hidden)\" — you can still add or keep one."),
    button("Save changes", saveEdits, "block primary"),
    el("div", { style: "margin-top:8px" }, button("Cancel", close, "ghost block")));
}

// Write the pop-up's parcel choice onto the order (v226). Kept in ONE place because
// the Edit form and the Note / tracking box are two doors onto the same record, and a
// record only one of them freezes correctly is a record that disagrees with itself —
// the same reason writeCourierCharge exists. `rows` are the order's kept rows; the
// record lives on the FIRST of them (as a booked trip already does), cleared from the
// rest so an order that stopped being a parcel leaves no record behind and stops
// publishing a carrier to the customer.
function writeParcel(state, first, rows, parcel) {
  if (!parcel) return;
  const id = String(parcel.carrierId || "").trim();
  const live = id ? byId(state.parcelCouriers || [], id) : null;
  // The name is FROZEN onto the order when the parcel is recorded, so a carrier
  // renamed or deleted afterwards never rewrites what a customer was already told
  // (js/parcel.js). Keeping this order's OWN held name when the carrier is gone from
  // the list is therefore the point of the freeze, not a fallback.
  const held = parcelOf(first);
  const name = live ? String(live.name || "").trim()
    : (held && held.carrierId === id ? String(held.carrierName || "").trim() : "");
  const target = rows[0] || first;
  for (const o of rows) clearParcel(o);
  if (id && name) {
    setParcel(target, { carrierId: id, carrierName: name });
    if (String(parcel.handedAt || "").trim()) markHanded(target, parcel.handedAt);
  }
}

// Write the pop-up's item lines + shared details back to state. Kept lines are
// edited in place; new lines become extra order rows in the same group (a
// single-item order that gains a second line becomes a group so it still shows
// as one customer order). Removed lines' orders are deleted. Guards against
// pushing the day over capacity.
function applyPopupEdits(state, date, group, first, chosen, shared, close, root) {
  // The charge travels beside the shared row fields, never among them: they are copied
  // straight onto the order rows with Object.assign, and a nested object riding along
  // there would be saved onto every row as a field of its own. The parcel (v226) is the
  // second such record, and is destructured here for exactly the same reason — miss this
  // line and every line of a multi-item order gets saved with its own copy of the parcel.
  const { courier = null, parcel = null, ...fields } = shared;
  const dest = byId(state.deliveryDates, fields.deliveryDateId) || date;
  if (!dest) return toast("Choose a delivery day");
  // The capacity guard follows the order to its destination. Capacity is derived
  // from deliveryDateId, so the source day frees itself with no bookkeeping, and
  // the destination already counts this order only when it IS the source day.
  const sameDay = !date || dest.id === date.id;
  const cap = capacityStatus(state, dest.id);
  const qtyNow = sameDay ? group.orders.reduce((s, o) => s + o.qty, 0) : 0;
  const qtyAfter = chosen.reduce((s, l) => s + (Number(l.qty) || 1), 0);
  const totalAfter = cap.total - qtyNow + qtyAfter;

  const commit = () => {
    const keptIds = new Set(chosen.map((l) => l.id).filter(Boolean));
    const dropIds = new Set(group.orders.filter((o) => !keptIds.has(o.id)).map((o) => o.id));
    if (dropIds.size) state.orders = state.orders.filter((o) => !dropIds.has(o.id));
    // The order screen is not a second copy of the customer: a name or number
    // fixed here carries to their other orders and to their saved record too.
    // keyOf(first) is read before the loop below rewrites these rows, so it
    // still gives the person's pre-edit key.
    syncContactFromOrder(state, keyOf(first), { customerName: fields.customerName, whatsapp: fields.whatsapp });
    let gid = first.groupId;
    if (!gid && chosen.length > 1) gid = newId("ordg"); // single order gains a second item
    const keptRows = [];
    for (const l of chosen) {
      const o = l.id ? byId(state.orders, l.id) : null;
      if (o) {
        const before = o.productId;
        o.productId = l.productId;
        o.qty = Number(l.qty) || 1;
        Object.assign(o, fields);
        if (gid) o.groupId = gid;
        // Only a line swapped to a different product re-prices; leaving a line
        // alone keeps the price it was sold at.
        if (before !== o.productId) stampOrderLine(o, byId(state.products, o.productId));
        // …and the price box has the last word either way (16 Sep 2026): what she
        // typed is what this order is sold at. A blank box leaves the line following
        // the product, as an unpriced line always has.
        const typed = l.price == null ? NaN : Number(l.price);
        if (Number.isFinite(typed) && typed >= 0) o.unitPrice = typed;
        else delete o.unitPrice;
        // This line's own note (v236). Written here rather than through `fields`, which
        // the Object.assign above copies onto EVERY row of the group — a line's note
        // riding there would give all three items the same words, the same trap the
        // courier charge and the parcel each document. Emptying the box deletes the key,
        // so a note she clears leaves the row exactly as it was before she wrote one.
        const lineNote = lineNoteOf(l.lineNote);
        if (lineNote) o.lineNote = lineNote; else delete o.lineNote;
        keptRows.push(o);
      } else {
        const row = {
          id: newId("ord"),
          deliveryDateId: dest.id,
          deliveryDate: dest.date,
          orderDate: fields.orderDate || todayISO(),
          productId: l.productId,
          qty: Number(l.qty) || 1,
          customerName: fields.customerName,
          whatsapp: fields.whatsapp,
          fulfillment: fields.fulfillment,
          address: fields.address,
          note: fields.note,
          trackingNo: fields.trackingNo,
          status: first.status || "new",
          groupId: gid,
          createdAt: new Date().toISOString(),
        };
        stampOrderLine(row, byId(state.products, row.productId));
        if (Number.isFinite(Number(l.price))) row.unitPrice = Number(l.price);
        // This new line's note, written per row like the kept ones above (v236).
        const newLineNote = lineNoteOf(l.lineNote);
        if (newLineNote) row.lineNote = newLineNote;
        state.orders.push(row);
        keptRows.push(row);
      }
    }
    // The charge, written the way the Note / tracking box writes it: the amount and the
    // payer settle together and the COD flag goes with them, so a charge cleared here
    // leaves no key behind and cannot outlive the amount. `courier` is null only for a
    // caller that does not ask for the charge, which then leaves it exactly as it was.
    if (courier) {
      // The three keys and the Delivery & fuel row, written by the one function every
      // door now uses, so a charge saved from here, from the Note / tracking box or from
      // a Delivery run cannot end up meaning three slightly different things. The rows
      // are the ones rebuilt for the destination day, which are not the group's own rows
      // until the move below.
      writeCourierCharge(state, keptRows, group, courier);
    }
    // The parcel record (v226), written the same way and for the same reason as the
    // charge: it lives on ONE row so the group reads as one thing, and it is cleared
    // from every kept row first so a carrier she took off leaves no record behind —
    // an order that stopped being a parcel must not keep publishing a carrier to the
    // customer. `parcel` is null only for a caller that does not ask for it (and for a
    // collect order, where parcelSection draws nothing), which then leaves it alone.
    if (parcel) writeParcel(state, first, keptRows, parcel);
    // Every kept row now sits on the destination day, with deliveryDateId and
    // the deliveryDate snapshot written together (self-heals a split group).
    moveOrderGroup(group, dest);
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    // The customer's card carries the items, the total, the address, the name, the day,
    // the tracking number and the charge — so every save here offers it the new version
    // and the card itself decides whether anything it shows moved (19 Sep 2026). The
    // hand-kept list this replaces named four fields, so an edit to the items or the
    // address republished nothing and the customer kept reading the old order.
    maybePublishTracking(state, group);
    toast(sameDay ? "Order updated" : "Order moved");
    close();
    renderAll(root, state, new URLSearchParams({ date: dest.id }));
  };

  if (totalAfter > cap.capacity) {
    confirmDialog(`Save? This makes ${totalAfter}/${cap.capacity} — over that day's capacity.`,
      commit, { danger: true, yesLabel: "Save anyway" });
  } else {
    commit();
  }
}

function addNew(state, date, productId, qty, price, customerName, whatsapp, fulfillment, address, note, lineNote, orderDate, shared, root) {
  const cap = capacityStatus(state, date.id);
  const newTotal = cap.total + qty;
  const st = deliveryStatus(date.date, state.settings);
  // The courier's own three records, off the card's shared answers (v237). Destructured
  // here rather than left nested, because they are written by their own functions AFTER
  // the row exists and must never be copied onto the row as fields of their own.
  const { courier = null, parcel = null, trackingNo = "" } = shared || {};

  function commit() {
    // The card keeps your draft across a rebuild, so a successful add has to clear it by
    // hand or the next order would open on the person you just served.
    newOrderDraft = null;
    const row = {
      id: newId("ord"),
      deliveryDateId: date.id,
      deliveryDate: date.date, // snapshot so the order stays in history if the date is deleted
      orderDate: orderDate || todayISO(), // when the order was placed/recorded (defaults to today)
      productId,
      qty,
      customerName,
      whatsapp,
      fulfillment: fulfillment || "collect",
      address: address || "",
      note,
      status: "new",
      createdAt: new Date().toISOString(),
    };
    stampOrderLine(row, byId(state.products, productId));
    if (Number.isFinite(Number(price))) row.unitPrice = Number(price); // the typed price wins
    // The customer's words for THIS item (v236). Written only when there are
    // words, so a line nobody noted carries no key at all and an order she takes
    // with no notes is byte-for-byte the order this app has always written —
    // the same "absent means nothing" spelling the shop side uses when it posts.
    if (lineNote) row.lineNote = lineNote;
    state.orders.push(row);
    // The courier half, written only once the row EXISTS. Both writers key what they
    // write on the order's own code (writeCourierCharge through orderCode, which for a
    // draft is the literal "??????" — a string applyCourierCharge's `!!code` guard lets
    // through), so writing from the card before this push would orphan a Delivery & fuel
    // expense the moment the real order got its real code. Written before the save and
    // before maybePublishTracking, so the tracking number and the carrier are on the row
    // by the time the customer's card is published.
    if (trackingNo) row.trackingNo = trackingNo;
    writeCourierCharge(state, [row], { orders: [row] }, courier);
    writeParcel(state, row, [row], parcel);
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    // The card exists from the moment the order does, so the tracking link she is about
    // to send already has something behind it instead of showing the customer "not
    // found" until the day she happens to change its status (19 Sep 2026).
    maybePublishTracking(state, { orders: [row] });
    toast("Order added");
    renderAll(root, state, new URLSearchParams({ date: date.id }));
  }

  if (newTotal > cap.capacity) {
    confirmDialog(`Add ${qty}? This makes ${newTotal}/${cap.capacity} — over today's capacity.`,
      commit, { danger: true, yesLabel: "Add anyway" });
  } else if (st.closed && !st.past) {
    confirmDialog("Orders for this date closed at 6pm yesterday. Add this as a backfill?",
      commit, { yesLabel: "Add anyway" });
  } else {
    commit();
  }
}

// Several manual items for one customer — added as a single order group so the
// list shows one block with one status and the group shares one order code
// (orderCode uses groupId || id), exactly like a multi-item storefront order.
// The capacity/backfill checks run against the combined quantity.
function addGroupNew(state, date, items, customerName, whatsapp, fulfillment, address, note, orderDate, shared, root) {
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  const cap = capacityStatus(state, date.id);
  const newTotal = cap.total + totalQty;
  const st = deliveryStatus(date.date, state.settings);
  const { courier = null, parcel = null, trackingNo = "" } = shared || {}; // see addNew

  function commit() {
    // See addNew: a completed add starts the card clean.
    newOrderDraft = null;
    const groupId = newId("ordg");
    const createdAt = new Date().toISOString();
    const rows = [];
    for (const it of items) {
      const row = {
        id: newId("ord"),
        deliveryDateId: date.id,
        deliveryDate: date.date, // snapshot so the order stays in history if the date is deleted
        orderDate: orderDate || todayISO(), // when the order was placed/recorded (defaults to today)
        productId: it.productId,
        qty: it.qty,
        customerName,
        whatsapp,
        fulfillment: fulfillment || "collect",
        address: address || "",
        note,
        status: "new",
        groupId,
        createdAt,
      };
      stampOrderLine(row, byId(state.products, it.productId));
      if (Number.isFinite(Number(it.price))) row.unitPrice = Number(it.price);
      // Per ROW, from that row's own item — a group of three items may have a note
      // on one of them and none on the others, so this can never be a value shared
      // across the group (v236).
      const lineNote = lineNoteOf(it.note);
      if (lineNote) row.lineNote = lineNote;
      state.orders.push(row);
      rows.push(row);
    }
    // One group, one charge and one parcel — keyed on the SHARED group code orderCode
    // resolves through groupId, exactly as the Edit pop-up writes them. The tracking
    // number rides on every row of the order, as the pop-up does. See addNew for why this
    // can only happen after the rows exist.
    if (trackingNo) for (const o of rows) o.trackingNo = trackingNo;
    writeCourierCharge(state, rows, { orders: rows }, courier);
    writeParcel(state, rows[0], rows, parcel);
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    // One card for the whole order, as the group has one code — see addNew.
    maybePublishTracking(state, { orders: rows });
    toast("Order added");
    renderAll(root, state, new URLSearchParams({ date: date.id }));
  }

  if (newTotal > cap.capacity) {
    confirmDialog(`Add ${totalQty}? This makes ${newTotal}/${cap.capacity} — over today's capacity.`,
      commit, { danger: true, yesLabel: "Add anyway" });
  } else if (st.closed && !st.past) {
    confirmDialog("Orders for this date closed at 6pm yesterday. Add this as a backfill?",
      commit, { yesLabel: "Add anyway" });
  } else {
    commit();
  }
}

function orderList(state, dateId, root) {
  const listEl = el("div", { class: "card", dataset: { role: "orders-list" } });
  const rebuild = () => {
    const all = state.orders
      .filter((o) => o.deliveryDateId === dateId)
      .sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    if (!all.length) {
      listEl.replaceChildren(
        el("div", {},
          el("h3", { style: "margin:0 0 4px" }, "Orders"),
          statusFlowEl(),
          el("p", { class: "muted", style: "text-align:center;margin:10px 0 0" },
            "No orders for this date yet.")));
      return;
    }
    // Storefront orders with several items arrive as one customer order: group
    // them so the list shows a single block (status applies to the whole order).
    const groups = groupOrders(all);
    const filteredGroups = filterOrderGroups(groups, orderStatusFilter);

    const filterSel = select(
      [{ value: "", label: "All statuses" }, ...STATUSES.map(([v, l]) => ({ value: v, label: l }))],
      orderStatusFilter,
      () => { orderStatusFilter = filterSel.value; rebuild(); });
    filterSel.className = "input";

    const blocks = filteredGroups.map((g) => orderGroupRow(state, g, root, dateId));

    const list = el("div", {},
      el("h3", { style: "margin:0 0 4px" }, "Orders"),
      el("div", { class: "row-actions", style: "margin:0 0 8px" }, filterSel),
      ...blocks);
    if (!filteredGroups.length) {
      list.appendChild(el("p", { class: "muted", style: "text-align:center;margin:0" },
        "No orders with this status."));
    }
    const cap = capacityStatus(state, dateId);
    list.appendChild(el("p", { class: "po-snapshot-note" }, `${cap.total} total · ${cap.capacity - cap.total} left of ${cap.capacity}`));
    listEl.replaceChildren(list);
  };
  rebuild();
  return listEl;
}

// The three courier-charge questions that are NOT the amount: who bore it, how SHE paid
// it, and whether the courier collects it at the door.
//
// They are their own block because a DELIVERY RUN asks exactly these three and nothing
// else — the amount on a run is not hers to type, it is the trip's fee split evenly over
// the customers on it (v191). A second copy of these three selects is precisely how two
// doors would start disagreeing about one charge, which is the same reason this block
// itself exists.
//
// Held in a closure rather than read back off the nodes, and repainted HERE rather than
// by the form holding it: the question under the payer comes and goes with the answer,
// and asking the whole form to rebuild for that would throw away everything else she had
// typed in it.
//
// `onChange` fires whenever an answer moves, so each caller repaints what it shows about
// the charge. read(amount) takes the amount from the caller — the box knows it from what
// she typed, a run knows it from the split — and gives back the answers in the terms
// applyCourierCharge and the three order keys want.
export function courierPayQuestions(state, first, onChange = () => {}, { defaultPayer = "" } = {}) {
  // Her ask, 27 Sep 2026, the day after v215 shipped: "Can you default the who paid courier
  // to The customer paid it?" So the ORDER's charge box opens on the answer she gives most
  // often, rather than on "Not recorded" — which is not a neutral resting place but the one
  // answer that means NOBODY bore it, and, since v215, the answer that refuses the save.
  //
  // It is a DEFAULT and never an overwrite: an order that already records a payer opens on
  // that payer, because `courierPayerOf` answers first. "Not recorded" stays in the list,
  // stays hers to choose, and stays how a charge is deleted — see courierControls.problem's
  // carve-out, which exists for exactly that press.
  //
  // The delivery RUN deliberately does not pass this. There the payer is read BEFORE the
  // amounts and decides which amounts they are (v192): "customer" sends it asking what each
  // doorstep costs on its own and puts a charge on every customer's bill, so on that screen
  // it must stay a choice she makes and not one she inherits.
  let payer = courierPayerOf(first) || defaultPayer; // "" | "me" | "customer"
  let codWanted = courierCodOf(first);
  // How SHE paid the courier is not a field on the order: the expense row IS the record,
  // so this opens on whatever that row already says. That is what stops a save which
  // does not touch the answer from quietly resetting it to Cash.
  const code = orderCode(first);
  const spent = (state.expenses || []).find((e) => e && e.courierFor === code);
  let paidWith = spent ? spent.method : "";
  const methods = methodsOf(state);

  const payerSel = select([
    { value: "", label: "Not recorded" },
    { value: "me", label: "I paid it" },
    { value: "customer", label: "The customer paid it" },
  ], payer, () => { payer = payerSel.value; paint(); onChange(); });
  const payerField = el("div", { class: "field", style: "margin:8px 0 0" },
    el("label", {}, "Who paid the courier"), payerSel);
  // Only asked when she bore it: it decides which book on the Money screen the money
  // left from, and it means nothing when the customer paid.
  const methodSel = select(methods.map((m) => ({ value: m, label: m })),
    paidWith || methods[0], () => { paidWith = methodSel.value; });
  const methodField = el("div", { class: "field", style: "margin:8px 0 0" },
    el("label", {}, "How you paid the courier"), methodSel);
  // Only asked when THEY bore it, and it changes what she asks them for: a charge paid
  // with the order sits inside their total, a COD charge is collected at the door and
  // must stay out of it. The pay button on the day is the same for both — what changes
  // is only what the customer is told (19 Sep 2026).
  const codSel = select([
    { value: "", label: "With their order (in the total)" },
    { value: "cod", label: "COD - the courier collects it on delivery" },
  ], codWanted ? "cod" : "", () => { codWanted = codSel.value === "cod"; onChange(); });
  const codField = el("div", { class: "field", style: "margin:8px 0 0" },
    el("label", {}, "How they pay it"), codSel);

  const wrap = el("div", {}, payerField);
  // The payer stays where it is; only the question under it comes and goes, so the box
  // she is choosing in is never rebuilt underneath her.
  function paint() {
    wrap.replaceChildren(...[payerField,
      payer === "me" ? methodField : null,
      payer === "customer" ? codField : null].filter(Boolean));
  }
  paint();

  return {
    el: wrap,
    // Who she said bore the charge, asked on its own — the delivery run needs the payer
    // BEFORE it can know which amounts each order is to carry (v192).
    payer: () => payer,
    read: (amount = 0) => {
      const n = Number(amount) || 0;
      // A charge is the amount AND who bore it, so no payer means no charge and the
      // amount goes with it — the v127 lesson, read the same way here.
      const who = n > 0 ? payer : "";
      return { amount: n, who, fee: who ? n : 0,
        collect: who === "customer" && codWanted, method: methodSel.value };
    },
  };
}

// The whole courier charge's questions — the amount, then the three above — built in ONE
// place, because two pop-ups ask them now: the small Note / tracking box and the full
// Edit form (19 Sep 2026). A second copy of this block is exactly how the two doors would
// start disagreeing about one charge, and a charge she can reach from either door has to
// behave the same in both.
//
// The amount box is what this adds to courierPayQuestions, which is the half a run does
// NOT want: a run's charge per customer is a share of the trip's fee, not a figure she
// types.
function courierControls(state, first, onChange = () => {}) {
  let feeRaw = courierFeeOf(first) ? String(courierFeeOf(first)) : "";

  const amountInput = el("input", { class: "input", type: "number", inputmode: "decimal", min: "0", step: "0.01",
    placeholder: "e.g. 8.00", value: feeRaw, "aria-label": "Courier charge",
    oninput: function () { feeRaw = this.value; onChange(); } });
  const amountField = el("div", { class: "field" },
    el("label", {}, "Courier charge (optional)"),
    amountInput);
  const pay = courierPayQuestions(state, first, onChange, { defaultPayer: "customer" });
  // What the box holds, read ONE way. Both the save and the guard below ask this, so
  // they cannot disagree about whether there is an amount in the box.
  const amountNow = () => Number(String(feeRaw).replace(/[^0-9.]/g, "")) || 0;
  // Did this box OPEN on a charge the order already owned — an amount with a payer
  // recorded? That one fact tells apart the two things "an amount and no payer" can mean
  // on screen, and they need opposite answers. See `problem` below.
  const openedOnAnOwnedCharge = courierFeeOf(first) > 0 && !!courierPayerOf(first);

  return {
    el: el("div", {}, amountField, pay.el),
    // Put an amount into this box from OUTSIDE it — the courier quote's own [Use this
    // fee]. It writes the same field and fires the same repaint as her typing does, so
    // a quoted price and a typed one are the same kind of answer: the payer and the COD
    // questions below it behave identically either way, and there is no second charge
    // editor for the two to disagree through. A junk reading is refused rather than
    // written, because `Number("")` is 0 and a box showing RM0.00 is a charge she would
    // have to notice and clear.
    //
    // It ANSWERS whether it wrote, and the answer is not decoration: the caller is a
    // button that has to say what it did. A courier can quote a total of zero — a real
    // reply, priced at nothing — and a [Use this fee] that toasted "put in the charge
    // box" over a box it left empty is the exact fault this app keeps finding: a tap
    // that moves the picture and skips the write.
    set: (amount) => {
      const n = strictNumber(amount);
      if (n === null || n <= 0) return false;
      feeRaw = String(n);
      amountInput.value = feeRaw;
      onChange();
      return true;
    },
    // Why this charge cannot be SAVED as it stands, in words, or "" when it can. One
    // combination loses her money in silence, and it is this one: an amount in the box
    // with nobody named as the payer. `pay.read()` settles the two together — an amount
    // with no payer is not a charge, so it reads back as fee 0 and the save wrote
    // nothing at all, while still saying "Order updated". A save that reports a write it
    // did not make is the same fault as a tap that moves the picture and skips the
    // write. Her report, 27 Sep 2026: "The selected courier charges cannot save", after
    // taking a courier's price with [Use this fee] and pressing Save.
    //
    // The reading comes from `pay.read` — the very value that would be written — rather
    // than from a second opinion about what is in the box, so this guard and the write
    // can never disagree. Both doors into this box ask it before they touch anything.
    problem: () => {
      const n = amountNow();
      if (n <= 0) return "";
      const { amount, who } = pay.read(n);
      if (who) return "";
      // AN AMOUNT THE ORDER ALREADY CARRIED, whose payer she has just set back to "Not
      // recorded", is her own way of REMOVING a charge — the rule she set on 19 Sep 2026
      // ("why i delete courier charges and the tag is not remove?"): a charge nobody owns
      // is not a charge, so the amount goes with the payer. Refusing THAT would be this
      // app blocking the very action she deletes a charge with. The guard is only for an
      // amount that arrived while this box was open and never got an owner.
      if (openedOnAnOwnedCharge) return "";
      return `The courier charge is ${fmtRM(amount, state.settings.currency)} but nobody is down as the payer, so it would not be saved — a charge is the amount and who bore it. Choose who paid the courier under it, or clear the amount, then press Save again.`;
    },
    read: () => pay.read(amountNow()),
  };
}

// A charge recorded while the order WAS a courier delivery, on an order she has since
// switched to self collect (1 Oct 2026). It is not deleted by the switch, deliberately —
// she may switch back — so it is NAMED, in the one wording both pop-ups use, rather than
// left to be met as a tag that no longer means anything.
//
// It says what the charge is doing and nothing more. It is NOT a warning and it gates
// nothing: the box under it stays fully usable, because the way she deletes a charge is
// the payer box inside it (see courierControls.problem's carve-out).
function parkedChargeNote(state, first) {
  const fee = courierFeeOf(first);
  const who = courierPayerOf(first);
  if (!fee && !who) return null;
  const cur = state.settings.currency;
  return el("p", { class: "card-sub parked-charge", style: "margin:0" },
    (fee
      ? `A courier charge of ${fmtRM(fee, cur)} is recorded on this order from when it was a courier delivery`
      : "A courier charge is recorded on this order from when it was a courier delivery")
    + ". While the order is a self collect it is not added to the customer's total and it is"
    + " not on any message, but it is still on the order."
    + (who === "me"
      ? " The Delivery & fuel entry it put on your books is still there — take it out on the Money screen if the courier was never actually paid."
      : "")
    + " Switch Fulfillment back to Courier delivery to put it back to work.");
}

// ── A parcel she books herself (v226) ───────────────────────────────────────
// The second KIND of courier. Not a vehicle for a journey the app prices and
// books, but a box she hands to J&T / Ninja Van / Line Clear and the app only
// remembers — see js/parcel.js for why a carrier is a record and not a provider
// in js/couriers.js.
//
// There is no CONSIGNMENT BOX here, deliberately: the consignment number is the
// tracking box this card sits under. That slot already holds a number-or-a-link
// and words itself from the value (courier_job.js), so a number she reads out
// over the phone and a live share link are the same field — no second door onto
// one fact.
//
// A parcel and a booked trip are mutually exclusive on one order. Whichever
// exists, the other's controls are replaced by a sentence NAMING it, so no press
// ever acts on something that is not there — and neither
// record is deleted by the other.
//
// The advisory below names a line that is not marked parcel-able and gates
// NOTHING: it still offers the carrier and the hand-over, because no app rule may
// block or hide a sale she takes by hand.
// `consignmentWhere` says which way the tracking box lies from here: both pop-ups
// draw it ABOVE this section, the + New order card draws it BELOW. The hint is the
// same sentence in all three, so it has to be told — and a host that draws no box
// beside this section at all (the card, until a carrier is named) passes null and
// the sentence simply stops before the pointer.
function parcelSection({ state, group, draft, refresh, consignmentWhere = "above" }) {
  const first = (group && group.orders && group.orders[0]) || null;
  if (!first) return null;
  if (draft.fulfillment !== "courier") return null;
  const trip = jobOf(first);
  if (trip) {
    // A recorded parcel is NAMED here rather than silently hidden: the trip is what
    // the customer is shown, so the stale record must not look like the live one —
    // and cancelling the trip below is the honest way back to posting it.
    const stale = parcelOf(first);
    return el("div", { class: "field" },
      el("label", {}, "Parcel carrier"),
      el("p", { class: "card-sub", style: "margin:0" },
        `This order is on a booked ${String(trip.courierName || "").trim() || "courier"} trip — the driver, the plate and the live share link are in the courier section below. A parcel carrier is recorded only on an order with no booked trip.`
        + (stale
          ? ` A parcel with ${stale.carrierName} is recorded on this order from earlier; the trip is what the customer is shown. Cancel the trip below if you meant to post this as a parcel instead.`
          : "")));
  }
  const carriers = state.parcelCouriers || [];
  const had = parcelOf(first);
  // A carrier the order already names stays offered even after she deletes it from
  // her list — the record froze the name precisely so a deletion could never
  // rewrite what the customer was told, and hiding it here would make the order
  // unreadable in the one place she can read it.
  const options = [{ value: "", label: "Not a parcel — nothing recorded" }];
  if (had && had.carrierId && !carriers.some((c) => c.id === had.carrierId)) {
    options.push({ value: had.carrierId, label: `${had.carrierName} (deleted from your list)` });
  }
  for (const c of carriers) options.push({ value: c.id, label: c.name });
  // Switching carrier clears a hand-over: the new carrier has been handed nothing,
  // which is exactly what setParcel writes — the draft and the save agree.
  const carrierSel = select(options, draft.carrierId, function () {
    if (this.value !== draft.carrierId) draft.handedAt = "";
    draft.carrierId = this.value;
    refresh();
  });
  const handed = String(draft.handedAt || "").trim();
  // The hand-over is the ONE progress fact she can supply, and it is what turns the
  // customer's card from "finding" to "Collected" — the neutral word for the carrier
  // having the box (supabase/courier_job.sql). Reversible in one press, because she
  // will sometimes press it on the wrong order.
  const handedEl = !draft.carrierId
    ? null
    : handed
      ? el("div", { class: "field" },
          el("label", {}, "Handed to the carrier"),
          el("p", { class: "card-sub", style: "margin:0 0 6px" },
            `Recorded as handed over ${fmtStamp(handed, todayISO())}. The customer's track card now reads Collected.`),
          button("Undo — not handed over yet", () => { draft.handedAt = ""; refresh(); }, "ghost small"))
      : button("Handed to the carrier", () => { draft.handedAt = new Date().toISOString(); refresh(); }, "soft small");
  const notYet = notParcelable(state, group);
  // An advisory, never a gate — and it says what it is about rather than using the
  // word "warning", so a pack that cannot travel still takes the press.
  const advisory = (draft.carrierId && notYet.length)
    ? el("p", { class: "hint" },
        `Not marked as able to travel as a parcel: ${notYet.join(", ")}. You can still send it this way — tick "Can travel as a parcel" on the product if it is fine to post.`)
    : null;
  return el("div", { class: "field" },
    el("label", {}, "Parcel carrier"),
    carrierSel,
    el("p", { class: "hint" },
      carriers.length
        ? "For a parcel you post yourself — J&T, Ninja Van, Line Clear."
          + (consignmentWhere ? ` The consignment number goes in the tracking box ${consignmentWhere}.` : "")
        : "No carriers yet. Add who you post parcels with under More → Parcel couriers, then record one here."),
    handedEl,
    advisory);
}

// The two things she most often needs to change once an order is placed: its note,
// and the courier's tracking number (16 Sep 2026). They get their own small pop-up
// behind their own button, so a one-line change never means scrolling the whole
// Edit form — and Edit keeps the rest (the delivery day, the customer, the
// address, the items). v97 had the tracking box sitting on the row itself; she
// asked for one simplified entry field with a button to reach it instead, which is
// also the only version that works for an order that is not a courier's.
function openNoteTrackingPopup(state, group, first, dateId, root) {
  // Everything she has typed or chosen is held OUT here rather than inside the body
  // below, because this card is now repainted while she is part-way through it: the
  // parcel's carrier picker asks for a repaint when it changes, exactly as the Edit
  // form's does, and the body is rebuilt from scratch each time. Held inside, a repaint
  // would throw away the carrier she just named and the number she just typed, and the
  // hand-over press would never appear at all. This is the Edit pop-up's own draft, in
  // the shape this card reads — held off the order, so Cancel still means cancel.
  const draft = {
    note: first.note || "",
    trackingNo: first.trackingNo || "",
    fulfillment: first.fulfillment || "collect",
    carrierId: (parcelOf(first) || {}).carrierId || "",
    handedAt: (parcelOf(first) || {}).handedAt || "",
  };
  showPopup(el("div", { class: "popup-title-row" }, "Note / tracking / courier / payment", orderCodeTag(first)),
    (refresh, close) => {
      const note = el("input", { class: "input note-input", placeholder: "Collect time, delivery time, etc.",
        value: draft.note, oninput: function () { draft.note = this.value; } });
      const tracking = el("input", { class: "input", placeholder: "e.g. JT123456789",
        autocomplete: "off", value: draft.trackingNo, oninput: function () { draft.trackingNo = this.value; } });
      // The parcel record is drawn by the same builder the Edit pop-up uses, onto the
      // same draft — this box is the quick way in to the tracking number, and the two
      // boxes have to behave alike or the one she happens to open decides what the order
      // can record (the same rule that keeps every control from acting on something that
      // is not there).
      // The courier's charge, and who bore it. Two different things happen to the
      // books depending on that answer, which is why it is asked rather than assumed
      // — see courier.js.
      // What the customer ends up owing, repainted as she types: the items, plus the
      // charge when THEY bear it. A charge she bears is her own cost and never reaches
      // this number. Without this line the fee box shows no consequence of its own
      // (19 Sep 2026). Drawn as the receipt (v276) rather than as one run-on sentence.
      const custTotal = el("div", { class: "receipt", style: "margin:10px 0 0" });
      const itemsTotal = groupValue(state, group);
      // The code this order carried, and what it took off — read here rather than by
      // customerTotal, because this line repaints as she types the charge and has to
      // agree with the message the same repaint will let her send (v272).
      const promo = promoOn(state, group.orders);
      // The same code's failure to pay out, so this card explains it exactly as the
      // customer's confirmation will (v276).
      const missed = promo.money > 0 ? null : codeNotApplied(state, group.orders);
      // The same three facts the Edit form works out, read off the SAVED order because
      // this box has no fulfilment control of its own — the order's fulfilment is not one
      // of the things this card is for. See the Edit form's block for what they mean.
      const courierOrder = isCourierOrder(first);
      const parkedCharge = !courierOrder && (courierFeeOf(first) > 0 || !!courierPayerOf(first));
      const showCharge = courierOrder || parkedCharge;
      function paintCustTotal() {
        const { fee, who, collect } = courierOrder
          ? charge.read() : { fee: 0, who: "", collect: false };
        const theirs = who === "customer" ? fee : 0;
        // A COD charge is still money they owe, but it is not money SHE collects — the
        // courier takes it at the door — so it is named under the total rather than
        // added into it, or she would ask for the same RM8 the courier is asking for
        // (19 Sep 2026).
        const cod = who === "customer" && collect ? theirs : 0;
        // The promo comes off what they owe here exactly as it does in the message they
        // are sent, so the two figures she can read side by side are the same figure.
        const off = promo.money;
        custTotal.replaceChildren(...receiptEls(state, {
          items: itemsTotal,
          courier: theirs - cod,
          cod,
          promo: off,
          promoCode: off ? promo.code : "",
          notApplied: missed ? missed.code : "",
          promoMinimum: missed ? missed.minimum : 0,
          total: Math.max(0, itemsTotal + theirs - cod - off),
        }));
      }
      // The charge's questions, built by the shared block so this box and the Edit form
      // cannot word or write them differently. It repaints only itself when the payer
      // changes, which is what lets the note and tracking boxes she may be part-way
      // through keep what she typed (19 Sep 2026).
      const charge = courierControls(state, first, paintCustTotal);
      // How the CUSTOMER paid HER. The Paid · Cash / Paid · TNG buttons are the fast
      // way in at the moment the money lands (they also stamp WHEN); this is for
      // fixing one later, or for an order she marked paid before she could tell. It
      // is her own record only — nothing here reaches the customer.
      const paidSel = select([
        { value: "", label: "Not recorded" },
        { value: "cash", label: "Cash" },
        { value: "tng", label: "TNG transfer" },
      ], first.paidMethod || "", () => {});
      // What the choice does, said where the choice is made (v268). The box is named
      // "Paid by the customer", so picking a method is a claim that they HAVE paid —
      // and it now writes exactly what the Paid · Cash / Paid · TNG buttons write, so
      // the two ways in cannot record two different halves of the same fact. The way
      // back is named too: this is the only control that can un-record a payment marked
      // by mistake, since the buttons disappear once the money is in.
      const paidHint = el("p", { class: "hint" },
        "Cash or TNG records that the money is received, and how — the same as pressing Paid · Cash / Paid · TNG on the row. Not recorded clears it and brings those two buttons back.");
      paintCustTotal();
      // Where the price section draws the door block (v201): the TOP of this card, above the
      // note. Her report was that this box gives her no way to see the address or the pin
      // the driver is being sent to — and this is the box where a trip gets priced and
      // booked, so the door belongs above everything she does here rather than folded in
      // with the prices. Handed to the section as a node rather than built here, because
      // the section owns every rule about a door and the card only owns its layout.
      const doorSlot = el("div", {});
      return el("div", {},
        doorSlot,
        el("div", { class: "field" }, el("label", {}, "Delivery note (optional)"), note),
        el("div", { class: "field" },
          el("label", {}, "Courier tracking number (optional)"), tracking,
          el("p", { class: "hint" }, "For a parcel this is the consignment number the carrier gave you.")),
        parcelSection({ state, group, draft, refresh }),
        parkedCharge ? parkedChargeNote(state, first) : null,
        showCharge ? charge.el : null,
        // The price, folded away until she asks for it (25 Sep 2026). It lives INSIDE
        // this card rather than in a pop-up of its own, because the app has one pop-up
        // layer: a second card would replace this one and take the charge box, the note
        // she is part-way through and the Save button with it, so an accepted fee would
        // land in a box nothing could ever save. Its [Use this fee] writes through this
        // card's own charge box, so there is still one charge editor in the app.
        //
        // Booking a trip (v189) writes the share link onto the order, and this box
        // captured the tracking number when it opened — so `onCommit` puts the new value
        // back into the box she is looking at. Without it, the Save below would write
        // its own stale number over the link the customer was about to be sent.
        // Asked for only when there is something for it to do, exactly as in the Edit
        // form — and [Use this fee] follows the box it fills, because no box on screen
        // means no button that writes into one (1 Oct 2026). A booked trip keeps this
        // card reachable whatever the order's fulfilment says, because the control that
        // cancels the trip lives in it.
        showCharge || jobOf(first) ? courierQuoteSection({
          state, orders: [first], onUseFee: showCharge ? (q) => charge.set(q.amount) : null, doorSlot,
          onCollected: onCollectedMove(state, group, root, dateId),
          onCommit: (o) => {
            tracking.value = String((o && o.trackingNo) || "");
            save(state);
            maybeSync(state);
            maybePublishTracking(state, group);
          },
        }) : null,
        custTotal,
        el("div", { class: "field" },
          el("label", {}, "Paid by the customer"), paidSel, paidHint),
        // The card's own explanation, and it has to match what the card is showing (1 Oct
        // 2026): a self-collect order used to be told what a courier charge does to the
        // customer's total and their messages, on the same screen where the charge had
        // stopped doing any of it. A courier order reads exactly as it always did.
        el("p", { class: "card-sub", style: "margin:0 0 10px" },
          (courierOrder
            ? "A courier charge the customer pays is added to their total, and named on their confirmation, their messages and their track card. Marked COD the courier collects it from them on delivery instead, so it stays out of the total and is named under it - that way nobody is asked for the same money twice. One you pay becomes a Delivery & fuel expense and comes off your profit. The charge and the tracking number are both under Edit as well, so you can change them wherever you are - and deleting the courier's line on the Money screen takes the charge off this order with it. "
            : showCharge
              ? "The charge box above is parked: this order leaves by self collect, so nothing about it reaches the customer and it is not on the confirmation, the messages or the track card. Clear who paid the courier to take it off the order entirely, or switch the order back to Post (nationwide) under Edit. "
              : "")
          + "The tracking number goes onto the customer's track card and into the posted message. Anything else - the delivery day, the customer, the address, the items - is under Edit."),
        el("div", { class: "popup-actions" },
          button("Cancel", close, "ghost"),
          button("Save", () => {
            // The whole order shares these, exactly as the Edit pop-up writes them.
            const number = tracking.value.trim();
            const method = paidSel.value;
            // A charge is the amount AND who bore it — the payer is what decides what the
            // charge does, to her books and to the customer. So "Not recorded" for the
            // payer means there is no charge, and the amount goes with it: leaving the
            // amount behind tagged the row "Courier RM8.00 · customer" for a charge nobody
            // had assigned, and nothing could remove it. That was her report — "why i
            // delete courier charges and the tag is not remove?" (19 Sep 2026).
            //
            // COD is only ever true of a charge the CUSTOMER bears: a charge she paid has
            // nothing for anyone to collect at the door, so the key goes with the other
            // two rather than lingering as a flag on no charge. All of that reading is the
            // shared block's, so this box and the Edit form settle it identically.
            // REFUSED, NOT DROPPED, when an amount is sitting there with no payer: see
            // courierControls.problem. Asked BEFORE the note and the tracking number are
            // written too, so a refused Save leaves the whole card exactly as she left it.
            //
            // A self-collect order asks it too, for the same reason the Edit form does:
            // the guard can only speak when there is an amount in the box with no owner,
            // and the box is on screen whenever that is true — so it is never refusing a
            // Save over something she cannot see, and skipping it here would let this box
            // answer "Order updated" for a write it did not make (1 Oct 2026).
            const why = charge.problem();
            if (why) return toast(why);
            const answers = charge.read();
            // "Paid by the customer" RECORDS the payment; it does not merely label one
            // (v268). A method now writes the same three keys the Paid · Cash / Paid · TNG
            // buttons write, and the row's tag is gated on the same rule those buttons
            // feed. Before this the box wrote only `paidMethod`, so a row could wear a
            // "TNG" tag while the journey strip and the Money screen still counted that
            // order as owing money — one screen saying paid, two saying unpaid.
            //
            // "Not recorded" is the way BACK, so a payment marked by mistake is not a
            // one-way door: at or past the paying stage it writes the app's own "still
            // owed" flag (false — what picking Paid in the dropdown writes), which brings
            // the Paid · Cash / Paid · TNG buttons back to the row. Before that stage the
            // flag goes entirely instead, because `false` there would be a claim about
            // money nobody has been asked for yet (17 Sep 2026 — the same rule setStage
            // follows).
            const paidAtNow = new Date().toISOString();
            for (const o of group.orders) {
              o.note = note.value.trim();
              o.trackingNo = number;
              if (method) {
                o.paidReceived = true;
                o.paidMethod = method;
                o.paidAt = o.paidAt || paidAtNow; // stamped once — the day the money landed
              } else {
                delete o.paidMethod;
                delete o.paidAt;
                if (STAGES_AT_OR_PAST_PAID.includes(o.status)) o.paidReceived = false;
                else delete o.paidReceived;
              }
            }
            // The charge's own three keys and the books follow the payer: her own charge
            // becomes a Delivery & fuel expense row, the customer's leaves her books
            // alone entirely. Written here rather than at the Money screen so one save
            // keeps the order and the expense in step — and written by the one shared
            // function, so this box and the Edit form cannot drift apart.
            writeCourierCharge(state, group.orders, group, answers);
            // The parcel, by the same one writer the Edit form uses, so the two doors
            // cannot leave the record in two different shapes (v226).
            writeParcel(state, first, group.orders, draft);
            save(state);
            maybeSync(state);
            // The card carries the tracking number and, when the customer bears it, the
            // charge and the total — so a charge added, changed OR cleared has to reach it,
            // and so does a COD flag flipped on or off, which moves the published total by
            // the whole charge without the charge itself changing at all. Which of those
            // happened is not this box's business any more: the card is offered the new
            // version and publishes when what it shows moved (19 Sep 2026).
            maybePublishTracking(state, group);
            toast("Order updated");
            close();
            renderAll(root, state, new URLSearchParams({ date: dateId }));
          }, "primary")));
    });
}

// "Send posted message" — a post order that has gone out, carrying the tracking
// number she typed. Offered at Packed and again at Collected / Posted, since
// either order of doing things is natural. Disabled without a WhatsApp number,
// like every other message button on a row.
function shippedMsgButton(state, group, first, root, dateId) {
  const btn = button("Send posted message", () =>
    sendOrderWhatsApp(state, group, {
      builder: buildShippedMessage,
      doneMsg: "Posted message drafted — press Send in WhatsApp",
      root, dateId,
    }), "soft small");
  if (!first.whatsapp) btn.disabled = true;
  return btn;
}

// One row per order (or per storefront order group). A group shows its items
// joined ("Focaccia + Sandwich"), its total quantity, its order code, and a
// single status select that advances the whole customer order. Edit opens a
// pop-up for any order — single items and multi-item groups alike. The row's
// journey map shows which step is done (green ✓) and which step is waiting on
// the baker (pulsing amber), and the buttons under the status match the stage:
// Confirmed offers "Send confirmation", Paid offers "Send payment reminder" +
// "Paid", Preparing offers "Print label" (to kit the order as it is packed), and
// Packed offers the message for how the order leaves: a post order gets "Send
// posted message" (with its tracking number), a collect one "Send pickup
// reminder". The last stage's NAME is the pair Collected / Posted for both — only
// which message it offers depends on the method.

// Courier orders also get a "Mailing" pill (first): FROM = the bakery address
// typed in Settings → Mailing labels, TO = the customer, ORDER = code/date/items.
const LABEL_STYLES = [
  ["full", "Full"],
  ["compact", "Compact"],
  ["name", "Name-only"],
  ["mailing", "Mailing"],
];

// Build the one label sheet as real DOM. `packingLabelData` is the single source
// of truth for the text; this only turns its rows into elements, so the popup
// preview is exactly what prints.
function labelSheetEl(state, group, style) {
  const data = packingLabelData(state, group, style);
  const kids = data.rows.map(([cls, text, mark]) => {
    const runs = (mark == null ? [] : [].concat(mark)).filter(Boolean);
    if (!runs.length) return el("div", { class: `ls-${cls}` }, text);
    // The customer's own words, underlined on the sheet exactly as they are on the
    // order row (v244) — the row itself chose the runs, so the two surfaces cannot
    // underline different characters. Runs are placed from the RIGHT: the last one
    // ends the row, and each earlier one is the last match before it, which keeps a
    // note two items happen to share on the right two items (v245).
    const str = String(text);
    const cuts = new Array(runs.length).fill(-1);
    let limit = str.length;
    for (let i = runs.length - 1; i >= 0; i--) {
      const at = str.lastIndexOf(runs[i], limit - runs[i].length);
      if (at < 0) continue;
      cuts[i] = at;
      limit = at;
    }
    const out = [];
    let drawn = 0;
    for (let i = 0; i < runs.length; i++) {
      if (cuts[i] < drawn) continue; // a run that cannot be placed is never invented
      if (cuts[i] > drawn) out.push(str.slice(drawn, cuts[i]));
      out.push(el("span", { class: "line-note" }, runs[i]));
      drawn = cuts[i] + runs[i].length;
    }
    if (drawn < str.length) out.push(str.slice(drawn));
    return el("div", { class: `ls-${cls}` }, ...out);
  });
  return el("div", { class: `label-sheet style-${data.style}` }, ...kids);
}

// Add a body class only for the instant of printing so print.css can show JUST
// the label sheet (never the app or the popup chrome). Cleaned up on afterprint
// (async browsers) and by a fallback timer, so a leftover class can never blank
// a later PO print.
function printActiveLabel() {
  document.body.classList.add("label-print");
  const done = () => {
    document.body.classList.remove("label-print");
    window.removeEventListener("afterprint", done);
    clearTimeout(timer);
  };
  const timer = setTimeout(done, 2000);
  window.addEventListener("afterprint", done);
  window.print();
}

// "Print label": pick one of the preset styles, preview it live, then print.
function openLabelPrint(state, group) {
  const first = group.orders[0];
  if (!first) return;
  const title = el("div", { class: "popup-title-row" },
    "Print label", orderCodeTag(first));
  showPopup(title, (refresh, close) => {
    // Courier parcels are sent, so Mailing (sender + recipient + order blocks)
    // is the go-to label there; walk-in customers stick with the Full preview.
    const courier = first.fulfillment === "courier";
    const baseStyles = LABEL_STYLES.filter(([v]) => v !== "mailing");
    const styles = courier ? [["mailing", "Mailing"], ...baseStyles] : baseStyles;
    let style = courier ? "mailing" : "full";
    const pills = el("div", { class: "label-styles" });
    const sheetWrap = el("div", { class: "label-preview-wrap" });
    const paint = () => {
      pills.replaceChildren(...styles.map(([v, label]) => {
        const pill = el("button", {
          class: "style-pill" + (v === style ? " active" : ""),
          onclick: () => { style = v; paint(); },
        }, label);
        return pill;
      }));
      sheetWrap.replaceChildren(labelSheetEl(state, group, style));
    };
    paint();
    return el("div", { class: "label-print-body" },
      pills,
      sheetWrap,
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Print label", printActiveLabel, "primary")));
  }, { wide: true });
}

// The courier section's `onCollected`: it tells US the trip has been collected, and the
// ORDER is what decides what that means for its stage. Written once because the two doors
// to that section — the Edit card and the Note / tracking card — must move a row
// identically, and because the sentence about it has to reach the section's own toast.
function onCollectedMove(state, group, root, dateId) {
  return (o) => (autoCollect(state, group, o, { root, dateId })
    ? "The order moved itself to Collected / Shipped — the Undo is on the row."
    : "");
}

// ---- moving an order to another stage ------------------------------------
//
// ONE place where a stage change is finished off, because there is now more than one door
// to an order's stage — the drop-down she works and, since v190, the courier telling the
// app the parcel has been picked up. Everything that has to happen once the new stage has
// been written lives here: where the row stays pinned, the save, the sync, the badge, and
// the customer's own card. The publish is the one that matters — a door that forgot it
// would leave the customer reading the stage the order used to be on, silently.
function stageWritten(state, group, { root = null, dateId = "", quiet = false, message = "Status saved" } = {}) {
  const first = ((group && group.orders) || [])[0];
  if (first) anchorRowId = first.id; // keep this row pinned where the baker tapped it
  save(state);
  maybeSync(state);
  updateOrderBadge(state);
  maybePublishTracking(state, group); // the customer's track card follows the status
  if (!quiet) toast(message);
  if (root) renderAll(root, state, new URLSearchParams({ date: dateId }));
}

// Move a group of orders onto another stage, with everything a stage carries: the stock
// it takes or gives back, and the flags that say what the stage means about the money.
function setStage(state, group, nextStatus, opts = {}) {
  const rows = ((group && group.orders) || []).filter(Boolean);
  if (!rows.length) return;
  // Baked takes the orders' ingredients off your stock; stepping back to before
  // Baked (an undo) puts them back. Forward moves leave stock be.
  adjustForStatus(state, rows, nextStatus, STATUSES.map(([id]) => id));
  for (const o of rows) {
    o.status = nextStatus;
    // Stepping into Confirmed / Paid means the stage is being worked, not
    // finished: it only turns green when Send confirmation / the Paid
    // button is pressed. Orders saved before these fields existed have no
    // flag, which reads as already done.
    // ... and the DRAFT mark goes with it (v268): arriving on Confirmed means this
    // message has not been written yet, so a draft left behind from the last time the
    // order sat here must not offer "I have sent it" for a message nobody has opened.
    if (nextStatus === "confirmed") {
      o.confirmedSent = false;
      delete o.confirmedOpened;
    }
    // Stepping PAST Paid without the money recorded says so on the order: a regular who
    // pays at the counter goes Confirmed -> Baked, and that order owes money. Without
    // this the flag would stay absent, which reads as "already paid" (the rule that keeps
    // her older orders from lighting up as unhandled), and the row would claim a payment
    // that never happened (17 Sep 2026). Only ever set when it is not already true, so
    // an order she did mark paid is never un-paid by moving it on.
    else if (STAGES_AT_OR_PAST_PAID.includes(nextStatus) && o.paidReceived !== true) {
      o.paidReceived = false;
    }
  }
  stageWritten(state, group, opts);
}

// The stage a collected delivery lands on — the last one, which this app has always
// labelled once for both of its endings.
const AUTO_STAGE = "delivered";

// The courier saying a trip has been picked up, and the order moving itself (v190).
//
// This is the first time anything in this app changes an order's stage with nobody's hand
// on it, so it is built to be SEEN and UNDONE rather than to be trusted. What the courier
// reports is a fact about a parcel; what a stage means is hers. Nothing moves quietly: the
// row gains a note naming who moved it and when, and one press puts it back.
//
// Two guards, and both are about her rather than about the courier. A row this rule has
// ALREADY moved is never moved again — a second check must not re-stamp the moment or
// overwrite the memory of what the row was before. And a row already sitting on the last
// stage is left alone, because there is nothing to move: a trip booked on an order she had
// already marked Collected / Shipped needs no help from anybody.
//
// Returns true when it moved the row, so the caller can say so in its own words.
//
// Exported so the rule above can be tested where it is stated. Through the screen the
// transition guard in the courier panel is reached first — it only asks for a move on the
// check that first SEES the trip collected — so a second call cannot be produced by
// pressing anything, and a guard nothing can reach is a guard nothing can prove.
export function autoCollect(state, group, order, { root = null, dateId = "" } = {}) {
  const o = order;
  if (!o || !o.courierJob) return false;
  if (o.courierJob.autoAt) return false;
  if ((o.status || "new") === AUTO_STAGE) return false;
  const at = new Date().toISOString();
  o.courierJob.autoAt = at;
  o.courierJob.collectedAt = String(o.courierJob.statusAt || "").trim() || at;
  // What the row was before, so the Undo can put it back. The payment flag is captured
  // WITH the stage and not instead of it: moving an order past Paid without the money
  // recorded is this app's own way of saying the order is owed, and that is the right rule
  // on a delivery that has gone out — but it is a claim about HER money, raised on a
  // courier's word, so the Undo has to be able to take it back. An Undo that restored the
  // stage and left the row saying it owes RM44 would be worse than no Undo at all.
  o.courierJob.autoFrom = { status: o.status || "new", paidReceived: o.paidReceived };
  setStage(state, group, AUTO_STAGE, { root, dateId, quiet: true });
  return true;
}

// Put a row back the way the courier found it. The three things the rule above wrote are
// cleared and nothing else is touched, so the Undo leaves no trace for a later check to
// trip over: with `autoAt` gone this is once again a row the rule has not moved, and the
// trip being collected does not move it a second time. That is the whole reason the guard
// is `autoAt` and not the trip's phase — an Undo has to survive her looking again.
function undoAutoCollect(state, group, order, { root = null, dateId = "" } = {}) {
  const o = order;
  const from = (o && o.courierJob && o.courierJob.autoFrom) || null;
  if (!from) return;
  delete o.courierJob.autoAt;
  delete o.courierJob.collectedAt;
  delete o.courierJob.autoFrom;
  // The stage goes back to the one this row was already on, and the STOCK rule is
  // deliberately not run on the way back. It is not an oversight: `adjustForStatus` reads
  // the row's current stage, which is now the last one, so it cannot tell "put this back"
  // from "step this out of Baked" — and stepping OUT of Baked puts the ingredients back
  // on her shelf. Charging one order's ingredients twice because a courier's API spoke is
  // exactly the kind of thing this release must not do. The auto-move itself changed no
  // stock (only stepping into or out of Baked does), so nothing needs undoing.
  o.status = from.status || "new";
  // Put back as it was, key and all: an order that had no payment flag at all goes back to
  // having none, rather than to a `false` this Undo invented.
  if (from.paidReceived === undefined) delete o.paidReceived;
  else o.paidReceived = from.paidReceived;
  stageWritten(state, group, { root, dateId, message: "Put back where it was" });
}
function orderGroupRow(state, group, root, dateId) {
  const orders = group.orders;
  const first = orders[0];
  const multi = orders.length > 1;
  const items = orders.map((o) => ({ name: orderLineName(state, o), qty: o.qty }));
  // Any note on any line of this order (v236). A single-item order with a note
  // gets the items line too — otherwise the only place the customer's words could
  // live would be the big title, and a heading is not where a note belongs.
  const anyNote = orders.some((o) => lineNoteOf(o.lineNote));
  const title = items.map((i) => i.name).join(" + ");
  const qtyTotal = items.reduce((s, i) => s + i.qty, 0);
  // Name, number, then the order's OWN note — the delivery note. It carries the
  // same underline the per-item note wears beside its item (v245), because it is
  // the customer's own words too and it applies to a self-collect order exactly as
  // much as a courier one. Blank pieces drop out, so a row with nothing to say
  // still draws no sub-line at all.
  const sub = subLineNodes([
    { text: first.customerName },
    { text: waNumber(first.whatsapp) },
    { text: first.note, mark: true },
  ]);
  const stSel = select(STATUSES.map(([v, l]) => ({ value: v, label: l })), first.status || "new",
    () => {
      // Picking Confirmed starts the confirming step, and confirming is what
      // sends the WhatsApp confirmation with the payment QR — that needs a
      // number on the order. Other stages advance the physical order even for a
      // walk-in with no number.
      if (!first.whatsapp && statusNeedsWhatsapp(stSel.value)) {
        stSel.value = first.status || "new";
        toast("Add the customer's WhatsApp first (tap Edit on the order).");
        return;
      }
      if (stSel.value === (first.status || "new")) return;
      // Everything a stage change carries — the stock, the money flags, the save, the
      // customer's card — is in one place, so this door and the courier's own cannot
      // drift apart (v190).
      setStage(state, group, stSel.value, { root, dateId });
    });
  stSel.className = "sel-small";

  const status = first.status || "new";
  const courier = first.fulfillment === "courier";
  // The courier moved this row and has not been put back (v190). Read here rather than
  // lower down, because the Undo press belongs in the row's own button line beside the
  // other things she can do to this order — and because the note under the row and the
  // press beside it have to agree about what happened, which one variable guarantees.
  const auto = first.courierJob && first.courierJob.autoFrom ? first.courierJob : null;
  const actions = [];
  // Edit is available on every order — single items and multi-item groups alike —
  // and opens a pop-up over the screen (the New-order card stays put).
  actions.push(button("Edit", () => {
    anchorRowId = first.id; // keep the row where the baker tapped it
    openEditPopup(state, group, dateId, root);
  }, "ghost small"));
  // The quick way in for the two fields she reaches for most: one tap here instead
  // of opening the whole Edit form.
  actions.push(button("Note / tracking", () => {
    anchorRowId = first.id;
    openNoteTrackingPopup(state, group, first, dateId, root);
  }, "ghost small"));

  // The stage's WhatsApp action(s). Each message carries the order code, and the
  // buttons that only send a message need a number on the order.
  if (status === "confirmed") {
    // The message is drafted, not sent (v268): the press opens WhatsApp and records that
    // much, and the row asks for the one thing the app cannot see by itself. Until she
    // says so the Confirmed dot stays amber, and the customer's card agrees — the same
    // flag feeds both (supabase.js confirmed_sent).
    const drafted = first.confirmedSent === false && first.confirmedOpened === true;
    const sendBtn = button("Send confirmation", () =>
      sendOrderWhatsApp(state, group, { builder: buildConfirmation, markOpened: true,
        doneMsg: "Confirmation drafted — press Send in WhatsApp, then tell me it has gone", root, dateId }),
      drafted ? "ghost small" : "soft small");
    if (!first.whatsapp) sendBtn.disabled = true;
    actions.push(sendBtn);
    if (drafted) {
      actions.push(button("I have sent it", () => markConfirmationSent(state, group, root, dateId), "small primary"));
    }
  } else if (status === "paid") {
    const remindBtn = button("Send payment reminder", () =>
      sendOrderWhatsApp(state, group, { builder: buildPaymentReminder, doneMsg: "Payment reminder drafted — press Send in WhatsApp", root, dateId }),
      "soft small");
    if (!first.whatsapp) remindBtn.disabled = true;
    actions.push(remindBtn);
  } else if (status === "baking") {
    // Nothing of its own. Print label sits below, for every stage from Preparing
    // onwards (v268) — it used to be offered at Preparing and nowhere else, so the one
    // control that prints the slip for the pouch vanishes the moment the order was
    // packed, including for the order still in her hand, with nothing on the row to say
    // where it went.
  } else if (status === "ready") {
    // How this order leaves decides what she tells the customer: a parcel goes on
    // its way (with its tracking number), a collect order is ready to fetch.
    if (courier) {
      actions.push(shippedMsgButton(state, group, first, root, dateId));
    } else {
      const pickupBtn = button("Send pickup reminder", () =>
        sendOrderWhatsApp(state, group, { builder: buildPickupReminder, doneMsg: "Pickup reminder drafted — press Send in WhatsApp", root, dateId }),
        "soft small");
      if (!first.whatsapp) pickupBtn.disabled = true;
      actions.push(pickupBtn);
    }
  } else if (status === "delivered" && courier) {
    // Already marked Posted: the message is still offered, because she may have
    // moved the status first and typed the tracking number afterwards.
    actions.push(shippedMsgButton(state, group, first, root, dateId));
  }
  // Money can be recorded at ANY stage from Paid onwards, not only while the order sits on
  // the Paid step. That is the regulars' route: confirm the order, make it, pack it, and she
  // hands over the money when they collect — so the buttons stay on until the payment lands,
  // wherever the order has got to (17 Sep 2026). They go the moment it is recorded, which is
  // when the Cash / TNG tag appears beside the row.
  const stageAt = STATUSES.findIndex(([id]) => id === status);
  const atOrPastPaid = stageAt >= PAID_AT;
  if (atOrPastPaid && first.paidReceived === false) {
    actions.push(
      button("Paid · Cash", () => markPaid(state, group, root, dateId, "cash"), "small primary"),
      button("Paid · TNG", () => markPaid(state, group, root, dateId, "tng"), "small primary"));
  }
  // Print label, from Baked onwards rather than only while the order sits on Baked (v268).
  // The slip goes out with the bag — a label that tore, or one printed before she had
  // finished packing, needs a second one, and the order it belongs to is often still in
  // her kitchen at Packed. Printing it again says nothing about the stage, so nothing
  // here is a claim about the order; before Baked there is no bag to kit, so it is not
  // offered at all.
  if (stageAt >= BAKED_AT) {
    actions.push(button("Print label", () => openLabelPrint(state, group), "ghost small"));
  }
  // The Undo sits with the other things she can do to this order, and before the ✕ so
  // the box that deletes the row stays the last press on the line where it has always
  // been. It is not a "dismiss the note" press: it puts the stage and the payment flag
  // back where they were.
  if (auto) actions.push(button("Undo", () => undoAutoCollect(state, group, first, { root, dateId }), "ghost small"));
  actions.push(button("✕", () => removeOrder(state, group, root, dateId), "ghost small"));
  const placedLine = el("div", { class: "li-sub" },
    `Placed ${fmtPlaced(first.createdAt, first.orderDate)}`,
    el("span", { class: `fulfill-tag${courier ? " courier" : ""}` }, courier ? "Post (nationwide)" : "Collect (local)"),
    courier && String(first.address || "").trim() ? el("span", { class: "fulfill-sub" }, String(first.address).trim()) : null);
  // The parcel she recorded (v226), said on the row itself rather than left to the
  // pop-up: it is the answer to "has this gone?", which is the question the row is
  // looked at for. Drawn only when a parcel exists, so every order that is not one
  // is byte-identical. The consignment number is the tracking box's own value, read
  // here as it already is elsewhere — a number to read out, not to open.
  // The row claims a parcel only while the order actually leaves by courier, and only
  // when no booked trip is out: a trip is a real vehicle the customer is being shown,
  // so an older parcel record must not be drawn as if it were the live arrangement.
  // Neither record is ever deleted by the other — both stay readable in the pop-up —
  // which is why this is a condition on the drawing, not a cleanup of the data.
  const parcel = (courier && !jobOf(first)) ? parcelOf(first) : null;
  const parcelNo = String(first.trackingNo || "").trim();
  const parcelLine = parcel
    ? el("div", { class: "li-sub muted" },
        `📦 ${parcel.carrierName}`
        + (parcelNo ? ` · ${parcelNo}` : "")
        + (parcelHanded(first) ? " · handed over" : ""))
    : null;
  const noWaHint = !first.whatsapp
    && (["confirmed", "paid", "ready"].includes(status) || (status === "delivered" && courier))
    ? el("div", { class: "li-sub muted" }, "Add the customer's WhatsApp (tap Edit) to send this order's messages.")
    : null;

  // The courier moved this row and the row says so (v190). Written on the row rather than
  // said in a toast at the moment it happened: a toast is gone in seconds, and this is a
  // change to an order's own money that she may not look at until the evening. The note
  // names WHO and WHEN, so the row can never read as something she did and cannot
  // remember doing.
  const autoNote = auto
    ? el("div", { class: "li-sub muted" },
        `${String(auto.courierName || "").trim() || "The courier"} says it collected`
        + (auto.collectedAt ? ` at ${fmtStamp(auto.collectedAt, todayISO())}` : "")
        + " — this row moved itself. Put it back if that is not right.")
    : null;

  // The order's own money, on the row (v277). Her report, 2 Oct 2026: the money is "non at
  // all in the order list". Every row now ends with its total in the same right-hand
  // column as every other row, so a list of orders can be read down the figures the way a
  // column of receipts can — "the money have to align up ... line up in one column".
  //
  // It is the SAME figure the receipt in the Edit / Note pop-ups and the customer's own
  // message quote, because all three read one customerTotal: an order the row prices at
  // RM38 and the pop-up prices at RM35 would be the class of fault this whole version is
  // about. Drawn only when the order has been priced at all — an unpriced row is not an
  // order worth nothing, and "RM 0.00" beside it would be the app inventing a figure.
  const orderMoney = customerTotal(state, group);
  const totalLine = orderMoney.items > 0
    ? el("div", { class: "info-row li-money" },
        el("span", {}, "Order total"),
        el("span", { class: "info-val" }, fmtRM(orderMoney.total, state.settings.currency)))
    : null;

  // The row is tagged with its first item's id; the group id rides along so the
  // inbox tap can still find this row when its own item is not the first one.
  const rowAttrs = { class: "list-item", dataset: { order: first.id } };
  const groupId = orders.find((o) => o.groupId)?.groupId;
  if (groupId) rowAttrs.dataset.group = groupId;

  return el("div", rowAttrs,
    el("div", { class: "li-main" },
      el("div", { class: "li-title" }, title, orderCodeTag(first),
        promoTag(first),
        orders.some((o) => o.source === "storefront") ? el("span", { class: "src-tag" }, "storefront") : null),
      (multi || anyNote)
        ? el("div", { class: "li-sub" }, orders.flatMap((o, i) =>
            i ? ["  ·  ", ...orderLineNodes(state, o)] : orderLineNodes(state, o)))
        : null,
      placedLine,
      sub.length ? el("div", { class: "li-sub" }, ...sub) : null,
      parcelLine,
      noWaHint,
      autoNote),
    el("div", { class: "li-right" },
      el("span", { class: "qty-chip" }, `×${qtyTotal}`),
      // Both halves, and the second one is the app's own question rather than a guess
      // from the row (v268): a method AND the money actually in (isCollected — the same
      // rule the journey strip, the Money screen and the tally all read). The tag used to
      // rest on `paidMethod` alone, so a method written without the money — a row recorded
      // before this version's box learned to write the payment, or one she had since set
      // back to Not recorded — still dressed the row as paid while every other screen said
      // it owed money. A method with the money not in is a note about HOW it will come,
      // and that belongs in the pop-up, not on a row that reads as settled.
      first.paidMethod && isCollected(group)
        ? el("span", { class: `paid-tag${first.paidMethod === "tng" ? " tng" : ""}` },
            first.paidMethod === "cash" ? "Cash" : "TNG")
        : null,
      // The courier's charge, in the paid-tag's family so it reads as one more thing
      // about this order: neutral when the customer bore it (it costs her nothing),
      // amber when it came out of her own pocket and is already off her profit.
      //
      // Both halves are required before it is tagged at all: with no payer recorded an
      // amount says nothing about who owes it, and the tag used to fill the blank in as
      // "customer" — a claim she never made, on a row it could not be removed from
      // (19 Sep 2026).
      //
      // And the order has to be going by courier, which is the third thing the tag needs
      // (1 Oct 2026). The three charge keys are not cleared when she switches to self
      // collect — she may switch back — so they outlive the fulfilment they were recorded
      // for, and the row kept a "Courier RM8.00 · customer" tag on an order with no
      // courier in it. That was her report: "when i schange the courier delivery to self
      // pickup, the courier chages tag still there".
      courierFeeOf(first) && courierPayerOf(first) && isCourierOrder(first)
        ? el("span", { class: `paid-tag courier${courierPayerOf(first) === "me" ? " mine" : ""}` },
            `Courier ${fmtRM(courierFeeOf(first), state.settings.currency)} · ${courierPayerOf(first) === "me" ? "me" : "customer"}`
            // ... and, for a customer-borne charge, which way it reaches her — so she
            // knows to have the courier take it at the door rather than look for it in
            // the tin at the end of the day (19 Sep 2026).
            + (courierCodOf(first) ? " · COD" : ""))
        : null,
      stSel,
      ...actions),
    totalLine,
    orderJourneyEl(first),
    referralBlockEl(state, group, root, dateId),
    promoBlockEl(state, group));
}

// ---- bring-a-friend (order row) ------------------------------------------
// When shared data on + referrals on, a row whose order came through someone's
// personal link shows what to do with it right under the journey: the Give
// credit / Skip choice for a NEW referred customer, and the customer's own
// usable credits ("Apply credit" = the owner has taken that RM off in
// WhatsApp). Everything the owner does is one tap — the app records, she
// applies the real discount on the confirmation message.

function referralBlockEl(state, group, root, dateId) {
  const first = group.orders[0];
  const scheme = schemeOf(state);
  if (!scheme.enabled || !first) return null;
  const parts = [];
  if (waNumber(first.referredBy)) {
    const offer = referralOfferEl(state, group, scheme, root, dateId);
    if (offer) parts.push(offer);
  }
  const apply = referralApplyEl(state, group, root, dateId);
  if (apply) parts.push(apply);
  return parts.length ? el("div", { class: "ref-block" }, ...parts) : null;
}

function refNote(text) {
  return el("p", { class: "card-sub", style: "margin:0 0 6px" }, text);
}

// ---- the label an order came in on ---------------------------------------
// What to take off, never what the app has taken off: the customer's page states
// the offer and deliberately does not apply it, so the figure she quotes back on
// WhatsApp is hers to decide — the same way a bring-a-friend credit is applied.
//
// Shown on the row and in the Edit pop-up, because the pop-up is where she fixes
// the items. There it is handed the pop-up's OWN total, so the "under the
// minimum" line can never disagree with the "Order total:" line right above it.
//
// The code is resolved live from the code list (see promoOf), so a label she has
// since renamed or retired still reads right — and a label she can no longer
// honour is still said out loud rather than leaving a blank.
function promoBlockEl(state, group, total) {
  const p = promoOf(state, group, todayISO(), total);
  if (!p) return null;
  const cur = p.cur;
  const named = p.name && p.name !== p.code ? ` — ${p.name}` : "";
  const parts = [];
  if (p.gone) {
    parts.push(refNote(`🎟 ${p.code} — no longer in your code list (${aKind(p.kind)}).` +
      " The order still records it."));
  } else if (p.retired) {
    parts.push(refNote(`🎟 ${p.code}${named} — you retired this code. The order still records it.`));
  } else if (!p.live) {
    // offerLine already ends on "ended" for an offer whose date has passed.
    const off = offerLine(p.offer, cur, todayISO());
    parts.push(refNote(off
      ? `🎟 ${p.code}${named} — ${off} — nothing to take off.`
      : `🎟 ${p.code}${named} — a label with no offer on it.`));
  } else {
    parts.push(refNote(`🎟 ${p.code}${named} — ${offerLine(p.live, cur, todayISO())}` +
      " — take it off when you confirm."));
    // Warnings only while the offer is live: a verdict on a code she can no
    // longer honour is one she cannot act on.
    if (!p.newCustomer) {
      parts.push(refNote(el("span", { class: "promo-warn" },
        "⚠️ Not a new customer — this offer is for new customers only.")));
    }
    if (!p.overMin) {
      parts.push(refNote(el("span", { class: "promo-warn" },
        `⚠️ This order is ${fmtRM(p.total, cur)} — under the ${fmtRM(Number(p.live.minSpend) || 0, cur)} minimum.`)));
    }
  }
  return el("div", { class: "promo-block" }, ...parts);
}

// "a shop label" / "an offer label" — the kind she picked when the code was made,
// which the order keeps even after the code itself is gone.
function aKind(kind) {
  const word = String(KIND_LABEL[kind] || "plain").toLowerCase();
  return `${/^[aeiou]/.test(word) ? "an" : "a"} ${word} label`;
}

function referralOfferEl(state, group, scheme, root, dateId) {
  const first = group.orders[0];
  const cur = (state.settings && state.settings.currency) || "RM";
  const via = waNumber(first.referredBy);
  const friendDigits = waNumber(first.whatsapp);
  const friendName = String(first.customerName || "").trim()
    || (friendDigits ? `${friendDigits} (new)` : "a new customer");
  const refName = referrerName(state, via) || `${via} (new)`;
  const handled = String(first.referralHandled || "");

  const give = () => {
    const r = giveCredits(state, group, scheme);
    for (const o of group.orders) o.referralHandled = "gave";
    anchorRowId = first.id;
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    toast(r.created
      ? `Credits added — apply the ${fmtRM(scheme.friendRM, cur)} off when you confirm`
      : "Credit was already given");
    renderAll(root, state, new URLSearchParams({ date: dateId }));
  };
  const skip = () => {
    for (const o of group.orders) o.referralHandled = "skip";
    anchorRowId = first.id;
    save(state);
    maybeSync(state);
    toast("Skipped — no credit for a returning customer");
    renderAll(root, state, new URLSearchParams({ date: dateId }));
  };

  if (handled === "gave") {
    return refNote(`🎁 Credit given — ${fmtRM(scheme.friendRM, cur)} off ${friendName}'s first order, and ${fmtRM(scheme.referrerRM, cur)} for ${refName}.`);
  }
  if (handled === "skip") {
    return refNote("⏭ Marked \"already a customer\" — no credit given.");
  }
  if (referralFlag(state, group) === "self") {
    return refNote(`↩️ ${refName} ordered through their own link — no referral credit.`);
  }
  if (referralFlag(state, group) === "existing") {
    return refNote(`👋 ${friendName} came via a link but already ordered before — not a new friend, no credit.`);
  }
  return el("div", { class: "ref-offer", style: "margin-bottom:6px" },
    refNote(`🎁 New referred customer — ${friendName} gets ${fmtRM(scheme.friendRM, cur)} off their first order, and ${refName} earns ${fmtRM(scheme.referrerRM, cur)}.`),
    el("div", { class: "btn-row", style: "margin:0" },
      button("Give credit", give, "small primary"),
      button("Skip — already a customer", skip, "ghost small")));
}

// The person on THIS order has unused credits (a friend's first-order discount,
// or a referrer reward ready to spend) — offer to apply one. The owner taps it
// after she has taken the RM off in WhatsApp, so the record matches reality.
function referralApplyEl(state, group, root, dateId) {
  const first = group.orders[0];
  const cur = (state.settings && state.settings.currency) || "RM";
  const mine = validCredits(state, waNumber(first.whatsapp));
  if (!mine.length) return null;
  const firstCredit = mine[0];
  return el("div", { class: "ref-apply", style: "margin-top:2px" },
    el("span", { class: "card-sub", style: "margin:0" },
      `✨ ${fmtRM(firstCredit.amountRM, cur)} credit available on this order`),
    button(`Apply credit${mine.length > 1 ? ` (${mine.length})` : ""}`, () => {
      const used = markOneUsed(state, waNumber(first.whatsapp));
      anchorRowId = first.id;
      save(state);
      maybeSync(state);
      toast(used ? `${fmtRM(used.amountRM, cur)} credit used — already taken off this order` : "Nothing to apply");
      renderAll(root, state, new URLSearchParams({ date: dateId }));
    }, "soft small"));
}

function trackUrlFor(order) {
  return `${location.origin}/store/?track=${orderCode(order)}`;
}

// Open WhatsApp with the built message for this order. When `markOpened` is set the press
// also records that the message was DRAFTED (order.confirmedOpened) — and nothing more.
//
// Opening WhatsApp is not sending the message (v268). The Confirmed step turns green only
// from the row's own "I have sent it"; until then the app counts the confirmation as
// outstanding, which is what it is. Before this, pressing Send confirmation lit the step
// green — and lit the customer's own track card with it, which reads the same flag — on a
// message that was still sitting unsent in WhatsApp's box.
//
// Nothing is published here either: a draft changes nothing the customer can see, and the
// stage that put this order on Confirmed already published its own card (stageWritten).
function sendOrderWhatsApp(state, group, { builder, markOpened = false, doneMsg, root, dateId }) {
  const first = group.orders[0];
  if (!first || !first.whatsapp) return;
  const built = builder(state, group, trackUrlFor(first));
  if (!built || !built.recipient) return;
  window.open(`https://wa.me/${built.recipient}?text=${encodeURIComponent(built.message)}`, "_blank");
  if (markOpened) {
    for (const o of group.orders) o.confirmedOpened = true;
    save(state);
    maybeSync(state);
  }
  anchorRowId = first.id;
  toast(doneMsg);
  renderAll(root, state, new URLSearchParams({ date: dateId }));
}

// The confirmation has actually gone — the half of it the app cannot know on its own
// (v268). This is the press that turns the step green, on her row and on the customer's
// track card behind the same flag, and it is the only thing that may say the message was
// sent. Putting the order back onto Confirmed clears both marks (setStage), so sending a
// second one is never blocked by the first.
function markConfirmationSent(state, group, root, dateId) {
  for (const o of group.orders) {
    o.confirmedSent = true;
    delete o.confirmedOpened; // the draft it stood for is done with
  }
  const first = firstOf(group);
  if (first) anchorRowId = first.id;
  save(state);
  maybeSync(state);
  publishTracking(state, group); // Confirmed now green on the customer's track card too
  toast("Confirmation sent");
  renderAll(root, state, new URLSearchParams({ date: dateId }));
}

// The customer's TNG receipt has come back — mark the order Paid for real. This
// is what turns the Paid step green on the row's map (the Paid button, not just
// picking Paid in the dropdown). No WhatsApp needed.
// Money in — and HOW it came in (16 Sep 2026). Two buttons rather than one, because
// cash in her hand and a TNG transfer in the app are reconciled against different
// things: the row records which, and when. The stamp lands when the money actually
// arrives, so an order can sit at Paid waiting on a transfer without being counted
// as collected anywhere. The customer sees none of this — their card just goes green.
function markPaid(state, group, root, dateId, method) {
  const at = new Date().toISOString();
  for (const o of group.orders) {
    o.paidReceived = true;
    o.paidMethod = method; // "cash" | "tng"
    o.paidAt = at;
  }
  anchorRowId = firstOf(group).id;
  save(state);
  maybeSync(state);
  publishTracking(state, group); // Paid now green on the customer's track card too
  toast(method === "cash" ? "Paid — cash received" : "Paid — TNG received");
  renderAll(root, state, new URLSearchParams({ date: dateId }));
}

function firstOf(group) {
  return ((group && group.orders) || [])[0];
}

function removeOrder(state, group, root, dateId) {
  const label = group.orders.map((o) => `${orderLineName(state, o)} ×${o.qty}`).join(", ");
  confirmDialog(`Remove order "${label}"?`,
    () => {
      const ids = new Set(group.orders.map((o) => o.id));
      state.orders = state.orders.filter((o) => !ids.has(o.id));
      save(state);
      maybeSync(state);
      updateOrderBadge(state);
      toast("Order removed");
      renderAll(root, state, new URLSearchParams({ date: dateId }));
    }, { danger: true, yesLabel: "Remove" });
}
