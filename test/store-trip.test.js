// test/store-trip.test.js — Engine v190: the customer's track card now carries
// where the delivery has got to, who is bringing it, and a way to ring them.
//
// Two rules are the whole file, and they pull in opposite directions:
//
//   • What the card DRAWS has to come off the published row, which means every column
//     it reads must be NAMED in the storefront's own `select`. PostgREST returns only
//     the columns asked for, so a column the backoffice publishes and this page forgets
//     to name arrives as `undefined` — the card is simply missing a section and nothing
//     anywhere says why. That failure is silent, so it is measured rather than reasoned:
//     the tests below read the request the page actually sends.
//   • The card must never be taught a courier's vocabulary. It is handed a NEUTRAL
//     phase (finding, on_the_way, collected…) and carries its own words for those in
//     all three languages, so a second courier cannot make the customer's page wrong.
//     A raw status string must therefore draw NOTHING — not an unknown word, not a
//     blank line.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";

// ── Minimal DOM shim (the shape test/store-track-jump.test.js uses) ───────────
function createEl(tag) {
  const classes = new Set();
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    hidden: false, scrollLeft: 0, _listeners: {},
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on) => {
        if (on === undefined ? !classes.has(c) : on) classes.add(c);
        else classes.delete(c);
      },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((x) => x !== f); },
    scrollIntoView() {},
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      // A real element REFLECTS its `href`, `title` and `rel` as properties, and a test
      // that had to reach into `attrs` would pass on an element the browser exposes
      // differently. Only the ones this file reads are mirrored.
      if (k === "href" || k === "title" || k === "rel") this[k] = String(v);
    },
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
  documentElement: createEl("html"),
  body: createEl("body"),
};
globalThis.window = { open() {} };
Object.defineProperty(globalThis, "navigator", {
  value: { language: "en-US" }, configurable: true, writable: true,
});
const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.location = { search: "" };

// The one request this file cares about is the tracking lookup; everything else the page
// asks for at boot (availability, the published storefront settings) is answered empty, so
// the card under test is built from the row handed to it and nothing else.
const TRACK_URL = [];
let TRACK_ROW = null;
globalThis.fetch = async (url) => {
  const href = String(url);
  if (href.includes("/rest/v1/order_tracking")) {
    TRACK_URL.push(href);
    return { ok: true, json: async () => (TRACK_ROW ? [TRACK_ROW] : []) };
  }
  return { ok: true, json: async () => [] };
};

const { trackOrder } = await import("../store/app.js");
await new Promise((r) => setTimeout(r, 0));

// ── reading the drawn card ───────────────────────────────────────────────────
const box = () => registry["track-result"];

// Every string on the card, in order, so a line can be asserted whole rather than
// searched for as a substring of one blob of text.
function lines(node = box(), out = []) {
  for (const kid of node.children || []) {
    if (kid.nodeType === 3) { out.push(String(kid.text)); continue; }
    lines(kid, out);
  }
  return out;
}

// The card's paragraphs, each one its own line of text — the unit a customer reads.
function paras(node = box(), out = []) {
  if (node !== box() && node.nodeType === 1 && String(node.tagName).toLowerCase() === "p") {
    out.push(lines(node).join(""));
    return out;
  }
  for (const kid of node.children || []) if (kid.nodeType === 1) paras(kid, out);
  return out;
}

async function card(row) {
  TRACK_ROW = row;
  await trackOrder("A3F9C2");
  return paras();
}

function findLink(node) {
  for (const kid of node.children || []) {
    if (kid.nodeType !== 1) continue;
    if (String(kid.tagName).toLowerCase() === "a") return kid;
    const found = findLink(kid);
    if (found) return found;
  }
  return null;
}

const base = {
  status: "baking", confirmed_sent: true, paid_received: true,
  delivery: "Wed, 30 Sep", items: "2 x Focaccia", total: "RM 30.00", customer: "Mei Ling",
};

// ── what the customer reads ─────────────────────────────────────────────────
test("the card names where the delivery has got to, who is bringing it, and how to ring them", async () => {
  const read = await card({
    ...base,
    courier_phase: "on_the_way", courier_driver: "Ah Meng",
    courier_plate: "PMM 1234", courier_phone: "0123456789",
  });
  assert.ok(read.includes("Delivery: The driver is on the way"), `the phase is said in this page's own words: ${JSON.stringify(read)}`);
  assert.ok(read.includes("Driver: Ah Meng · PMM 1234"), "the name and the plate read as one line");
  assert.ok(read.includes("Call the driver"), "and there is a way to reach them");
  // The number is a `tel:` the phone can dial, and the link's own text is the invitation
  // rather than the digits — a customer taps a word, not a number to copy out.
  const link = findLink(box());
  assert.ok(link, "the call line is a link");
  assert.equal(link.href, "tel:0123456789");
});

test("an order with no trip on it is drawn exactly as it was before any of this existed", async () => {
  const read = await card({ ...base });
  assert.equal(read.some((s) => s.startsWith("Delivery:")), false, "no trip line");
  assert.equal(read.some((s) => s.startsWith("Driver:") || s.startsWith("Vehicle:")), false, "no one to name");
  assert.equal(read.includes("Call the driver"), false, "and nobody to ring");
  assert.equal(findLink(box()), null, "so the card carries no link at all");
});

test("the phase and the driver are independent, and each draws only if it has something to say", async () => {
  // A driver matched before any status arrived — the name is still worth a line, and the
  // phase simply has nothing to say yet rather than being guessed at.
  const named = await card({ ...base, courier_driver: "Ah Meng", courier_plate: "PMM 1234" });
  assert.ok(named.includes("Driver: Ah Meng · PMM 1234"), "the driver draws on its own");
  assert.equal(named.some((s) => s.startsWith("Delivery:")), false, "and the missing phase draws nothing");

  // And the other way round: a trip in progress whose driver has not been matched yet.
  const phaseOnly = await card({ ...base, courier_phase: "finding" });
  assert.ok(phaseOnly.includes("Delivery: Finding a driver"), "the phase draws on its own");
  assert.equal(phaseOnly.some((s) => s.startsWith("Driver:")), false, "and the missing driver draws nothing");

  // A plate with no name is a vehicle, and the line says so rather than reading
  // "Driver: PMM 1234" — the label follows what the line actually holds.
  const plate = await card({ ...base, courier_plate: "PMM 1234" });
  assert.ok(plate.includes("Vehicle: PMM 1234"), `a plate alone is a vehicle: ${JSON.stringify(plate)}`);
  assert.equal(plate.some((s) => s.startsWith("Driver:")), false);
});

test("a phase the courier sent raw is not shown, and neither is a caller's own vocabulary", async () => {
  // THE SEAM, said as a rule. The backoffice publishes a neutral phase; this page knows
  // only those. A row carrying the API's own status string must draw NOTHING, because a
  // word this page has no translation for is a line the customer can do nothing with —
  // and printing it is exactly how a second courier would make the shop read wrongly.
  for (const raw of ["PICKED_UP", "ASSIGNING_DRIVER", "ON_GOING", "SOMETHING_NEW"]) {
    const read = await card({ ...base, courier_phase: raw });
    assert.equal(read.some((s) => s.startsWith("Delivery:")), false,
      `the courier's own word "${raw}" is not published to the customer`);
    assert.equal(lines().includes(raw), false, "and it is nowhere else on the card either");
  }
  // The same goes for an empty or absent one — nothing is drawn rather than a blank label.
  assert.equal((await card({ ...base, courier_phase: "  " })).some((s) => s.startsWith("Delivery:")), false);
});

test("a number that cannot be dialled is left as words, never made into a dead button", async () => {
  // The rule the tracking slot already follows for a link, applied to the driver's number:
  // a value with no digits in it cannot be rung, so it must not become a `tel:` the phone
  // will refuse. Nothing is drawn rather than something un-tappable being offered.
  const junk = await card({ ...base, courier_driver: "Ah Meng", courier_phone: "ask the bakery" });
  assert.equal(junk.includes("Call the driver"), false, "no call line for a number that is not one");
  assert.equal(findLink(box()), null, "and nothing became a link");

  // A real number typed with the country code and some punctuation keeps only what a
  // dialler can use — `tel:` with letters in it rings nothing.
  const messy = await card({ ...base, courier_driver: "Ah Meng", courier_phone: "+60 12-345 6789" });
  const link = findLink(box());
  assert.ok(link, "a dialable number is a link");
  assert.equal(link.href, "tel:+60123456789", "stripped to digits and a leading plus");
});

// ── the silent failure, measured off the request the page actually sends ─────
test("every trip column the card reads is named in the page's own select", async () => {
  TRACK_ROW = null;
  await trackOrder("A3F9C2");
  const asked = TRACK_URL[TRACK_URL.length - 1] || "";
  assert.ok(asked, "the page asked for the order");
  // PostgREST returns ONLY what is named here. A column the backoffice publishes and this
  // list forgets is a line the card can never draw — and it fails with no error anywhere,
  // so the request itself is what has to be measured.
  for (const col of ["courier_name", "courier_phase", "courier_driver", "courier_plate", "courier_phone"]) {
    assert.ok(asked.includes(col), `${col} is asked for`);
  }
  // And the slot the share link rides in, which is not new but is drawn by the same card.
  assert.ok(asked.includes("tracking_no"), "tracking_no is asked for");
});

// ── the words themselves ────────────────────────────────────────────────────
test("every trip word exists in all three languages, and the labels keep their placeholder", () => {
  const keys = ["tripStatus", "tripFinding", "tripOnTheWay", "tripCollected", "tripDelivered",
    "tripStopped", "tripNoDriver", "driverLine", "vehicleLine", "callDriver"];
  for (const l of LANGS) {
    for (const k of keys) {
      const said = STORE[l][k];
      assert.equal(typeof said, "string", `${k} is in ${l}`);
      assert.ok(said.trim(), `${k} is not blank in ${l}`);
    }
  }
  // A label whose translation dropped its `%1` prints the label with no value beside it —
  // "Delivery:" and then nothing. Cheap to check, and it is exactly the broken-label class
  // the shop has been caught by before.
  for (const l of LANGS) {
    for (const k of ["tripStatus", "driverLine", "vehicleLine"]) {
      assert.ok(STORE[l][k].includes("%1"), `${k} keeps its placeholder in ${l}`);
    }
  }
});

// ── the two things a customer taps, and how big they are ────────────────────
test("the card's two links are as tall as everything else the customer taps", () => {
  // READ OFF THE STYLESHEET, because this is the one class of defect nothing in this file
  // can see. Every shim here answers a box with a number it was handed, so a link built
  // from padding alone measures exactly the same whether it comes out 30 pixels or 48 —
  // and the first version of this pill was 30, measured on the drawn card at 375 pixels,
  // while every other control on the page (the delivery day, the collect / courier pair,
  // Track, Place order) is 37 to 48. The two controls that matter most at the door were
  // the two smallest targets on the page, and no assertion could have said so.
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  const rule = css.match(/\.track-result a\s*\{([\s\S]*?)\}/);
  assert.ok(rule, "the card's own link rule is still there to read");
  const body = rule[1];
  const floor = Number((body.match(/min-height:\s*(\d+)px/) || [])[1] || 0);
  assert.ok(floor >= 38, `the link declares the page's own floor, not a padded guess: ${floor}px`);
  // A floor only holds if the box is the tall thing and the word centres in it: with the
  // default content-box the padding is added on top, and with a block box the word sits at
  // the top of the pill instead of in the middle.
  assert.match(body, /box-sizing:\s*border-box/, "and the floor is the whole box, not the content inside it");
  assert.match(body, /display:\s*inline-flex/, "with the word centred in it");
  assert.match(body, /align-items:\s*center/, "and not left sitting at the top");
});
