// views/dashboard.js — Home: coming weeks' sales, the weekly to-do (editable),
// and the next delivery dates shown one week at a time as small fuel dials.

import { navigate } from "../app.js";
import { generateUpcomingDates, longDate, shortDate, todayISO, weekdayName } from "../dates.js";
import { capacityStatus } from "../bom.js";
import { occColour, upcomingOccasions } from "../calendar.js";
import { el, button, emptyState, confirmDialog } from "../ui.js";
import { gauge } from "../gauge.js";
import { newId, save } from "../state.js";
import { pendingReviewCount } from "../supabase.js";
import {
  addTask, comingWeeks, loadRoutine, money, newOrderCount, nextBake,
  removeTask, renameTask, taskList, toggleRoutine, weekStats,
} from "../weekly.js";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function generateWeek(state) {
  const newDates = generateUpcomingDates(state.settings, 6,
    state.deliveryDates.map((d) => d.date));
  for (const date of newDates) {
    state.deliveryDates.push({
      id: newId("del"),
      date,
      notes: "",
    });
  }
  save(state);
  renderInner(document.getElementById("view"), state);
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

// "What needs you now": every group still marked New, across all delivery dates.
// Tapping goes to the Orders tab, which already leads with the New-Orders inbox.
function needsCard(n) {
  return el("div", {
    class: "card tappable",
    onclick: () => navigate("#/orders"),
  },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, `${n} new order${n === 1 ? "" : "s"} to confirm`),
        el("p", { class: "card-sub" }, "Waiting on you — tap to open")),
      el("span", { class: "badge badge-open" }, n > 99 ? "99+" : String(n))));
}

// "New review(s) to publish": same shape as the new-orders card, tapping
// through to the Reviews moderation screen. Filled asynchronously below —
// reviews live in the cloud, not local state.
function reviewNeedsCard(n) {
  return el("div", {
    class: "card tappable",
    onclick: () => navigate("#/reviews"),
  },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, `⭐ ${n} new review${n === 1 ? "" : "s"} to publish`),
        el("p", { class: "card-sub" }, "Waiting on you — tap to open")),
      el("span", { class: "badge badge-open" }, n > 99 ? "99+" : String(n))));
}

// Review-pending state for the Home card. `revDead` turns off once the view
// unmounts so a slow fetch never paints into a screen she's left.
let revDead = true;
let revTimer = null;
let revFillT = null;

async function fillRevSlot(slot, state) {
  if (!slot) return;
  const n = await pendingReviewCount(state); // null when off the cloud / offline
  if (revDead || !slot.isConnected) return;
  slot.replaceChildren(n && n > 0 ? reviewNeedsCard(n) : []);
}

// Debounced fill: renderInner rebuilds the slot on every internal re-render
// (a to-do tick, an added date), so re-querying and refilling after each
// rebuild keeps the card fresh without stampeding the cloud.
function scheduleRevFill(root, state) {
  if (revDead) return;
  clearTimeout(revFillT);
  revFillT = setTimeout(() => {
    const slot = root.querySelector(".dash-rev-slot");
    if (!slot || !slot.isConnected) return;
    fillRevSlot(slot, state);
  }, 0);
}

// "Next bake": the next delivery with orders still to bake, product by product.
function bakeCard(state, bake) {
  const date = state.deliveryDates.find((d) => d.id === bake.dateId);
  const head = el("div", { class: "card-row" },
    el("div", {},
      el("p", { class: "card-title" }, "Next batch"),
      el("p", { class: "card-sub" },
        date ? `${weekdayName(date.date)}, ${longDate(date.date)}` : "")),
    bake.hasWork ? el("span", { class: "qty-chip" },
      `${bake.totalItems} item${bake.totalItems === 1 ? "" : "s"}`) : null);
  const body = bake.hasWork
    ? el("div", { class: "bake-lines" },
        ...bake.lines.map((l) => el("div", { class: "bake-line" },
          el("span", {}, l.name),
          el("span", { class: "muted" }, `×${l.qty}`))))
    : el("p", { class: "card-sub", style: "margin-top:8px" },
        date ? `Nothing to prep for ${weekdayName(date.date)} yet` : "");
  return el("div", {
    class: "card tappable",
    onclick: () => navigate(`#/orders?date=${bake.dateId}`),
  }, head, body);
}

// "This week": orders placed in the last 7 days, their value, top sellers.
function weekCard(state, w) {
  const fig = (n, label) => el("div", {},
    el("p", { class: "stat-num" }, n),
    el("p", { class: "stat-label" }, label));
  const rows = [
    el("div", { class: "stat-grid" },
      fig(w.orders, "orders placed"),
      fig(`≈ ${money(state, w.rm)}`, "est. value")),
  ];
  if (w.orders === 0) {
    rows.push(el("p", { class: "card-sub", style: "margin-top:8px" },
      "Nothing yet — share your shop link."));
  } else {
    rows.push(el("p", { class: "card-sub", style: "margin-top:8px" },
      w.top.length
        ? `Top sellers: ${w.top.map((t) => t.name).join(", ")}`
        : "No prices set on products yet",
      w.unpriced ? " · some items unpriced" : ""));
  }
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("p", { class: "card-title" }, "This week"),
      w.orders ? el("span", { class: "qty-chip" }, `${w.orders} order${w.orders === 1 ? "" : "s"}`) : null),
    ...rows);
}

// ── "Coming 4 weeks" — one line per week, Mon→Sun from the next Monday ────

// A week's range as "7 – 13 Sep" / "28 Sep – 4 Oct" / "28 Dec – 3 Jan".
function rangeLabel(startISO, endISO) {
  const s = new Date(`${startISO}T00:00:00`);
  const e = new Date(`${endISO}T00:00:00`);
  const sd = s.getDate();
  const ed = e.getDate();
  const same = s.getMonth() === e.getMonth() && s.getFullYear() === e.getFullYear();
  if (same) return `${sd} – ${ed} ${MONTHS[e.getMonth()]}`;
  const se = s.getFullYear() === e.getFullYear() ? "" : ` ${s.getFullYear()}`;
  return `${sd} ${MONTHS[s.getMonth()]}${se} – ${ed} ${MONTHS[e.getMonth()]} ${e.getFullYear()}`.trim();
}

// The visible start of a week row: when an early date folded into Week 1, label
// from that date rather than the Monday.
function rowStart(week) {
  return week.dates.length && week.dates[0].date < week.start ? week.dates[0].date : week.start;
}

function chipDate(state, d) {
  return el("button", {
    class: "chip-date",
    type: "button",
    onclick: (ev) => { ev.stopPropagation(); navigate(`#/orders?date=${d.id}`); },
  }, `${weekdayName(d.date)} ${Number(d.date.slice(8))}`);
}

function comingCard(state, fc) {
  const rows = fc.rows.map((r) => {
    const first = r.dates[0];
    const body = r.dates.length
      ? el("div", {},
          el("div", { class: "fore-line1" },
            el("span", { class: "fore-range" }, rangeLabel(rowStart(r), r.end)),
            el("span", { class: "fore-chips" }, ...r.dates.map((d) => chipDate(state, d)))),
          el("p", { class: "fore-stats" },
            el("span", {}, `${r.booked} booked`),
            el("span", { class: "muted" },
              ` · est. ${money(state, r.rm)}${r.unpriced ? " · some items unpriced" : ""} · ${r.free} free`)))
      : el("p", { class: "fore-empty" }, "no delivery dates yet");
    return el("div", {
      class: `fore-row${first ? " tappable" : ""}`,
      onclick: first ? () => navigate(`#/orders?date=${first.id}`) : null,
    }, body);
  });

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "Coming 4 weeks"),
        el("p", { class: "card-sub" }, "Booked, money & free slots ahead")),
      el("span", { class: "qty-chip" },
        `${fc.rows.reduce((s, r) => s + r.booked, 0)} booked`)),
    el("div", { class: "fore-list" }, ...rows));
}

// ── "This week's to-do" — presets, plus addable / editable / removable tasks ──

// The row shown while editing one task: a text field + Save (Enter saves,
// Escape leaves without saving). The caller swaps it into the task's row slot.
function editRow(root, state, task) {
  const input = el("input", {
    class: "check-input", type: "text", value: task.label, autocomplete: "off",
  });
  const finish = () => {
    const v = input.value.trim();
    if (v && v !== task.label) renameTask(state, task.id, v);
    renderInner(root, state);
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish();
    else if (e.key === "Escape") renderInner(root, state);
  });
  // Replaces the row's toggle+acts; the outer .check-row keeps the spacing.
  return el("div", { class: "check-edit" }, input, button("Save", finish, "soft small"));
}

function beginEdit(root, state, row, task) {
  const form = editRow(root, state, task);
  row.replaceChildren(form);
  const input = form.querySelector("input");
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);
}

function removeIt(root, state, task) {
  confirmDialog(`Remove “${task.label}” from your to-do?`, () => {
    removeTask(state, task.id);
    renderInner(root, state);
  }, { danger: true, yesLabel: "Remove" });
}

function routineRow(root, state, task, done, today) {
  const row = el("div", { class: "check-row" },
    el("button", {
      class: "check-toggle", type: "button",
      onclick: () => { toggleRoutine(state, task.id, { today }); renderInner(root, state); },
    },
      el("span", { class: `check-dot${done ? " done" : ""}` }, done ? "✓" : ""),
      el("span", { class: `check-label${done ? " done" : ""}` }, task.label)),
    el("span", { class: "check-acts" },
      el("button", {
        class: "act-btn", type: "button", title: "Edit task",
        onclick: () => beginEdit(root, state, row, task),
      }, "✎"),
      el("button", {
        class: "act-btn", type: "button", title: "Remove task",
        onclick: () => removeIt(root, state, task),
      }, "✕")));
  return row;
}

function addRowUI(root, state) {
  const input = el("input", {
    class: "check-input", type: "text", placeholder: "Add your own task…", autocomplete: "off",
  });
  const submit = () => {
    if (addTask(state, input.value)) renderInner(root, state);
    else input.focus();
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return el("div", { class: "check-add" },
    input,
    el("button", { class: "btn soft small", type: "button", onclick: submit }, "Add"));
}

function routineCard(root, state, today) {
  const rt = loadRoutine(state, { today });
  const list = taskList(state);
  const doneCount = list.filter((t) => rt.done[t.id]).length;
  const rows = list.map((t) => routineRow(root, state, t, !!rt.done[t.id], today));
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "This week's to-do"),
        el("p", { class: "card-sub" },
          `Week of ${weekdayName(rt.week)}, ${longDate(rt.week)} — tick as you go`)),
      el("span", { class: "qty-chip" }, `${doneCount}/${list.length}`)),
    el("div", { class: "check-list" },
      ...(list.length ? [] : [el("p", { class: "muted", style: "padding:2px 0 0" },
        "No tasks yet — add one below.")]),
      ...rows,
      addRowUI(root, state)));
}

function atAGlanceBlocks(root, state, today, fc) {
  const blocks = [];

  // First "needs you" slot: the async review-pending card lives here. It is
  // always present (a zero-height placeholder when nothing is waiting).
  blocks.push(el("div", { class: "dash-rev-slot" }));

  const needs = newOrderCount(state);
  if (needs > 0) blocks.push(needsCard(needs));

  const bake = nextBake(state, { today });
  if (bake) blocks.push(bakeCard(state, bake));

  if (fc.rows.some((r) => r.dates.length)) blocks.push(comingCard(state, fc));

  blocks.push(weekCard(state, weekStats(state, { today })));
  blocks.push(holidayCard(state, today));
  blocks.push(routineCard(root, state, today));
  return blocks;
}

// "Upcoming holidays": the marked periods still to come (from today) — reminders
// she painted on the Delivery calendar. The card ALWAYS shows, so a quiet week
// can't make it vanish: it lists the three soonest marks and scrolls for more,
// and an empty list explains itself with a tap through to that calendar.
function holidayCard(state, today) {
  const occs = upcomingOccasions(state.occasions || [], today);
  const rows = occs.map((o) => {
    const running = o.from <= today && today <= o.to;
    const when = running
      ? `until ${shortDate(o.to)}`
      : `${shortDate(o.from)} – ${shortDate(o.to)}`;
    return el("div", { class: "hol-row" },
      el("span", { class: `occ-tag occ-${occColour(o)}` }, o.label),
      el("span", { class: "occ-row-dates" }, when));
  });
  const body = occs.length
    ? el("div", { class: `hol-list${occs.length > 3 ? " hol-list--scroll" : ""}` }, ...rows)
    : el("p", { class: "card-sub", style: "margin-top:8px" },
        "No upcoming days marked yet — add them on the Delivery calendar.");
  return el("div", {
    class: "card tappable",
    onclick: () => navigate("#/deliveries"),
  },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "Upcoming holidays"),
        el("p", { class: "card-sub" }, "Marked on the Delivery calendar")),
      occs.length ? el("span", { class: "qty-chip" }, String(occs.length)) : null),
    body);
}

// ── Upcoming deliveries: one week of small dials at a time (up to 4 weeks) ──

// Which week of the pager is showing. Module-level so re-renders (a to-do tick,
// an add) keep her place; renderDashboard resets it to week 1 on every visit.
let weekPage = 0;

function arrowBtn(symbol, disabled, onClick) {
  return el("button", {
    class: `btn ghost small pager-arrow${disabled ? " disabled" : ""}`,
    type: "button",
    onclick: disabled ? () => {} : onClick,
  }, symbol);
}

function stepWeek(root, state, delta) {
  weekPage += delta;
  renderInner(root, state);
}

function laterDates(state, later) {
  const list = el("div", { hidden: true });
  const head = el("button", {
    class: "btn ghost small",
    type: "button",
    onclick: () => { list.hidden = !list.hidden; },
  }, `Later dates (${later.length})`);
  for (const d of later) {
    const cap = capacityStatus(state, d.id);
    list.appendChild(el("div", {
      class: "card tappable",
      onclick: () => navigate(`#/orders?date=${d.id}`),
    },
      el("div", { class: "card-row" },
        el("div", {}, el("p", { class: "card-title" }, `${weekdayName(d.date)}, ${longDate(d.date)}`)),
        el("span", { class: "qty-chip" }, `${cap.total} ordered`))));
  }
  return el("div", { style: "margin-top:14px" }, head, list);
}

function upcomingSection(root, state, fc, total) {
  const pages = fc.rows.filter((r) => r.dates.length);
  const nodes = [el("h2", { class: "section" }, `Upcoming deliveries (${total})`)];

  if (!pages.length) {
    if (fc.later.length) nodes.push(laterDates(state, fc.later));
    return nodes;
  }

  const page = Math.min(Math.max(0, weekPage), pages.length - 1);
  const week = pages[page];

  nodes.push(el("div", { class: "pager-head" },
    arrowBtn("‹", page === 0, () => stepWeek(root, state, -1)),
    el("div", { class: "pager-center" },
      el("p", { class: "pager-range" }, rangeLabel(rowStart(week), week.end)),
      el("p", { class: "card-sub" },
        `${week.dates.length} delivery date${week.dates.length === 1 ? "" : "s"} this week`)),
    arrowBtn("›", page === pages.length - 1, () => stepWeek(root, state, 1))));

  nodes.push(el("div", { class: "week-tiles" },
    ...week.dates.map((d) => {
      const cap = capacityStatus(state, d.id);
      return el("div", {
        class: "date-tile",
        onclick: () => navigate(`#/orders?date=${d.id}`),
      },
        el("p", { class: "tile-day" }, `${weekdayName(d.date)} ${Number(d.date.slice(8))}`),
        gauge(cap.total, cap.capacity));
    })));

  if (fc.later.length) nodes.push(laterDates(state, fc.later));
  return nodes;
}

function renderInner(root, state) {
  const today = todayISO();
  const upcoming = [...state.deliveryDates]
    .filter((d) => d && d.date && d.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date));

  const past = [...state.deliveryDates]
    .filter((d) => d && d.date && d.date < today)
    .sort((a, b) => b.date.localeCompare(a.date));

  const fc = comingWeeks(state, { today });

  const hero = el("div", { class: "hero" },
    el("div", { class: "hero-row" },
      el("div", { class: "hero-text" },
        el("p", { class: "hero-eyebrow" }, `${weekdayName(today)}, ${longDate(today)}`),
        el("h2", { class: "hero-title" }, `${greeting()}, ready to make today's batch?`)),
      button("＋ New order", () => navigate("#/orders"), "hero-btn")),
    el("p", { class: "hero-sub" },
      `Orders close ${state.settings.cutoff} the day before · tap a dial to take orders`));

  // Conditional pieces are spread from arrays: replaceChildren would otherwise
  // turn a trailing null into a stray "null" text node in the real DOM.
  root.replaceChildren(
    hero,
    ...atAGlanceBlocks(root, state, today, fc),
    ...(upcoming.length
      ? upcomingSection(root, state, fc, upcoming.length)
      : [
          el("h2", { class: "section" }, "Upcoming deliveries"),
          emptyState("No delivery dates yet",
            "Add the next Mon/Wed/Fri dates to start taking orders."),
          el("div", {}, button("Generate next delivery dates",
            () => generateWeek(state), "block primary")),
        ]),
    ...(past.length ? [pastSection(state, past)] : []),
  );
  scheduleRevFill(root, state);
}

function pastSection(state, past) {
  const list = el("div", { hidden: true });
  const head = el("button", {
    class: "btn ghost small",
    type: "button",
    onclick: () => { list.hidden = !list.hidden; },
  }, `Past dates (${past.length})`);
  for (const d of past.slice(0, 8)) {
    const cap = capacityStatus(state, d.id);
    list.appendChild(el("div", {
      class: "card tappable",
      onclick: () => navigate(`#/orders?date=${d.id}`),
    },
      el("div", { class: "card-row" },
        el("div", {}, el("p", { class: "card-title" }, `${weekdayName(d.date)}, ${longDate(d.date)}`)),
        el("span", { class: "qty-chip" }, `${cap.total} ordered`))));
  }
  return el("div", { style: "margin-top:18px" }, head, list);
}

export function renderDashboard(root, state) {
  weekPage = 0;
  revDead = false;
  if (revTimer) clearInterval(revTimer);
  // While Home is on screen, refresh the review-pending card every ~45 s so a
  // review published (or arriving) elsewhere shows up without a page change.
  revTimer = setInterval(() => scheduleRevFill(root, state), 45000);
  renderInner(root, state);
  return () => {
    revDead = true;
    if (revTimer) { clearInterval(revTimer); revTimer = null; }
    if (revFillT) { clearTimeout(revFillT); revFillT = null; }
  };
}
