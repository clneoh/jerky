// test/consolidated-view.test.js — the consolidated invoice SCREEN (v372).
//
// ⚠️ WHY THIS EXISTS ON TOP OF THE PURE TESTS. `consolidatedSheet` is proven next door; what this
// proves is that the SCREEN is wired to it — that the period pills and the customer picker really do
// re-scope the document, and that the empty state is a sentence rather than a blank card. A control
// nobody has pressed is a control nobody knows works (v333's rule), and the missing-import bug this
// session nearly shipped on the Bring-a-friend screen is exactly what a "does it build at all" test
// catches.

import { test } from "node:test";
import assert from "node:assert/strict";

// The shim's nodes carry a `_classes` Set behind a `className` accessor rather than a real
// classList, so the two query helpers read it the same way the accessor writes it.
const hasClass = (n, c) => String((n && n.className) || "").split(/\s+/).includes(c);

function createEl(tag) {
  const node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    _classes: new Set(), style: {}, value: "", checked: false, selected: false,
    disabled: false, hidden: false, _listeners: {},
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = []; for (const c of cs) if (c != null) this.children.push(c); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    focus() {}, click() {}, remove() {},
    // ⚠️⚠️ A WORKING `querySelector`, AND IT WAS NOT BEFORE. The screen wires TWO things onto the
    // built sheet after it is drawn — the sortable headings (v379) and the order-number doors
    // (v381) — and both find their cells with a class query. A shim answering null made both
    // silently unreachable, so a press that never got wired could not fail a test here.
    querySelector(sel) {
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      if (cls) return walk(this).find((n) => hasClass(n, cls[1])) || null;
      const data = /^\[data-([\w-]+)="(.+)"\]$/.exec(String(sel));
      if (data) return walk(this).find((n) => n.dataset && n.dataset[data[1]] === data[2]) || null;
      return null;
    },
    querySelectorAll(sel) {
      const cls = /^\.([\w-]+)$/.exec(String(sel));
      return cls ? walk(this).filter((n) => hasClass(n, cls[1])) : [];
    },
  };
  Object.defineProperty(node, "className", {
    get() { return [...node._classes].join(" "); },
    set(v) { node._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
  });
  Object.defineProperty(node, "textContent", {
    get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
    set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
  });
  return node;
}
const body = createEl("body");
// ⚠️ A PERSISTENT `#view`, so the view's own class change can be seen at all. A shim that answered
// null here would make the width code unreachable and leave it untested.
const viewEl = createEl("div");
viewEl.classList = {
  _s: new Set(),
  add(c) { this._s.add(c); },
  remove(c) { this._s.delete(c); },
  contains(c) { return this._s.has(c); },
  toggle() {},
};
globalThis.document = {
  createElement: createEl,
  createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
  getElementById: (id) => (id === "view" ? viewEl : id === "body" ? body : null),
  querySelector: () => null, querySelectorAll: () => [],
  addEventListener() {}, removeEventListener() {},
  body,
};
globalThis.window = { innerWidth: 375, innerHeight: 812, print() {} };
// ⚠️ The view navigates with `location.hash` directly (the choice history.js documents), so the
// address has to exist for an order-number press to be provable at all.
globalThis.location = { hash: "" };

const { renderConsolidated } = await import("../admin/js/views/consolidated.js");
const { orderCode } = await import("../admin/js/state.js");
const { consolidatedSheet } = await import("../admin/js/consolidated.js");
const { journalSheetEl } = await import("../admin/js/journal.js");
void createEl;

const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
const txt = (n) => walk(n).map((x) => (x.nodeType === 3 ? x.text : "")).join(" ").replace(/\s+/g, " ");
const press = (root, label) => {
  const b = walk(root).find((n) => n.tagName === "BUTTON" && txt(n).trim() === label);
  assert.ok(b, `no button reads "${label}"`);
  b._listeners.click[0]();
  return b;
};

const OCT = (d) => `2026-10-${String(d).padStart(2, "0")}`;
let n = 0;
function state() {
  n = 0;
  const order = (over) => {
    n += 1;
    return { id: `o${n}`, groupId: over.groupId || `o${n}`, status: "paid", paidReceived: true,
      paidMethod: "cash", productId: "p1", qty: 1, unitPrice: 16,
      deliveryDate: OCT(5), customerName: "Aunty Bee", whatsapp: "60111111111", ...over };
  };
  return {
    settings: { currency: "RM" },
    products: [{ id: "p1", name: "Focaccia", price: 16 }],
    deliveryDates: [], credits: [], expenses: [], deposits: [], ingredients: [], categories: [],
    // ⚠️ THE GROUP IDS ARE HEX ON PURPOSE. `orderCode` strips every character that is not one,
    // so a "g1"/"g2" pair would give both orders the code "1" and "2" — and a test that the
    // press carries the RIGHT order would pass while proving nothing (the v378 lesson).
    orders: [
      order({ groupId: "beef01", deliveryDate: OCT(5) }),
      order({ groupId: "cafe02", deliveryDate: OCT(20), customerName: "Mei Ling", whatsapp: "60222222222" }),
    ],
  };
}

test("★ the screen builds, and shows the period's own total", () => {
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);
  const said = txt(root);
  assert.match(said, /Consolidated invoice/);
  assert.match(said, /RM 32\.00/, `the month's total is not on the screen: ${said.slice(0, 260)}`);
  // The period pills and the two presses come from the shared pair.
  assert.ok(walk(root).some((b) => b.tagName === "BUTTON" && txt(b).trim() === "Print"), "no Print press");
  assert.ok(walk(root).some((b) => b.tagName === "BUTTON" && txt(b).trim() === "Share"), "no Share press");
});

test("★★ the ALL pill is above the three, and carries no stepping arrows", () => {
  // Her words: __"pls add a selection ALL, on top of A DAy, A week, a month"__.
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);
  const pills = walk(root)
    .filter((n) => n.tagName === "BUTTON" && ["All", "A day", "A week", "A month"].includes(txt(n).trim()))
    .map((n) => txt(n).trim());
  assert.deepEqual(pills, ["All", "A day", "A week", "A month"],
    `the scopes are not in the order she asked for: ${pills.join(" / ")}`);

  press(root, "All");
  // Everything, not just this month.
  assert.match(txt(root), /Everything/, "the All scope does not say what it is showing");
  // ⚠️ AND NO DEAD ARROWS. There is nothing to step on "All", and a press that cannot do anything
  // reads as a broken screen — the app's own rule for a control with nothing to do.
  const arrows = walk(root).filter((n) => n.tagName === "BUTTON" && ["‹", "›"].includes(txt(n).trim()));
  assert.equal(arrows.length, 0, "the All scope still offers stepping arrows");
  // And the other scopes still have theirs.
  press(root, "A month");
  assert.ok(walk(root).some((n) => n.tagName === "BUTTON" && txt(n).trim() === "‹"),
    "stepping disappeared from the periods that need it");
});

test("★★ the period pill really re-scopes the document", () => {
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);
  assert.match(txt(root), /RM 32\.00/, "the month should hold both orders");

  // ⚠️ DRIVEN, NOT ASSERTED TO EXIST. The fifth of October holds only Aunty Bee's order.
  press(root, "A day");
  press(root, "‹");
  press(root, "‹"); // back to the 5th
  const said = txt(root);
  assert.match(said, /by bake day/, "the basis stopped being stated");
  assert.match(said, /A day/, "the day pill did not take");
});

test("★ picking one customer takes the other one out of the document", () => {
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);
  // ⚠️ DRIVEN TO A KNOWN STATE FIRST. The screen keeps what she last looked at, so this test ran
  // against whatever the test before it had left — a DAY, holding one of the two orders — and its
  // assertions passed without the picker doing anything at all. The bite found that, not a reading:
  // removing `paint()` from the picker left this test green and only failed the one after it.
  press(root, "A month");
  assert.match(txt(root), /RM 32\.00/, "the month should hold both orders before the picker is touched");

  const picker = walk(root).find((x) => x.tagName === "SELECT");
  assert.ok(picker, "there is no customer picker on the screen");
  picker.value = "60222222222";
  picker._listeners.change[0].call(picker); // `select` calls back with the element as `this`
  const said = txt(root);
  assert.match(said, /Mei Ling/, "the picked customer is not named");
  assert.equal(/RM 32\.00/.test(said), false,
    `the other customer is still in the document: ${said.slice(0, 240)}`);
  assert.match(said, /RM 16\.00/, "the picked customer's own order is missing");
});

test("a customer with nothing in the period is told so, not shown a blank card", () => {
  // ⚠️ THE SCREEN REMEMBERS WHAT SHE LAST LOOKED AT — the period, the anchor and the customer are
  // kept between visits on purpose, so stepping away and back does not silently re-scope the
  // document. That means this test has to drive the picker BACK to everybody first rather than
  // assuming a fresh screen; the first run of it failed for exactly that reason.
  const st = state();
  st.orders = [];
  const root = createEl("div");
  renderConsolidated(root, st);
  const picker = walk(root).find((x) => x.tagName === "SELECT");
  picker.value = "";
  picker._listeners.change[0].call(picker);
  assert.match(txt(root), /Nothing was sold in this period/,
    "an empty period drew a blank card instead of saying so");

  // And a customer picked with nothing in the period gets their own sentence, not the same one.
  const st2 = state();
  const root2 = createEl("div");
  renderConsolidated(root2, st2);
  const picker2 = walk(root2).find((x) => x.tagName === "SELECT");
  picker2.value = "60111111111";
  picker2._listeners.change[0].call(picker2);
  st2.orders = [];
  renderConsolidated(root2, st2);
  assert.match(txt(root2), /This customer has nothing in this period/,
    "a customer with an empty period is told the bakery sold nothing at all");
});

test("★★ the page WIDENS itself on a desktop, and gives the width back when she leaves", () => {
  // ⚠️ THE WHOLE BACKOFFICE IS CAPPED AT 540px — a phone column, on every screen at every size. Her
  // words: __"that page can be optimise for desktop brouwser"__, and she is right: a filing page is
  // read and printed at a desk. **The cap is lifted for this view ALONE**, and a page that widened the
  // app without putting it back would quietly change every screen she opened next.
  const st = state();
  const root = createEl("div");
  const cleanup = renderConsolidated(root, st);
  assert.equal(viewEl.classList.contains("view-wide"), true,
    "the filing page did not widen — it is still a phone column on a desktop");
  assert.equal(typeof cleanup, "function",
    "★ the view returns no cleanup, so the wider cap would follow her to every other screen");
  cleanup();
  assert.equal(viewEl.classList.contains("view-wide"), false,
    "★ the width was not given back, so the next screen she opens is the wrong size");
});

// ── ★★ the order number is a door (v381) ──────────────────────────────────────────────
// Her words: __"can make the order number clickable to bring us to the order so i can admen it,
// or look at it detail"__.

test("★★ every filing row's order number opens that order", () => {
  // ⚠️⚠️ THE SCOPE AND THE CUSTOMER ARE BOTH MODULE STATE, KEPT BETWEEN VISITS on purpose — stepping
  // away and coming back should not re-scope the document she was reading. It also means the tests
  // above have left BOTH narrowed (a day, and one customer), so this one names its own view rather
  // than assuming a default. Setting only the period would still show one order and read as a
  // missing press.
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);
  const sel = walk(root).find((n) => n.tagName === "SELECT");
  assert.ok(sel, "the page has no customer picker to reset");
  sel.value = "";
  sel._listeners.change[0].call(sel);
  press(root, "All"); // every order, whatever the earlier tests left behind

  const links = walk(root).filter((n) => n.tagName === "A" && hasClass(n, "ord-open"));
  const orderCells = walk(root)
    .filter((n) => hasClass(n, "j-col-1"))
    .map((n) => JSON.stringify(String(n.textContent)));
  assert.equal(links.length, 2,
    `the filing list's order numbers are not pressable — the order cells hold ${orderCells.join(", ")}`);

  // ⚠️ EACH LINK CARRIES ITS OWN ORDER, proved against the codes the fixture's own ids make.
  // A page where both rows opened the same order would pass a count of two.
  const want = st.orders.map((o) => `#/orders?order=${orderCode(o)}`);
  assert.deepEqual(links.map((a) => a.attrs.href).sort(), want.sort(),
    "a filing row links somewhere other than the order it names");
  assert.equal(links.every((a) => String(a.textContent).startsWith("#")), true,
    "the press does not read as the order number");

  globalThis.location.hash = "#/more/consolidated";
  links[0]._listeners.click[0]({ preventDefault() {} });
  assert.equal(globalThis.location.hash, links[0].attrs.href, "pressing it went nowhere");
});

test("★ the sortable headings still work now that the body is wired too", () => {
  // ⚠️ TWO PASSES OVER THE SAME BUILT SHEET — sort (v379) then doors (v381). This pins that the
  // second did not undo the first: a wiring pass that rebuilt a row would drop the heading's
  // listener, and the page would quietly stop sorting.
  const st = state();
  const root = createEl("div");
  renderConsolidated(root, st);

  const headNow = () => walk(root).find((n) => hasClass(n, "journal-cols-head"));
  assert.ok(headNow(), "the sheet's own header row is not on the screen");
  assert.equal(headNow().children.filter((c) => hasClass(c, "sortable")).length, 5,
    "not every heading is sortable");

  const order = headNow().children.filter((c) => hasClass(c, "sortable"))[1];
  assert.ok(order._listeners.click && order._listeners.click.length, "the Order heading lost its press");
  order._listeners.click[0]();

  // ⚠️⚠️ RE-FOUND AFTER THE PRESS, NEVER THE NODE THAT WAS PRESSED. `paint()` replaces the whole
  // card, so the cell she pressed is detached the moment it is pressed — and the arrow is written
  // when the heading is WIRED, which is on the next render. Asserting on the pressed node would
  // read a dead element and fail over a screen that is working (v333's rule: a control is proved
  // at its OUTCOME, which means looking at what the repaint drew).
  const after = headNow().children.filter((c) => hasClass(c, "sortable"))[1];
  assert.match(String(after.textContent), /[▲▼]/, "the heading does not say which way it is sorting");
  assert.match(String(after.textContent), /▲/, "the first press on a heading should sort it ascending");
});

test("⚠️ the PRINTED sheet carries no link at all", () => {
  // ⚠️⚠️ THE WHOLE POINT OF WIRING THE SCREEN AND NOT THE SHEET. `journalBodyEl` (screen) and
  // `journalSheetEl` (paper) draw one document from one `sheetLineEl`; a link written into that
  // shared builder would put a live link in the middle of a filing sheet — meaningless on paper,
  // and a second rendering of the document besides.
  // ⚠️ BUILT FROM THE SHEET ITSELF, not walked off the live screen: the print layer is not in the
  // DOM until Print is pressed, so a walk of the screen would find no sheet and this test would pass
  // over nothing at all — the vacuous shape this project has shipped twice.
  const st = state();
  const sheet = consolidatedSheet(st, { kind: "month", anchor: "2026-10", customerKey: "" });
  const paper = journalSheetEl(sheet, "RM");

  assert.ok(walk(paper).some((n) => n.nodeType === 3 && /#/.test(String(n.text))),
    "the printed sheet carries no order numbers at all — so it proves nothing about links");
  assert.equal(walk(paper).filter((n) => n.tagName === "A").length, 0,
    "a link reached the sheet that goes to the printer");
  assert.equal(walk(paper).filter((n) => hasClass(n, "ord-open")).length, 0,
    "an order door reached the printed sheet");
});


test("⚠️ a number whose order was REMOVED is not a door — there is nothing to open", () => {
  // ⚠️⚠️ THE ONE ROW ON THIS PAGE A DOOR MUST NOT APPEAR ON. A void line is a receipt whose order
  // was removed — which is the whole reason it is on the page — and its cell still holds a
  // perfectly good-looking code ("#000001"). A press there could only land on the Orders screen
  // and open nothing, which is the control this app treats as a bug. The row is read off its own
  // `journal-void` class, put there by the builder for exactly that row.
  const st = state();
  st.settings.supabase = { enabled: true, url: "https://proj.supabase.co", anonKey: "anon",
    email: "a@b.c", password: "p" };
  const store = new Map([["bakeadmin.supabase",
    JSON.stringify({ access_token: "tok", expires_at: Date.now() + 3600000 })]]);
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  const real = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true,
    json: async () => [{ number: 1, order_code: "DEAD01", issued_at: "2026-10-05T02:00:00.000Z",
      refunded_at: null, refunded_amount: 0 }] });

  const root = createEl("div");
  renderConsolidated(root, st);
  return new Promise((r) => setTimeout(r, 0)).then(() => {
    const said = txt(root);
    assert.match(said, /#DEAD01/, "the removed number is not on the page at all — so this proves nothing");
    const voidRow = walk(root).find((n) => hasClass(n, "journal-void"));
    assert.ok(voidRow, "the void row lost its own class, so nothing can tell it apart");
    assert.equal(walk(voidRow).filter((n) => n.tagName === "A").length, 0,
      "a door was drawn on a number whose order does not exist");
    assert.equal(walk(root).filter((n) => n.tagName === "A" && hasClass(n, "ord-open")).length, 2,
      "the orders that DO exist lost their doors");
  }).finally(() => { globalThis.fetch = real; });
});
