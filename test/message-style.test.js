// test/message-style.test.js — the Message style setting (2 Oct 2026).
//
// WhatsApp carries no fonts: the letters always come from the customer's own
// phone, so the only lever over how her words land is WhatsApp's own marks, and
// leaning the opening line over is the whole of the choice. Four things have to
// hold, and each is a way this could go wrong on her:
//
//   1. Plain is BYTE FOR BYTE what every message sent before this existed. Not
//      "close to" — the old text, so a bakery that never opens the setting cannot
//      tell the version moved.
//   2. When it IS on, the italics land on the greeting line and on nothing else —
//      the order code, the items and the money must not lean over with it.
//   3. One value drives all four messages, so the confirmation cannot lean over
//      while "on its way" does not.
//   4. A hand-edited backup cannot inject a third value, and the two phones agree.
//
// Pure modules, no DOM shim needed — except for the sync cases, which install a
// minimal localStorage the way test/sync.test.js does.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPaymentReminder, buildPickupReminder, buildShippedMessage, greeting }
  from "../admin/js/messages.js";
import { buildConfirmation } from "../admin/js/confirm.js";
import { defaultState, normalize } from "../admin/js/state.js";
import * as sync from "../admin/js/sync.js";

function state(style) {
  const s = {
    settings: {
      currency: "RM",
      storefront: { name: "Jienluv2bake", whatsapp: "60123456789", tngQr: "https://img/tng.png" },
    },
    products: [{ id: "p1", name: "Focaccia", price: 15 }],
    deliveryDates: [{ id: "d1", date: "2026-09-07" }],
  };
  // Only set the key when the caller named one, so the "never chose" case is a
  // state that genuinely has no messageStyle at all — which is what every phone
  // and every stored backup looks like the moment this version lands.
  if (style !== undefined) s.settings.messageStyle = style;
  return s;
}

function group() {
  return { orders: [{
    id: "ord_ab12cd34ef56", groupId: "ordg_112233445566",
    deliveryDateId: "d1", fulfillment: "collect",
    whatsapp: "+60 12-345 6789", customerName: "Mei Ling",
    productId: "p1", qty: 2,
  }] };
}

const URL = "https://bake.app/store/?track=445566";

// The four builders, so a rule can be asked of all of them at once. Kept as a
// table rather than four copies of every assertion: the whole point of the
// setting is that the four cannot differ.
const BUILDERS = [
  ["confirmation", (s) => buildConfirmation(s, group(), URL)],
  ["payment reminder", (s) => buildPaymentReminder(s, group(), URL)],
  ["shipped", (s) => buildShippedMessage(s, group(), URL)],
  ["pickup", (s) => buildPickupReminder(s, group(), URL)],
];

const GREETING = "Hi Mei Ling!";

// ── 1. Plain is untouched ─────────────────────────────────────────────────

test("a phone that never chose sends byte for byte what it sent before", () => {
  for (const [name, build] of BUILDERS) {
    const never = build(state()).message;
    const plain = build(state("plain")).message;
    assert.equal(never, plain, `${name}: an absent setting and "plain" are the same message`);
    assert.ok(never.startsWith(`${GREETING} `), `${name}: opens on the plain greeting`);
    assert.ok(!never.includes("_"), `${name}: no stray WhatsApp mark anywhere`);
  }
});

test("an unknown value is read as plain, exactly as the importer reads it", () => {
  for (const [name, build] of BUILDERS) {
    assert.equal(build(state("banana")).message, build(state("plain")).message,
      `${name}: a third value is Plain`);
  }
});

// ── 2. The italics land on the greeting line only ─────────────────────────

test("the greeting leans over, and nothing below it does", () => {
  for (const [name, build] of BUILDERS) {
    const msg = build(state("greeting")).message;
    const lines = msg.split("\n");
    assert.equal(lines[0], `_${GREETING}${lines[0].slice(GREETING.length + 1, -1)}_`,
      `${name}: the first line is the greeting, wrapped tight in one pair of underscores`);
    assert.ok(lines[0].startsWith("_Hi "), `${name}: the opening underscore is tight against the words`);
    // The marks must sit TIGHT. A space inside the pair leaves the underscores
    // showing as literal characters on some phones, which is worse than no italics.
    assert.ok(!lines[0].startsWith("_ ") && !lines[0].endsWith(" _"), `${name}: no space inside the pair`);
    assert.equal(lines[0].split("_").length - 1, 2, `${name}: exactly one pair of marks`);
    // Everything after the greeting is word for word the plain message.
    assert.deepEqual(lines.slice(1), build(state("plain")).message.split("\n").slice(1),
      `${name}: only the first line moved`);
  }
});

test("the money still reaches the customer unmarked, and the greeting's italics leave it alone", () => {
  // This shop's money lines carry no WhatsApp marks at all — the goods are a plain
  // "Total: ..." line and the sum asked for is a plain "To pay: ...". Italics on the
  // greeting must not put a mark anywhere near them: two marks on one message is what
  // a phone is most likely to misread, so this asserts the money survives verbatim.
  const plainer = buildConfirmation(state("plain"), group(), URL).message;
  const leaning = buildConfirmation(state("greeting"), group(), URL).message;
  for (const msg of [plainer, leaning]) {
    assert.ok(msg.includes("Total: RM 30.00"), "the money line is untouched");
    assert.equal(msg.includes("*"), false, "and no WhatsApp bold mark has crept in");
  }
  assert.ok(leaning.includes("Order #445566"), "the order code is not leaning over");
  assert.ok(leaning.includes("Pay by TNG using the QR below:"), "the QR line is not leaning over");
});

// ── 3. One value for all four ─────────────────────────────────────────────

test("the setting is read fresh on every build, so the four cannot disagree", () => {
  const s = state("plain");
  for (const [, build] of BUILDERS) assert.ok(!build(s).message.startsWith("_"), "plain everywhere");
  s.settings.messageStyle = "greeting"; // she changes it while the app is open
  for (const [name, build] of BUILDERS) {
    assert.ok(build(s).message.startsWith("_Hi Mei Ling!"), `${name} follows the setting`);
  }
});

test("greeting() returns the line untouched unless the style is exactly greeting", () => {
  assert.equal(greeting(state("plain"), "Hi!"), "Hi!");
  assert.equal(greeting(state(), "Hi!"), "Hi!");
  assert.equal(greeting(null, "Hi!"), "Hi!");
  assert.equal(greeting(state("greeting"), "Hi!"), "_Hi!_");
});

// ── 4. It travels, and a hand-edited backup cannot inject a third value ───

test("normalize pins the value to plain or greeting", () => {
  assert.equal(normalize({ settings: { messageStyle: "greeting" } }).settings.messageStyle, "greeting");
  assert.equal(normalize({ settings: { messageStyle: "banana" } }).settings.messageStyle, "plain");
  assert.equal(normalize({ settings: { messageStyle: 7 } }).settings.messageStyle, "plain");
  assert.equal(normalize({ settings: {} }).settings.messageStyle, "plain");
  assert.equal(defaultState().settings.messageStyle, "plain", "and the app starts on Plain");
});

// A minimal localStorage, as test/sync.test.js installs one — the sync journal
// lives there and the three rules below are read off it.
function installStorage() {
  const store = new Map();
  const real = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  return {
    store,
    restore: () => { if (real === undefined) delete globalThis.localStorage; else globalThis.localStorage = real; },
  };
}

function settingsPayload(style) {
  const s = defaultState();
  s.settings.messageStyle = style;
  return sync.computeRecords(s).find((r) => r.kind === "settings").data;
}

function cloudSettings(payload, updated_at) {
  return { kind: "settings", id: "default", data: JSON.stringify(payload), _deleted: false, updated_at };
}

test("the guard is what puts the choice on the wire at all", () => {
  assert.equal(settingsPayload("greeting").messageStyle, "greeting");
  assert.ok(!("messageStyle" in settingsPayload("plain")),
    "a phone on Plain says nothing, so it can never push Plain over the other phone's leaning greeting");
});

test("rule 2: a phone that has never chosen takes the cloud's leaning greeting", () => {
  // Local wins here (this phone's settings row is pending and newer), which is the
  // branch the GUARDED list governs. Without messageStyle in that list the key the
  // cloud is holding is dropped on the floor and the second phone keeps sending
  // plain for ever.
  const { restore } = installStorage();
  try {
    const phone = defaultState(); // never chose — Plain
    sync.markDirty(phone, "2026-10-02T12:00:00.000Z");
    sync.mergeRows(phone, [cloudSettings({ messageStyle: "greeting" }, "2026-10-02T00:00:00.000Z")]);
    assert.equal(phone.settings.messageStyle, "greeting", "the choice arrives on a phone that never chose");
  } finally { restore(); }
});

test("rule 3: a phone that chose puts it back when the cloud row has lost it", () => {
  // The cloud row wins on time and simply has no messageStyle in it — a row written
  // by a phone that never chose. This phone holds the choice, so it must queue its
  // own back up rather than let the row's silence end the leaning greeting.
  const { restore } = installStorage();
  try {
    const phone = defaultState();
    phone.settings.messageStyle = "greeting";
    sync.markDirty(phone, "2026-10-02T00:00:00.000Z");
    sync.mergeRows(phone, [cloudSettings({ defaultCapacity: 12 }, "2026-10-02T12:00:00.000Z")]);
    assert.equal(phone.settings.messageStyle, "greeting", "the choice is not lost to the cloud row's silence");
    const journal = JSON.parse(globalThis.localStorage.getItem("bakeadmin.sync"));
    assert.equal(journal.pending["settings:default"].data.messageStyle, "greeting",
      "and it is queued to be pushed back up");
  } finally { restore(); }
});

test("rule 1: choosing Plain again is spoken, not silence", () => {
  // The guard carries the key only once the greeting leans over, so Plain would
  // otherwise go out as silence — rule 2 would read that as a phone that had never
  // chosen, and the leaning greeting would come straight back. This is what puts
  // messageStyle in sync.js's SPEAK_EMPTY list.
  const { restore } = installStorage();
  try {
    const phone = defaultState();
    phone.settings.messageStyle = "greeting";
    sync.markDirty(phone); // this phone records that it held a leaning greeting
    phone.settings.messageStyle = "plain";
    const spoken = sync.markDirty(phone).pending["settings:default"].data;
    assert.equal(spoken.messageStyle, "plain", "Plain is spoken once this phone has held the greeting");
  } finally { restore(); }
});
