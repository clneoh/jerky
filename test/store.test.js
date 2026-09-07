import { test } from "node:test";
import assert from "node:assert/strict";

// Minimal DOM shim so store/app.js can render at import time.
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    scrollTop: 0, _listeners: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
  };
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

// store/config.js holds "FILLME" Supabase placeholders until this business has
// its own project; stub fetch so the module-level render() hits no network.
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { buildMessage, mergeStorefront, upcomingDates, pillSpecs, dateKey, fmtDay, trackOrder, isOpen, waNumber, parseVia } = await import("../store/app.js");

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
  assert.ok(registry["dates"].children.length >= 1); // date pills
  // feature off (empty supabase config) → first day selected by default
  assert.equal(registry["dates"].children[0].className, "pill active");
  assert.equal(registry["dates"].children.every((p) => p.className.includes("soldout")), false);
  assert.equal(registry["order-btn"].disabled, true); // empty cart
});

test("dateKey formats a local YYYY-MM-DD key", () => {
  assert.equal(dateKey(new Date(2026, 8, 2)), "2026-09-02");
  assert.equal(dateKey(new Date(2026, 0, 7)), "2026-01-07");
});

test("pillSpecs flags sold-out days and leaves open days plain", () => {
  const d1 = new Date(2026, 8, 2);
  const d2 = new Date(2026, 8, 4);
  const d3 = new Date(2026, 8, 7);
  const avail = { [dateKey(d1)]: 0, [dateKey(d2)]: 2, [dateKey(d3)]: 9 };
  const specs = pillSpecs([d1, d2, d3], avail);

  assert.equal(specs[0].label, `${fmtDay(d1)} Sold out`);
  assert.equal(specs[0].soldOut, true);
  assert.equal(specs[0].day, fmtDay(d1));
  assert.equal(specs[0].avail, "Sold out");

  assert.equal(specs[1].label, fmtDay(d2));
  assert.equal(specs[1].soldOut, false);

  assert.equal(specs[2].label, fmtDay(d3));
  assert.equal(specs[2].soldOut, false);
});

test("pillSpecs leaves days plain when availability is off or unknown", () => {
  const d = new Date(2026, 8, 2);
  const off = pillSpecs([d], {});
  assert.equal(off[0].label, fmtDay(d));
  assert.equal(off[0].soldOut, false);

  const unknown = pillSpecs([d], { "2099-01-01": 5 }, 3); // row for another date
  assert.equal(unknown[0].label, fmtDay(d));
  assert.equal(unknown[0].soldOut, false);
});

test("order click sends one order and shows the success card (regression: no throw on the date label)", async () => {
  // Add one item via the first menu card's "+" button (drives the real cart).
  const card = registry["menu"].children[0];
  const stepper = card.children.find((c) => c.className === "stepper");
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
  } finally {
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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

test("mergeStorefront carries the TNG QR image URL", () => {
  const out = mergeStorefront({ tngQr: "" }, { tngQr: "https://img/tng.png" });
  assert.equal(out.tngQr, "https://img/tng.png");
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
    assert.deepEqual(labels, ["New", "Confirmed", "Paid", "Preparing", "Packed", "Delivered"],
      "journey reads New → Confirmed → Paid → Preparing → Packed → Delivered");
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

test("a Packed order (status ready) shows the preparation steps done with only Delivered pulsing", async () => {
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
    assert.deepEqual(labels, ["New", "Confirmed", "Paid", "Preparing", "Packed", "Delivered"],
      "journey reads New → Confirmed → Paid → Preparing → Packed → Delivered");
    assert.equal(steps.length, 6, "all six stages present");
    assert.equal(steps.filter((s) => String(s.className || "").includes("done")).length, 5,
      "everything before the delivery is green once the order is Packed");
    assert.equal(steps.filter((s) => String(s.className || "").includes("todo")).length, 0,
      "no stage stays grey — the delivery is the only one left");
    const now = steps.find((s) => String(s.className || "").includes("now"));
    const nowLabel = (now.children || []).find((c) => String(c.className || "").includes("tj-label"));
    assert.ok(nowLabel && String(nowLabel.children[0].text || "").includes("Delivered"),
      "Delivered is the flashing (current) stage while the order is Packed");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});

test("a Delivered order shows the whole journey green — nothing flashes", async () => {
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
      "every stage is green on a delivered order");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
  const stepper = card.children.find((c) => c.className === "stepper");
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
