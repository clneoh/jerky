// views/orders.js — per-delivery-date order intake (manual, warn-not-block).

import { deliveryStatus, fmtPlaced, longDate, shortDate, todayISO, weekdayName } from "../dates.js";
import { capacityStatus, dayRuleRows, parseDayDelta, productRemaining, saveDayAdjustments } from "../bom.js";
import { el, button, select, fillMeter, emptyState, confirmDialog, toast, showPopup } from "../ui.js";
import { byId, fmtRM, groupOrders, newId, orderCode, orderLineName, save, stampOrderLine, updateOrderBadge, waNumber } from "../state.js";
import { buildConfirmation } from "../confirm.js";
import { buildPaymentReminder, buildPickupReminder } from "../messages.js";
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

const STATUSES = [
  ["new", "New"],
  ["confirmed", "Confirmed"],
  ["paid", "Paid"],           // TNG payment received, right after Confirmed
  ["baking", "Preparing"],    // internal id unchanged — no schema migration
  ["ready", "Packed"],
  ["delivered", "Delivered"],
];

// A small route map shown when a delivery date has no orders yet, so the screen
// still explains the journey: New → Confirmed → Paid → Preparing → Packed →
// Delivered. Real rows carry their own mini journey below them instead.
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
      : true;                                         // Preparing/Packed/Delivered: on selection
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
// done. A Delivered order shows the whole line green, matching what the
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

export function renderOrders(root, state, params) {
  orderStatusFilter = "";
  orderQuery = ""; // a fresh visit to Orders starts with an empty finder box
  renderAll(root, state, params);
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

// The date strip scrolls horizontally, so a far date's pill hides off its
// right edge. When a New-Orders tap lands on such a date, slide the strip so
// the pill appears — gliding to center it. An already-visible pill never moves
// (plain taps on a visible date stay put). Falls back to an instant jump when
// there is no animation loop (tests) or no real geometry.
function revealDatePill(strip, pill) {
  if (!strip || !pill
      || typeof strip.getBoundingClientRect !== "function"
      || typeof pill.getBoundingClientRect !== "function") return;
  const s = strip.getBoundingClientRect();
  const p = pill.getBoundingClientRect();
  if (p.left >= s.left && p.right <= s.right) return; // fully visible already
  const max = Math.max(0, strip.scrollWidth - strip.clientWidth);
  const end = Math.max(0, Math.min(
    strip.scrollLeft + (p.left - s.left) - (s.width - p.width) / 2,
    max));
  const start = strip.scrollLeft;
  if (Math.abs(end - start) < 1) return;
  const raf = globalThis.requestAnimationFrame;
  if (typeof raf !== "function") { strip.scrollLeft = end; return; }
  const t0 = globalThis.performance && typeof globalThis.performance.now === "function"
    ? globalThis.performance.now() : Date.now();
  const dur = 260;
  const step = (now) => {
    const k = Math.min(1, (now - t0) / dur);
    const ease = 1 - Math.pow(1 - k, 3); // ease-out: glide in, settle softly
    strip.scrollLeft = start + (end - start) * ease;
    if (k < 1) raf(step);
  };
  raf(step);
}

function renderAll(root, state, params) {
  const dates = [...state.deliveryDates].sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) {
    root.replaceChildren(emptyState("No delivery dates yet",
      "Add delivery dates first — go to More → Delivery Dates."));
    return;
  }
  // In-place rebuilds (status change, add, edit, remove) must not let the
  // screen jump under the baker's finger: the New-orders inbox above the date
  // strip grows/shrinks as orders are handled, and the New/Edit form changes
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

  const strip = el("div", { class: "date-tabs" });
  const content = el("div", {});

  const renderContent = () => {
    const date = byId(state.deliveryDates, activeId);
    if (!date) {
      content.replaceChildren(emptyState("Delivery date missing",
        "This order's delivery date was deleted. Remove it from the New Orders box."));
      return;
    }
    content.replaceChildren(dateContent(state, date, root));
  };

  // Switch dates in place instead of navigating: the strip keeps its scroll and
  // only the order area below is rebuilt. The URL still updates (without
  // firing the router) so the current date stays shareable.
  const selectDate = (id) => {
    activeId = id;
    for (const t of strip.querySelectorAll(".date-tab")) {
      t.classList.toggle("active", t.dataset.dateId === id);
    }
    renderContent();
    if (history && history.replaceState) {
      history.replaceState(null, "", `#/orders?date=${id}`);
    }
    // The tapped order may sit on a far delivery date whose pill is hidden off
    // the strip's edge (New-Orders rows jump across dates). Slide it into view.
    const pill = strip.querySelector(`.date-tab[data-date-id="${id}"]`);
    if (pill) revealDatePill(strip, pill);
  };

  for (const d of dates) {
    const { closed, past } = deliveryStatus(d.date, state.settings);
    strip.appendChild(el("a", {
      class: `date-tab${d.id === activeId ? " active" : ""}`,
      href: `#/orders?date=${d.id}`,
      dataset: { dateId: d.id },
      onclick: (ev) => { ev.preventDefault(); selectDate(d.id); },
    },
      el("span", { class: `dot${closed || past ? " closed" : ""}` }, "● "),
      shortDate(d.date)));
  }

  // The strip is rebuilt on a full render (e.g. arriving via the router, or
  // after an order is saved). Reveal the active tab so a later date isn't
  // hidden off the strip's edge — the same slide the inbox taps use.
  const raf = globalThis.requestAnimationFrame || ((fn) => fn());
  raf(() => {
    const active = strip.querySelector(".date-tab.active");
    if (active) revealDatePill(strip, active);
  });

  renderContent();
  const inbox = newOrdersInbox(state, selectDate, root);
  // The screen is two stacked parts: the finder card up top, then everything
  // else (New-orders inbox, date strip, that date's orders) in one container.
  // While a search is active the container hides so only matches are shown.
  const body = el("div", {});
  if (inbox) body.append(inbox);
  body.append(strip, content);
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

// Inbox card at the top of the Orders screen: every order still waiting to be
// handled (status New), across all delivery dates, oldest first. Tap a row to
// jump to that delivery date and confirm it. The red tab badge counts the same
// set, so a new storefront order surfaces here without digging through dates.
// A storefront order with several items is one row ("Focaccia + Sandwich"),
// not one row per item.
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
          // Switch dates in place like the date tabs (not native hash navigation,
          // which is flaky on iOS) so the tap reliably opens the order's date.
          onclick: (ev) => { ev.preventDefault(); selectDate(first.deliveryDateId); },
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
      "Tap a row to open the delivery date and confirm."),
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
    const row = root.querySelector(`[data-order="${first.id}"]`);
    if (!row) return;
    row.classList.add("hit");
    setTimeout(() => row.classList.remove("hit"), 1800);
    if (typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  };

  if (orderQuery.trim()) { showResults(); paint(orderQuery); } // a rebuild while searching
  return el("div", { class: "card finder" },
    el("div", { class: "finder-bar" },
      el("span", { class: "finder-ico", "aria-hidden": "true" }, "🔍"),
      input),
    resultsEl);
}

function dateContent(state, date, root) {
  const st = deliveryStatus(date.date, state.settings);
  const cap = capacityStatus(state, date.id);
  const dateLabel = `${weekdayName(date.date)}, ${longDate(date.date)}`;
  const rules = dayRuleRows(state, date.date);
  const adjusted = rules.rows.filter((r) => r.delta !== 0).length;

  const header = el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, dateLabel),
        el("p", { class: "card-sub" },
          st.past ? "Past delivery"
            : st.closed ? `Orders closed at ${state.settings.cutoff} yesterday`
              : `Open · cut-off in ${st.countdown}`)),
      el("span", { class: "qty-chip" }, `${cap.total}/${cap.capacity}`)),
    fillMeter(cap.total, cap.capacity),
    cap.exceeded ? el("div", { class: "danger-banner" },
      `Over capacity by ${cap.total - cap.capacity}. Add more only if she can bake extra.`) : null,
    !st.past && rules.rows.length ? el("div", { class: "btn-row", style: "margin-top:10px" },
      button(adjusted ? `Set day's availability · ${adjusted} adjusted` : "Set day's availability", () =>
        openDayAdjustPopup(state, date, () => renderAll(root, state, new URLSearchParams({ date: date.id }))), "soft")) : null);

  const form = orderForm(state, date.id, root);
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

  showPopup(el("div", { class: "popup-title-row" }, "Availability for this day"), (refreshBody, close) => {
    const rows = el("div", { class: "day-adj-rows" },
      ...inputs.map(({ rule, inp }) => {
        const todayEl = el("span", { class: "day-adj-preview" }, preview(rule, inp));
        inp.addEventListener("input", () => { todayEl.textContent = preview(rule, inp); });
        return el("div", { class: "day-adjust-row" },
          el("div", { style: "min-width:0" },
            el("p", { style: "margin:0" }, rule.name),
            el("p", { class: "card-sub", style: "margin:0" }, `Usual ${rule.usual}/day`)),
          el("div", { class: "day-adj-right" },
            todayEl,
            inp));
      }));

    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 12px" },
        `For ${weekdayName(date.date)}, ${longDate(date.date)} only: how many more (+) or fewer (−) than usual to make. 0 = Sold out that day. Other dates are untouched.`),
      rows,
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

// The manual "＋ Add order" card, always at the top of a delivery date. Takes
// several items at once — they become ONE customer order (a shared group), the
// same shape a multi-item storefront order arrives as, so the list/inbox/confirm
// all treat it as a single order. Editing an order never replaces this card:
// Edit opens a pop-up over the screen instead.
function orderForm(state, dateId, root) {
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
    placeholder: "e.g. 012-345 6789",
    value: draft.whatsapp, oninput: function () { draft.whatsapp = this.value; } });
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; });
  const address = el("input", { class: "input", placeholder: "Postal address (for posting)",
    value: draft.address, oninput: function () { draft.address = this.value; } });
  const note = el("input", { class: "input", placeholder: "Note (optional)",
    value: draft.note, oninput: function () { draft.note = this.value; } });
  const orderDate = el("input", { class: "input", type: "date",
    value: draft.orderDate, oninput: function () { draft.orderDate = this.value; } });

  const rowsEl = el("div", {});
  const items = [{ productId: "", qty: 1 }];
  const renderRows = () => {
    rowsEl.replaceChildren(...items.map((it, i) => {
      const prodSel = select(products, it.productId,
        () => { it.productId = prodSel.value; }, "Product…");
      const qtySpan = el("span", { class: "stepper-val" }, String(it.qty));
      return el("div", { class: "add-item" },
        prodSel,
        el("div", { class: "stepper" },
          el("button", { onclick: () => { it.qty = Math.max(1, it.qty - 1); qtySpan.textContent = String(it.qty); } }, "−"),
          qtySpan,
          el("button", { onclick: () => { it.qty = it.qty + 1; qtySpan.textContent = String(it.qty); } }, "＋")),
        el("button", { class: "inbox-del", "aria-label": "Remove item",
          onclick: () => { items.splice(i, 1); renderRows(); } }, "✕"));
    }));
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
    const placed = orderDate.value;
    if (picked.length === 1) {
      addNew(state, date, picked[0].productId, picked[0].qty, customerName, phone, fulfillment, addressText, noteText, placed, root);
    } else {
      addGroupNew(state, date, picked, customerName, phone, fulfillment, addressText, noteText, placed, root);
    }
  };

  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "＋ New order"),
    el("div", { class: "field" },
      el("label", {}, "Items"),
      rowsEl,
      button("＋ Add another item", () => { items.push({ productId: "", qty: 1 }); renderRows(); }, "ghost")),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Everything in the Items list becomes one customer order — add every item, then press Add order."),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Customer"), customer),
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel),
      el("div", {}, el("label", {}, "Delivery address (if courier)"), address)),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Order date = when it was placed (defaults to today). WhatsApp is kept in your delivery history for marketing follow-ups."),
    el("div", { class: "field", style: "margin-top:10px" }, note),
    button("＋ Add order", submit, "block primary"));
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
  if (!date) return toast("This order's delivery date is missing.");

  const lines = group.orders.map((o) => ({ id: o.id, productId: o.productId || "", qty: o.qty }));
  const draft = {
    customerName: first.customerName || "",
    whatsapp: waNumber(first.whatsapp || ""),
    fulfillment: first.fulfillment || "collect",
    address: first.address || "",
    note: first.note || "",
    orderDate: first.orderDate || String(first.createdAt || "").slice(0, 10) || todayISO(),
  };

  const title = el("div", { class: "popup-title-row" },
    "Edit order",
    orderCodeTag(first));
  showPopup(title, (refresh, close) => popupEditBody(state, date, group, first, lines, draft, refresh, close, root));
}

function popupEditBody(state, date, group, first, lines, draft, refresh, close, root) {
  const products = productOptions(state, date.id);
  const customer = el("input", { class: "input", placeholder: "Customer name (optional)",
    value: draft.customerName, oninput: function () { draft.customerName = this.value; } });
  const whatsapp = el("input", { class: "input", type: "tel", inputmode: "tel",
    placeholder: "e.g. 012-345 6789",
    value: draft.whatsapp, oninput: function () { draft.whatsapp = this.value; } });
  const fulfillmentSel = select(
    [{ value: "collect", label: "Collect (local)" }, { value: "courier", label: "Post (nationwide)" }],
    draft.fulfillment, function () { draft.fulfillment = this.value; });
  const address = el("input", { class: "input", placeholder: "Postal address (for posting)",
    value: draft.address, oninput: function () { draft.address = this.value; } });
  const note = el("input", { class: "input", placeholder: "Note (optional)",
    value: draft.note, oninput: function () { draft.note = this.value; } });
  const orderDate = el("input", { class: "input", type: "date",
    value: draft.orderDate, oninput: function () { draft.orderDate = this.value; } });

  const rowFor = (line, i) => {
    const prodSel = select(products, line.productId,
      () => { line.productId = prodSel.value; }, "Product…");
    const qtySpan = el("span", { class: "stepper-val" }, String(line.qty));
    return el("div", { class: "add-item" },
      prodSel,
      el("div", { class: "stepper" },
        el("button", { onclick: () => { line.qty = Math.max(1, line.qty - 1); qtySpan.textContent = String(line.qty); } }, "−"),
        qtySpan,
        el("button", { onclick: () => { line.qty = line.qty + 1; qtySpan.textContent = String(line.qty); } }, "＋")),
      el("button", { class: "inbox-del", "aria-label": "Remove item",
        onclick: () => { lines.splice(i, 1); refresh(); } }, "✕"));
  };

  const rowsEl = el("div", {}, ...lines.map(rowFor));

  const save = () => {
    const chosen = lines.filter((l) => l.productId);
    if (!chosen.length) return toast("Choose a product");
    applyPopupEdits(state, date, group, first, chosen, {
      customerName: customer.value.trim(),
      whatsapp: waNumber(whatsapp.value.trim()),
      fulfillment: fulfillmentSel.value,
      address: address.value.trim(),
      note: note.value.trim(),
      orderDate: orderDate.value,
    }, close, root);
  };

  return el("div", {},
    el("div", { class: "field" },
      el("label", {}, "Items"),
      rowsEl,
      button("＋ Add another item", () => { lines.push({ productId: "", qty: 1 }); refresh(); }, "ghost")),
    el("div", { class: "card-sub", style: "margin:0 0 10px" },
      "Hidden products are listed as \"(hidden)\" — you can still add or keep one."),
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Customer"), customer),
      el("div", {}, el("label", {}, "Order date"), orderDate),
      el("div", {}, el("label", {}, "WhatsApp (optional)"), whatsapp),
      el("div", {}, el("label", {}, "Fulfillment"), fulfillmentSel),
      el("div", {}, el("label", {}, "Delivery address (if courier)"), address)),
    el("div", { class: "field", style: "margin-top:10px" }, note),
    button("Save changes", save, "block primary"),
    el("div", { style: "margin-top:8px" }, button("Cancel", close, "ghost block")));
}

// Write the pop-up's item lines + shared details back to state. Kept lines are
// edited in place; new lines become extra order rows in the same group (a
// single-item order that gains a second line becomes a group so it still shows
// as one customer order). Removed lines' orders are deleted. Guards against
// pushing the day over capacity.
function applyPopupEdits(state, date, group, first, chosen, shared, close, root) {
  const cap = capacityStatus(state, date.id);
  const qtyNow = group.orders.reduce((s, o) => s + o.qty, 0);
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
      } else {
        const row = {
          id: newId("ord"),
          deliveryDateId: date.id,
          deliveryDate: date.date,
          orderDate: shared.orderDate || todayISO(),
          productId: l.productId,
          qty: Number(l.qty) || 1,
          customerName: shared.customerName,
          whatsapp: shared.whatsapp,
          fulfillment: shared.fulfillment,
          address: shared.address,
          note: shared.note,
          status: first.status || "new",
          groupId: gid,
          createdAt: new Date().toISOString(),
        };
        stampOrderLine(row, byId(state.products, row.productId));
        state.orders.push(row);
      }
    }
    save(state);
    maybeSync(state);
    updateOrderBadge(state);
    toast("Order updated");
    close();
    renderAll(root, state, new URLSearchParams({ date: date.id }));
  };

  if (totalAfter > cap.capacity) {
    confirmDialog(`Save? This makes ${totalAfter}/${cap.capacity} — over today's capacity.`,
      commit, { danger: true, yesLabel: "Save anyway" });
  } else {
    commit();
  }
}

function addNew(state, date, productId, qty, customerName, whatsapp, fulfillment, address, note, orderDate, root) {
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

// One row per order (or per storefront order group). A group shows its items
// joined ("Focaccia + Sandwich"), its total quantity, its order code, and a
// single status select that advances the whole customer order. Edit opens a
// pop-up for any order — single items and multi-item groups alike. The row's
// journey map shows which step is done (green ✓) and which step is waiting on
// the baker (pulsing amber), and the buttons under the status match the stage:
// Confirmed offers "Send confirmation", Paid offers "Send payment reminder" +
// "Paid", Baked offers "Print label" (to kit the order as it is packed),
// Packed offers "Send pickup reminder".

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
  const actions = [];
  // Edit is available on every order — single items and multi-item groups alike —
  // and opens a pop-up over the screen (the New-order card stays put).
  actions.push(button("Edit", () => {
    anchorRowId = first.id; // keep the row where the baker tapped it
    openEditPopup(state, group, dateId, root);
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
    actions.push(remindBtn, button("Paid", () => markPaid(state, group, root, dateId), "small primary"));
  } else if (status === "baking") {
    // Print the label at Preparing — the baker needs it in hand to kit the order
    // (stick it on the pouch/box as the items go in), before it is marked Packed.
    actions.push(button("Print label", () => openLabelPrint(state, group), "ghost small"));
  } else if (status === "ready") {
    const readyBtn = button(first.fulfillment === "courier" ? "Send posting reminder" : "Send pickup reminder", () =>
      sendOrderWhatsApp(state, group, { builder: buildPickupReminder, doneMsg: "Reminder drafted — press Send in WhatsApp", root, dateId }),
      "soft small");
    if (!first.whatsapp) readyBtn.disabled = true;
    actions.push(readyBtn);
  }
  actions.push(button("✕", () => removeOrder(state, group, root, dateId), "ghost small"));

  const courier = first.fulfillment === "courier";
  const placedLine = el("div", { class: "li-sub" },
    `Placed ${fmtPlaced(first.createdAt, first.orderDate)}`,
    el("span", { class: `fulfill-tag${courier ? " courier" : ""}` }, courier ? "Post (nationwide)" : "Collect (local)"),
    courier && String(first.address || "").trim() ? el("span", { class: "fulfill-sub" }, String(first.address).trim()) : null);
  const noWaHint = !first.whatsapp && ["confirmed", "paid", "ready"].includes(status)
    ? el("div", { class: "li-sub muted" }, "Add the customer's WhatsApp (tap Edit) to send this order's messages.")
    : null;

  return el("div", { class: "list-item", dataset: { order: first.id } },
    el("div", { class: "li-main" },
      el("div", { class: "li-title" }, title, orderCodeTag(first),
        orders.some((o) => o.source === "storefront") ? el("span", { class: "src-tag" }, "storefront") : null),
      multi ? el("div", { class: "li-sub" }, items.map((i) => `${i.name} ×${i.qty}`).join("  ·  ")) : null,
      placedLine,
      sub ? el("div", { class: "li-sub" }, sub) : null,
      noWaHint),
    el("div", { class: "li-right" },
      el("span", { class: "qty-chip" }, `×${qtyTotal}`),
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
function markPaid(state, group, root, dateId) {
  for (const o of group.orders) o.paidReceived = true;
  anchorRowId = firstOf(group).id;
  save(state);
  maybeSync(state);
  publishTracking(state, group); // Paid now green on the customer's track card too
  toast("Paid — payment received");
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
