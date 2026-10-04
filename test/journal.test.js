// test/journal.test.js — a book that can leave the screen (v282).
//
// Her words: "those journals in profits and other journals should be printable and able to be
// shared". What this file pins is NOT the layout — it is the one promise the build rests on:
// the screen, the paper and the shared message are three renderings of ONE description, so
// they cannot disagree about a row or a total. Everything below is either that invariant or
// one of the two presses' failure paths, which are the places a "share" quietly goes wrong.

import { test } from "node:test";
import assert from "node:assert/strict";

// A stand-in screen, deliberately unforgiving: classList is real and keeps className in step,
// and getElementById searches the document the way a browser does — a forgiving shim would
// have hidden the one bug this file exists to catch (a second Print press reusing a layer the
// first press had already emptied). See the strict-shim rule in the project's own notes.
function domShim() {
  const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };
  const createEl = (tag) => {
    const node = {
      tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
      _classes: new Set(), style: {}, value: "", checked: false, selected: false,
      disabled: false, hidden: false, _listeners: {}, parentNode: null,
      appendChild(c) { if (c != null) { this.children.push(c); c.parentNode = this; } return c; },
      append(...cs) { for (const c of cs) if (c != null) { this.children.push(c); c.parentNode = this; } },
      replaceChildren(...cs) {
        this.children = [];
        for (const c of cs) if (c != null) { this.children.push(c); c.parentNode = this; }
      },
      remove() {
        const p = this.parentNode;
        if (p) p.children = p.children.filter((x) => x !== this);
        this.parentNode = null;
      },
      addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
      removeEventListener(t, f) { this._listeners[t] = (this._listeners[t] || []).filter((g) => g !== f); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k]; },
      focus() {},
      // A click is the browser ACTING on the node, and the app's last-resort save path is a
      // detached link it makes and clicks. Recording it is how that path can be seen at all —
      // the node is gone from the tree by the time the call returns.
      click() { globalThis.document.clicks.push(this); },
    };
    Object.defineProperty(node, "className", {
      get() { return [...node._classes].join(" "); },
      set(v) { node._classes = new Set(String(v).split(/\s+/).filter(Boolean)); },
    });
    node.classList = {
      add(...cs) { for (const c of cs) if (c) node._classes.add(c); },
      remove(...cs) { for (const c of cs) node._classes.delete(c); },
      toggle(c, on) {
        const want = on === undefined ? !node._classes.has(c) : !!on;
        if (want) node._classes.add(c); else node._classes.delete(c);
        return want;
      },
      contains(c) { return node._classes.has(c); },
    };
    Object.defineProperty(node, "textContent", {
      get() { return this.children.map((c) => (c.nodeType === 3 ? c.text : c.textContent)).join(""); },
      set(v) { this.children = v === "" ? [] : [{ nodeType: 3, text: String(v) }]; },
    });
    return node;
  };
  const body = createEl("body");
  globalThis.document = {
    createElement: createEl,
    createTextNode: (s) => ({ nodeType: 3, text: String(s) }),
    getElementById: (id) => [body, ...walk(body)].find((n) => n.attrs && n.attrs.id === id) || null,
    querySelector: () => null,
    querySelectorAll: () => [],
    clicks: [],
    body,
  };
  return { body, createEl };
}
const screen = domShim();

const { journalSheet, buildJournalText, journalSheetEl, shareJournal, printJournal,
  journalButtons, bakeryName } = await import("../admin/js/journal.js");
const { fmtRM } = await import("../admin/js/state.js");

const sheetOf = (over = {}) => journalSheet({
  title: "Sales journal",
  subtitle: "Sales · September 2026",
  lines: [
    { what: "10 Sep · Focaccia · Bee", amount: 30 },
    { what: "12 Sep · Sourdough · Ali", amount: 12.5 },
  ],
  totals: [{ label: "Total", amount: 42.5 }],
  where: "More → Profit",
  bakery: "Jien Luv 2 Bake",
  ...over,
});

const walk = (n, out = []) => { for (const c of n.children || []) { out.push(c); walk(c, out); } return out; };

// Every row of money the sheet draws, in order, as [words, figure] — the lines and then the
// totals, which is the order a reader meets them in on the page and in the message.
const moneyRows = (node) => walk(node)
  .filter((n) => String(n.className).includes("info-row"))
  .map((n) => [n.children[0].textContent, n.children[1].textContent]);

const lineStarting = (text, starts) => text.split("\n").find((l) => l.startsWith(starts));

// ── one description, three renderings ────────────────────────────────────────

test("the paper and the message are the same book as the screen", () => {
  const s = sheetOf();
  const expected = [
    ...s.lines.map((l) => [l.what, fmtRM(l.amount)]),
    ...s.totals.map((t) => [t.label, fmtRM(t.amount)]),
  ];
  assert.deepEqual(moneyRows(journalSheetEl(s)), expected,
    "the printed sheet shows the sheet's own rows, in the sheet's own order");

  const text = buildJournalText(s);
  for (const [what, figure] of expected) {
    assert.ok(text.includes(what), `the shared message carries "${what}"`);
    assert.ok(text.includes(figure), `the shared message carries ${figure}`);
  }
  const total = lineStarting(text, "Total");
  assert.ok(total.endsWith(fmtRM(42.5)), `the message's total is the sheet's total, not a second sum: ${total}`);
});

test("the figure on the paper is the figure on the screen, to the cent", () => {
  // The Money screen writes a movement out as "−RM 8.00". A sheet that let each renderer
  // choose would print "RM -8.00" on one and "−RM 8.00" on the other, which is exactly the
  // disagreement this module exists to make impossible.
  const s = sheetOf({ lines: [
    { what: "10 Sep · a sale", amount: 30 },
    { what: "10 Sep · flour", amount: 8, dir: "out" },
  ], totals: [] });
  const dom = moneyRows(journalSheetEl(s));
  assert.equal(dom[1][1], "−RM 8.00");
  assert.equal(lineStarting(buildJournalText(s), "10 Sep · flour").endsWith("−RM 8.00"), true);
  assert.equal(lineStarting(buildJournalText(s), "10 Sep · a sale").includes("−"), false,
    "money that arrived carries no direction");
});

test("a heading is a heading — its own words and no money column", () => {
  const s = sheetOf({
    lines: [
      { what: "Sales", amount: 42.5 },
      { what: "Running costs", heading: true },
      { what: "Packaging", amount: -8 },
    ],
    totals: [{ label: "Total expenses", amount: -8 }],
  });
  const text = buildJournalText(s);
  assert.ok(text.split("\n").includes("Running costs"), "the heading gets a line of its own");
  assert.equal(text.split("\n").some((l) => /^Running costs\s/.test(l)), false,
    "nothing is padded onto a heading, so it cannot be read as a figure");

  const section = walk(journalSheetEl(s)).find((n) => String(n.className).includes("js-section"));
  assert.equal(section.textContent, "Running costs");
  assert.equal(section.children.length, 1, "a heading carries no value node to hold a figure");
});

test("a note of more than one paragraph prints as more than one paragraph", () => {
  const s = sheetOf({ note: "First thing.\n\nSecond thing." });
  const notes = walk(journalSheetEl(s)).filter((n) => String(n.className).includes("js-note"));
  assert.deepEqual(notes.map((n) => n.textContent), ["First thing.", "Second thing."],
    "a page has no other way to show a break, so a blank line has to become one");
  assert.ok(buildJournalText(s).includes("First thing.\n\nSecond thing."),
    "and the message keeps the same break");
});

test("an empty journal is still a document, and never invents a figure", () => {
  const s = sheetOf({ lines: [], totals: [], empty: "Nothing was sold in September 2026." });
  const text = buildJournalText(s);
  assert.ok(text.includes("Sales journal"), "it still says what it is");
  assert.ok(text.includes("Nothing was sold in September 2026."));
  assert.equal(/NaN|undefined|RM 0\.00/.test(text), false, "an empty book has no figure to print");

  const dom = journalSheetEl(s);
  assert.equal(moneyRows(dom).length, 0, "and no row of money at all");
  assert.equal(walk(dom).some((n) => n.textContent === "Nothing was sold in September 2026."), true);
});

test("an amount is carried as a number, never as a figure already written down", () => {
  // If a formatted string could get in here, the screen and the paper would be free to round
  // differently. Normalising on the way in is what closes that door.
  const s = journalSheet({ title: "x", lines: [{ what: "a", amount: "30.00" }], totals: [{ label: "Total", amount: "30" }] });
  assert.equal(s.lines[0].amount, 30);
  assert.equal(s.totals[0].amount, 30);
  assert.equal(typeof s.lines[0].amount, "number");
});

test("the sheet says whose books it is, in the shop's own name", () => {
  assert.equal(bakeryName({ settings: { storefront: { name: "  Jien Luv 2 Bake  " } } }), "Jien Luv 2 Bake");
  assert.equal(bakeryName({ settings: {} }), "Munchies Furkidz");
  assert.equal(bakeryName(null), "Munchies Furkidz");
});

test("every journal wears the same two presses, in the same order", () => {
  const btns = journalButtons(sheetOf());
  assert.deepEqual(btns.map((b) => b.textContent), ["Print", "Share"]);
  assert.equal(btns.every((b) => typeof b._listeners.click[0] === "function"), true);
});

// ── the Share press ─────────────────────────────────────────────────────────
//
// What this press hands over changed in v283, and the reason is the fault she reported: the
// share sheet opened on her phone with WhatsApp missing from it. A phone offers WhatsApp for a
// FILE and not always for a bare block of text, so the journal now leaves as a PDF.
//
// The order is asked of the phone rather than assumed, and every step below is one rung of that
// ladder. What each test pins is that a rung BELOW is never reached on her behalf.

// A phone's answers, installed for the length of one test and taken off again. `share` records
// what it was handed before it answers.
function phone({ canShareFiles, share, clipboard = true } = {}) {
  const heard = [];
  if (canShareFiles !== undefined) globalThis.navigator.canShare = () => canShareFiles;
  globalThis.navigator.share = (payload) => {
    heard.push(payload);
    return share ? share(payload) : Promise.resolve();
  };
  const copied = [];
  if (clipboard) globalThis.navigator.clipboard = { writeText: (t) => { copied.push(t); return Promise.resolve(); } };
  return {
    heard, copied,
    saved: () => globalThis.document.clicks,
    off() {
      delete globalThis.navigator.share;
      delete globalThis.navigator.canShare;
      delete globalThis.navigator.clipboard;
    },
  };
}

// Count what was turned into a downloadable address, and hand back a fake one — the shape of
// the save path, watched from the outside.
function saving() {
  const blobs = [];
  const real = URL.createObjectURL;
  URL.createObjectURL = (b) => { blobs.push(b); return "blob:test/1"; };
  return { blobs, off() { URL.createObjectURL = real; } };
}

const reset = () => { globalThis.document.clicks.length = 0; };

test("Share hands the phone the journal as a PDF FILE — the form WhatsApp offers itself for", async () => {
  // The whole point of v283. A file, named after the journal, carrying a real PDF.
  reset();
  const p = phone({ canShareFiles: true });
  try {
    await shareJournal(sheetOf());
    assert.equal(p.heard.length, 1, "one share, not a file and then a text as well");
    const payload = p.heard[0];
    assert.ok(Array.isArray(payload.files) && payload.files.length === 1, "a file, not a block of text");
    const file = payload.files[0];
    assert.equal(file.name, "Sales journal.pdf", "named so she can find it again in the chat");
    assert.equal(file.type, "application/pdf");
    assert.equal(payload.text, undefined, "she chose the document, not both");
    assert.ok(file.size > 0);
    const head = Buffer.from(await file.arrayBuffer()).toString("latin1");
    assert.ok(head.startsWith("%PDF-"), "and what is inside it really is a PDF");
    assert.ok(head.includes("Jien Luv 2 Bake"), "with her own letterhead on it");
    assert.equal(p.copied.length, 0, "a share that worked must not also copy");
  } finally { p.off(); }
});

test("a phone that cannot take a file is handed the text, so the journal still leaves the app", async () => {
  // The rung below the file. A phone that says no to `files` must not be left with nothing.
  reset();
  const p = phone({ canShareFiles: false });
  try {
    await shareJournal(sheetOf());
    assert.equal(p.heard.length, 1);
    assert.equal(p.heard[0].files, undefined, "no file was forced on a phone that refused one");
    assert.ok(p.heard[0].text.includes("Jien Luv 2 Bake — Sales journal"));
    assert.equal(p.copied.length, 0);
  } finally { p.off(); }
});

test("a phone that never says whether it takes a file is handed the text", async () => {
  // `canShare` is asked, never assumed: a phone without it is not one that has agreed.
  reset();
  const p = phone({});
  try {
    await shareJournal(sheetOf());
    assert.equal(p.heard.length, 1);
    assert.equal(p.heard[0].files, undefined);
    assert.equal(p.heard[0].title, "Sales journal");
    assert.ok(p.heard[0].text.includes("Jien Luv 2 Bake — Sales journal"));
  } finally { p.off(); }
});

test("her own cancel of the share sheet is a decision, not a fault", async () => {
  // The one behaviour here that would read as a bug: she opens the share sheet, changes her
  // mind, closes it — and the journal lands on her clipboard anyway. There are now TWO places
  // she can cancel (the file, then the text), and a cancel at either has to end it.
  const abort = new Error("cancelled"); abort.name = "AbortError";
  try {
    for (const canShareFiles of [true, false]) {
      reset();
      const p = phone({ canShareFiles, share: () => Promise.reject(abort) });
      try {
        await shareJournal(sheetOf());
        assert.equal(p.heard.length, 1,
          "her cancel ends it there — the journal is not offered again as text behind the sheet");
        assert.equal(p.copied.length, 0, "and nothing goes on the clipboard behind her back");
        assert.equal(p.saved().length, 0, "and no file is quietly saved to her phone");
      } finally { p.off(); }
    }
  } finally { reset(); }
});

test("a share that genuinely failed still gets the journal out", async () => {
  const s = saving();
  reset();
  const p = phone({ canShareFiles: false, share: () => Promise.reject(new Error("no handler")) });
  try {
    await shareJournal(sheetOf());
    assert.equal(p.heard.length, 1, "the share sheet was tried and it failed");
    assert.equal(p.saved().length, 1, "so the document is saved to her phone instead");
    assert.match(lastToast().textContent, /Saved as a PDF/);
    assert.equal(p.copied.length, 0, "the copy is the last resort, not the second one");
  } finally { p.off(); s.off(); reset(); }
});

test("a phone with no share sheet at all is given the file, not a block of text", async () => {
  // She asked for a document. On a phone that cannot share one, the honest answer is to put the
  // document on the phone, not to silently hand her something else.
  const s = saving();
  reset();
  const p = phone({});
  delete globalThis.navigator.share;
  try {
    await shareJournal(sheetOf());
    assert.equal(p.saved().length, 1, "one download");
    assert.equal(p.saved()[0].getAttribute("download"), "Sales journal.pdf");
    assert.equal(s.blobs.length, 1);
    assert.equal(s.blobs[0].type, "application/pdf", "the file that was saved is the PDF");
    assert.equal(p.copied.length, 0, "she asked for a document, so a document is what she gets");
  } finally { p.off(); s.off(); reset(); }
});

test("where even saving is impossible, the clipboard is the last resort", async () => {
  // The very bottom rung. Nothing else can work, so the text is what is left — the behaviour
  // the whole press had before v283, kept for the phone that can do nothing else.
  reset();
  const real = URL.createObjectURL;
  URL.createObjectURL = undefined;
  const p = phone({});
  delete globalThis.navigator.share;
  try {
    await shareJournal(sheetOf());
    assert.equal(p.copied.length, 1);
    assert.equal(p.copied[0], buildJournalText(sheetOf()),
      "what reaches the clipboard is the same text the share sheet would have been handed");
  } finally { p.off(); URL.createObjectURL = real; reset(); }
});

// ── the Print press ─────────────────────────────────────────────────────────

const lastToast = () => walk(screen.body)
  .filter((n) => String(n.className).includes("toast")).pop();

test("a press that cannot print says so, and names the press that can", () => {
  printJournal(sheetOf());
  assert.equal(walk(screen.body).filter((n) => String(n.className).includes("print-layer")).length, 0,
    "a press that cannot print leaves no layer behind, and no sheet either");
  assert.equal(walk(screen.body).some((n) => String(n.className).includes("journal-sheet")), false);
  assert.match(lastToast().textContent, /can't print — use Share instead/,
    "a control that silently does nothing reads as a broken screen");
});

test("Print builds the sheet in its own layer, and clears both away afterwards", () => {
  const handlers = {};
  let printed = 0;
  globalThis.window = {
    print() { printed += 1; },
    addEventListener(t, f) { (handlers[t] ||= []).push(f); },
    removeEventListener(t, f) { handlers[t] = (handlers[t] || []).filter((g) => g !== f); },
  };
  try {
    printJournal(sheetOf());
    assert.equal(printed, 1);
    const layer = screen.body.children.find((n) => String(n.className).includes("print-layer"));
    assert.ok(layer, "the sheet is built somewhere the stylesheet can find it on its own");
    assert.equal(layer.children[0].className, "journal-sheet");
    assert.equal(screen.body.classList.contains("journal-print"), true,
      "the body says a journal is printing, so print.css can hide the app");
    assert.equal(walk(layer).some((n) => n.textContent === "Sales journal"), true);

    // The browser says it has finished printing.
    assert.equal(handlers.afterprint.length, 1);
    handlers.afterprint.forEach((f) => f());
    assert.equal(screen.body.classList.contains("journal-print"), false,
      "a class left behind would hide the whole app the next time anything printed");
    assert.equal(layer.children.length, 0, "and the sheet does not linger in the tree");
    assert.equal(handlers.afterprint.length, 0, "the listener is taken off again");
  } finally {
    delete globalThis.window;
  }
});

test("a second Print press reuses the first press's own layer", () => {
  // The trap the strict getElementById in the shim exists to catch: two layers would mean
  // print.css hides one of them and the sheet that reached paper is the wrong one.
  let printed = 0;
  globalThis.window = { print() { printed += 1; }, addEventListener() {}, removeEventListener() {} };
  try {
    printJournal(sheetOf());
    printJournal(sheetOf({ title: "Cost of sales journal" }));
    assert.equal(printed, 2);
    const layers = walk(screen.body).filter((n) => String(n.className).includes("print-layer"));
    assert.equal(layers.length, 1, "one layer, whichever press built it");
    assert.equal(walk(layers[0]).some((n) => n.textContent === "Cost of sales journal"), true,
      "and it holds the sheet from the press that just happened, not the one before");
  } finally {
    delete globalThis.window;
  }
});
