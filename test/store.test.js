import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM shim so store/app.js can render at import time.
//
// replaceChildren IS THE BROWSER'S, NOT A KINDER VERSION OF IT. Most shims in this suite
// drop a null argument (`if (c != null) push(c)`), which is the one thing the real DOM
// never does: it is variadic and converts every argument with String(), so a null arrives
// on the page as a text node reading "null". That difference has shipped three defects in
// this repo and it shipped a fourth in the shop — the order receipt printed the word
// "null" between two sentence lines, because the cancellation note is optional and was
// handed over as a null. The assertion at the foot of the order test below is what holds
// it; a forgiving shim here could not see it at all.
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) })); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
}

// Every text node under `node` that would print as the word null or undefined — the whole
// of what this file's faithful replaceChildren exists to make visible.
function strayNulls(node, out = []) {
  for (const c of node.children || []) {
    if (c.nodeType === 3) { if (c.text === "null" || c.text === "undefined") out.push(c.text); }
    else strayNulls(c, out);
  }
  return out;
}
const registry = {};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (registry[id] ||= createEl("div")),
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
};
globalThis.window = { open() {} };

// store/config.js carries this business's own Supabase url + anon key; stub fetch
// so the module-level render() hits no network.
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { buildMessage, mergeStorefront, upcomingDates, daySpecs, dateKey, fmtDay, windowTitle, trackOrder, isOpen, postsOn, dayAsk, waNumber, parseVia, clockWords, renderStatic, render } = await import("../store/app.js");
const { strictestCancelDays } = await import("../store/pool.js");
const { CONFIG } = await import("../store/config.js");
// v270: the shop's own line and its refusals, kept as pure functions so they are
// judged here rather than by looking at a phone.
const { clauseWords, dayWords, ownWords, rememberShopOrder, shopMemo, shopVerdict, softVerdict } = await import("../store/app.js");
const { STORE } = await import("../store-lang.js");

// The cut-off time as the page prints it: the app stores it 24-hour (Settings'
// cut-off box is an <input type="time">) and the shop says it out loud — the
// owner asked for "6pm the day before posting" on 21 Sep 2026, where the card
// had been reading "18:00 the day before".
test("the cut-off time is written the way it is said, in all three languages", () => {
  assert.equal(clockWords("18:00", "en"), "6pm");
  assert.equal(clockWords("18:00", "zh"), "晚上6点");
  assert.equal(clockWords("18:00", "ms"), "6 petang");
  assert.equal(clockWords("09:00", "en"), "9am");
  assert.equal(clockWords("15:30", "en"), "3:30pm");
  assert.equal(clockWords("15:30", "ms"), "3.30 petang");
  assert.equal(clockWords("12:00", "en"), "12pm");
  assert.equal(clockWords("12:00", "zh"), "中午12点");
  assert.equal(clockWords("13:00", "ms"), "1 tengah hari");
  assert.equal(clockWords("00:15", "zh"), "凌晨12点15分");
});

test("anything that is not a 24-hour time is handed back untouched", () => {
  assert.equal(clockWords("", "en"), "");
  assert.equal(clockWords(undefined, "en"), "");
  assert.equal(clockWords("6pm", "en"), "6pm", "a value already in words is left alone");
  assert.equal(clockWords("25:00", "en"), "25:00", "an impossible hour is not guessed at");
});

test("the info card reads 'Order by 6pm the day before posting'", () => {
  renderStatic({ name: "Munchies Furkidz", tagline: "Handmade", deliveryDays: [1, 3, 5], cutoff: "18:00" });
  assert.equal(registry["cutoff"].textContent, "6pm the day before posting");
  assert.equal(registry["eyebrow"].textContent, "Made to order · closes 6pm the day before");
});

// The receipt's own lines, as plain strings, from the confirm box.
function confirmLines() {
  return registry["confirm-msg"].children.map((n) => (n.children[0] ? n.children[0].text : n.textContent));
}

test("buildMessage produces a tidy WhatsApp order", () => {
  const cfg = { name: "Munchies Furkidz", products: [{ name: "Chicken Jerky", price: 12 }] };
  const order = {
    date: "Wed, 2 Sep",
    lines: [{ name: "Chicken Jerky", qty: 3, price: 12 }, { name: "Duck Jerky", qty: 2, price: 12.5 }],
    total: 61,
    customer: "Aunty Bee",
    note: "",
  };
  const msg = buildMessage(cfg, order);
  assert.equal(msg,
    "New order · Munchies Furkidz 🐾\n📅 Wed, 2 Sep\n• Chicken Jerky ×3 — RM36.00\n• Duck Jerky ×2 — RM25.00\n💰 Total: RM61.00\n👤 Aunty Bee");
});

test("buildMessage omits customer/note when blank and handles note", () => {
  const cfg = { name: "Test Shop", products: [] };
  const order = { date: "Mon, 7 Sep", lines: [{ name: "Duck Jerky", qty: 1, price: 8 }], total: 8, customer: "", note: "No onions" };
  const msg = buildMessage(cfg, order);
  assert.ok(msg.includes("New order · Test Shop 🐾"));
  assert.ok(!msg.includes("👤"));
  assert.ok(msg.includes("📝 No onions"));
});

// The promo code rides on the order the customer sends. The test above pins the
// exact message for an order with NO code, which is the guard: the moment the code
// line is emitted unconditionally, that assertion breaks and every existing order
// gains a line it never had.
test("buildMessage adds the promo code as one line, and only when there was one", () => {
  const cfg = { name: "Munchies Furkidz", products: [] };
  const base = { date: "Wed, 2 Sep", lines: [{ name: "Focaccia", qty: 1, price: 15 }], total: 15, customer: "Aunty Bee", note: "" };

  const without = buildMessage(cfg, base);
  assert.ok(!without.includes("🎟"), "an order with no code says nothing about codes");

  const withCode = buildMessage(cfg, { ...base, promo: "FRESH10" });
  assert.equal(withCode.split("\n").length, without.split("\n").length + 1, "exactly one line is added");
  assert.equal(withCode, `${without}\n🎟 FRESH10`, "the code is the last line, so nothing above it moves");

  // A blank or unaccepted code is not a code. Nothing is ever stamped on an order
  // that did not use one, or the baker would be honouring a discount nobody took.
  assert.equal(buildMessage(cfg, { ...base, promo: "" }), without);
});

test("waNumber strips +/spaces/dashes and adds the +60 country code to locals (store's own copy)", () => {
  assert.equal(waNumber("+60 12-345 6789"), "60123456789");
  assert.equal(waNumber("60123456789"), "60123456789");
  assert.equal(waNumber("012-345 6789"), "60123456789");
  assert.equal(waNumber("+65 8123 4567"), "6581234567", "foreign +65 is kept");
  assert.equal(waNumber(""), "");
  assert.equal(waNumber(null), "");
});

test("upcomingDates only returns the configured delivery days", () => {
  const cfg = { deliveryDays: [1, 3, 5], upcomingCount: 3 };
  const ds = upcomingDates(cfg);
  assert.equal(ds.length, 3);
  for (const d of ds) assert.ok(cfg.deliveryDays.includes(d.getDay()));
});

test("isOpen blocks a delivery day once its cutoff has passed the day before", () => {
  const cfg = { cutoff: "18:00" };
  const wed = new Date(2026, 8, 2); // Wed 2 Sep 2026 — delivery day
  // Ordering closes 6pm Tue 1 Sep (the day before).
  assert.equal(isOpen(cfg, wed, new Date(2026, 8, 1, 17, 59)), true, "open right before 6pm the day before");
  assert.equal(isOpen(cfg, wed, new Date(2026, 8, 1, 18, 0)), false, "closed exactly at 6pm the day before");
  assert.equal(isOpen(cfg, wed, new Date(2026, 8, 2, 9, 0)), false, "still closed on the delivery day itself");
});

test("isOpen keeps a later day open and treats a missing cutoff as always open", () => {
  const cfg = { cutoff: "18:00" };
  const fri = new Date(2026, 8, 4); // Fri 4 Sep — closes Thu 3 Sep at 6pm
  assert.equal(isOpen(cfg, fri, new Date(2026, 8, 3, 17, 59)), true, "open before Friday's cutoff");
  assert.equal(isOpen(cfg, fri, new Date(2026, 8, 3, 18, 1)), false, "closed after Friday's cutoff");
  assert.equal(isOpen({}, new Date(2026, 8, 2), new Date(2026, 8, 1, 23, 59)), true, "no cutoff → always open");
});

test("store render() fills the page without crashing", () => {
  assert.ok(registry["name"]);
  assert.equal(registry["name"].textContent, "Munchies Furkidz");
  assert.ok(registry["menu"].children.length >= 2); // one card per product
  assert.equal(registry["dates"].children.length, 1); // just the calendar

  // Feature off (no availability) → every delivery day is open, so the calendar
  // draws and the first one is chosen for the customer — the line under the grid
  // names it, so the auto-choice is visible rather than a silent highlight.
  const cal = registry["dates"].children[0];
  assert.equal(cal.className, "cal");
  const grid = cal.children.find((c) => c.className === "cal-grid");
  assert.equal(grid.children.filter((c) => c.className === "cal-dow").length, 7, "a Sun→Sat heading row");
  assert.ok(grid.children.some((c) => c.className.includes("cal-cell avail")), "real delivery days are marked");
  assert.ok(!grid.children.some((c) => c.className.includes("cal-cell avail") && c.className.includes("full")),
    "nothing is sold out with availability off");
  const chosen = cal.children.find((c) => c.className === "cal-chosen");
  assert.ok(chosen.children[0].text.startsWith("Your posting day: "));
  // "First OPEN", not simply "first": a posting day whose cutoff has gone by is
  // dropped from the customer's calendar entirely, so the day named is the first
  // one still orderable. Asking isOpen the same question the shop asks keeps this
  // true whatever hour the suite happens to run at — at 21:17 on the day before a
  // 18:00 cutoff, tomorrow is already shut.
  const firstOpen = upcomingDates(CONFIG).find((d) => isOpen(CONFIG, d));
  assert.ok(chosen.children[0].text.endsWith(fmtDay(firstOpen)), "the first open day is the one named");

  assert.equal(registry["order-btn"].disabled, true); // empty cart
});

test("tapping a day she does not post is answered, not swallowed", async () => {
  // The grid is five whole weeks that follow today (v231), every cell a real
  // date, so the cells line up one-for-one with the weeks — after the 7
  // day-of-week headings in the same grid. The window it opens on is derived the
  // same way the shop derives it, through windowBounds, so this cannot drift from
  // the app: `home` is today's own window, sliding forward only when nothing on
  // sale is inside it.
  const { rollingWeeks, windowBounds } = await import("../store/calendar.js");
  const cal = () => registry["dates"].children[0];
  const grid = () => cal().children.find((c) => c.className === "cal-grid");
  const miss = () => cal().children.find((c) => c.className === "cal-miss");
  const todayK = dateKey(new Date());
  const all = upcomingDates(CONFIG);
  const first = all.find((d) => isOpen(CONFIG, d));
  const { home } = windowBounds(todayK, dateKey(first), dateKey(all[all.length - 1]));
  const flat = rollingWeeks(todayK, { offset: home }).flat();
  const posts = (iso) => CONFIG.deliveryDays.includes(new Date(`${iso}T00:00:00`).getDay());

  // A day still to come that she does not post. It used to be a dead number: the
  // grid built a button only for a day that was open or marked (21 Sep 2026).
  const idx = flat.findIndex((iso) => iso && iso >= todayK && !posts(iso));
  assert.ok(idx >= 0, "the window on screen has a day she does not post");
  const cell = grid().children[7 + idx];
  assert.ok(cell.className.includes("tappable"), "that day answers a tap");
  cell._listeners.click[0]();

  const note = miss();
  assert.ok(note, "the tap is answered with a note under the grid");
  assert.equal(note.children[0].text,
    `${fmtDay(new Date(`${flat[idx]}T00:00:00`))} is not a posting day — please pick a green day.`);

  // Choosing a day she does post takes the answer away with it, so the note can
  // never outlive the question it was answering.
  grid().children.find((c) => c.className.includes("avail"))._listeners.click[0]();
  assert.equal(miss(), undefined, "picking a green day clears the answer");

  // A day already gone is asked nothing: a past Monday WAS a posting day, so the
  // sentence would be a lie on it — and it is dimmed besides.
  const pastIdx = flat.findIndex((iso) => iso && iso < todayK);
  if (pastIdx >= 0) {
    assert.ok(!grid().children[7 + pastIdx].className.includes("tappable"),
      "a past day stays quiet");
  }

  // The other answer, on a day she DOES post whose 6pm window has shut. Today is
  // one whenever today is one of her posting weekdays — the shop never offers
  // today (the list starts tomorrow), so its own cell is the closed one. One
  // thing can hide it here and it is not the code's fault: when the window opens
  // more than a week past today (nothing on sale inside today's own window, so
  // `home` 2 or more), the first row is already past this week and today is not
  // drawn. When it is drawn, it must give the closed sentence and not the miss
  // one — the rules themselves are pinned date-independently in the dayAsk test
  // below.
  const todayIdx = flat.indexOf(todayK);
  if (todayIdx >= 0 && posts(todayK)) {
    const todayCell = grid().children[7 + todayIdx];
    assert.ok(todayCell.className.includes("tappable"), "a closed posting day answers a tap");
    todayCell._listeners.click[0]();
    const closedNote = miss();
    assert.ok(closedNote, "the tap is answered");
    assert.equal(closedNote.children[0].text,
      `Orders for ${fmtDay(new Date(`${todayK}T00:00:00`))} have closed — please pick a green day.`);
  }
});

// The two answers are two facts, and getting them the wrong way round is what puts
// "not a posting day" on a day she posts — the same screen that names that weekday
// as a posting day. Pinned against fixed dates so it proves both branches on any
// day of the year.
test("a day she posts whose window has shut is not called a day she does not post", () => {
  const cfg = { deliveryDays: [1, 3, 5], cutoff: "18:00" }; // Mon, Wed, Fri; closes 6pm the day before
  const tue = new Date(2026, 8, 22);  // a day she never posts
  const wed = new Date(2026, 8, 23);  // a day she posts; window shuts 6pm Tuesday
  const thu = new Date(2026, 8, 24);  // not a posting weekday — but she published it by hand
  const mon = new Date(2026, 8, 21);
  const tue9 = new Date(2026, 8, 22, 9, 0);
  const tue19 = new Date(2026, 8, 22, 19, 0);

  // A day she does not post is the same answer whenever it is asked.
  assert.equal(dayAsk(cfg, [], tue, undefined, tue9), "miss");
  assert.equal(dayAsk(cfg, [], tue, undefined, tue19), "miss");
  // Her own posting day, before its window shuts: still open, so this grid not
  // offering it is not worth a sentence — silence is the only honest answer.
  assert.equal(dayAsk(cfg, [], wed, undefined, tue9), null);
  // …and the moment it shuts, it is "closed", never "miss".
  assert.equal(dayAsk(cfg, [], wed, undefined, tue19), "closed");
  // A day already offered is not asked at all, sold out or not.
  assert.equal(dayAsk(cfg, [], wed, { soldOut: false }, tue19), null);
  assert.equal(dayAsk(cfg, [], wed, { soldOut: true }, tue19), null);
  // A date she added by hand is a day she posts, so it closes like the rest —
  // Thursday's window shuts at 6pm on the Wednesday, and until then it is still
  // open like any other of her days.
  assert.equal(postsOn(cfg, [{ date: "2026-09-24" }], thu), true);
  assert.equal(dayAsk(cfg, [{ date: "2026-09-24" }], thu, undefined, tue19), null);
  assert.equal(dayAsk(cfg, [{ date: "2026-09-24" }], thu, undefined, new Date(2026, 8, 23, 19, 0)), "closed");
  assert.equal(dayAsk(cfg, [], thu, undefined, tue19), "miss");
  // A Monday's window shuts on the Sunday, so a Monday is already closed by the
  // time it is Monday — which is the case the old wording got wrong.
  assert.equal(dayAsk(cfg, [], mon, undefined, new Date(2026, 8, 21, 9, 0)), "closed");
  // No cutoff configured: nothing ever shuts, so nothing is ever "closed" —
  // a posting day the grid is not offering stays quiet.
  assert.equal(dayAsk({ deliveryDays: [1, 3, 5] }, [], wed, undefined, tue19), null);
});

test("dateKey formats a local YYYY-MM-DD key", () => {
  assert.equal(dateKey(new Date(2026, 8, 2)), "2026-09-02");
  assert.equal(dateKey(new Date(2026, 0, 7)), "2026-01-07");
});

// The delivery window's title. It names the span of dates on screen rather than a
// month, because the window follows today: five whole weeks beginning with the week
// just gone. Both ends are always spelled out — a customer reading "6 – 12 Sep" and
// one reading "23 Aug – 26 Sep" must get the same thing, which is why the ends are
// named rather than inferred, and why a window across a month or a year boundary is
// not special-cased but simply falls out of naming both.
test("windowTitle names the window's own two ends, in the visitor's language", () => {
  assert.equal(windowTitle("2026-08-23", "2026-09-26"), "23 Aug – 26 Sep",
    "a window across two months names both");
  assert.equal(windowTitle("2026-09-06", "2026-09-12"), "6 – 12 Sep",
    "a window inside one month names it once");
  assert.equal(windowTitle("2026-12-27", "2027-01-02"), "27 Dec – 2 Jan",
    "a window across the new year is not special-cased, just spelled out");

  // The visitor's own language, read at paint time like every other string.
  const realStorage = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem: () => "zh", setItem() {} };
    assert.equal(windowTitle("2026-09-06", "2026-09-12"), "9月6日 – 12日",
      "Chinese repeats the month only when the window crosses one");
    assert.equal(windowTitle("2026-08-23", "2026-09-26"), "8月23日 – 9月26日");
    globalThis.localStorage = { getItem: () => "ms", setItem() {} };
    assert.equal(windowTitle("2026-08-23", "2026-09-26"), "23 Ogo – 26 Sep",
      "Malay uses its own month names");
  } finally {
    if (realStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = realStorage;
  }
});

test("daySpecs flags sold-out days and leaves open days plain", () => {
  const d1 = new Date(2026, 8, 2);
  const d2 = new Date(2026, 8, 4);
  const d3 = new Date(2026, 8, 7);
  const avail = { [dateKey(d1)]: 0, [dateKey(d2)]: 2, [dateKey(d3)]: 9 };
  const specs = daySpecs([d1, d2, d3], avail);

  assert.deepEqual(specs.map((s) => dateKey(s.date)), [dateKey(d1), dateKey(d2), dateKey(d3)]);
  assert.deepEqual(specs.map((s) => s.soldOut), [true, false, false]);
});

test("daySpecs leaves days plain when availability is off or unknown", () => {
  const d = new Date(2026, 8, 2);
  const off = daySpecs([d], {});
  assert.equal(off[0].soldOut, false);

  const unknown = daySpecs([d], { "2099-01-01": 5 }); // a row for another date
  assert.equal(unknown[0].soldOut, false);
});

test("order click sends one order and shows the success card (regression: no throw on the date label)", async () => {
  // Add one item via the first menu card's "+" button (drives the real cart).
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0](); // "+" — cart now has 1 item
  assert.equal(registry["order-btn"].disabled, false, "cart non-empty enables the button");

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    // Customer picks Courier + gives a phone + address; the order must carry them.
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";
    document.getElementById("address-input").value = "12 Jalan Bunga";
    await registry["order-btn"].onclick();
    assert.ok(posted, "order was POSTed to the backoffice");
    assert.ok(String(posted.url).includes("/rest/v1/incoming_orders"), "POSTs to incoming_orders");
    const payload = JSON.parse(posted.body[0].data);
    assert.equal(payload.lines.length, 1, "one line per item");
    assert.match(payload.date, /^\d{4}-\d{2}-\d{2}$/, "raw YYYY-MM-DD date reaches the backoffice");
    assert.equal(payload.whatsapp, "60123456789");
    assert.equal(payload.fulfillment, "courier");
    assert.equal(payload.address, "12 Jalan Bunga");
    const title = registry["confirm-msg"].children[0].children[0]; // .text, not textContent, in the shim
    assert.equal(title.text, "🎉 Order received!");
    // THE WORD THAT WAS PRINTED ON HER RECEIPT. The cancellation note is only added when
    // a product on the order states a window, and the shop's own products state none — so
    // an order placed against her live storefront carried a null in that card, and the DOM
    // wrote "null" between the order line and "Your order is in…". Nothing
    // in this suite could see it while this file's shim skipped null arguments, which is
    // why the shim now keeps them. The two lines this pins down are both real: the receipt
    // really drew (the title above), and there is really no window to state.
    assert.equal(strictestCancelDays(CONFIG.products), null,
      "no product on the shop states a change/cancel window, so the optional line is absent");
    assert.deepEqual(strayNulls(registry["confirm-msg"]), [],
      "and its absence prints as nothing at all — not as the word 'null'");
    assert.match(registry["confirm-msg"].children.map((n) => (n.children[0] || {}).text || "").join(" "),
      /Your order is in/,
      "the line under the missing one is still there, so the check above is not over a blank card");
  } finally {
    globalThis.fetch = realFetch;
  }
});

// ── the customer's own door pin (v197) ────────────────────────────────────
//
// Driven through the REAL controls — the press the customer makes, the phone's own
// geolocation object, and the order button — because everything that can go wrong
// here goes wrong in the wiring and not in the rules: store/geo.js is covered purely
// in test/store-pin.test.js, and what these two check is that the pinned point
// actually leaves the phone on the order, and only when it should.

const flush = () => new Promise((r) => setTimeout(r, 0));

function refill() {
  registry["menu"].children[0]
    .children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0]();
}

test("the pin the customer marks rides on a courier order, and never on a self-collect one", async () => {
  refill();
  const realFetch = globalThis.fetch;
  const realGeo = navigator.geolocation;
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("address-input").value = "Block C, Sri Bunga Condo";
    // "Use my location" — the customer standing at the guard house, which is the one
    // path the preview pane cannot test (a permission sheet only a real phone has).
    navigator.geolocation = {
      getCurrentPosition: (ok) => ok({ coords: { latitude: 5.41991234, longitude: 100.33116789, accuracy: 12 } }),
    };
    registry["pin-here"]._listeners.click[0]();
    await flush();
    assert.match(registry["pin-status"].textContent, /Pin set/, "the customer is told the pin is on");
    assert.equal(registry["pin-status"].hidden, false);

    // COURIER: the pin travels with the order, tidied to six decimals, named with the
    // customer's OWN typed address (v205 — never the geocoder's name for that spot,
    // which is a fragment), and nothing else the phone reported travels with it.
    document.getElementById("fulfillment")._value = "courier";
    await registry["order-btn"].onclick();
    assert.ok(posted, "the order went through");
    assert.deepEqual(posted.place, {
      lat: 5.419912, lng: 100.331168, label: "Block C, Sri Bunga Condo",
    });
    assert.equal(posted.place.label, posted.address,
      "the pin's words are the customer's own address, so her screen cannot name one place twice");
    assert.deepEqual(Object.keys(posted.place).sort(), ["label", "lat", "lng"],
      "no accuracy, no timestamp — the bakery is told where, named the customer's way, and nothing more");

    // SELF COLLECT: the same customer pins again and then chooses to come and get it.
    // Nothing is being delivered, so no door is posted. (A placed order empties the
    // cart, the number and the method, so the next one starts them over — which is
    // exactly what the next customer does too.)
    document.getElementById("whatsapp-input").value = "60123456789";
    registry["pin-here"]._listeners.click[0]();
    await flush();
    document.getElementById("fulfillment")._value = "collect";
    refill();
    posted = null;
    await registry["order-btn"].onclick();
    assert.ok(posted, "the self-collect order went through");
    assert.equal("place" in posted, false, "a self-collect order carries no door");
  } finally {
    globalThis.fetch = realFetch;
    if (realGeo === undefined) delete navigator.geolocation; else navigator.geolocation = realGeo;
  }
});

test("the next customer does not inherit the last one's front door", async () => {
  refill();
  const realFetch = globalThis.fetch;
  const realGeo = navigator.geolocation;
  let posted = null;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    navigator.geolocation = {
      getCurrentPosition: (ok) => ok({ coords: { latitude: 5.42, longitude: 100.33 } }),
    };
    document.getElementById("fulfillment")._value = "courier";
    // This shop refuses a courier order with no postal address (the bakery does not),
    // so the door a customer posts to has to be here or the order never leaves.
    document.getElementById("address-input").value = "12 Jalan Mawar, 10450 Penang";
    registry["pin-here"]._listeners.click[0]();
    await flush();
    assert.equal(registry["pin-status"].hidden, false);
    await registry["order-btn"].onclick();
    // The pin carries the customer's OWN typed address as its name (v205), so the order
    // cannot name one place twice — and nothing else the phone reported travels with it.
    assert.deepEqual(posted.place, {
      lat: 5.42, lng: 100.33, label: "12 Jalan Mawar, 10450 Penang",
    });
    // An order empties the cart, the number and the delivery method for whoever comes
    // next. The pin has to go with them, or the phone handed across the counter sends
    // the NEXT order to the last customer's door.
    assert.equal(registry["pin-status"].hidden, true, "the pin line is cleared with the order");
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";
    document.getElementById("address-input").value = "12 Jalan Mawar, 10450 Penang";
    refill();
    posted = null;
    await registry["order-btn"].onclick();
    assert.ok(posted, "the second order went through");
    assert.equal("place" in posted, false, "a courier order nobody pinned carries no door");
  } finally {
    globalThis.fetch = realFetch;
    if (realGeo === undefined) delete navigator.geolocation; else navigator.geolocation = realGeo;
  }
});

test("the receipt carries the strictest change/cancel window of the whole basket", async () => {
  const card = registry["menu"].children[0];
  card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0]();

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (opts && opts.method === "POST" ? { ok: true } : { ok: true, json: async () => [] });
  const saved = CONFIG.products.map((p) => p.cancelDays);
  try {
    // Two products, two different windows: the customer reads the strictest (3).
    CONFIG.products.forEach((p) => { p.cancelDays = p.name === "Chicken Jerky" ? 3 : 1; });
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    const line = confirmLines().find((t) => /change or cancel/i.test(t));
    assert.ok(line, "the receipt states a change/cancel window");
    assert.match(line, /up to 3 days before the posting day/, "the strictest window wins");
    assert.match(line, /not refundable/i, "and the no-refund rule that goes with it");

    // Nothing stated anywhere → no window line at all.
    CONFIG.products.forEach((p) => { delete p.cancelDays; });
    card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper").children[2]._listeners.click[0](); // basket refilled
    document.getElementById("fulfillment")._value = "collect"; // the success path reset it to Post
    await registry["order-btn"].onclick();
    assert.ok(!confirmLines().some((t) => /change or cancel/i.test(t)),
      "no product states a window → the receipt says nothing");
  } finally {
    CONFIG.products.forEach((p, i) => { if (saved[i] === undefined) delete p.cancelDays; else p.cancelDays = saved[i]; });
    globalThis.fetch = realFetch;
  }
});

test("parseVia normalises the ?via= digits on a referral link", () => {
  assert.equal(parseVia("?via=60123456789"), "60123456789");
  assert.equal(parseVia("?via=012-345%206789"), "60123456789", "local number gets +60");
  assert.equal(parseVia("?via=60123456789&track=abc"), "60123456789");
  assert.equal(parseVia(""), "");
  assert.equal(parseVia("?via="), "");
  assert.equal(parseVia("?track=abc"), "");
  assert.equal(parseVia(null), "");
});

test("an order placed from a ?via= link is stamped with the referrer", async () => {
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0](); // "+" — cart now has 1 item

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  const realLocation = globalThis.location;
  globalThis.location = { search: "?via=60139876543" };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "self";
    await registry["order-btn"].onclick();
    assert.ok(posted, "order was POSTed");
    const payload = JSON.parse(posted.body[0].data);
    assert.equal(payload.referredBy, "60139876543", "the ?via= digits ride on the order");
  } finally {
    globalThis.fetch = realFetch;
    if (realLocation === undefined) delete globalThis.location;
    else globalThis.location = realLocation;
  }
});

test("an order without a ?via= link carries no referral stamp", async () => {
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0]();

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    const payload = JSON.parse(posted.body[0].data);
    assert.equal(payload.referredBy, undefined, "no stamp when there's no via");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("order click without a WhatsApp number blocks the order (no POST)", async () => {
  // The number is compulsory — confirmations + the payment QR go over WhatsApp.
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0]();
  assert.equal(registry["order-btn"].disabled, false);

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "";
    await registry["order-btn"].onclick();
    assert.equal(posted, null, "no order POSTed when the phone is blank");
    assert.equal(registry["order-btn"].disabled, false, "button stays usable so they can retry");
    const title = registry["confirm-msg"].children[0].children[0];
    assert.equal(title.text, "Please add your WhatsApp number.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the default Post (nationwide) order is blocked until a postal address is given", async () => {
  const card = registry["menu"].children[0];
  const body = card.children.find((c) => c.className === "card-body");
  const stepper = body.children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0](); // "+" — cart has 1 item
  assert.equal(registry["order-btn"].disabled, false);

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    // No fulfilment button was tapped → Post (nationwide) is the default, and an
    // order cannot be posted anywhere without a full postal address.
    document.getElementById("fulfillment")._value = "courier";
    document.getElementById("address-input").value = "";
    await registry["order-btn"].onclick();
    assert.equal(posted, null, "no order POSTed when the postal address is blank");
    assert.equal(registry["order-btn"].disabled, false, "button stays usable so the customer can add their address");
    const title = registry["confirm-msg"].children[0].children[0];
    assert.equal(title.text, "Please add your postal address.");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("order click sanitizes a +60-style phone to wa.me digits", async () => {
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0]();

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "+60 12-345 6789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    assert.ok(posted, "order was POSTed");
    const payload = JSON.parse(posted.body[0].data);
    assert.equal(payload.whatsapp, "60123456789", "stored as clean digits for the wa.me confirmation link");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("buildMessage appends the delivery method and courier address", () => {
  const cfg = { name: "Munchies Furkidz", products: [] };
  const msg = buildMessage(cfg, {
    date: "Wed, 2 Sep",
    lines: [{ name: "Chicken Jerky", qty: 1, price: 15 }],
    total: 15,
    customer: "",
    note: "",
    fulfillment: "courier",
    address: "12 Jalan Bunga, Penang",
  });
  assert.ok(msg.includes("📦 Post (nationwide)"));
  assert.ok(msg.includes("📍 12 Jalan Bunga, Penang"));
});

// The TNG QR is sent to the customer in the WhatsApp confirmation and payment
// reminder; it is deliberately not part of the shop's config, and the shop
// draws no payment code anywhere. This fails if the key is ever added back.
test("mergeStorefront never carries the TNG QR — the shop shows no payment code", () => {
  const out = mergeStorefront({}, { tngQr: "https://img/tng.png", name: "Munchies Furkidz" });
  assert.equal(out.tngQr, undefined);
  assert.equal(out.name, "Munchies Furkidz", "other keys still merge");
});

// The standard days behind the tinted days on the customer's calendar. The app
// publishes only built-in standard days, but the shop checks every row again on
// its own terms, so a half-formed row is dropped rather than drawn.
test("mergeStorefront keeps well-formed occasions and drops the rest", () => {
  const good = { label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" };
  const out = mergeStorefront({}, { occasions: [good, { ...good, label: "Sibling Day" }] });
  assert.deepEqual(out.occasions, [good, { ...good, label: "Sibling Day" }]);

  const dropped = [
    mergeStorefront({}, { occasions: [{ ...good, colour: "chartreuse" }] }),
    mergeStorefront({}, { occasions: [{ ...good, label: "   " }] }),
    mergeStorefront({}, { occasions: [{ ...good, from: "16 Sep" }] }),
    mergeStorefront({}, { occasions: [{ ...good, to: "2026-09-01", from: "2026-09-16" }] }),
    mergeStorefront({}, { occasions: [null, 7, {}] }),
  ];
  for (const o of dropped) assert.deepEqual(o.occasions, [], "a row that does not hold up is not published");

  // A published snapshot is complete, so an empty list is a real instruction:
  // there are no standard days marked, and the tints an open page is showing go.
  assert.deepEqual(mergeStorefront({ occasions: [good] }, { occasions: [] }).occasions, []);
  // A payload that says nothing about occasions leaves the key alone.
  assert.deepEqual(mergeStorefront({ occasions: [good] }, { name: "X" }).occasions, [good]);
});

// The promo codes the shop may judge. This row is the same world-readable one the
// shop name and tagline come from, so the shop re-checks every code on its own
// terms rather than trusting the payload it was handed (v269).
test("mergeStorefront keeps codes it can read and drops the ones it cannot", () => {
  const good = { code: "FRESH10", vis: "public", gives: { type: "rm", value: 10, cap: 0 } };
  const out = mergeStorefront({}, { promoCodes: [good] });
  assert.equal(out.promoCodes.length, 1);
  assert.equal(out.promoCodes[0].code, "FRESH10");
  assert.deepEqual(out.promoCodes[0].gives, { type: "rm", value: 10, cap: 0 });

  for (const bad of [
    { ...good, code: "" },                   // no name at all
    { ...good, code: "AB" },                 // too short to read off a card
    { ...good, code: "WAY-TOO-LONG-A-CODE" },
    { ...good, code: "FRESH 10" },           // a customer cannot type a space
    null, 7, {},
  ]) {
    assert.deepEqual(mergeStorefront({}, { promoCodes: [bad] }).promoCodes, [],
      "a code the shop cannot read is never put in front of a customer");
  }

  // Whatever a code arrived as, the shop holds it in the one spelling it matches
  // customers against — so the same code typed lower-case still works.
  assert.equal(mergeStorefront({}, { promoCodes: [{ code: " fresh10 " }] }).promoCodes[0].code, "FRESH10");

  // A half-written record is clamped to the full shape rather than drawn as-is:
  // a code published before a rule family existed still works today.
  const partial = mergeStorefront({}, { promoCodes: [{ code: "HALF1" }] }).promoCodes[0];
  assert.equal(partial.state, "live");
  assert.equal(partial.vis, "public");
  assert.deepEqual(partial.often, { type: "unlimited", n: 0, maxRM: 0 });
  assert.deepEqual(partial.when, { from: "", to: "" });
  assert.equal(partial.say, "", "a code she has written nothing for has no sentence, not a placeholder");

  // Her own words ride along with the code (v270) — trimmed, because a stray
  // space she cannot see would show up as a gap under the offer on the page.
  const worded = mergeStorefront({}, { promoCodes: [{ code: "FRESH10", say: "  Baked this morning.  ", sayZh: "今早刚出炉。" }] });
  assert.equal(worded.promoCodes[0].say, "Baked this morning.");
  assert.equal(worded.promoCodes[0].sayZh, "今早刚出炉。");
  assert.equal(worded.promoCodes[0].sayMs, "", "a language she left blank arrives blank, for the shop to fall back on");

  // Replaced wholesale, like the occasions above: the app publishes a complete
  // snapshot, so an empty list really means "she has no codes" and a code box on
  // an already-open page stops accepting the ones it was holding.
  assert.deepEqual(mergeStorefront({ promoCodes: [{ code: "OLD1" }] }, { promoCodes: [] }).promoCodes, []);
  // A payload that says nothing about codes leaves the key alone.
  assert.equal(mergeStorefront({ promoCodes: [{ code: "OLD1" }] }, { name: "X" }).promoCodes[0].code, "OLD1");
});

test("mergeStorefront sorts occasions by start date and trims the label", () => {
  const out = mergeStorefront({}, {
    occasions: [
      { label: " Halloween ", from: "2026-10-31", to: "2026-10-31", colour: "orange" },
      { label: "Malaysia Day", from: "2026-09-16", to: "2026-09-16", colour: "red" },
    ],
  });
  assert.deepEqual(out.occasions.map((o) => o.label), ["Malaysia Day", "Halloween"]);
  assert.deepEqual(out.occasions.map((o) => o.from), ["2026-09-16", "2026-10-31"]);
});

test("trackOrder re-fetches and re-renders every lookup (never stale)", async () => {
  const box = document.getElementById("track-result");
  const urls = [];
  const row = { status: "Confirmed", delivery: "4 Sep · Post (nationwide)", items: "Focaccia ×1", total: "RM15.00", customer: "Ain" };
  globalThis.fetch = async (url, opts) => {
    urls.push({ url: String(url), opts });
    return { ok: true, json: async () => [row] };
  };
  try {
    await trackOrder("A3F9C2");
    const afterFirst = box.children.length;
    assert.ok(afterFirst >= 4, "first lookup renders status + delivery + items + customer");
    await trackOrder("B5D1E4");
    assert.equal(box.children.length, afterFirst, "second lookup replaces the result");
    assert.equal(urls.length, 2, "every lookup hits the network — nothing is cached");
    assert.equal(urls[0].opts.cache, "no-store", "cache: no-store so status is always fresh");
    assert.equal(urls[1].opts.cache, "no-store");
    assert.ok(String(urls[0].url).includes("confirmed_sent,paid_received"),
      "the lookup fetches the stage flags so the map matches the app's");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("trackOrder shows only the order details and latest status — no receipt/QR extras", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "confirmed", confirmed_sent: true, paid_received: false,
    delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×1", total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    const journey = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    assert.ok(journey, "shows the order journey progress line");
    const steps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) steps.push(c);
        walk(c);
      }
    })(journey);
    assert.equal(steps.length, 6, "journey shows all six stages");
    assert.equal(steps.filter((s) => String(s.className || "").includes("done")).length, 2,
      "New and Confirmed are done (the confirmation was sent)");
    const now = steps.find((s) => String(s.className || "").includes("now"));
    assert.ok(now, "the current stage is highlighted");
    const label = (now.children || []).find((c) => String(c.className || "").includes("tj-label"));
    assert.ok(label && String(label.children[0].text || "").includes("Paid"), "the highlighted stage is Paid");
    assert.equal(steps.filter((s) => String(s.className || "").includes("todo")).length, 3, "the three later stages stay upcoming");
    const code = box.children.find((c) => c.tagName === "P" && String(c.className || "").includes("track-code"));
    assert.ok(code, "shows the order code line");
    assert.ok(String(code.children[0].text || "").includes("A3F9C2"), "code line has the order code");
    const note = box.children.find((c) => c.tagName === "P" && String(c.className || "").includes("track-note")
      && c.children[0] && String(c.children[0].text || "").includes("payment description"));
    assert.equal(note, undefined, "no payment-description reminder on the track page");
    const link = box.children.find((c) => c.tagName === "A");
    assert.equal(link, undefined, "no receipt-send link on the track page");
    const img = box.children.find((c) => c.tagName === "IMG");
    assert.equal(img, undefined, "no QR image on the track page");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a Paid order lights up Paid on the journey, between Confirmed and Preparing", async () => {
  const box = document.getElementById("track-result");
  // The baker picked Paid in the dropdown and sent the payment reminder, but the
  // TNG receipt has not come back yet (paid_received: false) — so Paid is the
  // live step, exactly as the app shows.
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "paid", confirmed_sent: true, paid_received: false,
    delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×1", total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    const journey = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    assert.ok(journey, "shows the journey");
    const labels = [];
    const steps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) steps.push(c);
        if (String(c.className || "").split(/\s+/).includes("tj-label")) {
          labels.push((c.children[0] && c.children[0].text) || String(c.textContent || ""));
        }
        walk(c);
      }
    })(journey);
    assert.deepEqual(labels, ["New", "Confirmed", "Paid", "Preparing", "Packed", "Collected / Posted"],
      "journey reads New → Confirmed → Paid → Preparing → Packed → Collected / Posted");
    assert.equal(steps.length, 6, "all six stages present");
    assert.equal(steps.filter((s) => String(s.className || "").includes("done")).length, 2,
      "New and Confirmed are done before Paid");
    const now = steps.find((s) => String(s.className || "").includes("now"));
    const nowLabel = (now.children || []).find((c) => String(c.className || "").includes("tj-label"));
    assert.ok(nowLabel && String(nowLabel.children[0].text || "").includes("Paid"),
      "the current (highlighted) stage is Paid");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a Packed order (status ready) shows the preparation steps done with only the last step pulsing", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "Ready", delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×1", total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    const journey = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    assert.ok(journey, "shows the journey");
    const labels = [];
    const steps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) steps.push(c);
        if (String(c.className || "").split(/\s+/).includes("tj-label")) {
          labels.push((c.children[0] && c.children[0].text) || String(c.textContent || ""));
        }
        walk(c);
      }
    })(journey);
    assert.deepEqual(labels, ["New", "Confirmed", "Paid", "Preparing", "Packed", "Collected / Posted"],
      "journey reads New → Confirmed → Paid → Preparing → Packed → Collected / Posted");
    assert.equal(steps.length, 6, "all six stages present");
    assert.equal(steps.filter((s) => String(s.className || "").includes("done")).length, 5,
      "everything before the delivery is green once the order is Packed");
    assert.equal(steps.filter((s) => String(s.className || "").includes("todo")).length, 0,
      "no stage stays grey — the delivery is the only one left");
    const now = steps.find((s) => String(s.className || "").includes("now"));
    const nowLabel = (now.children || []).find((c) => String(c.className || "").includes("tj-label"));
    assert.ok(nowLabel && String(nowLabel.children[0].text || "").includes("Collected / Posted"),
      "the last stage is the flashing (current) one while the order is Packed");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("an order at the last stage shows the whole journey green — nothing flashes", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "Delivered", delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×1", total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    const journey = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    assert.ok(journey, "shows the journey");
    const steps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) steps.push(c);
        walk(c);
      }
    })(journey);
    assert.equal(steps.length, 6, "all six stages present");
    assert.equal(steps.filter((s) => String(s.className || "").includes("done")).length, 6,
      "every stage is green on a finished order");
    assert.equal(steps.filter((s) => String(s.className || "").includes("now")).length, 0,
      "nothing flashes once the order is delivered");
    assert.equal(steps.filter((s) => String(s.className || "").includes("todo")).length, 0,
      "nothing stays upcoming on a delivered order");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("order that reaches the app shows received WITHOUT opening WhatsApp (no popup)", async () => {
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0](); // "+" — cart has 1 item
  assert.equal(registry["order-btn"].disabled, false);

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  const opened = [];
  const realOpen = window.open;
  window.open = (u) => { opened.push(u); return {}; };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    assert.ok(posted, "order was POSTed to the backoffice");
    assert.deepEqual(opened, [], "a successful order must NOT open WhatsApp");
    const title = registry["confirm-msg"].children[0].children[0];
    assert.equal(title.text, "🎉 Order received!");
    const saysConfirm = registry["confirm-msg"].children.find((n) =>
      n.children && n.children.some((c) => String(c.text || "").includes("we'll WhatsApp you once we confirm")));
    assert.ok(saysConfirm, "tells the customer confirmation comes later, from the shop");
    const mentionsPayment = registry["confirm-msg"].children.find((n) =>
      n.children && n.children.some((c) => /\b(TNG|pay|receipt)\b/i.test(String(c.text || ""))));
    assert.equal(mentionsPayment, undefined, "no payment wording — payment is only explained when the shop confirms");
  } finally {
    globalThis.fetch = realFetch;
    window.open = realOpen;
  }
});

test("WhatsApp only opens as a fallback when the order could NOT reach the app", async () => {
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "card-body").children.find((c) => c.className === "stepper");
  stepper.children[2]._listeners.click[0]();
  assert.equal(registry["order-btn"].disabled, false);

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") return { ok: false };
    return { ok: true, json: async () => [] };
  };
  const opened = [];
  const realOpen = window.open;
  window.open = (u) => { opened.push(u); return {}; };
  try {
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    assert.equal(opened.length, 1, "WhatsApp opens only when the app could not be reached");
    assert.ok(String(opened[0]).startsWith("https://wa.me/60123456789?text="), "falls back to the configured shop number");
    assert.ok(decodeURIComponent(opened[0]).includes("New order"), "the message carries the order details");
    assert.equal(registry["order-btn"].disabled, false, "button is usable again so the customer can retry");
  } finally {
    globalThis.fetch = realFetch;
    window.open = realOpen;
  }
});

// ── v97: how the order left, on the customer's own card ──────────────────────
const cardLabels = (box) => {
  const out = [];
  (function walk(n) {
    for (const c of n.children || []) {
      if (String(c.className || "").split(/\s+/).includes("tj-label")) out.push(c.children[0].text);
      walk(c);
    }
  })(box);
  return out;
};
const byExactClass = (box, name) =>
  box.children.find((c) => String(c.className || "").split(/\s+/).includes(name));
// This shop's card names a charge in ONE line of words with its figure —
// "Courier charge: RM8.00" — rather than the bakery's two-half money row (v277),
// because the flat postage here is never published and the card draws no money
// block at all (see store/app.js' `track-fee` line). So the whole line is read at
// once, rather than a left label and a right figure read apart.
const feeText = (p) => (p.children || [])
  .map((c) => (c.nodeType === 3 ? String(c.text) : (c.children || []).map((g) => String(g.text || "")).join("")))
  .join("").trim();
// The courier charge sits inside the details block rather than beside it, so it is
// found by walking rather than by looking at the card's own children.
const deepByClass = (box, name) => {
  let hit;
  (function walk(n) {
    if (hit) return;
    for (const c of n.children || []) {
      if (String(c.className || "").split(/\s+/).includes(name)) { hit = c; return; }
      walk(c);
    }
  })(box);
  return hit;
};
// PostgREST returns ONLY the columns named in `select`, and a stub that answers
// with the whole row regardless is exactly how a missing column hides: the card
// draws a field the real server would never have sent. Every track stub goes
// through this so the column list is part of what is being tested (19 Sep 2026).
const onlySelected = (url, row) => {
  const sel = /[?&]select=([^&]*)/.exec(String(url))?.[1];
  if (!sel || sel === "*") return row;
  const keep = decodeURIComponent(sel).split(",").map((s) => s.trim());
  return Object.fromEntries(Object.entries(row).filter(([k]) => keep.includes(k)));
};

test("a posted order shows the courier's tracking number", async () => {
  const box = document.getElementById("track-result");
  // Selected exactly like the real server, so dropping tracking_no from the
  // lookup's select list fails here rather than passing on a stub that hands
  // back every column.
  const posted = {
    status: "delivered", delivery: "9 Sep · Post (nationwide) · 12 Jalan Bunga", items: "Chicken Jerky ×1",
    total: "RM15.00", customer: "Ain", tracking_no: "JT123456789",
  };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => [onlySelected(url, posted)] });
  try {
    await trackOrder("A3F9C2");
    const no = byExactClass(box, "track-no");
    assert.ok(no, "the card carries the tracking number on its own line");
    assert.equal(no.children[0].text, "Tracking number: JT123456789");
    assert.equal(cardLabels(box)[5], "Collected / Posted", "the last step wears the pair");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── v189: the tracking slot can now hold the courier's own share link ────────
//
// v189 puts a booked trip's share link into this same slot, so the branch that
// decides "link or number" is now customer-facing on every courier order — and until
// this test it had none. The NUMBER half was covered above; the LINK half was not,
// which is the half a booking newly exercises.
test("a courier's share link in the tracking slot is a link a customer can tap", async () => {
  const box = document.getElementById("track-result");
  const link = "https://www.lalamove.com/en-my/track/order/LM-PG-771204";
  const posted = {
    status: "shipped", delivery: "30 Sep · Courier · 12 Jalan Bunga", items: "Focaccia ×2",
    total: "RM58.00", customer: "Mei Ling", tracking_no: link,
  };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => [onlySelected(url, posted)] });
  try {
    await trackOrder("A3F9C2");
    const no = byExactClass(box, "track-no");
    assert.ok(no, "the card carries the tracking slot on its own line");
    assert.equal(no.children[0].text, "Track your delivery: ",
      "a link is labelled for what it is, rather than called a tracking NUMBER");
    const a = no.children[1];
    assert.equal(a.tagName, "A", "and it is tappable rather than words to read out");
    assert.equal(a.attrs.href, link, "pointing at the courier's own page");
    assert.equal(a.attrs.rel, "noopener noreferrer", "opened without handing it this page's window");
    assert.equal(a.children[0].text, link, "and the customer can see where it goes before tapping");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("only http and https become a link — a delivery is never a page to run", async () => {
  const box = document.getElementById("track-result");
  // This value arrives from a courier's reply and is rendered as a tappable href.
  // Only the two schemes that mean "a web address" may become one: a `javascript:`
  // or `data:` href is a page, not a parcel, and a number read as a link sends the
  // customer to nothing. `www.` with no scheme is words, and so is a string with a
  // space in it — a half-match must not become a half-link.
  const words = ["javascript:alert(1)", "data:text/html,<b>x</b>", "JT123456789", "www.lalamove.com", "https://x.com/a b"];
  for (const value of words) {
    const posted = {
      status: "shipped", delivery: "30 Sep · Courier · 12 Jalan Bunga", items: "Focaccia ×2",
      total: "RM58.00", customer: "Mei Ling", tracking_no: value,
    };
    globalThis.fetch = async (url) => ({ ok: true, json: async () => [onlySelected(url, posted)] });
    try {
      await trackOrder("A3F9C2");
      const no = byExactClass(box, "track-no");
      assert.ok(no, `the slot still draws for ${value}`);
      assert.equal(no.children.length, 1, `${value} must not become a link`);
      assert.equal(no.children[0].tagName, undefined, `${value} is words, and draws as words`);
      assert.match(no.children[0].text, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      globalThis.fetch = async () => ({ ok: true, json: async () => [] });
    }
  }
});

// ── v124: the courier's charge on the customer's own card ────────────────────
test("a courier charge the customer bears is named on the card, and the lookup asks for it", async () => {
  const box = document.getElementById("track-result");
  const posted = {
    status: "delivered", delivery: "9 Sep · Post (nationwide) · 12 Jalan Bunga", items: "Chicken Jerky ×1",
    total: "RM23.00", customer: "Ain", tracking_no: "JT123456789", courier_fee: 8,
  };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => [onlySelected(url, posted)] };
  };
  try {
    await trackOrder("A3F9C2");
    assert.ok(/[?&]select=[^&]*\bcourier_fee\b/.test(urls[0]),
      "the lookup names courier_fee — PostgREST sends only the columns listed, so the charge you typed is invisible to the card until this asks for it");
    assert.ok(/[?&]select=[^&]*\bcustomer\b/.test(urls[0]),
      "and customer, for the same reason: the name was in the row all along and the card never received it");
    const fee = deepByClass(box, "track-fee");
    assert.ok(fee, "the charge is named on its own line, above the total that includes it");
    assert.equal(feeText(fee), "Courier charge: RM8.00",
      "the charge is named and its figure given, on one line, above the total that includes it");
    assert.equal(byExactClass(box, "track-note").children[0].text, "For Ain",
      "and the customer's own name reaches the card");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("an order with no courier charge shows no charge line", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "ready", delivery: "9 Sep · Collect (local)", items: "Chicken Jerky ×1",
    total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    assert.equal(deepByClass(box, "track-fee"), undefined,
      "nothing to name, so no line at all — not an empty label, and not a stray null");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── v272: the promo code on the customer's own card ─────────────────────────
test("the code a customer used is named on the card, and the lookup asks for it", async () => {
  const box = document.getElementById("track-result");
  // The total published is ALREADY down by the discount (customerTotal works it out
  // that way), so a card that did not name the code would show a figure the customer
  // cannot reconcile with the total they ordered at — and the same code names itself
  // on every message they got.
  const posted = {
    status: "delivered", delivery: "9 Sep · Post (nationwide) · 12 Jalan Bunga", items: "Chicken Jerky ×2",
    total: "RM20.00", customer: "Ain", promo_code: "FRESH10", promo_rm: 10,
  };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => [onlySelected(url, posted)] };
  };
  try {
    await trackOrder("A3F9C2");
    assert.ok(/[?&]select=[^&]*\bpromo_code\b/.test(urls[0]) && /[?&]select=[^&]*\bpromo_rm\b/.test(urls[0]),
      "the lookup names promo_code and promo_rm — PostgREST sends only the columns listed, so the discount is invisible to the card until this asks for it");
    const promo = deepByClass(box, "track-promo");
    assert.ok(promo, "the code is named on its own line, above the total that already has it off");
    assert.equal(feeText(promo), "Promo FRESH10: -RM10.00",
      "the code is named and what it took off is given, in one line");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("an order with no code shows no promo line", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [onlySelected(
    "?select=status,delivery,items,total,customer,promo_code,promo_rm",
    { status: "ready", delivery: "9 Sep · Collect (local)", items: "Chicken Jerky ×1",
      total: "RM15.00", customer: "Ain", promo_code: null, promo_rm: null })] });
  try {
    await trackOrder("A3F9C2");
    assert.equal(deepByClass(box, "track-promo"), undefined,
      "no code, no line — and a null column must not draw an empty label or a stray null");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── v128: the charge the courier collects at the door ───────────────────────
test("a Courier COD charge tells the customer to pay the courier, not you", async () => {
  const box = document.getElementById("track-result");
  // The total published is the items alone — the charge is the courier's to take
  // at the door, so a card that added it in would ask for the same money twice.
  const posted = {
    status: "delivered", delivery: "9 Sep · Post (nationwide) · 12 Jalan Bunga", items: "Chicken Jerky ×1",
    total: "RM15.00", customer: "Ain", tracking_no: "JT123456789",
    courier_fee: 8, courier_cod: true,
  };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => [onlySelected(url, posted)] };
  };
  try {
    await trackOrder("A3F9C2");
    assert.ok(/[?&]select=[^&]*\bcourier_cod\b/.test(urls[0]),
      "the lookup names courier_cod — PostgREST sends only the columns listed, so the card can never know the charge is COD until this asks for it, and would word it as money owed to you");
    const fee = deepByClass(box, "track-fee");
    assert.ok(fee, "the charge is still named in full — the customer has to know what the courier will ask for");
    assert.equal(feeText(fee), "Courier charge: RM8.00 - COD, pay the courier on delivery",
      "where the money goes is kept with the words, so the customer reads who takes it");
    assert.equal(byExactClass(box, "track-note").children[0].text, "For Ain");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a charge paid with the order still reads as the plain charge", async () => {
  // The flag's absence is the old behaviour: nothing already published changes
  // wording because this column appeared.
  const box = document.getElementById("track-result");
  const posted = {
    status: "delivered", delivery: "9 Sep · Post (nationwide) · 12 Jalan Bunga", items: "Chicken Jerky ×1",
    total: "RM23.00", customer: "Ain", courier_fee: 8,
  };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => [onlySelected(url, posted)] });
  try {
    await trackOrder("A3F9C2");
    assert.equal(feeText(deepByClass(box, "track-fee")), "Courier charge: RM8.00",
      "no COD wording, and no flag sent — as every row published before this column existed");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── the delivery cost is not settled yet (28 Sep 2026) ───────────────────────
//
// The backoffice can be switched to quote each posted order by courier instead of
// charging the flat nationwide fee (Settings → Storefront). Until she records what
// the courier asked for it, such an order owes the items alone — and the card's
// total is therefore the items alone, which by itself reads as the whole cost. The
// published postage_quoted flag is what tells the card to say so, and it is the same
// sentence her WhatsApp confirmation carries, because the two are read side by side.
test("a posted order with its delivery cost still to be quoted says so", async () => {
  const box = document.getElementById("track-result");
  const posted = {
    status: "confirmed", delivery: "30 Sep · Post (nationwide) · 12 Jalan Bunga",
    items: "Chicken Jerky ×2", total: "RM30.00", customer: "Ain", postage_quoted: true,
  };
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => [onlySelected(url, posted)] };
  };
  try {
    await trackOrder("A3F9C2");
    assert.ok(/[?&]select=[^&]*\bpostage_quoted\b/.test(urls[0]),
      "the lookup names postage_quoted — PostgREST sends only the columns listed, so without this the card cannot tell an order whose delivery is still to be quoted from one with nothing left to pay, and would quietly say neither");
    const fee = deepByClass(box, "track-fee");
    assert.ok(fee, "the customer is told the delivery cost is coming, rather than left with a total that looks like the whole of it");
    assert.equal(fee.children[0].text, "Postage: quoted separately - we'll message you the exact amount");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a settled order draws no such line, as every row published before it did", async () => {
  // The flag's absence is the old behaviour — a flat fee the card never names, or a
  // charge already recorded — and nothing already published changes because the
  // column appeared.
  const box = document.getElementById("track-result");
  const posted = {
    status: "confirmed", delivery: "30 Sep · Post (nationwide) · 12 Jalan Bunga",
    items: "Chicken Jerky ×2", total: "RM38.00", customer: "Ain",
  };
  globalThis.fetch = async (url) => ({ ok: true, json: async () => [onlySelected(url, posted)] });
  try {
    await trackOrder("A3F9C2");
    assert.equal(deepByClass(box, "track-fee"), undefined,
      "no delivery line at all — the flat postage stays inside the total and is never named to the customer");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a self-collect order shows no tracking line", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "delivered", delivery: "9 Sep · Collect (local)", items: "Chicken Jerky ×1",
    total: "RM15.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    assert.equal(byExactClass(box, "track-no"), undefined,
      "nothing was posted, so there is no number to show");
    assert.equal(cardLabels(box)[5], "Collected / Posted", "the label is the same pair");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── v117: the customer's line for a pickup payment ───────────────────────────
// The track card draws its own copy of the journey, so it has to agree with yours: a
// regular who pays at the counter has no Paid step on either (17 Sep 2026).
test("a bypassed order shows the customer five steps, with no Paid tick", async () => {
  const box = document.getElementById("track-result");
  globalThis.fetch = async () => ({ ok: true, json: async () => [{
    status: "ready", confirmed_sent: true, paid_received: false,
    delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×2", total: "RM36.00", customer: "Ain",
  }] });
  try {
    await trackOrder("A3F9C2");
    const journey = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    const labels = [];
    const steps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) steps.push(c);
        if (String(c.className || "").split(/\s+/).includes("tj-label")) {
          labels.push((c.children[0] && c.children[0].text) || String(c.textContent || ""));
        }
        walk(c);
      }
    })(journey);
    assert.deepEqual(labels, ["New", "Confirmed", "Paid", "Preparing", "Packed", "Collected / Posted"],
      "every step keeps its place, so the customer's line reads like any other order's");
    assert.equal(steps.length, 6, "six steps");
    const paid = steps.find((s) => {
      const l = (s.children || []).find((c) => String(c.className || "").includes("tj-label"));
      return l && String(l.children[0].text || "").includes("Paid");
    });
    assert.ok(String(paid.className).includes("skipped"), "the Paid step is marked as gone past");
    assert.ok(!String(paid.className).includes("done"), "and is not green while the money is owed");
    assert.equal(steps.filter((s) => String(s.className || "").includes("now")).length, 1,
      "and exactly one step still flashes");

    // The same order with the money recorded: the step is back, green, where it belongs.
    globalThis.fetch = async () => ({ ok: true, json: async () => [{
      status: "ready", confirmed_sent: true, paid_received: true,
      delivery: "4 Sep · Post (nationwide)", items: "Chicken Jerky ×2", total: "RM36.00", customer: "Ain",
    }] });
    await trackOrder("A3F9C2");
    const paidLabels = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-label")) {
          paidLabels.push((c.children[0] && c.children[0].text) || "");
        }
        walk(c);
      }
    })(box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj")));
    assert.ok(paidLabels.includes("Paid"), "the Paid step is on the customer's line either way");
    const after = box.children.find((c) => c.tagName === "DIV" && String(c.className || "").includes("tj"));
    const allSteps = [];
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").split(/\s+/).includes("tj-step")) allSteps.push(c);
        walk(c);
      }
    })(after);
    assert.ok(!allSteps.some((s) => String(s.className || "").includes("skipped")),
      "once the money is recorded the mark is gone");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

// ── the customer's note on ONE item (v236) ────────────────────────────────
//
// Driven through the REAL controls — the "+" the customer presses, the link they
// tap, the box they type in, and the order button — because everything that can go
// wrong here goes wrong in the wiring: the menu is repainted from scratch on every
// stepper tap, so a note held in the card's DOM would be wiped out mid-sentence.
// That is the defect these tests exist to catch, and it is not visible in the
// rules. The switch that publishes `askNote` is covered in test/supabase.test.js
// and test/storefront.config.test.js; what is left is that the shop obeys it.

const hasClass = (n, cls) => String(n.className || "").split(/\s+/).includes(cls);
const textOf = (n) => (n.children || []).map((c) => (c.nodeType === 3 ? c.text : textOf(c))).join("");
const cardNamed = (name) => {
  let hit = null;
  (function walk(n) {
    for (const c of n.children || []) {
      if (c.dataset && c.dataset.product === name && !hit) hit = c;
      walk(c);
    }
  })(registry["menu"]);
  return hit;
};
const cardBodyOf = (card) => card.children.find((c) => hasClass(c, "card-body"));
const plusOf = (card) => cardBodyOf(card).children.find((c) => hasClass(c, "stepper")).children[2];
const noteRow = (card) => cardBodyOf(card).children.find((c) => hasClass(c, "line-note-row")) || null;
const noteAdd = (card) => (noteRow(card) ? noteRow(card).children.find((c) => hasClass(c, "line-note-add")) || null : null);
const noteBox = (card) => (noteRow(card) ? noteRow(card).children.find((c) => hasClass(c, "line-note")) || null : null);
const pressPlus = (card) => plusOf(card)._listeners.click[0]();
const tapNote = (card) => noteAdd(card)._listeners.click[0]();
const typeNote = (box, text) => { box.value = text; box._listeners.input[0].call(box); };

// One product switched on for a note, rendered, driven, and put back exactly as it
// was. `render()` is the real page render, so the second call rebuilds the menu and
// gives each test a cart of its own.
async function withNotedProduct(fn) {
  const p = CONFIG.products[0];
  const realFetch = globalThis.fetch;
  p.askNote = true;
  render();
  try {
    return await fn(p, realFetch);
  } finally {
    delete p.askNote;
    globalThis.fetch = realFetch;
    render();
  }
}

test("the note link appears only once the item is in the basket, and opens the box on a tap", async () => {
  await withNotedProduct(async (p) => {
    const card = cardNamed(p.name);
    assert.ok(card, "the product is on the menu");
    assert.equal(noteRow(card), null, "nothing is offered before the item is in the basket");

    // A press repaints the menu, so the card in hand is a detached node from here on —
    // every read after a press re-finds the card, the way a thumb on the screen does.
    pressPlus(cardNamed(p.name));
    assert.ok(noteAdd(cardNamed(p.name)), "one in the basket, and the card offers a way to add a note");
    assert.match(textOf(noteAdd(cardNamed(p.name))), /Add a note/, "and it says what it does");
    assert.equal(noteBox(cardNamed(p.name)), null, "the box itself stays shut until it is asked for");

    tapNote(cardNamed(p.name));
    const box = noteBox(cardNamed(p.name));
    assert.ok(box, "the tap opens the box");
    assert.equal(box.value, "", "and it opens empty");
    assert.equal(box.attrs.maxlength, "120", "stopped at the cap the app will trim to anyway");
    assert.equal(noteAdd(cardNamed(p.name)), null, "the link is gone — the box has taken its place");
  });
});

test("a product the baker never switched on offers no note at all", async () => {
  await withNotedProduct(async () => {
    const other = CONFIG.products[1];
    assert.notEqual(other.askNote, true, "this product carries no note switch");
    const card = cardNamed(other.name);
    pressPlus(card);
    assert.equal(noteRow(cardNamed(other.name)), null,
      "an item in the basket still offers nothing — the switch is the whole permission");
  });
});

test("the note rides that item's line, and a repaint mid-sentence keeps the words", async () => {
  await withNotedProduct(async (p) => {
    pressPlus(cardNamed(p.name));
    tapNote(cardNamed(p.name));
    typeNote(noteBox(cardNamed(p.name)), "no nuts");

    // A second press of "+" repaints the whole menu — the card in front of them is
    // rebuilt from scratch, and the box they were typing in is a new node.
    pressPlus(cardNamed(p.name));
    const again = noteBox(cardNamed(p.name));
    assert.ok(again, "the box is still there after the repaint");
    assert.equal(again.value, "no nuts", "and it still holds what they typed");

    let posted = null;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
      return { ok: true, json: async () => [] };
    };
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect";
    await registry["order-btn"].onclick();

    assert.ok(posted, "the order went through");
    assert.equal(posted.lines.length, 1);
    assert.equal(posted.lines[0].name, p.name);
    assert.equal(posted.lines[0].note, "no nuts", "the words ride the line they were typed against");
  });
});

test("an order with no note posts no note key at all — the payload is the one this page always sent", async () => {
  await withNotedProduct(async (p) => {
    pressPlus(cardNamed(p.name));
    tapNote(cardNamed(p.name)); // the box is opened and then left alone

    let posted = null;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
      return { ok: true, json: async () => [] };
    };
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect";
    await registry["order-btn"].onclick();

    assert.ok(posted, "the order went through");
    assert.equal(Object.prototype.hasOwnProperty.call(posted.lines[0], "note"), false,
      "an empty box and no box at all place exactly the same order");
  });
});

test("the next customer does not inherit the last one's note", async () => {
  await withNotedProduct(async (p) => {
    pressPlus(cardNamed(p.name));
    tapNote(cardNamed(p.name));
    typeNote(noteBox(cardNamed(p.name)), "no nuts");

    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") return { ok: true };
      return { ok: true, json: async () => [] };
    };
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect";
    await registry["order-btn"].onclick();

    // The person behind them adds the same item; the box must open on nothing.
    pressPlus(cardNamed(p.name));
    const link = noteAdd(cardNamed(p.name));
    assert.ok(link, "the item is back in the basket and offers its note again");
    tapNote(cardNamed(p.name));
    assert.equal(noteBox(cardNamed(p.name)).value, "",
      "the last customer's words are not sitting in this one's box");
  });
});

// ── v270: what the shop says when it will not take a code ──────────────────
// The engine answers in a machine reason and the shop renders it. Every reason
// the engine can give has to have a sentence here, because a reason with no
// sentence falls back to the flat "we don't know that code" line — which would
// tell a customer their code was never heard of when it had simply ended, or was
// for a first order, or was a few ringgit short.

test("every reason the engine can give the shop has its own sentence", () => {
  const shown = (r) => {
    const v = shopVerdict(r);
    return [v.kind, v.key];
  };
  assert.deepEqual(shown({ ok: true, code: { code: "FRESH10" }, offer: { kind: "rm", value: 10 } }),
    ["ok", "promoAccepted"]);
  assert.deepEqual(shown({ ok: false, fail: "unknown" }), ["no", "promoUnknown"]);
  assert.deepEqual(shown({ ok: false, fail: "paused" }), ["no", "promoPaused"]);
  assert.deepEqual(shown({ ok: false, fail: "claimed" }), ["no", "promoClaimed"]);
  assert.deepEqual(shown({ ok: false, fail: "clash" }), ["no", "promoClash"]);
  assert.deepEqual(shown({ ok: false, fail: "ended", on: "2026-09-30" }), ["no", "promoEnded"]);
  assert.deepEqual(shown({ ok: false, fail: "notYet", on: "2026-11-01" }), ["no", "promoNotYet"]);
  assert.deepEqual(shown({ ok: false, fail: "small", short: 12 }), ["no", "promoSmall"]);

  // The two the shop STATES and does not gate on. Her standing rule is that a
  // website rule must never block or hide a sale she takes by hand, so a code
  // already used once, or one meant for a first order, is taken and stamped —
  // the customer is simply told it will be confirmed when she takes the order.
  assert.deepEqual(shown({ ok: false, fail: "used" }), ["soft", "promoAcceptedUsed"]);
  assert.deepEqual(shown({ ok: false, fail: "firstOnly" }), ["soft", "promoAcceptedFirst"]);
});

test("a date reason with no readable date falls back rather than printing a sentence with a hole", () => {
  // "That code ended on %1" with %1 empty reads as a glitch, which is worse than
  // the flat line it falls back to.
  for (const on of ["", "30/09/2026", undefined, null, 42]) {
    const v = shopVerdict({ ok: false, fail: "ended", on });
    assert.equal(v.key, "promoNo", `"${on}" is not a date the shop will print`);
    assert.equal(v.kind, "no");
  }
});

test("a reason the shop has never heard of is answered plainly, never guessed at", () => {
  // An engine reason this page has never been taught is NOT a reason to borrow
  // someone else's sentence — a "small" line for an unknown fault would send the
  // customer off to spend more for something that was never a minimum.
  assert.equal(shopVerdict({ ok: false, fail: "whoKnows" }).key, "promoNo");
  // No judgement at all is the one thing the shop does know: it has not heard of
  // that code.
  assert.equal(shopVerdict(null).key, "promoUnknown");
});

// ── v275: the smallest basket, in the shop's own line ─────────────────────
test("a stated-but-not-gated code still says the smallest basket it needs", () => {
  // Her report of 2 Oct 2026: a "RM10 off on RM100" code riding on a small order still
  // took its RM10 off. The deduction is fixed in one place — awardOf, js/promo.js — and
  // this is the other half of it: the shop must never promise money the app will not
  // hand over, or the customer reads RM10 off and then finds it was not given.
  //
  // A code the customer has already used, or one meant for a first order, is STATED with
  // its caveat and left on the order — she decides by hand. That is unchanged, and so is
  // the order going through. But when the basket never reached the code's smallest basket
  // the code gives nothing for it whatever else is true, so the caveat is not the useful
  // sentence: the shortfall is.
  const c = { code: "FRESH10", gives: { type: "rm", value: 10, cap: 0 },
    basket: { type: "amount", amount: 100 } };

  const short = softVerdict("promoAcceptedUsed", "FRESH10", 16, [c]);
  assert.equal(short.key, "promoSmall", "the line the customer can act on, not an offer that will not be honoured");
  assert.equal(short.short, 84, "and it names how much more is needed");
  assert.equal(short.offer, null, "no offer is stated, because on this basket there is none");
  assert.equal(short.code, "FRESH10", "and the code still rides on the order — this is a sentence, not a gate");

  const enough = softVerdict("promoAcceptedUsed", "FRESH10", 100, [c]);
  assert.equal(enough.key, "promoAcceptedUsed", "a basket that does reach it keeps the caveat it was stated with");
  assert.equal(enough.offer.money, 10);

  // A code the shop cannot find is left exactly as it was: the soft line, the name it
  // was handed, and no offer to state. (The name arrives already tidied — the shop
  // cleans what the customer typed before it ever reaches a judgement.)
  const missing = softVerdict("promoAcceptedFirst", "NOPE", 16, []);
  assert.equal(missing.key, "promoAcceptedFirst");
  assert.equal(missing.code, "NOPE");
  assert.equal(missing.offer, null);
});

test("a date is read out in the reader's own month, not in English", () => {
  assert.equal(dayWords("2026-10-31"), "31 October");
  assert.equal(dayWords("2026-10-31", "zh"), "10月31日");
  assert.equal(dayWords("2026-10-31", "ms"), "31 Oktober", "Oktober, not October");
  for (const junk of ["", "2026-10", "31/10/2026", null, undefined]) {
    assert.equal(dayWords(junk), "", `"${junk}" is not a day and is not guessed at`);
  }
});

test("the standing line says the whole offer — what, how much to spend, and until when", () => {
  const c = {
    code: "FRESH10", gives: { type: "rm", value: 10, cap: 0 },
    basket: { type: "amount", amount: 30 }, when: { from: "", to: "2026-10-31" },
  };
  assert.equal(clauseWords(c), "RM10.00 off on RM30.00 and above, until 31 October",
    "the minimum belongs to the offer and the end date to the whole thing, so the sentence does not read as if the dates were the condition");

  // With no end date there is nothing to say about one — and no empty tail.
  assert.equal(clauseWords({ ...c, when: { from: "", to: "" } }),
    "RM10.00 off on RM30.00 and above");
  // A code with nothing to say beyond its offer is left as its offer.
  assert.equal(clauseWords({ code: "X", gives: { type: "rm", value: 5, cap: 0 } }), "RM5.00 off");
});

// ── v270: her own words under the shop's own line ─────────────────────────

test("her own words are shown in the reader's language, and fall back to what she wrote", () => {
  const c = { say: "Baked this morning.", sayZh: "", sayMs: "Dibakar pagi ini." };
  assert.equal(ownWords(c, "en"), "Baked this morning.");
  assert.equal(ownWords(c, "ms"), "Dibakar pagi ini.");
  assert.equal(ownWords(c, "zh"), "Baked this morning.",
    "a blank translation shows the English she wrote, which is more use than showing nothing");
  assert.equal(ownWords({ say: "   " }, "en"), "", "whitespace is not a sentence");
  assert.equal(ownWords(null, "en"), "");
});

// ── v270: what this phone remembers about its own orders ───────────────────

// A stand-in for localStorage, so the memory can be judged without a browser.
function fakeStore(seed) {
  const box = { ...(seed || {}) };
  return {
    getItem: (k) => (k in box ? box[k] : null),
    setItem: (k, v) => { box[k] = String(v); },
  };
}

test("a phone that has ordered before remembers that, and which codes it used", () => {
  const empty = shopMemo(fakeStore());
  assert.deepEqual(empty, { orders: 0, codes: [] }, "a phone that has never ordered says so");

  const one = rememberShopOrder("fresh10", fakeStore());
  assert.equal(one.orders, 1);
  assert.deepEqual(one.codes, ["FRESH10"], "the code is remembered in the one spelling the engine matches on");

  // The same code twice is one code, and two orders.
  const store = fakeStore();
  rememberShopOrder("FRESH10", store);
  const two = rememberShopOrder(" fresh10 ", store);
  assert.equal(two.orders, 2);
  assert.deepEqual(two.codes, ["FRESH10"], "a code used twice is still one code");

  // An order with no code counts as an order and adds no code.
  const ordered = rememberShopOrder("", store);
  assert.equal(ordered.orders, 3);
  assert.deepEqual(ordered.codes, ["FRESH10"]);
});

test("a memory it cannot read is treated as no memory, never as a crash", () => {
  for (const junk of ["not json", "[]", "null", '{"orders":"lots","codes":"FRESH10"}', "7"]) {
    assert.deepEqual(shopMemo(fakeStore({ "munchies.shop.v1": junk })), { orders: 0, codes: [] },
      `"${junk}" is not a memory the shop can use`);
  }
});

// ── v270: every sentence the shop can show exists, in all three languages ──

test("every promo line the shop can print is written in all three languages", () => {
  // Built by walking what the code can actually produce rather than by listing
  // keys by hand: a reason added to the engine and forgotten in one language is
  // exactly the fault this is here to catch.
  const keys = new Set([
    "promoAccepted", "promoAcceptedUsed", "promoAcceptedFirst", "promoNo", "promoUntil",
    ...["unknown", "paused", "ended", "notYet", "claimed", "clash", "small"]
      .map((fail) => shopVerdict({ ok: false, fail, on: "2026-09-30", short: 1 }).key),
  ]);
  for (const lang of ["en", "zh", "ms"]) {
    const dict = (STORE || {})[lang] || {};
    for (const k of keys) {
      assert.equal(typeof dict[k], "string", `${k} is missing from ${lang}`);
      assert.ok(dict[k].length > 0, `${k} is empty in ${lang}`);
    }
  }
  // The two that carry a value must keep their placeholders in every language, or
  // the customer is shown a sentence with a hole in it.
  for (const lang of ["en", "zh", "ms"]) {
    assert.match(STORE[lang].promoUntil, /%1/);
    assert.match(STORE[lang].promoUntil, /%2/);
    for (const k of ["promoEnded", "promoNotYet", "promoSmall"]) {
      assert.match(STORE[lang][k], /%1/, `${k} lost its placeholder in ${lang}`);
    }
    for (const k of ["promoAcceptedUsed", "promoAcceptedFirst"]) {
      assert.match(STORE[lang][k], /%1/, `${k} lost its offer in ${lang}`);
      assert.match(STORE[lang][k], /%2/, `${k} lost its code in ${lang}`);
    }
    // And none of them is left in English by accident.
    for (const k of keys) {
      if (lang === "en") continue;
      assert.notEqual(STORE[lang][k], STORE.en[k], `${k} was left untranslated in ${lang}`);
    }
  }
});
