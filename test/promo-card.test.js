// The printed promo card (slice 5). Two things are being proved here, and both
// of them are about a piece of paper she cannot take back.
//
// 1. THE CARD AGREES WITH THE SHOP. Every family the shop judges for a typed code
//    has to be on the card — if the card omits one, the paper in the customer's
//    hand says something the shop will refuse, which is the single worst thing a
//    card can do.
// 2. THE CARD CARRIES NOTHING IT CANNOT KEEP. No end date, no count: a date is a
//    promise she may have to move, and a count is one the card cannot count. Both
//    are left off deliberately, and left off is asserted as hard as put on.
//
// cardFields is pure — no DOM, no storage, no clock — so all of that runs in Node.
// Only boot(), which turns the fields into a page, needs a stand-in document.
//
// Every test here was bitten by reverting the behaviour in place.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// A page only as faithful as boot() needs: elements that can hold children and
// stringify their own text. It reads back what was rendered, so a card that never
// reached the page fails rather than passing quietly.
function makeEl(tag) {
  const node = {
    tagName: String(tag).toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, hidden: false, innerHTML: "", _listeners: [],
    append(...cs) { for (const c of cs) this.children.push(c); },
    appendChild(c) { this.children.push(c); return c; },
    replaceChildren(...cs) { this.children = cs.filter((c) => c != null); },
    addEventListener(t, f) { this._listeners.push([t, f]); },
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    click() { for (const [t, f] of this._listeners) if (t === "click") f({ type: "click", target: this }); },
  };
  const classes = new Set();
  node.classList = {
    add: (c) => classes.add(c),
    remove: (c) => classes.delete(c),
    contains: (c) => classes.has(c),
    toggle: (c) => (classes.has(c) ? classes.delete(c) : classes.add(c)),
  };
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(" "); },
    configurable: true,
  });
  return node;
}

const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => { mem.set(k, String(v)); },
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};

const { cardFields, offerLine, renderCard, shopLink, boot } =
  await import("../admin/js/promo-card.js");
const { blankCode, minimumOf, normCode } = await import("../admin/js/promo.js");

// A frozen code with every family given an opinion, so a card built from it has
// something to say about all of them. The dates and the two ceiling numbers are
// deliberately distinctive, because the point of the card is that they do NOT
// travel.
const FROZEN = {
  ...blankCode(),
  id: "p1",
  code: "FRESH10",
  vis: "public",
  frozen: true,
  who: { type: "first" },
  when: { from: "2026-10-01", to: "2026-12-31" },
  basket: { type: "amount", amount: 30 },
  gives: { type: "rm", value: 10, cap: 0 },
  often: { type: "quota", n: 7, maxRM: 137 },
  beside: { type: "nocredit" },
  say: "Made fresh the morning you collect it.",
};

const SHOP = ["Munchies Furkidz", "Handmade Dehydrated Pet Treats"];

const fieldsOf = (over = {}, brand = {}, base = "https://munchies.com.my/admin/promo-card.html") =>
  cardFields({ ...FROZEN, ...over }, brand, base);

test("the card carries every rule the shop will judge", () => {
  const f = fieldsOf();
  assert.equal(f.code, "FRESH10");
  assert.equal(f.offer, "RM10 off");
  assert.equal(f.minimum, 30);
  assert.equal(f.minimumLine, "on RM30 and above");
  // "How often" is the one family that splits: ONCE is a rule the card can keep
  // and does carry, while a quota is a count it cannot, and is left off.
  assert.deepEqual(f.rules, [
    "First order only",
    "Not with the bring-a-friend welcome discount",
  ]);
  assert.deepEqual(fieldsOf({ often: { type: "once", n: 0, maxRM: 0 } }).rules,
    ["First order only", "One per customer", "Not with the bring-a-friend welcome discount"]);
  assert.equal(f.sentence, "Made fresh the morning you collect it.");
  assert.equal(f.url, "https://munchies.com.my/store/?promo=FRESH10");
});

test("a code with no opinion on a family says nothing about it", () => {
  // The card must not invent rules either: a plain code reads as plainly as it
  // did before there were families.
  const f = fieldsOf({ who: { type: "all" }, basket: { type: "none", amount: 0 },
    often: { type: "unlimited", n: 0, maxRM: 0 }, beside: { type: "anything" } });
  assert.deepEqual(f.rules, []);
  assert.equal(f.minimumLine, "");
  assert.equal(f.minimum, 0);
});

test("the card leaves off the two promises paper cannot keep", () => {
  const f = fieldsOf();
  // The dates the code runs, and both ceilings, are hers to move. A card that
  // printed them would be lying the moment she extended the offer or raised the
  // ceiling — and a card cannot be recalled.
  const shown = JSON.stringify(f);
  for (const gone of ["2026-12-31", "2026-10-01", "137"]) {
    assert.ok(!shown.includes(gone), `the card must not carry ${gone}: ${shown}`);
  }
  // …and not smuggled into a sentence either.
  const words = [f.offer, f.minimumLine, ...f.rules, f.sentence].join(" ");
  assert.ok(!/\d{4}-\d{2}-\d{2}/.test(words), `no date on the card: ${words}`);
  assert.ok(!/\b\d+\s+orders?\b/.test(words), `no order count on the card: ${words}`);
  assert.ok(!/at most/i.test(words), `no ceiling on the card: ${words}`);
});

test("the card cannot agree with the shop by accident", () => {
  // The minimum is taken from the engine, never re-read out of the record, so a
  // code whose basket was normalised to 0 cannot print "on RM0 and above".
  const none = { ...FROZEN, basket: { type: "amount", amount: 0 } };
  const f = fieldsOf({ basket: { type: "amount", amount: 0 } });
  assert.equal(f.minimum, minimumOf(none));
  assert.equal(f.minimum, 0);
  assert.equal(f.minimumLine, "");
  // …and when there IS a minimum, the card and the engine agree on the figure.
  assert.equal(fieldsOf().minimum, minimumOf(FROZEN));
  assert.equal(fieldsOf().minimum, 30);
  // The offer is the engine's too — a percentage reads with its cap or without.
  assert.equal(offerLine({ ...FROZEN, gives: { type: "pct", value: 15, cap: 20 } }), "15% off, up to RM20");
  assert.equal(offerLine({ ...FROZEN, gives: { type: "pct", value: 15, cap: 0 } }), "15% off");
  assert.equal(offerLine({ ...FROZEN, gives: { type: "delivery", value: 0, cap: 0 } }), "Free delivery");
});

test("the square points at the shop that printed it, with the code on it", () => {
  assert.equal(shopLink("fresh10", "https://munchies.com.my/admin/promo-card.html"),
    "https://munchies.com.my/store/?promo=FRESH10");
  // The page a card is built from is the page it points back at, so a card printed
  // from a test copy carries a test link rather than a live one that would scan
  // into the wrong shop.
  assert.equal(shopLink("FRESH10", "http://localhost:8453/admin/promo-card.html"),
    "http://localhost:8453/store/?promo=FRESH10");
  assert.ok(fieldsOf().where.includes("munchies.com.my/store/"));
  // The code is shown to the customer exactly as the shop will read it.
  assert.equal(fieldsOf({ code: "fresh10" }).code, normCode("fresh10"));
});

test("a blank storefront falls back to the homepage's own brand", () => {
  const f = fieldsOf({}, {});
  assert.equal(f.name, SHOP[0]);
  assert.equal(f.tagline, SHOP[1]);
  // Her published name wins when she has set one — the card is the shop's card.
  const own = fieldsOf({}, { name: "Munchies Furkidz", tagline: "Dehydrated treats, Penang" });
  assert.equal(own.name, "Munchies Furkidz");
  assert.equal(own.tagline, "Dehydrated treats, Penang");
});

test("her own sentence rides on the card only when she wrote one", () => {
  assert.equal(fieldsOf().sentence, "Made fresh the morning you collect it.");
  assert.equal(fieldsOf({ say: "" }).sentence, "");
});

/* ── the page ───────────────────────────────────────────────────────────── */

function pageWith(code) {
  const card = makeEl("main");
  const bar = makeEl("div");
  bar.hidden = false;
  const byId = new Map([["card", card]]);
  const doc = {
    createElement: makeEl,
    createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
    getElementById: (id) => byId.get(id) || null,
    querySelector: (sel) => (sel === ".bar" ? bar : null),
  };
  card.ownerDocument = doc;
  globalThis.document = doc;
  const win = { document: doc, location: { href: "https://munchies.com.my/admin/promo-card.html", search: code == null ? "" : `?code=${code}` }, print() {} };
  return { win, card, bar };
}

test("a known code draws four cards to the sheet, cut out of one press", () => {
  mem.clear();
  mem.set("bakeadmin.v1", JSON.stringify({
    version: 1, promoCodes: [{ ...FROZEN }], orders: [],
    settings: { storefront: { name: "Munchies Furkidz", tagline: "Handmade Dehydrated Pet Treats" } },
  }));
  const { win, card } = pageWith("FRESH10");
  boot(win);
  assert.equal(card.children.length, 1, "one sheet");
  assert.equal(card.children[0].children.length, 4, "A4 holds four A6 cards");
  const text = card.textContent;
  assert.ok(text.includes("FRESH10"), "the code is on the card");
  assert.ok(text.includes("RM10 off"));
  assert.ok(text.includes("on RM30 and above"));
});

test("a card with no code on it is never drawn as a blank sheet", () => {
  // A blank sheet is the one outcome that could reach a customer: she would print
  // it, and nothing on the paper would be wrong in a way anyone could see.
  const { win, card } = pageWith(null);
  boot(win);
  assert.equal(card.children.length, 1);
  assert.ok(!card.children[0].className.includes("sheet"), "no sheet was built");
  assert.ok(card.textContent.includes("needs to be told which code"));
});

test("the page offers nothing to print when it has no card to print", () => {
  // A Print button above a message is a control that does nothing, and she reads
  // a dead control as a fault. It goes with the card — and it goes by a CLASS,
  // because the bar is laid out with display:flex, which outranks the browser's
  // own [hidden] rule and would leave the button sitting there looking ready.
  const none = pageWith(null);
  boot(none.win);
  assert.equal(none.bar.classList.contains("is-off"), true, "no card, no Print button");
  const gone = pageWith("NOPE123");
  boot(gone.win);
  assert.equal(gone.bar.classList.contains("is-off"), true, "an unknown code is no card either");
  // …and the stylesheet has to make that class mean something.
  const css = readFileSync(new URL("../admin/promo-card.html", import.meta.url), "utf8");
  assert.match(css, /\.bar\.is-off\{display:none\}/, "the class must actually hide the bar");
  // …and a real card keeps it.
  mem.clear();
  mem.set("bakeadmin.v1", JSON.stringify({
    version: 1, promoCodes: [{ ...FROZEN }], orders: [],
    settings: { storefront: { name: "Munchies Furkidz", tagline: "Handmade Dehydrated Pet Treats" } },
  }));
  const good = pageWith("FRESH10");
  boot(good.win);
  assert.equal(good.bar.classList.contains("is-off"), false, "a drawn card keeps its Print button");
});

test("an unknown code is named, and nothing is frozen by looking", () => {
  mem.clear();
  mem.set("bakeadmin.v1", JSON.stringify({ version: 1, promoCodes: [{ ...FROZEN }], orders: [], settings: {} }));
  const { win, card } = pageWith("NOPE123");
  boot(win);
  assert.ok(card.textContent.includes("NOPE123"), "the code she typed is named back to her");
  assert.ok(card.textContent.includes("not a code on this device"));
  const saved = JSON.parse(mem.get("bakeadmin.v1"));
  assert.equal(saved.promoCodes[0].frozen, true);
  assert.equal(saved.promoCodes[0].code, "FRESH10", "nothing about the code changed");
});

test("renderCard draws the fields it was handed, not a code it went looking for", () => {
  const root = makeEl("main");
  renderCard(root, cardFields({ ...FROZEN, say: "" }, {}, "https://munchies.com.my/admin/promo-card.html"));
  const sheet = root.children[0];
  assert.equal(sheet.children.length, 4);
  for (const card of sheet.children) {
    assert.ok(card.textContent.includes("FRESH10"));
    assert.ok(card.textContent.includes("RM10 off"));
    assert.ok(!/\d{4}-\d{2}-\d{2}/.test(card.textContent), "no date reaches the paper");
  }
});

test("the card never names the person a code belongs to (v289)", () => {
  // The card is a piece of paper handed to whoever walks past it, and a code may now belong to a
  // named partner. The card stays IMPERSONAL on purpose, for the same reason it carries no count:
  // it is one code handed to many people, and it goes out into the world.
  const f = fieldsOf({ holder: { id: "cus_1", name: "Cafe Aunty" } });
  const shown = JSON.stringify(f);
  assert.ok(!shown.includes("Cafe Aunty"), `the card must not carry the holder's name: ${shown}`);
  assert.ok(!shown.includes("cus_1"), "nor the profile id");
  // AND THE CARD IS OTHERWISE UNCHANGED — the same fields, whatever the code is tied to.
  assert.deepEqual(Object.keys(f).sort(), Object.keys(fieldsOf()).sort(),
    "a code belonging to someone prints exactly the card a code belonging to nobody prints");
});
