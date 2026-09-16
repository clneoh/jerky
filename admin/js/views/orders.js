// views/orders.js — per-delivery-date order intake (manual, warn-not-block).

import { addDays, deliveryStatus, fmtPlaced, longDate, shortDate, todayISO, weekdayName } from "../dates.js";
import { capacityStatus, dayCapacityParts, dayRuleRows, parseDayDelta, productRemaining, saveDayAdjustments } from "../bom.js";
import { dayMoney } from "../money.js";
import { el, button, select, fillMeter, emptyState, confirmDialog, toast, showPopup } from "../ui.js";
import { dateField } from "../datepicker.js";
import { DOW, addMonth, monthLabel, monthWeeks, occColour, occForDate } from "../calendar.js";
import { boxClass, nameDay, occBox, occPapers, tipEl } from "../occgrid.js";
// A product's sell days — the shared root copy the shop reads, so the day this
// pop-up counts a product on is exactly the day the shop offers it.
import { sellOpen } from "../../../availability.js";
import { byId, fmtRM, groupOrders, moveOrderGroup, newId, orderCode, orderLineName, orderLinePrice, save, stampOrderLine, updateOrderBadge, waNumber } from "../state.js";
import { strictestCancelDays } from "../../../store/pool.js";
import { buildConfirmation } from "../confirm.js";
import { buildPaymentReminder, buildPickupReminder, buildShippedMessage } from "../messages.js";
import { maybeSync, publishTracking } from "../supabase.js";
import { schemeOf, referralFlag, giveCredits, validCredits, markOneUsed, referrerName } from "../referrals.js";
import { adjustForStatus } from "../stock.js";
import { keyOf } from "../customers.js";
import { syncContactFromOrder } from "../profiles.js";

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
// The month the Orders screen's calendar is showing, as { year, month } — null
// until the first render settles it on the day that opens. It lives out here, not
// inside the render, so paging forward to look at a later week survives a rebuild
// the baker did not ask for (a sync pull, a status change).
let ordersCalMonth = null;
// Whether the ＋ New order card is open. Also module scope, because the card is
// rebuilt whenever anything around it changes — including when a day is tapped in
// its own calendar — and folding under her finger at that moment would be mad.
let newFormOpen = false;

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
  let end = 0; // first index NOT done; steps before it are green
  for (let i = 0; i < STATUSES.length; i++) {
    let done;
    if (i < at) done = true;                          // already moved past
    else if (i === at) done = i === 0 ? true          // New: done on arrival
      : i === 1 ? confirmedDone                       // Confirmed: after Send confirmation
      : i === 2 ? paidDone                            // Paid: after the Paid button
      : true;                                         // Preparing/Packed/Collected-Posted: on selection
    else done = false;
    if (!done) break;
    end = i + 1;
  }
  return STATUSES.map((_, i) => (i < end ? "done" : i === end ? "now" : "todo"));
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
  const itemLines = orders.map((o) => `${orderLineName(state, o)} ×${Number(o.qty) || 1}`);
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
    for (const line of itemLines) rows.push(["mail-line", line]);
    if (note) rows.push(["mail-line", `Note: ${note}`]);
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
    if (itemLines.length) rows.push(["items", itemLines.join(" · ")]);
    if (address) rows.push(["address", address]);
    return { style, rows };
  }
  if (dateLine || method) rows.push(["meta", [dateLine, method].filter(Boolean).join(" · ")]);
  rows.push(["code", code]);
  if (customer) rows.push(["customer", customer]);
  for (const line of itemLines) rows.push(["item", line]);
  if (note) rows.push(["note", `Note: ${note}`]);
  if (address) rows.push(["address", `Post to: ${address}`]);
  return { style, rows };
}

// ── The ＋ New order card folds away ─────────────────────────────────────────
// It sits on every delivery day and is not what the screen is for day to day, so
// it starts shut. One document listener serves it, and a card taken off the page
// is simply dropped from the list on the next tap — nothing has to be unhooked
// when a rebuild replaces it. Installed from renderOrders rather than at module
// scope, since the test shim's document has no addEventListener.
const openOrderCards = new Set();
let orderCollapseInstalled = false;

function installOrderCollapseOutside() {
  if (orderCollapseInstalled || typeof document === "undefined"
      || typeof document.addEventListener !== "function") return;
  orderCollapseInstalled = true;
  document.addEventListener("pointerdown", (ev) => {
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
  ordersCalMonth = null; // …and on the month of the day that opens
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
// date pills: the same month grid the shop shows its customers, with each day the
// bakery delivers carrying how booked it is. A strip could only ever show a
// handful of days and made a distant date something to hunt for.
//
// `days` is deliveryDayList(state) on this screen (the Edit pop-up passes its own
// shorter list); a day in it is tapped to open it, and a day of the month with no
// delivery record is drawn quietly and does nothing. `getActiveId()` is read on
// every paint rather than captured, so a rebuild marks the day actually on screen,
// and `month` is the caller's own { year, month }, paged in place so the month she
// is looking at survives that rebuild.
function monthOf(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return { year: d.getFullYear(), month: d.getMonth() };
}

function before(a, b) {
  return a.year < b.year || (a.year === b.year && a.month < b.month);
}

// `noteMisses` turns on one extra thing: tapping a day the bakery does not deliver
// is ANSWERED instead of swallowed — the calendar says the day is not a delivery
// day, and where it gets added. The baker is on these screens to put an order
// somewhere, so a tap that does nothing is a dead end she has to guess her way out
// of (15 Sep 2026: she tapped a marked 16 Sep, read "Malaysia Day", and had no way
// of knowing why no order could go on it). The state is this calendar's own, in
// its closure: nothing outside the grid answers for it.
export function deliveryCal({ state, days, getActiveId, month, onPick, noteMisses = false }) {
  const list = (days || []).filter((d) => d && d.id && d.date);
  const today = todayISO();
  let missedIso = null; // the day she asked about and the bakery does not deliver
  const byDate = new Map(list.map((d) => [d.date, d.id]));
  // The arrows reach only the months a delivery day falls in: a month with
  // nothing to deliver has nothing to show, so paging into it is a dead end.
  let lo = null;
  let hi = null;
  for (const d of list) {
    const m = monthOf(d.date);
    if (!lo || before(m, lo)) lo = m;
    if (!hi || before(hi, m)) hi = m;
  }
  if (!lo) { lo = monthOf(today); hi = lo; }

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
    const go = (delta) => {
      const next = addMonth(month.year, month.month, delta);
      month.year = next.year;
      month.month = next.month;
      paint();
    };
    const prev = button("‹", () => go(-1), "ghost small cal-nav");
    const next = button("›", () => go(1), "ghost small cal-nav");
    if (!before(lo, month)) prev.disabled = true;
    if (!before(month, hi)) next.disabled = true;

    const weeks = monthWeeks(month.year, month.month);
    const cells = weeks.flat().map((iso) => {
      if (!iso) return el("span", { class: "cal-cell blank" });
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
      // she does not deliver would be the one day of the month with no way to be
      // read (the customer's shop page names that day too).
      if (!dateId) {
        const cls = `cal-cell off${iso === today ? " today" : ""}${box}`;
        // A day already gone is asked nothing: there is nothing left to add to it,
        // and the past is reviewed in the list below, not on the grid.
        const askable = noteMisses && !past;
        if (!tip && !askable) return el("span", { class: cls }, num);
        return el("button", {
          class: `${cls} ${tip ? "tippable" : "tappable"}`,
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
    wrap.replaceChildren(
      el("div", { class: "cal-head" },
        prev,
        el("span", { class: "cal-title" }, monthLabel(month.year, month.month)),
        next),
      el("div", { class: "cal-grid" },
        ...DOW.map((d) => el("span", { class: "cal-dow" }, d)),
        ...cells,
        ...occPapers(state.occasions, weeks, today)),
      ...(note ? [note] : []));
  }

  paint();
  return { el: wrap, repaint: paint };
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

  const activeDate = byId(state.deliveryDates, activeId);
  if (!ordersCalMonth) ordersCalMonth = monthOf(activeDate.date);
  const topCal = deliveryCal({
    state,
    days: deliveryDayList(state),
    getActiveId: () => activeId,
    month: ordersCalMonth,
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
  // calendar is rebuilt, so the calendar keeps the month she paged it to. The URL
  // still updates (without firing the router) so the current date stays shareable.
  const selectDate = (id) => {
    activeId = id;
    // Opening a day in another month brings the grid with it — a New-orders row a
    // season away must not leave the calendar showing a month it isn't on.
    const dest = byId(state.deliveryDates, id);
    if (dest) {
      const m = monthOf(dest.date);
      ordersCalMonth.year = m.year;
      ordersCalMonth.month = m.month;
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
// view and flashes it so the baker sees exactly where it is. Matches live-update
// as she types — only the results list is rebuilt, never the input, so the
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

// Product choices for adding/editing an order. Unlike the customer menu, the
// backoffice pickers show EVERY product — including hidden ones (marked
// "(hidden)") — so the baker can still add or edit an order for a product she
// has temporarily taken off the menu. Active products list first.
function productOptions(state, dateId, excludeOrderId = null) {
  // Drafts are never for sale yet, so they have no orders — keep them out of
  // the backoffice picker too. Hidden products stay (marked below) so an order
  // for something temporarily off the menu can still be added or edited.
  return state.products
    .filter((p) => p.draft !== true)
    .map((p) => {
      const pr = productRemaining(state, dateId, p.id, excludeOrderId);
      let label = pr ? `${p.name} — ${pr.remaining <= 0 ? "sold out" : `${pr.remaining} left`}` : p.name;
      const hidden = p.active === false;
      if (hidden) label += " (hidden)";
      return { value: p.id, label, hidden };
    })
    .sort((a, b) => (a.hidden === b.hidden ? 0 : a.hidden ? 1 : -1));
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

  // The form edits a *draft*, not the orders directly, so a mid-edit re-render
  // (a sync pull, a fresh storefront import) rebuilds this form with what she
  // actually typed. Nothing is written until Add order is pressed.
  const draft = { customerName: "", whatsapp: "", fulfillment: "collect", address: "", note: "", orderDate: todayISO() };
  const customer = el("input", { class: "input", placeholder: "Customer name (optional)",
    value: draft.customerName, oninput: function () { draft.customerName = this.value; } });
  const whatsapp = el("input", { class: "input", type: "tel", inputmode: "tel",
    placeholder: "e.g. 012-345 6789", "data-suggest": "012-345 6789",
    value: draft.whatsapp, oninput: function () { draft.whatsapp = this.value; } });
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; });
  const address = el("input", { class: "input", placeholder: "Postal address (for posting)",
    value: draft.address, oninput: function () { draft.address = this.value; } });
  const note = el("input", { class: "input", placeholder: "Note (optional)",
    value: draft.note, oninput: function () { draft.note = this.value; } });
  const orderDate = dateField(draft.orderDate, (iso) => { draft.orderDate = iso; },
    { occasions: state.occasions });

  // "Which day am I adding to?" — the same calendar the top of the screen shows,
  // so the two can never disagree about which days exist. Choosing a day switches
  // the screen instead of filling a draft: the product list and each day's limits
  // are built for the date on screen, so a day held only in the draft would offer
  // items that are not sellable on it.
  const dayCal = deliveryCal({
    state,
    days: deliveryDayList(state),
    getActiveId: () => dateId,
    month: monthOf(date.date),
    onPick: selectDate,
    noteMisses: true,
  });

  const rowsEl = el("div", {});
  const totalEl = el("p", { class: "card-sub", style: "margin:8px 0 0" });
  const items = [{ productId: "", qty: 1, price: null }];
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
      // Two lines, built as two: the product across the top so its name is readable,
      // then its controls — how many, the price, remove. Letting flexbox wrap them
      // instead left the dropdown 2px wide with the price box eating the row.
      return el("div", { class: "add-item" },
        prodSel,
        el("div", { class: "add-item-ctl" },
          el("div", { class: "stepper" },
            el("button", { onclick: () => { it.qty = Math.max(1, it.qty - 1); qtySpan.textContent = String(it.qty); paintTotal(); } }, "−"),
            qtySpan,
            el("button", { onclick: () => { it.qty = it.qty + 1; qtySpan.textContent = String(it.qty); paintTotal(); } }, "＋")),
          linePriceBox(it, paintTotal),
          el("button", { class: "inbox-del", "aria-label": "Remove item",
            onclick: () => { items.splice(i, 1); renderRows(); } }, "✕")));
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
    if (picked.length === 1) {
      addNew(state, date, picked[0].productId, picked[0].qty, picked[0].price ?? null,
        customerName, phone, fulfillment, addressText, noteText, placed, root);
    } else {
      addGroupNew(state, date, picked, customerName, phone, fulfillment, addressText, noteText, placed, root);
    }
  };

  // Shut until its title is tapped: the card stands on every delivery day and is
  // not what the screen is for day to day. Inside, the day calendar comes first
  // (the same month grid the shop shows), then the customer, then the items.
  const body = el("div", { class: "fold-body", hidden: !newFormOpen },
    el("div", { class: "field", style: "margin-bottom:10px" },
      el("label", {}, "Delivery day"),
      dayCal.el),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Customer"), customer),
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel),
      el("div", {}, el("label", {}, "Delivery address (if courier)"), address)),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Order date = when it was placed (defaults to today). WhatsApp is kept in your delivery history for marketing follow-ups."),
    el("div", { class: "field" },
      el("label", {}, "Items"),
      rowsEl,
      button("＋ Add another item", () => { items.push({ productId: "", qty: 1, price: null }); renderRows(); }, "ghost"),
      totalEl),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Everything in the Items list becomes one customer order — add every item, then press Add order."),
    el("div", { class: "field" }, note),
    button("＋ Add order", submit, "block primary"));

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
  };

  const title = el("div", { class: "popup-title-row" },
    "Edit order",
    orderCodeTag(first));
  showPopup(title, (refresh, close) => popupEditBody(state, date, group, first, lines, draft, refresh, close, root));
}

function popupEditBody(state, date, group, first, lines, draft, refresh, close, root) {
  const curId = draft.deliveryDateId || (date && date.id) || "";
  const products = productOptions(state, curId);
  const customer = el("input", { class: "input", placeholder: "Customer name (optional)",
    value: draft.customerName, oninput: function () { draft.customerName = this.value; } });
  const whatsapp = el("input", { class: "input", type: "tel", inputmode: "tel",
    placeholder: "e.g. 012-345 6789", "data-suggest": "012-345 6789",
    value: draft.whatsapp, oninput: function () { draft.whatsapp = this.value; } });
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; });
  const address = el("input", { class: "input", placeholder: "Postal address (for posting)",
    value: draft.address, oninput: function () { draft.address = this.value; } });
  const note = el("input", { class: "input", placeholder: "Note (optional)",
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
  // room for another thing to unfold.
  const curDate = byId(state.deliveryDates, curId);
  const deliveryPick = deliveryCal({
    state,
    days: deliveryDayOptions(state, curId),
    getActiveId: () => draft.deliveryDateId || curId,
    month: monthOf(curDate ? curDate.date : todayISO()),
    onPick: (id) => { draft.deliveryDateId = id; refresh(); },
    noteMisses: true,
  }).el;
  const deliveryNotes = el("div", { class: "card-sub", style: "margin:6px 0 0" },
    ...moveNoteLines(state, group, curId).map((t) => el("p", { style: "margin:2px 0" }, t)));

  const totalEl = el("p", { class: "card-sub", style: "margin:8px 0 0" });
  const paintTotal = () => {
    const priced = lines.filter((l) => l.productId && l.price != null);
    totalEl.textContent = priced.length
      ? `Order total: ${fmtRM(priced.reduce((sum, l) => sum + l.qty * Number(l.price), 0),
          state.settings.currency)}`
      : "";
  };
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
    return el("div", { class: "add-item" },
      prodSel,
      el("div", { class: "add-item-ctl" },
        el("div", { class: "stepper" },
          el("button", { onclick: () => { line.qty = Math.max(1, line.qty - 1); qtySpan.textContent = String(line.qty); paintTotal(); } }, "−"),
          qtySpan,
          el("button", { onclick: () => { line.qty = line.qty + 1; qtySpan.textContent = String(line.qty); paintTotal(); } }, "＋")),
        linePriceBox(line, paintTotal),
        el("button", { class: "inbox-del", "aria-label": "Remove item",
          onclick: () => { lines.splice(i, 1); refresh(); } }, "✕")));
  };

  const rowsEl = el("div", {}, ...lines.map(rowFor));
  paintTotal();

  const save = () => {
    const chosen = lines.filter((l) => l.productId);
    if (!chosen.length) return toast("Choose a product");
    const destId = draft.deliveryDateId || curId;
    if (!destId || !byId(state.deliveryDates, destId)) return toast("Choose a delivery day");
    applyPopupEdits(state, date, group, first, chosen, {
      customerName: customer.value.trim(),
      whatsapp: waNumber(whatsapp.value.trim()),
      fulfillment: fulfillmentSel.value,
      address: address.value.trim(),
      note: note.value.trim(),
      trackingNo: tracking.value.trim(),
      orderDate: draft.orderDate,
      deliveryDateId: destId,
    }, close, root);
  };

  // Same order as the New-order card: which day, then who, then what.
  return el("div", {},
    el("div", { class: "field", style: "margin-bottom:10px" },
      el("label", {}, "Delivery day"),
      deliveryPick,
      deliveryNotes),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Customer"), customer),
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel),
      el("div", {}, el("label", {}, "Delivery address (if courier)"), address)),
    el("div", { class: "field" }, note),
    el("div", { class: "field" },
      el("label", {}, "Courier tracking number (optional)"),
      tracking),
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "Items"),
      el("p", { class: "card-sub", style: "margin:0 0 6px" },
        "The price beside each item is what THIS order is sold at. Change it here and the confirmation, every later message and the customer's total follow it — your menu price is untouched."),
      rowsEl,
      button("＋ Add another item", () => { lines.push({ productId: "", qty: 1, price: null }); refresh(); }, "ghost"),
      totalEl),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Hidden products are listed as \"(hidden)\" — you can still add or keep one."),
    button("Save changes", save, "block primary"),
    el("div", { style: "margin-top:8px" }, button("Cancel", close, "ghost block")));
}

// Write the pop-up's item lines + shared details back to state. Kept lines are
// edited in place; new lines become extra order rows in the same group (a
// single-item order that gains a second line becomes a group so it still shows
// as one customer order). Removed lines' orders are deleted. Guards against
// pushing the day over capacity.
function applyPopupEdits(state, date, group, first, chosen, shared, close, root) {
  const dest = byId(state.deliveryDates, shared.deliveryDateId) || date;
  // Read before the write-back below: a new tracking number has to reach the
  // customer's card, and an edit that did not touch it should not republish.
  const trackingBefore = String(first.trackingNo || "");
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
    syncContactFromOrder(state, keyOf(first), { customerName: shared.customerName, whatsapp: shared.whatsapp });
    let gid = first.groupId;
    if (!gid && chosen.length > 1) gid = newId("ordg"); // single order gains a second item
    for (const l of chosen) {
      const o = l.id ? byId(state.orders, l.id) : null;
      if (o) {
        const before = o.productId;
        o.productId = l.productId;
        o.qty = Number(l.qty) || 1;
        Object.assign(o, shared);
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
      } else {
        const row = {
          id: newId("ord"),
          deliveryDateId: dest.id,
          deliveryDate: dest.date,
          orderDate: shared.orderDate || todayISO(),
          productId: l.productId,
          qty: Number(l.qty) || 1,
          customerName: shared.customerName,
          whatsapp: shared.whatsapp,
          fulfillment: shared.fulfillment,
          address: shared.address,
          note: shared.note,
          trackingNo: shared.trackingNo,
          status: first.status || "new",
          groupId: gid,
          createdAt: new Date().toISOString(),
        };
        stampOrderLine(row, byId(state.products, row.productId));
        if (Number.isFinite(Number(l.price))) row.unitPrice = Number(l.price);
        state.orders.push(row);
      }
    }
    // Every kept row now sits on the destination day, with deliveryDateId and
    // the deliveryDate snapshot written together (self-heals a split group).
    moveOrderGroup(group, dest);
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    // The track card bakes the delivery-date string, so a move must republish
    // it. An in-place edit leaves it as it was.
    if (!sameDay || trackingBefore !== String(shared.trackingNo || "")) {
      publishTracking(state, group);
    }
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

function addNew(state, date, productId, qty, price, customerName, whatsapp, fulfillment, address, note, orderDate, root) {
  const cap = capacityStatus(state, date.id);
  const newTotal = cap.total + qty;
  const st = deliveryStatus(date.date, state.settings);

  function commit() {
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
    state.orders.push(row);
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
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
function addGroupNew(state, date, items, customerName, whatsapp, fulfillment, address, note, orderDate, root) {
  const totalQty = items.reduce((s, it) => s + it.qty, 0);
  const cap = capacityStatus(state, date.id);
  const newTotal = cap.total + totalQty;
  const st = deliveryStatus(date.date, state.settings);

  function commit() {
    const groupId = newId("ordg");
    const createdAt = new Date().toISOString();
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
      state.orders.push(row);
    }
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
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

// The two things she most often needs to change once an order is placed: its note,
// and the courier's tracking number (16 Sep 2026). They get their own small pop-up
// behind their own button, so a one-line change never means scrolling the whole
// Edit form — and Edit keeps the rest (the delivery day, the customer, the
// address, the items). v97 had the tracking box sitting on the row itself; she
// asked for one simplified entry field with a button to reach it instead, which is
// also the only version that works for an order that is not a courier's.
function openNoteTrackingPopup(state, group, first, dateId, root) {
  const note = el("input", { class: "input", placeholder: "Note (optional)",
    value: first.note || "" });
  const tracking = el("input", { class: "input", placeholder: "e.g. JT123456789",
    autocomplete: "off", value: first.trackingNo || "" });
  // How it was paid. The Paid · Cash / Paid · TNG buttons are the fast way in at the
  // moment the money lands (they also stamp WHEN); this is for fixing one later, or
  // for an order she marked paid before she could tell. It is her own record only —
  // nothing here reaches the customer.
  const paidSel = select([
    { value: "", label: "Not recorded" },
    { value: "cash", label: "Cash" },
    { value: "tng", label: "TNG transfer" },
  ], first.paidMethod || "", () => {});
  showPopup(el("div", { class: "popup-title-row" }, "Note / tracking / payment", orderCodeTag(first)),
    (refresh, close) => el("div", {},
      el("div", { class: "field" }, el("label", {}, "Note (optional)"), note),
      el("div", { class: "field" },
        el("label", {}, "Courier tracking number (optional)"), tracking),
      el("div", { class: "field" }, el("label", {}, "Paid by"), paidSel),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "This goes on the order and, for the tracking number, onto the customer's track card and into the posted message. Anything else - the delivery day, the customer, the address, the items - is under Edit."),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Save", () => {
          // The whole order shares these, exactly as the Edit pop-up writes them.
          const before = String(first.trackingNo || "").trim();
          const number = tracking.value.trim();
          const method = paidSel.value;
          for (const o of group.orders) {
            o.note = note.value.trim();
            o.trackingNo = number;
            if (method) o.paidMethod = method;
            else delete o.paidMethod; // "Not recorded" is the absent key, as everywhere
          }
          save(state);
          maybeSync(state);
          if (before !== number) publishTracking(state, group); // the card carries it
          toast("Order updated");
          close();
          renderAll(root, state, new URLSearchParams({ date: dateId }));
        }, "primary"))));
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
  const kids = data.rows.map(([cls, text]) => el("div", { class: `ls-${cls}` }, text));
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

function orderGroupRow(state, group, root, dateId) {
  const orders = group.orders;
  const first = orders[0];
  const multi = orders.length > 1;
  const items = orders.map((o) => ({ name: orderLineName(state, o), qty: o.qty }));
  const title = items.map((i) => i.name).join(" + ");
  const qtyTotal = items.reduce((s, i) => s + i.qty, 0);
  const sub = [first.customerName, waNumber(first.whatsapp), first.note].filter(Boolean).join(" · ");
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
      // Preparing takes the orders' ingredients off your stock; stepping back to
      // before Preparing (an undo) puts them back. Forward moves leave stock be.
      adjustForStatus(state, orders, stSel.value, STATUSES.map(([id]) => id));
      for (const o of orders) {
        o.status = stSel.value;
        // Stepping into Confirmed / Paid means the stage is being worked, not
        // finished: it only turns green when Send confirmation / the Paid
        // button is pressed. Orders saved before these fields existed have no
        // flag, which reads as already done.
        if (stSel.value === "confirmed") o.confirmedSent = false;
        else if (stSel.value === "paid") o.paidReceived = false;
      }
      anchorRowId = first.id; // keep this row pinned where the baker tapped it
      save(state);
      maybeSync(state);
      updateOrderBadge(state);
      publishTracking(state, group); // the customer's track card follows the status
      toast("Status saved");
      renderAll(root, state, new URLSearchParams({ date: dateId }));
    });
  stSel.className = "sel-small";

  const status = first.status || "new";
  const courier = first.fulfillment === "courier";
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
    const sendBtn = button("Send confirmation", () =>
      sendOrderWhatsApp(state, group, { builder: buildConfirmation, markSent: true, doneMsg: "Confirmation drafted — press Send in WhatsApp", root, dateId }),
      "soft small");
    if (!first.whatsapp) sendBtn.disabled = true;
    actions.push(sendBtn);
  } else if (status === "paid") {
    const remindBtn = button("Send payment reminder", () =>
      sendOrderWhatsApp(state, group, { builder: buildPaymentReminder, doneMsg: "Payment reminder drafted — press Send in WhatsApp", root, dateId }),
      "soft small");
    if (!first.whatsapp) remindBtn.disabled = true;
    actions.push(remindBtn,
      button("Paid · Cash", () => markPaid(state, group, root, dateId, "cash"), "small primary"),
      button("Paid · TNG", () => markPaid(state, group, root, dateId, "tng"), "small primary"));
  } else if (status === "baking") {
    // Print the label at Preparing — the baker needs it in hand to kit the order
    // (stick it on the pouch/box as the items go in), before it is marked Packed.
    actions.push(button("Print label", () => openLabelPrint(state, group), "ghost small"));
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
  actions.push(button("✕", () => removeOrder(state, group, root, dateId), "ghost small"));

  const placedLine = el("div", { class: "li-sub" },
    `Placed ${fmtPlaced(first.createdAt, first.orderDate)}`,
    el("span", { class: `fulfill-tag${courier ? " courier" : ""}` }, courier ? "Post (nationwide)" : "Collect (local)"),
    courier && String(first.address || "").trim() ? el("span", { class: "fulfill-sub" }, String(first.address).trim()) : null);
  const noWaHint = !first.whatsapp
    && (["confirmed", "paid", "ready"].includes(status) || (status === "delivered" && courier))
    ? el("div", { class: "li-sub muted" }, "Add the customer's WhatsApp (tap Edit) to send this order's messages.")
    : null;

  // The row is tagged with its first item's id; the group id rides along so the
  // inbox tap can still find this row when its own item is not the first one.
  const rowAttrs = { class: "list-item", dataset: { order: first.id } };
  const groupId = orders.find((o) => o.groupId)?.groupId;
  if (groupId) rowAttrs.dataset.group = groupId;

  return el("div", rowAttrs,
    el("div", { class: "li-main" },
      el("div", { class: "li-title" }, title, orderCodeTag(first),
        orders.some((o) => o.source === "storefront") ? el("span", { class: "src-tag" }, "storefront") : null),
      multi ? el("div", { class: "li-sub" }, items.map((i) => `${i.name} ×${i.qty}`).join("  ·  ")) : null,
      placedLine,
      sub ? el("div", { class: "li-sub" }, sub) : null,
      noWaHint),
    el("div", { class: "li-right" },
      el("span", { class: "qty-chip" }, `×${qtyTotal}`),
      first.paidMethod
        ? el("span", { class: `paid-tag${first.paidMethod === "tng" ? " tng" : ""}` },
            first.paidMethod === "cash" ? "Cash" : "TNG")
        : null,
      stSel,
      ...actions),
    orderJourneyEl(first),
    referralBlockEl(state, group, root, dateId));
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

// Open WhatsApp with the built message for this order. When markSent is set the
// stage also counts as done (Send confirmation finishes Confirmed), so the row's
// map moves the amber dot to the next step.
function sendOrderWhatsApp(state, group, { builder, markSent = false, doneMsg, root, dateId }) {
  const first = group.orders[0];
  if (!first || !first.whatsapp) return;
  const built = builder(state, group, trackUrlFor(first));
  if (!built || !built.recipient) return;
  window.open(`https://wa.me/${built.recipient}?text=${encodeURIComponent(built.message)}`, "_blank");
  if (markSent) {
    for (const o of group.orders) o.confirmedSent = true;
    save(state);
    maybeSync(state);
    publishTracking(state, group); // Confirmed now green on the customer's track card too
  }
  anchorRowId = first.id;
  toast(doneMsg);
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
