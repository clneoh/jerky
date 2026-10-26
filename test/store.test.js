import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// ⚠️ THE STEPPER MOVED (v634): it now sits inside the card's price column, beside the price it changes, so a
// card's direct children no longer hold it. ⭐ These tests WALK the card instead of assuming a depth — a helper
// that hard-codes the tree shape fails the day the page is rearranged and blames the wrong thing.
const stepperIn = (card) => {
  let hit = null;
  const walk = (n) => {
    if (!n || hit || !n.children) return;
    for (const c of n.children) {
      if (c && String(c.className || "") === "stepper") { hit = c; return; }
      walk(c);
    }
  };
  walk(card);
  return hit;
};

// ★★ THE RECEIVED NOTICE NOW FOLLOWS HER ONE SECOND (v451). The fourth ball is greened and HELD on a timer
// before it, so a test that reads the notice must let that second pass — and one that does not leaves a
// pending timer that cancels the test outright (`cancelledByParent`).
//
// ⚠️⚠️ AND THE NUMBER IS READ, NOT COPIED (v427/v428's lesson). A fixed 1000 here would be a SECOND copy of
// the one number the shop keeps, and the two can only ever disagree one way. **The test asks the shop how
// long it holds**, so her number can change without this file silently testing yesterday's timing.
const afterOrderNotice = () => {
  const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  const m = /const GREEN_HOLD_MS = (\d+);/.exec(src);
  const held = m ? Number(m[1]) : 1000;
  return new Promise((r) => setTimeout(r, held + 150));
};

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
  // ⚠️⚠️ `classList` IS REAL NOW (v415). It was inert for a long time and that had a cost: the
  // STEP CIRCLES turn green by `classList.toggle("done", …)` and nothing else, so **the shop's own
  // three steps had never been tested at all** — and a rule the customer watches change was being
  // held up only by the changelog. ⭐ A shim that cannot express what the view does cannot test it.
  // ⚠️ Backed by `className`, so an assertion can read either and they cannot disagree.
  let node = null;
  const classes = () => String((node && node.className) || "").split(/\s+/).filter(Boolean);
  const setClasses = (a) => { if (node) node.className = a.join(" "); };
  node = {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false,
    // ⚠️ A REAL DOM NODE'S `hidden` DEFAULTS TO `false`, and this shim had none at all (v436) — so a
    // freshly made element answered `undefined`, and "is the question up?" was neither true nor
    // false. ⭐ Anything asserted before the view has touched it has to start from the real default.
    hidden: false,
    scrollTop: 0, _listeners: {},
    classList: {
      add(c) { const a = classes(); if (!a.includes(c)) { a.push(c); setClasses(a); } },
      remove(c) { setClasses(classes().filter((x) => x !== c)); },
      toggle(c, on) {
        const want = on === undefined ? !classes().includes(c) : !!on;
        if (want) node.classList.add(c); else node.classList.remove(c);
      },
      contains(c) { return classes().includes(c); },
    },
    parentElement: null,
    // ⚠️⚠️ `parentNode` IS THE REAL DOM'S OWN NAME FOR WHAT THIS SHIM CALLS `parentElement` (v459). The
    // shop moves the refusal line with `insertBefore(note, near)` and reads `near.parentNode` — **a
    // standard browser property this shim simply did not have.** ⭐ So the move quietly fell back to the
    // other placement, and my assertion about WHERE the line lands was, without the shim saying a word,
    // asserting nothing. ⚠️ **A shim missing a property the view actually uses is not a smaller DOM, it is
    // a different one** — the rule this file has already paid for with `classList`, `removeEventListener`
    // and `hidden`.
    get parentNode() { return this.parentElement; },
    // ⚠️ AND NEITHER DID THIS ONE (v459) — and this time it was the VIEW reading it, not only the test:
    // `sayStepFirst` asks `note.nextSibling !== before` before moving the line. ⭐ With the property
    // missing that guard was always true, so the shop re-inserted on every keystroke and **the test
    // asking "is the line directly above the card he touched?" got `undefined` and could not say.**
    get nextSibling() {
      const p = this.parentElement;
      if (!p || !Array.isArray(p.children)) return null;
      const i = p.children.indexOf(this);
      return i >= 0 && i + 1 < p.children.length ? p.children[i + 1] : null;
    },
    // ⚠️⚠️ AND THE OTHER DIRECTION (v493), FOR EXACTLY THE REASON ABOVE. The refusal now asks
    // `note.previousSibling !== head` before moving itself under a step heading — ⭐ **with the property
    // missing that guard was always true, so the shop would re-insert the line on every refusal, and the
    // test asking "is the line directly under the step it is about?" read `undefined` and could not say.**
    // ⚠️ `null` when there is nothing before it, as the real DOM does — never `undefined`.
    get previousSibling() {
      const p = this.parentElement;
      if (!p || !Array.isArray(p.children)) return null;
      const i = p.children.indexOf(this);
      return i > 0 ? p.children[i - 1] : null;
    },
    appendChild(c) { if (c != null) { c.parentElement = this; this.children.push(c); } return c; },
    append(...cs) { for (const c of cs.flat()) this.appendChild(c == null ? { nodeType: 3, text: "null" } : c); },
    // ⚠️⚠️ THIS SHIM HAD NO `insertBefore` AT ALL UNTIL v459, and that mattered the moment the shop began
    // MOVING the refusal line instead of leaving it where the markup put it: **the view quietly fell back
    // to the other placement, and a test asserting WHERE the line lands was asserting nothing.** ⭐ It was
    // found by the assertion failing, not by reading — and the answer was to fix the shim, not the claim.
    // ⭐ Like the real one, it takes the node OUT of wherever it was first: that is what makes
    // `nextSibling` — and therefore "is it directly above the card he touched?" — an honest question.
    insertBefore(n, ref) {
      const prev = n && n.parentElement;
      // ⚠️⚠️ AND IT TAKES THE NODE OUT OF **THIS** PARENT TOO, NOT ONLY OUT OF ANOTHER ONE (v493).
      // **The real `insertBefore` is a MOVE even when the node is already here** — this shim only removed it
      // when the parent was DIFFERENT, so re-inserting a node that was already a child **appended a SECOND
      // ENTRY for the same node.** ⭐ MEASURED: `document.body.children` held FIVE entries for one
      // `#step-note`, and the assertion asking "is the line directly under step 2?" read the first copy and
      // answered no — a failure that had nothing to do with the view. ⚠️ A shim that cannot express what the
      // real DOM does cannot test it: the same lesson as `parentNode`, `nextSibling` and `scrollIntoView`
      // above, and this one had been sitting there since v459.
      if (prev && Array.isArray(prev.children)) {
        const i = prev.children.indexOf(n);
        if (i >= 0) prev.children.splice(i, 1);
      }
      n.parentElement = this;
      const at = ref ? this.children.indexOf(ref) : -1;
      if (at >= 0) this.children.splice(at, 0, n); else this.children.push(n);
      return n;
    },
    replaceChildren(...cs) {
      // ⚠️⚠️ THE REAL ONE DETACHES WHAT IT THROWS AWAY, AND THIS SHIM DID NOT (v460). ⭐ So an element the
      // menu had just emptied out still answered `parentElement` as the menu — **a false PASS for "is it
      // still in the menu?", which is exactly the question her vanishing warning turned on.** ⭐ Without
      // this, the test below would have gone green over the very fault it exists to catch.
      for (const old of this.children) if (old && old.parentElement === this) old.parentElement = null;
      this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) }));
      // ⚠️ The real one re-parents what it is given, which is what makes `closest` — and therefore
      // the card this view puts its edge on — reachable from a row. Without it every freshly drawn
      // row read as parentless and `closest` answered null.
      for (const c of this.children) c.parentElement = this;
    },
    closest(sel) {
      const want = String(sel || "").replace(/^\./, "");
      let n = this;
      while (n) {
        if (String(n.className || "").split(/\s+/).includes(want)) return n;
        n = n.parentElement;
      }
      return null;
    },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    // ⚠️⚠️ A REAL `removeEventListener` — it was a NO-OP until v436, and a no-op cannot express what
    // the shop now does. **The confirmation adds its own handlers on every open and takes them off
    // again on close**; with the removal missing, the SECOND question would still carry the FIRST
    // one's answer, and pressing "change" would run two handlers for one press. ⭐ **A shim that
    // cannot express what the view does cannot test it** — the same lesson this file already records
    // twice above, and the gap was in the shim rather than in the view.
    // ⚠️ By REFERENCE, as the real DOM does: `askSwitch` builds fresh closures each time, so only
    // the identical one it handed back is removed.
    removeEventListener(t, f) {
      const a = this._listeners[t];
      if (!a) return;
      const i = a.indexOf(f);
      if (i >= 0) a.splice(i, 1);
    },
    // ⚠️ THE REAL DOM KEEPS `dataset` AND `data-*` ATTRIBUTES IN STEP, and this shim did not
    // (v407): `el()` writes `data-point-id` with setAttribute, so `b.dataset.pointId` — which is
    // how the shop marks the chosen collect-from row — read `undefined` here and would never have
    // matched in a test. **A shim that cannot express what the view does cannot test it**, and the
    // gap was in the shim rather than in the view. Anything that is not a `data-` attribute is
    // left exactly as it was.
    setAttribute(k, v) {
      this.attrs[k] = String(v);
      const m = /^data-([a-z0-9-]+)$/.exec(k);
      if (m) this.dataset[m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = String(v);
    },
    getAttribute(k) { return this.attrs[k]; },
    focus() {}, click() {},
    // ⚠️⚠️ AND A NODE CAN BE TAKEN BACK OUT OF THE PAGE (v495). The offer that puts the page back for the
    // next customer is removed once it is dealt with — by the press, or by the shop doing it by itself —
    // and ⭐ **a shim with no `remove` leaves it on the page for ever, so "the offer comes down" was an
    // assertion that could neither pass nor say why.** Same rule as `parentNode` and `scrollIntoView`
    // above: the shim has to be able to express what the view does.
    remove() {
      const p = this.parentElement;
      if (p && Array.isArray(p.children)) {
        const i = p.children.indexOf(this);
        if (i >= 0) p.children.splice(i, 1);
      }
      this.parentElement = null;
    },
    // ⚠️⚠️ THE SHIM HAD NO `scrollIntoView` AT ALL (v462), so **every "did the page go there?" question was
    // silently answered by the guard in the view** — and a test could not ask it. ⭐ The real one records
    // what it was asked, which is what makes "the page is carried to the missing box" an assertion rather
    // than a hope. Same rule as `insertBefore` and `parentNode` before it.
    scrollIntoView(opts) { this.scrolled = opts; },
    // ⚠️⚠️ AND IT CAN BE ASKED WHERE IT IS (v493) — the shim could not, until now. The refusal carries the
    // page to a step ONLY when that step is not already on screen, so "did the page go there?" became a
    // question about GEOMETRY; ⭐ and with no `getBoundingClientRect` on the node, `bringIntoView` bails on
    // its first line — **so every assertion about the page being carried to a step would have been proving
    // the guard rather than the view.** Same lesson as `scrollIntoView` and `removeEventListener` above.
    // ⚠️ The default is WELL BELOW the viewport, which is the real case being pinned (a customer at the
    // menu, with step 1 far above him). A test that wants the other case sets `.rect` itself.
    getBoundingClientRect() {
      return this.rect || { top: 9000, bottom: 9040, left: 0, right: 0, width: 320, height: 40 };
    },
  };
  return node;
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
  // ★★★ A NODE FOUND BY ID CARRIES THAT ID (v455) — the shim did not, and it cost a real assertion.
  // ⚠️⚠️ **A shim that cannot express what the view does cannot test it** — the standing rule for this
  // suite. The shop builds the field-note's id from the INPUT's own id (`${input.id}-note`) and ties the
  // two with `aria-describedby`; with `id` undefined the shim produced `"undefined-note"` and the
  // accessibility assertion could never pass, however correct the page was.
  getElementById: (id) => {
    const node = (registry[id] ||= createEl("div"));
    node.id = id;
    return node;
  },
  querySelector: () => null,
  querySelectorAll: () => [],
  body: createEl("body"),
  // ⚠️⚠️ AND THE ONE NODE EVERY BROWSER HAS (v497). **`store/app.js`'s last block — the privacy notice's
  // press, the language pills' paint, the shop's own "a newer version is ready" press, and the listening
  // for the page being looked at again — is guarded by `document.documentElement`.** ⭐ Without this the
  // WHOLE block was skipped in this file, silently: ⚠️ **five bindings the shop makes in a browser were
  // never made here, so no test in this file could reach any of them.** ⭐ MEASURED — a test that pressed
  // the shop's "someone looked at my page again" path found no listener bound at all, and the shim was the
  // reason, not the shop. Same rule as `parentNode`, `remove()` and `scrollIntoView` before it.
  documentElement: createEl("html"),
  // The REAL document has these. A shim without them is not a smaller DOM, it is a
  // different one: the shop registers a visibilitychange listener at start-up (v292),
  // and a missing method is a TypeError at import — every store test dies at once.
  _docListeners: {},
  addEventListener(t, f) { (this._docListeners[t] ||= []).push(f); },
  removeEventListener() {},
};
// ⚠️ `innerHeight` BECAUSE THE SHOP NOW ASKS IT (v493) — the refusal moves the page only when the step
// it names is not already on screen, and "on screen" is measured against the viewport. ⭐ A window shim
// without it would make every element read as OFF screen and hide the case that must not scroll.
globalThis.window = {
  open() {},
  innerHeight: 800,
  // ⚠️⚠️ THE PAGE'S OWN SCROLL POSITION (v495), AND A WAY TO MOVE IT. The shop now asks where the page is
  // resting after an order and puts it back at the top a minute later — so a shim without `scrollY` and
  // `scrollTo` **cannot express either half of that rule**, and a test for it would be asserting nothing.
  // ⭐ Same lesson as `scrollIntoView`, `getBoundingClientRect` and `parentNode` before it.
  scrollY: 0,
  scrollTo(arg) { this.scrollY = typeof arg === "object" && arg !== null ? Number(arg.top) || 0 : Number(arg) || 0; },
  // ⚠️ AND ITS OWN LISTENERS (v495) — the shop binds `focus` here, once. A window with no `addEventListener`
  // silently skipped that binding, so the whole "someone looked at the page again" path was unreachable.
  _listeners: {},
  addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
};
// ★★★ AND A PAGE THE SHOP CAN ACTUALLY CLEAR (v498). ⭐ Her word for four versions: __"no reload"__.
// ⚠️ The offer used to SCROLL the page and call itself "Back to the top" — **my words for my action** —
// while what she asked for, in her very first message, was a pop-up **offering to clear the page**.
// ⭐ So the shop calls `location.reload()` now, and **a test that cannot see a reload cannot tell the two
// apart.** ⚠️ Installed once and counted per test; one other test in this file saves and restores it.
let reloads = 0;
globalThis.location = { search: "", reload: () => { reloads += 1; } };
const reloaded = () => reloads;

// ⚠️⚠️ THE STEP HEADS **AND THEIR FIELDS** NEED A PARENT, AND THEY NEED IT IN EVERY TEST (v493). The
// refusal is put directly BELOW the field of the step it names with `insertBefore`, and the shim's registry
// hands back ORPHAN nodes whose `parentNode` is null — ⭐ **so without this the move is silently skipped,
// the line stays wherever the last test left it, and an assertion about WHERE it lands is asserting
// nothing.** Same rule as `parentNode`, `insertBefore` and `previousSibling` above: a shim that cannot
// express what the view does cannot test it. The ids are read from the shop's own markup, so a renamed
// field cannot leave this quietly parenting nothing.
const STEP_FIELD_IDS = [...readFileSync(new URL("../store/app.js", import.meta.url), "utf8")
  .matchAll(/STEP_FIELD\s*=\s*\{([^}]*)\}/g)]
  .flatMap((m) => [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]));
for (const id of ["step1", "step2", "step3", ...STEP_FIELD_IDS]) {
  const n = document.getElementById(id);
  if (!n.parentElement) document.body.appendChild(n);
}

// store/config.js carries this business's own Supabase url + anon key; stub fetch
// so the module-level render() hits no network.
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

const { buildMessage, mergeStorefront, upcomingDates, daySpecs, dateKey, fmtDay, windowTitle, trackOrder, isOpen, todayStillOpen, postsOn, dayAsk, waNumber, phoneText, parseVia, clockWords, waPlausible, renderStatic, render } = await import("../store/app.js");
const { strictestCancelDays } = await import("../store/pool.js");
const { CONFIG } = await import("../store/config.js");
// v270: the shop's own line and its refusals, kept as pure functions so they are
// judged here rather than by looking at a phone.
const { clauseWords, dayWords, ownWords, rememberShopOrder, shopMemo, shopVerdict, softVerdict, standingToday, standingNext, turnsAtAll } = await import("../store/app.js");
const { STORE } = await import("../store-lang.js");

// The cut-off time as the page prints it: the app stores it 24-hour (Settings'
// cut-off box is an <input type="time">) and the shop says it out loud — the
// owner asked for "6pm the day before posting" on 21 Sep 2026, where the card
// had been reading "18:00 the day before".
// ⚠️⚠️ THIS TEST COMES FIRST, AND IT HAS TO. It asserts what the shop does on a COLD page — the
// very first press, with nothing chosen — because the rule it pins is *the refusal names the FIRST
// step outstanding, not a later one*, and "first" only means anything from the start.
//
// ⚠️ `dayPicked` (step 1's question) is state inside the shop, and every test that drives the
// basket has to tap a day first — the step lock refuses `+` until one is picked. **So this test
// cannot run after any of them**, and it was silently reading a day an earlier test had tapped: the
// refusal correctly said "pick something from the menu" while the assertion was asking about step 1.
// ⭐ It passed alone and failed in the file, which is the shape of an order-dependent test.
//
// ⭐ Run first, its precondition is the file's own starting state rather than a hope.
test("★★★ the FIRST step outstanding is said, in his order — never a dead button (v452)", async () => {
  // ⚠️⚠️ HER WORDS: __"when we proceed order step by step, one after another, if the previous step not
  // completed user should be inform accordingly"__
  //
  // ⭐ AND TWO THINGS WERE WRONG. The button was DISABLED on an empty basket — and **a disabled button on a
  // phone does not even acknowledge the tap**, so a customer who reached the bottom was told nothing at all,
  // while the press's own comment twenty lines away already said *"THE BUTTON IS NEVER DISABLED"*. And the
  // press **returned silently** when there was nothing to order.
  //
  // ⚠️ THE ORDER OF THE MESSAGES IS THE POINT OF THIS TEST, not just their presence: a message about step 3
  // shown to somebody who has not done step 2 sends him BACKWARDS down the page to fix something it was not
  // yet asking him for. **So the guard stops at the first thing missing, and the assertions read top down.**
  const press = async () => { await registry["order-btn"].onclick(); };
  // ⚠️ THE ONE LINE A STEP REFUSES WITH (v493) — under the step's own heading, never a banner.
  const textOfNode = (n) => {
    if (!n) return "";
    if (n.children && n.children.length) {
      return n.children.map((c) => (c.nodeType === 3 ? String(c.text || "") : textOfNode(c))).join("");
    }
    return String(n.textContent || "");
  };
  const stepLine = () => textOfNode(registry["step-note"]);
  // ⚠️ A FIELD'S REASON IS SET WITH `textContent` (see `markField`), NOT WITH CHILDREN — and the shim's
  // `getElementById` hands back the same object every time, so this is the box's own note and not a copy.
  const fieldNote = (id) => String((registry[id] || {}).textContent || "");
  // ⚠️ AND WHETHER THE FOOT-OF-PAGE BANNER WAS USED AT ALL. `#confirm-msg` may never have been asked for in
  // this test, so it is read defensively — the question is "was anything put in it", not "does it exist".
  const bannerLines = () => ((registry["confirm-msg"] || {}).children || []).length;

  // ── nothing at all: the button is LIVE and says where to start
  assert.equal(registry["order-btn"].disabled, false,
    "★ the button is dead on an empty basket again — it must answer instead");
  await press();
  // ★★★ AND IT NAMES STEP 1, BECAUSE STEP 1 IS WHAT IS MISSING (v493). ⚠️⚠️ HER WORDS: __"when step 1 is
  // skip, it should always go back to step1"__ — ⭐ **the refusal names the FIRST step that is not done, not
  // the step the control belongs to.** Before this, this press was answered with a sentence about the
  // BASKET while the bake day was the thing he had not chosen — and the three circles beside it said step
  // 1, so the page was disagreeing with itself about one order.
  assert.match(stepLine(), /Choose your posting day first/,
    "★ the first thing outstanding was not named — the refusal is answering about a later step");
  assert.equal(registry["step-note"].previousSibling, registry["dates"],
    "★ the line is not under the calendar — the field step 1 is filled in with");
  assert.deepEqual(registry["step-note"].scrolled,
    { block: "center", behavior: "smooth" },
    "★★ the page was not carried to the line — he is told off out of sight, which is exactly the fault "
    + "the old foot-of-page banner was supposed to fix and made worse");
  assert.equal(bannerLines(), 0,
    "★ the foot-of-page banner is back — one refusal, one surface");

  // ── and with the day chosen, the SAME press names step 2 — the basket
  tapDay();
  await press();
  assert.match(stepLine(), /Pick something from the menu above/,
    "★ with step 1 done, an empty basket was refused without telling him what to do");
  assert.equal(registry["step-note"].previousSibling, registry["menu"],
    "★ the line is not under the menu — the field step 2 is filled in with");

  // ── an item, and nothing else: HIS NAME FIRST, because the page asks it first
  const stepper = stepperIn(registry["menu"].children[0]);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  stepper.children[2]._listeners.click[0](); // "+"
  await press();
  // ★★★ THE NAME IS ASKED FOR ON THE BOX ITSELF, NOT IN A POP-UP (v455). Her words: __"the message show in
  // the wrong place and the screen jump, it should shown up at the appropriate place, or the missing field
  // turn red embossed, or how a form filling would behave"__ ⭐ **So this asserts the FIELD, not a notice** —
  // an assertion that only looked for a sentence would pass over a page with no red box at all.
  const nameBox = registry["name-input"];
  assert.ok(String(nameBox.className || "").includes("bad"),
    `★ the empty name box did not mark itself (it is "${nameBox.className}")`);
  // ⚠️ AND IT IS TIED TO THE BOX, not merely near it (v455). The skill's 1.6 names *"a label not tied"* as
  // one of the costliest hand-written-site faults — so the assertion is the TIE, not the proximity.
  assert.match(String(nameBox.attrs?.["aria-describedby"] || ""), /name-input-note/,
    "★ the reason is not tied to the box for a screen reader — only sighted customers would get it");
  assert.equal(nameBox.attrs?.["aria-invalid"], "true", "★ the box is not marked invalid");
  // ⚠️⚠️ AND THE REASON UNDER IT BLINKS (v462). Her report: __"i skip step 3, go for step4, not warning"__ —
  // ⭐ **the warning WAS there: the box turned red with its reason underneath it.** ⚠️ **But it was a STILL
  // red edge, a screen up from the button she had just pressed, and nothing about it moved — so it read as
  // no warning at all.** ⭐ A warning that does not move is a warning she has to be looking for.
  const reason = registry["name-input-note"];
  assert.ok(reason, "the reason under the box was never drawn, so nothing below proves anything");
  assert.ok(String(reason.className).includes("flash"),
    "★ the reason appeared WITHOUT BLINKING — a still red edge is exactly what she reported as no warning");
  // ⚠️⚠️ AND THE PAGE IS CARRIED TO THE BOX (v462). **MEASURED ON THE REAL SHOP: the reason sat 825 PIXELS
  // ABOVE the button she had pressed** — and a flashing line she cannot see is still a line she cannot see.
  // ⚠️ v455 said *"the page does not move"*, and that was right for a message appearing ON ITS OWN. ⭐ **This
  // is not that: she pressed a button and the form is answering her, which is how a form behaves.**
  const carried = nameBox.scrolled;
  assert.ok(carried, "★ the page was NOT carried to the box that is missing, so he is told off out of sight");
  assert.equal(carried.block, "center",
    "★ the box was put somewhere other than the middle of the screen — under the bar fixed to the foot is no use");
  assert.ok(!String(registry["whatsapp-input"].className || "").includes("bad"),
    "★ he was sent to his NUMBER while a still-earlier step was the one outstanding");

  // ── a name, still no number
  document.getElementById("name-input").value = "Aunty Bee";
  await press();
  // ★★★ AND THE NUMBER ANSWERS THE SAME WAY THE NAME DOES (v493). ⚠️⚠️ Her rule 3 is the whole reason:
  // __"step 3 not fill up … screen will scroll to the field below it and flash the warning"__. ⭐ The name
  // box has done exactly that since v455/v462; **the number box used a BANNER at the very foot of the page
  // instead — two ways of saying one sentence inside one step.** ⭐ That banner is retired and the box now
  // behaves as the box above it does, **with both sentences, so he is told what is missing AND why.**
  const waBox = registry["whatsapp-input"];
  assert.ok(String(waBox.className || "").includes("bad"),
    `★ the empty number box did not mark itself (it is "${waBox.className}")`);
  assert.match(fieldNote("whatsapp-input-note"), /WhatsApp number/i,
    "★ the box says nothing about the number it wants");
  assert.match(fieldNote("whatsapp-input-note"), /confirm your order/i,
    "★ the second half of the banner's sentence was dropped with the banner — he is told what is missing "
    + "and not why the bakery needs it");
  assert.ok(String(waBox.className).includes("bad") && waBox.scrolled,
    "★ the number box did not carry the page to itself");
  assert.equal(bannerLines(), 0, "★ the banner is back for the number");

  // ── a number, still no way of getting it
  document.getElementById("whatsapp-input").value = "60123456789";
  await press();
  // ⚠️ MUNCHIES HAS NO "HOW WILL YOU GET IT" STEP (v609): posting is the default, so the way is never
  // empty and the step that is outstanding next is the ADDRESS the order is posted to.
  assert.ok(String(document.getElementById("address-input").className || "").includes("bad"),
    "★ the postal address was not asked for, though a posted order cannot leave without one");
});


// ★★★ THE STEP LOCK IS REAL NOW (v454), so a test that adds to the basket must FIRST do what a customer
// must: tap a posting day. ⚠️⚠️ **I wrote this lock once before and REVERTED it when exactly these tests failed
// — which is why the feature stayed unbuilt and she had to ask twice.** ⭐ **The tests move with the
// behaviour; the behaviour does not move back for the tests.**
function tapDay() {
  let hit = null;
  (function walk(n) {
    for (const c of (n.children || [])) {
      // ⚠️⚠️ AN **OPEN** DAY — the shop can only take an order for a day it really posts. A bare
      // `tappable` also matches a CLOSED or askable day: the tap lands, `dayPicked` stays false,
      // and the step lock refuses every `+`, so the basket reads empty and the test fails for a
      // reason that has nothing to do with what it is testing.
      if (c.tagName === "BUTTON" && String(c.className || "").includes("cal-cell")
        && String(c.className || "").includes("tappable")
        && String(c.className || "").includes("avail")) { hit = hit || c; return; }
      walk(c);
    }
  })(registry["dates"]);
  if (hit && hit._listeners && hit._listeners.click) hit._listeners.click[0]();
  return !!hit;
}

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

// ⚠️⚠️ EVERY WORD ON THE RECEIPT, WALKED (v498). ⭐ The offer is ONE CARD now — a box holding its sentence
// and its button — and `confirmLines()` reads only a child's first text node, **so the card came back as
// `undefined` and the test said the offer had never appeared when it was sitting right there.** ⭐ The same
// shape as the step line's own reader: what a test reads has to be able to see what the view draws.
function receiptText() {
  const walk = (n) => (n.nodeType === 3 ? String(n.text || "")
    : (n.children || []).map(walk).join(" "));
  return walk(registry["confirm-msg"] || { children: [] });
}

// The receipt's own lines, as plain strings, from the confirm box.
function confirmLines() {
  return registry["confirm-msg"].children.map((n) => (n.children[0] ? n.children[0].text : n.textContent));
}

// ── the privacy notice's contact number (v348) ───────────────────────────────
// The notice prints a number rather than only building a link, and the number is
// read from the same setting the order button uses. This is the formatting step:
// a mis-grouped Malaysian number is the kind of thing that looks like a typo in a
// document whose entire job is to look trustworthy.
test("the privacy notice's number is written the way a person reads it", () => {
  assert.equal(phoneText("60169601268"), "+60 16-960 1268");
  assert.equal(phoneText("0169601268"), "+60 16-960 1268", "a local number is read the same way");
  assert.equal(phoneText("+60 16-960 1268"), "+60 16-960 1268", "and one already written out is unchanged");
  assert.equal(phoneText(""), "", "no number set means nothing to show");
  assert.equal(phoneText(null), "");
  // Anything that is not an 11-digit Malaysian number is shown plainly rather than
  // grouped into a shape it does not have.
  assert.equal(phoneText("+1 415 555 0100"), "+14155550100");
});

// ── the spare copy of the shop's settings has to be REAL (v346) ──────────────
// store/config.js is only a fallback — the published settings override it — so a
// fault in it is invisible for as long as the cloud answers. It is also what the
// shop shows at the one moment it matters: when the published settings cannot be
// reached, which is when an order cannot be placed either. It shipped the notes'
// own EXAMPLE WhatsApp number, 60123456789, which belongs to a stranger, and a
// menu with a product and a price the shop does not sell. Neither could be seen
// on any screen while the cloud was up.
test("the shop's fallback settings are real, not the notes' examples", () => {
  assert.notEqual(CONFIG.whatsapp, "60123456789",
    "the fallback WhatsApp number is her real number, not the example written in the comment above it");
  assert.match(String(CONFIG.whatsapp), /^60\d{8,10}$/,
    "and it is a Malaysian number in the shop's own digits-only format");
  assert.ok(CONFIG.products.length > 0, "and there is a menu to fall back to at all");
  for (const p of CONFIG.products) {
    assert.ok(String(p.name || "").trim(), "every fallback product is named");
    assert.ok(Number.isFinite(p.price) && p.price > 0,
      `and carries a real price: ${p.name} is ${p.price}`);
  }
});

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

test("★★★ today's bake is only 'closed' when she actually bakes today", () => {
  // ⚠️⚠️ THE FAULT (v549): the heading asked "is it still before the deadline for a bake TODAY?" — and that
  // deadline is YESTERDAY at 18:00, so it was false every day of the year. ⭐ The shop said **"Today's bake
  // has closed"** on a Sunday the bakery never bakes, and **"You're in time" could never appear at all.**
  const cfg = { cutoff: "18:00", deliveryDays: [1, 3, 5] };
  // Sunday 18 Oct 2026, 00:08 — not one of her days.
  assert.equal(todayStillOpen(cfg, new Date(2026, 9, 18, 0, 8)), true,
    "★ a day she does not bake was reported as a bake that has closed — **there is no bake to close**");
  // Monday 19 Oct 2026, 10:00 — a bake day, and its cut-off was Sunday 18:00.
  assert.equal(todayStillOpen(cfg, new Date(2026, 9, 19, 10, 0)), false,
    "precondition: once the bake day arrives, ordering for it has closed");
  assert.equal(todayStillOpen({ cutoff: "" , deliveryDays: [1, 3, 5] }, new Date(2026, 9, 19, 10, 0)), true,
    "with no cut-off at all there is nothing to have closed");
  // ⚠️⚠️ AND HER PUBLISHED DAYS OUTRANK THE WEEKDAY (v599). ⚠️ v598 OR-ed the pattern in, so a Wednesday she
  // had DELETED still read "You're in time" — ⚠️ **the page offered a bake she had taken off.** ⭐ When rows
  // exist, the row is the answer; the pattern is only for the no-rows fallback (`undefined`).
  const wed = new Date(2026, 9, 21, 9, 0); // Wed 21 Oct, a weekday-bake day
  assert.equal(todayStillOpen(cfg, wed, false), true,
    "★ a deleted bake day was reported as a bake that has closed (or is still open) because it was a Wednesday");
  assert.equal(todayStillOpen(cfg, wed, true), false, "a day that IS in her rows still closes at its cut-off");
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
  // One card per product — read off the config rather than asserted against a
  // number that meant "the sample menu happened to hold two" (v347).
  assert.equal(registry["menu"].children.length, CONFIG.products.length);
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
  // ★ IT IS THE POSTING DAY, NOT THE DELIVERY DAY (v407). ⚠️ This line pinned the old word for two
  // versions, so it is asserted against the dictionary rather than a second copy of the English:
  // the page and this test cannot drift apart again.
  //
  // ⚠️⚠️ AND SINCE v434 THE LINE HAS TWO FORMS, which is why this is no longer a `startsWith`.
  // A day chosen FOR him says so; a day he chose himself reads plainly. **This test taps nothing,
  // so it draws the first of the two** — and the check is written so it holds for either, by
  // splitting the dictionary's own wording on its `%1` and demanding the day sits in that gap.
  // ⭐ A prefix check would have been silently vacuous for the new line, whose `%1` comes FIRST.
  const said = chosen.children[0].text;
  const fits = [STORE.en.calChosen, STORE.en.calChosenFor].some((f) => {
    const [before, after] = f.split("%1");
    return said.startsWith(before) && said.endsWith(after);
  });
  assert.ok(fits, `the calendar names the chosen day in the shop's own words (it reads: ${JSON.stringify(said)})`);
  assert.ok(!/delivery day/i.test(said),
    "and never calls it a delivery day — a customer collecting his own bread did not recognise the day");
  // "First OPEN", not simply "first": a posting day whose cutoff has gone by is
  // dropped from the customer's calendar entirely, so the day named is the first
  // one still orderable. Asking isOpen the same question the shop asks keeps this
  // true whatever hour the suite happens to run at — at 21:17 on the day before a
  // 18:00 cutoff, tomorrow is already shut.
  const firstOpen = upcomingDates(CONFIG).find((d) => isOpen(CONFIG, d));
  // ⚠️ "The one NAMED", not "the one it ends with" (v434): the two forms of the line put the day in
  // different places — `Your posting day: <day>` puts it last, and `<day> is suggested for you…` puts
  // it first, because that is how she wrote the sentence. **What has to hold for both is that the
  // first open day is the day it names.**
  assert.ok(chosen.children[0].text.includes(fmtDay(firstOpen)), "the first open day is the one named");

  // ★★ AND IT IS NEVER DISABLED — THE BUTTON ANSWERS INSTEAD (v452). Her standing rule, written in the
  // press's own comment and contradicted by the line that used to be here: *"THE BUTTON IS NEVER DISABLED —
  // a site rule must not hide or block a sale."* ⚠️ A disabled button on a phone does not even acknowledge
  // the tap, so a customer who reached the bottom was told nothing at all. ⭐ **This now pins the LIVE button
  // rather than its absence** — an assertion of absence would pass for a page that had simply lost its button.
  assert.equal(registry["order-btn"].disabled, false,
    "★ an empty cart left the Place order button dead — it must answer with the first step outstanding");
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
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "courier";
    // ★★★ AND A COURIER ORDER WITH NO ADDRESS MUST NOT POST (v548). ⚠️⚠️ It used to: the shop asked for a
    // name, a number and the way it travels, and then posted `address: ""` — ⭐ **an order she cannot
    // deliver, for a fact the page had already shown a box for.** ⭐ The refusal is the phone rule, not a
    // disabled button: the box is marked and says why, and nothing is sent.
    await registry["order-btn"].onclick();
    assert.equal(posted, null,
      "★ a courier order with NO ADDRESS was posted — **the rider has nowhere to go**");
    assert.ok(String(document.getElementById("address-input").className || "").includes("bad"),
      "★ the address box was not marked, so the customer was not told what was missing");
    document.getElementById("address-input").value = "12 Jalan Bunga";
    await registry["order-btn"].onclick();
    await afterOrderNotice(); // ★ the notice follows her one second (v451)
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
    // ★★★ AND THE MENU CARDS GO BACK TO ZERO WITH THE BASKET (v549). ⚠️⚠️ The reset emptied the basket
    // and left every card's stepper showing the last customer's number: the bar read "0 items / RM0.00"
    // while the card beside it still said 1. ⭐ Two things on one screen saying different numbers is the
    // fault this shop has fixed more than any other.
    const stepperAfter = stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body"));
    assert.equal(String(stepperAfter.children[1].value), "0",
      "★ the menu still shows the last customer's quantity while the bar says 0 items — **the next "
      + "customer would order from a number he did not choose**");
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

test("★★★ a repaint during the send does not re-open Place order", async () => {
  // ⚠️⚠️ THE FAULT: the press disabled the button for the send, and the bar set it back to ENABLED on every
  // repaint. ⭐ **A language tap, a "+", or the 30-second refresh landing during a slow send turned it back
  // on — and a second press posted the SAME ORDER AGAIN.** ⭐ The one disable the shop keeps is the one that
  // stops a slow network making him order twice, so it must survive a redraw.
  const stepperNow = () => stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body"));

  tapDay();
  stepperNow().children[2]._listeners.click[0]();        // "+" — one item in the basket
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("fulfillment")._value = "courier";
  document.getElementById("address-input").value = "12 Jalan Bunga";

  let release = null;
  let posts = 0;
  const gate = new Promise((r) => { release = r; });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posts += 1; await gate; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    const flying = registry["order-btn"].onclick();
    // a repaint while the order is still in flight — the "+" press redraws the bar
    stepperNow().children[2]._listeners.click[0]();
    assert.equal(registry["order-btn"].disabled, true,
      "★ a repaint re-opened Place order while the order was being sent — **a second tap posts the same "
      + "order twice**");
    release();
    await flying;
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(posts, 1, "★ the order was posted more than once");
  await afterOrderNotice();
});

test("★★★ a product that leaves the menu takes the basket with it, and the press says why", async () => {
  // ⚠️⚠️ THE FAULT: the menu is replaced wholesale on the 30-second refresh. A product the bakery renamed
  // or removed vanished from the page, **the basket kept its name**, and at Place order `lines` came out
  // empty while step ② still read done — ⭐ **so the press did nothing at all: no order, no message.**
  const saved = CONFIG.products.slice();
  const stepperNow = () => stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body"));
  let posts = 0;
  const realFetch = globalThis.fetch;
  try {
    tapDay();
    stepperNow().children[2]._listeners.click[0]();       // one item in the basket
    const gone = CONFIG.products[0].name;
    CONFIG.products = CONFIG.products.filter((p) => p.name !== gone);

    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") { posts += 1; return { ok: true }; }
      return { ok: true, json: async () => [] };
    };
    await registry["order-btn"].onclick();

    assert.equal(posts, 0, "★ an order was posted for a product that is no longer on the menu");
    const said = registry["confirm-msg"].children
      .map((n) => (n.children[0] || {}).text || "").join(" ");
    assert.match(said, /no longer on the menu/i,
      `★ the press did nothing and said nothing — **the customer is stuck with no clue** (said: ${JSON.stringify(said)})`);
  } finally {
    CONFIG.products = saved;
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
  stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body")).children[2]._listeners.click[0]();
}

// ⚠️ TWO PIN TESTS WERE HERE AND MOVED TO test/store-address.test.js (v414). They placed a pin by
// pressing "Use my location", which no longer exists — and every one of their assertions was about
// what the ORDER carries, not about that button. They are driven through the MAP there now, which
// is the path a customer still has, and that file owns the Leaflet stub the map needs.
// ⚠️ A WAY MUST BE CHOSEN BEFORE AN ORDER IS PLACED (v588). ⭐ The after-order reset now returns the page to
// NOTHING chosen — before it, "Self collect" was left engaged for the next customer, so a test that never chose
// a way was placing orders on a state the shop no longer reaches. Choosing is what a customer does, and the
// Place-order guard refusing without it is the behaviour that change exists for.
const chooseCollect = () => {
  const f = document.getElementById("fulfillment");
  f._value = "collect";
  f._picked = true;
};

test("the receipt carries the strictest change/cancel window of the whole basket", async () => {
  // The two products and their two windows are the TEST's own fixture (v347) —
  // the fallback menu can no longer supply them, and never promised to.
  await withProducts(
    [
      { name: "Chicken Jerky", price: 22, unit: "100g pouch", cancelDays: 3 },
      { name: "Duck Jerky", price: 24, unit: "100g pouch", cancelDays: 1 },
    ],
    async () => {
      const card = registry["menu"].children[0];
      const plus = () => stepperIn(card).children[2]._listeners.click[0]();
      plus();

      globalThis.fetch = async (url, opts) => (opts && opts.method === "POST" ? { ok: true } : { ok: true, json: async () => [] });

      // Two products in the basket, two different windows: the customer reads the
      // strictest (3), not the loosest.
      // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    // ⚠️ AND A POSTAL ADDRESS — this shop posts by default, its own rule kept on purpose.
    document.getElementById("address-input").value = "12 Jalan Bunga";
      await registry["order-btn"].onclick();
      await afterOrderNotice(); // ★ the notice follows her one second (v451)
      const line = confirmLines().find((t) => /change or cancel/i.test(t));
      assert.ok(line, "the receipt states a change/cancel window");
      // ⚠️ MUNCHIES' WORDING: its dictionary says "…before the posting day".
      assert.match(line, /up to 3 days before the posting day/, "the strictest window wins");
      assert.match(line, /not refundable/i, "and the no-refund rule that goes with it");

      // Nothing stated anywhere → no window line at all.
      CONFIG.products.forEach((p) => { delete p.cancelDays; });
      // ⚠️⚠️ AND THE SECOND ORDER HAS TO BE A REAL ONE (v493). ⭐ **It never was.** The first order's receipt
      // stayed in the banner, and the empty-basket refusal used to call `showConfirm` — **which OVERWROTE
      // that receipt, so the assertion below passed because a REFUSAL had replaced it, not because an order
      // without a window had been placed.** ⚠️ v465's after-order reset also clears `dayPicked`, so the
      // refilled basket needed a day tapped before it and the press was refused outright.
      // ⭐ Retiring the banner exposed it. Now the order is placed for real, and the receipt is counted.
      tapDay();                       // ⭐ the next customer's bake day is not inherited (v465)
      registry["confirm-msg"].replaceChildren();   // ⚠️ so a STALE receipt cannot answer for the new order
      plus();                         // basket refilled
      // ⚠️ BOTH FIELDS AGAIN (v493) — the after-order reset blanks the form for the next customer, so the
      // number set before the FIRST order is gone by now. ⭐ The name was already being re-set here and the
      // number was not, which is why this second order stopped at step 3 instead of being placed.
      document.getElementById("name-input").value = "Aunty Bee";
      document.getElementById("whatsapp-input").value = "60123456789";
      // ⚠️ AND THE POSTAL ADDRESS AGAIN — munchies' own rule, and the after-order reset blanks the
      // form. The bakery asks only for a way, so a test ported from there does not need this line.
      document.getElementById("address-input").value = "12 Jalan Bunga";
      let posts = 0;
      const countingFetch = globalThis.fetch;
      globalThis.fetch = async (url, opts) => {
        if (opts && opts.method === "POST") posts += 1;
        return countingFetch(url, opts);
      };
      chooseCollect();
      await registry["order-btn"].onclick();
      await afterOrderNotice(); // ★ the notice follows her one second (v451)
      globalThis.fetch = countingFetch;
      assert.equal(posts, 1, "★ the second order was never placed, so the assertion below proves nothing");
      assert.ok(confirmLines().length, "★ the receipt did not come back, so nothing below is being read");
      assert.ok(!confirmLines().some((t) => /change or cancel/i.test(t)),
        "no product states a window → the receipt says nothing");
    });
});

test("★★★ a truncated referral link is NOT a referral (v565)", () => {
  // ⚠️⚠️ `/store/?via=123` used to show "You were referred — you have a welcome discount on your first
  // order" and stamp referredBy "123" on the order. ⭐ A discount promised and never given is the one
  // thing the shop must not say by accident.
  assert.equal(parseVia("?via=123"), "", "★ a three-digit link claims a referral and a discount");
  assert.equal(parseVia("?via=1"), "");
  assert.equal(parseVia("?via=601234"), "");
  // ⭐ A real number still works, in every spelling.
  assert.equal(parseVia("?via=60123456789"), "60123456789");
});

test("★★★ a WhatsApp number a person cannot answer is not accepted (v565)", () => {
  // ⚠️⚠️ THE FAULT: the box accepted any digit string, so an order could carry "1" — the bakery cannot
  // confirm on it, the payment QR never arrives, and the tracking card (v558) can never be opened.
  assert.equal(waPlausible("1"), false, "★ one digit was accepted as a phone number");
  assert.equal(waPlausible("12345678"), false, "★ eight digits is under the 9-digit floor");
  assert.equal(waPlausible(""), false);
  assert.equal(waPlausible("abc"), false);
  // ⭐ And a real Malaysian number passes in every spelling a customer types.
  assert.equal(waPlausible("012-345 6789"), true);
  assert.equal(waPlausible("+60 12-345 6789"), true);
  assert.equal(waPlausible("60123456789"), true);
  assert.equal(waPlausible("601234567890123"), true, "a long international number is still a number");
  assert.equal(waPlausible("6012345678901234"), false, "past E.164's 15 digits is not a number");
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
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
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
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  stepper.children[2]._listeners.click[0]();

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
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
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
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
    // ⚠️ A NAME IS REQUIRED (v452) — her decision. Without it the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    await registry["order-btn"].onclick();
    assert.equal(posted, null, "no order POSTed when the phone is blank");
    assert.equal(registry["order-btn"].disabled, false, "button stays usable so they can retry");
    // ★★★ AND THE BOX ITSELF SAYS IT (v493), NOT A BANNER AT THE FOOT OF THE PAGE. ⚠️ Her rule 3:
    // __"step 3 not fill up … screen will scroll to the field below it and flash the warning"__. ⭐ The name
    // box has answered that way since v455; the number box used a banner BELOW everything — including the
    // Track-your-order card — so one step had two ways of saying one sentence. ⭐ It answers as the box above
    // it does now, and the page is carried to it.
    const waBox = registry["whatsapp-input"];
    assert.ok(String(waBox.className || "").includes("bad"),
      `★ the empty number box did not mark itself (it is "${waBox.className}")`);
    assert.match(String((registry["whatsapp-input-note"] || {}).textContent || ""), /WhatsApp number/i,
      "★ the box that is missing the number says nothing about it");
    assert.deepEqual(waBox.scrolled, { block: "center", behavior: "smooth" },
      "★ the page was not carried to the box that is missing, so he is told off out of sight");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the default Post (nationwide) order is blocked until a postal address is given", async () => {
  // ⚠️ THE MENU ONLY EXISTS ONCE A DAY IS CHOSEN, and this test used to inherit one from whichever test
  // ran before it. ⭐ The file's own rule (see the step test's note): a test that drives the basket taps its
  // own day, or it is reading state another test left behind.
  tapDay();
  // ⚠️ THE MENU IS A TREE NOW (headings over cards), so the stepper is found by walking it — the same
  // `stepperIn` the bakery's own tests use, rather than assuming the first child is a card.
  const stepper = stepperIn(registry["menu"]);
  assert.ok(stepper, "the menu drew no product stepper, so this test cannot drive the basket");
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
    // ★★★ AND THE BOX ANSWERS, NOT A BANNER (v548) — the same way the name and the number boxes do.
    assert.ok(String(document.getElementById("address-input").className || "").includes("bad"),
      "the address box was not marked — the customer is not told what is missing");
    assert.match(String((registry["address-input-note"] || {}).textContent || ""), /postal address/i,
      "the box was marked but says nothing about the address it wants");
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("order click sanitizes a +60-style phone to wa.me digits", async () => {
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  stepper.children[2]._listeners.click[0]();

  let posted = null;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => {
    if (opts && opts.method === "POST") { posted = { url, body: JSON.parse(opts.body) }; return { ok: true }; }
    return { ok: true, json: async () => [] };
  };
  try {
    document.getElementById("whatsapp-input").value = "+60 12-345 6789";
    // ⚠️ A NAME IS REQUIRED (v452) — her decision. Without it the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    // ⚠️ AND A POSTAL ADDRESS, BECAUSE THIS SHOP POSTS BY DEFAULT — jerky's own rule, kept on
    // purpose (see store/app.js). Without it the press refuses before the POST this reads.
    document.getElementById("address-input").value = "12 Jalan Bunga";
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

test("★★★ the offline message keeps each item's note and the door pin (v592)", () => {
  // ⚠️⚠️ MEASURED: the fallback text printed only name/qty/price — ⚠️ **a customer's "no nuts" and a condo
  // door pin were in the cloud order and absent from the WhatsApp message**, which is the one path that must
  // carry the whole order when the cloud cannot be reached.
  const cfg = { name: "Jienluv2bake", products: [] };
  const msg = buildMessage(cfg, {
    date: "Wed, 2 Sep",
    lines: [{ name: "Focaccia", qty: 1, price: 15, note: "no nuts" }],
    total: 15, customer: "", note: "", fulfillment: "courier",
    address: "12 Jalan Bunga", place: { lat: 5.4141, lng: 100.3288 },
  });
  assert.ok(msg.includes("📝 no nuts"), "★ the item's own note is not in the message the baker receives");
  assert.ok(msg.includes("📌 5.414100, 100.328800"), "★ the door pin is not in the message");
  assert.ok(msg.includes("maps.google.com/?q=5.4141,100.3288"), "the pin has no link to open");
});

test("★★★ a collection order names the point it is collected from (v581)", () => {
  // ⚠️⚠️ MEASURED: the message said "Self collect" and nothing else, although the order carries the
  // Point's name — ⚠️ **so the baker could not tell which place from the message she was sent**, and the
  // offline fallback message lost it the same way.
  const cfg = { name: "Jienluv2bake", products: [] };
  const base = { date: "Wed, 2 Sep", lines: [{ name: "Focaccia", qty: 1, price: 15 }],
    total: 15, customer: "Aunty Bee", note: "", fulfillment: "collect" };
  const withPoint = buildMessage(cfg, { ...base, pointName: "Desa Park Collective" });
  assert.ok(withPoint.includes("Collect (local)"), "the method line went missing");
  assert.ok(withPoint.includes("📍 Desa Park Collective"),
    "★ the message does not say which place the customer collects from");
  // And an order with no Point named is byte-for-byte the message it always was.
  assert.equal(buildMessage(cfg, base), buildMessage(cfg, { ...base, pointName: "   " }),
    "an empty Point name added a line");
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

// ── v299: the Self collection Points the shop may offer ─────────────────────

test("the shop keeps the Points it can read, and only the fields it needs", () => {
  // ⚠️ THE SHOP IS PUBLIC. Only an id, a name and the SMALLEST BASKET are read off the payload;
  // anything else is dropped here rather than drawn. This is also what makes a malformed row
  // unable to reach the page — the app validates on its side, and the shop validates again on
  // its own terms.
  //
  // The smallest basket joined them in v306. It is the opposite of private — it is what the
  // customer has to know BEFORE choosing — while the receiver, the address and the fee are
  // exactly the things that must never leave her app.
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 30, address: "Lebuhraya Thean Teik", receiver: "Aunty Lim", feeRM: 0.5 },
    { id: "pt_2", name: "Chai Leng Park, Prai" },
  ] });
  assert.deepEqual(out.points, [
    { id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 30 },
    { id: "pt_2", name: "Chai Leng Park, Prai", minOrderRM: 0 },
  ], "the receiver, the address and the fee never reach the shop");
});

test("the shop keeps the kitchen flag, and adds it to nothing else (v407)", () => {
  // ★★ A FIELD A SENDER PUBLISHES AND A RECEIVER DOES NOT KEEP IS A FIELD THAT WAS NEVER SENT.
  // ⚠️ `publishPoints` sends `isKitchen` and this whitelist would have thrown it away one step
  // later — the shop would go on inventing its own "Our kitchen" row and a customer would see the
  // kitchen twice, which is the exact fault the pair of edits repairs. Every new key needs naming
  // in BOTH places, and this is the second one.
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Farlim, Air Itam", isKitchen: true },
    { id: "pt_2", name: "Chai Leng Park, Prai" },
  ] });
  assert.equal(out.points[0].isKitchen, true, "the marked kitchen arrives marked");
  // ⚠️ WRITTEN ONLY WHEN TRUE, the house's "absent means nothing" spelling: an ordinary Point's
  // payload stays byte-for-byte what it has always been, so this cannot change a page by itself.
  assert.equal("isKitchen" in out.points[1], false, "an ordinary Point gains no key at all");
  assert.equal(out.points[1].isKitchen, undefined,
    "and an absent key reads as 'not the kitchen', which is also what an older payload means");
});

test("a smallest basket the shop cannot read is NO minimum, never a guess (v306)", () => {
  // A rule the shop invented would refuse an order nobody asked it to refuse. Junk, a negative
  // and a missing key all mean "no minimum", which is what every Point meant until v306.
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "A", minOrderRM: "rubbish" },
    { id: "pt_2", name: "B", minOrderRM: -5 },
    { id: "pt_3", name: "C" },
    { id: "pt_4", name: "D", minOrderRM: 0 },
    { id: "pt_5", name: "E", minOrderRM: "12.50" },
  ] });
  assert.deepEqual(out.points.map((p) => p.minOrderRM), [0, 0, 0, 0, 12.5]);
});

test("a Point the shop cannot read is dropped rather than drawn", () => {
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Real" },
    { id: "", name: "No id" },
    { id: "pt_3", name: "   " },
    { name: "No id at all" },
    "nonsense",
    null,
  ] });
  assert.deepEqual(out.points, [{ id: "pt_1", name: "Real", minOrderRM: 0 }]);
  // A payload that says nothing about Points leaves the key alone.
  assert.equal(mergeStorefront({ points: [{ id: "pt_x", name: "Kept", minOrderRM: 0 }] }, { name: "X" }).points[0].name, "Kept");
  // And an EMPTY list is a real instruction, not silence — the payload replaces the whole row,
  // so it has to take a Point off a page that is already showing it.
  assert.deepEqual(mergeStorefront({ points: [{ id: "pt_x", name: "Gone", minOrderRM: 0 }] }, { points: [] }).points, []);
});

// ── v292: the shop's standing offers, and how they turn ─────────────────────
//
// The strip used to `.find()` the FIRST live public code and drop the rest
// without a word, so a bakery advertising three offers was advertising one.
// `standingToday` and `standingNext` are pure, so the shop's own rule is judged
// here rather than by looking at a phone.

// A code the shop would happily advertise, with the two rule families that can
// stop it overridden per test.
const stand = (over = {}) => ({
  code: "FRESH10", vis: "public", state: "live",
  when: { from: "", to: "" }, often: { type: "unlimited", n: 0, maxRM: 0 }, used: 0, given: 0,
  ...over,
});
const TODAY = "2026-10-04";

test("the strip advertises EVERY live public code, not just the first", () => {
  const codes = [stand({ code: "ONE" }), stand({ code: "TWO" }), stand({ code: "THREE" })];
  assert.deepEqual(standingToday(codes, TODAY).map((c) => c.code), ["ONE", "TWO", "THREE"],
    "all three are running, so all three are advertised — this is the fault v292 fixed");
  // The order is her publishing order, so the first code the strip shows is the
  // one she put first rather than whichever the filter happened to meet.
  assert.deepEqual(standingToday([stand({ code: "B" }), stand({ code: "A" })], TODAY).map((c) => c.code),
    ["B", "A"]);
});

test("a code that is not running is never advertised", () => {
  const dropped = [
    ["personal", stand({ vis: "personal" })],                        // unadvertised is the whole of what "personal" buys
    ["paused", stand({ state: "paused" })],
    ["ended", stand({ state: "ended" })],
    ["not yet", stand({ when: { from: "2026-11-01", to: "" } })],
    ["out of date", stand({ when: { from: "", to: "2026-09-30" } })],
    ["used up", stand({ often: { type: "quota", n: 3, maxRM: 0 }, used: 3 })],
    ["over its ceiling", stand({ often: { type: "unlimited", n: 0, maxRM: 50 }, given: 50 })],
    ["junk", null],
  ];
  for (const [why, c] of dropped) {
    assert.deepEqual(standingToday([c], TODAY), [], `${why} must not be advertised`);
  }
  // ...and the good one beside a bad one still gets through, so this is a filter
  // and not a stop-at-the-first-problem.
  assert.deepEqual(standingToday([stand({ vis: "personal" }), stand({ code: "OK" })], TODAY).map((c) => c.code),
    ["OK"]);
  // A code running till TODAY is still running — the same "still valid on its
  // last day" rule creditStatus keeps, asked of the engine rather than restated.
  assert.equal(standingToday([stand({ when: { from: "", to: TODAY } })], TODAY).length, 1);
});

test("the turn wraps, and one offer never moves", () => {
  assert.equal(standingNext(3, 0), 1);
  assert.equal(standingNext(3, 1), 2);
  assert.equal(standingNext(3, 2), 0, "the third turns back to the first");
  assert.equal(standingNext(2, 0), 1);
  assert.equal(standingNext(2, 1), 0);
  // One offer is a statement, not a one-slide carousel: it stays put because
  // `(0 + 1) % 1` is 0, and the shop never arms a timer for it at all.
  assert.equal(standingNext(1, 0), 0);
  assert.equal(standingNext(0, 0), 0);
  // A list that shrank under the timer — she paused a code while the page was open
  // — clamps rather than wrapping into a hole and drawing nothing.
  assert.equal(standingNext(3, 9), 0);
  assert.equal(standingNext(3, -1), 0);
});

test("the shop arms its timer only when there is something to turn to", () => {
  // The one place this deliberately differs from the homepage's own carousel,
  // which arms an interval even for a single slide where it then ticks every six
  // seconds to no effect.
  assert.equal(turnsAtAll(0), false, "no offers, no strip, no timer");
  assert.equal(turnsAtAll(1), false, "a lone offer is stated, not turned");
  assert.equal(turnsAtAll(2), true);
  assert.equal(turnsAtAll(3), true);
  assert.equal(turnsAtAll("2"), true, "a count that arrives as text still counts");
  assert.equal(turnsAtAll(undefined), false);
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

// A lookup returns ONLY the columns its column list names, and a stub that answers
// with the whole row regardless is exactly how a missing column hides: the card
// draws a field the real server would never have sent. Every track stub goes
// through this so the column list is part of what is being tested (19 Sep 2026).
//
// ⚠️ THE LIST MOVED IN v345, AND SO DID THE THING THAT READS IT. The lookup used to
// be a PostgREST select and this read the `select=` out of the URL. It is now the
// `track_order` function in supabase/tracking.sql, because a `using (true)` read
// policy on the table handed every customer's name and delivery address to anyone
// holding the (public) anon key. A function returns only what its `returns table`
// names, so the column list is read out of the SQL file instead — and it is still
// part of what is being tested, for exactly the same reason as before.
const trackCols = (() => {
  const sql = readFileSync(new URL("../supabase/tracking.sql", import.meta.url), "utf8");
  const declared = sql.slice(sql.indexOf("returns table"), sql.indexOf("language sql"));
  return new Set([...declared.matchAll(/^\s*([a-z_]+)\s+(?:text|boolean|numeric|timestamptz)/gm)]
    .map((m) => m[1]));
})();

const onlySelected = (url, row) => {
  const href = String(url);
  if (href.includes("/rest/v1/rpc/track_order")) {
    return Object.fromEntries(Object.entries(row).filter(([k]) => trackCols.has(k)));
  }
  const sel = /[?&]select=([^&]*)/.exec(href)?.[1];
  if (!sel || sel === "*") return row;
  const keep = decodeURIComponent(sel).split(",").map((s) => s.trim());
  return Object.fromEntries(Object.entries(row).filter(([k]) => keep.includes(k)));
};

test("trackOrder re-fetches and re-renders every lookup (never stale)", async () => {
  const box = document.getElementById("track-result");
  const urls = [];
  const row = { status: "Confirmed", delivery: "4 Sep · Post (nationwide)", items: "Focaccia ×1", total: "RM15.00", customer: "Ain" };
  globalThis.fetch = async (url, opts) => {
    urls.push({ url: String(url), opts });
    return { ok: true, json: async () => [row] };
  };
  try {
    await trackOrder("A3F9C2", "0123456789");
    const afterFirst = box.children.length;
    assert.ok(afterFirst >= 4, "first lookup renders status + delivery + items + customer");
    await trackOrder("B5D1E4", "0123456789");
    assert.equal(box.children.length, afterFirst, "second lookup replaces the result");
    assert.equal(urls.length, 2, "every lookup hits the network — nothing is cached");
    assert.equal(urls[0].opts.cache, "no-store", "cache: no-store so status is always fresh");
    assert.equal(urls[1].opts.cache, "no-store");
    assert.ok(trackCols.has("confirmed_sent") && trackCols.has("paid_received"),
      "the lookup fetches the stage flags so the map matches the app's");
    assert.ok(trackCols.has("tracking_no"),
      "and asks for tracking_no by name — the lookup sends only the columns listed, so a number the baker typed is invisible to the card until this names it");
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
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
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    await afterOrderNotice(); // ★ the notice follows her one second (v451)
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

test("★★★ after an order, the next customer arrives with NO way chosen (v588)", async () => {
  // ⚠️⚠️ MEASURED: the after-order reset left "Self collect" engaged — ⚠️ **so the next customer opened step 3
  // with the card edged, the "Tap to choose one" prompt gone, and no guard left to stop an order placed with a
  // way they never picked.** ⭐ The reset now returns the page to the state a new visitor sees.
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay();
  stepper.children[2]._listeners.click[0]();
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (opts && opts.method === "POST" ? { ok: true } : { ok: true, json: async () => [] });
  try {
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    chooseCollect();
    await registry["order-btn"].onclick();
    await afterOrderNotice();

    // ⚠️ MUNCHIES' OWN MODEL: its shop OPENS on Post (nationwide), so the reset must return the page to
    // exactly that — the same call arrival makes (`apply("courier")`). The bakery opens with nothing
    // chosen because its number alone cannot say how the order travels; here the way is never empty.
    assert.equal(document.getElementById("fulfillment")._value, "courier",
      "★ the next customer does not open the shop in the same state a new visitor gets");
  } finally { globalThis.fetch = realFetch; }
});

test("WhatsApp only opens as a fallback when the order could NOT reach the app", async () => {
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect"; // avoid the postal-address requirement
    await registry["order-btn"].onclick();
    assert.equal(opened.length, 1, "WhatsApp opens only when the app could not be reached");
    assert.ok(String(opened[0]).startsWith(`https://wa.me/${CONFIG.whatsapp}?text=`),
      "falls back to the configured shop number");
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
// ⚠️ THE OLD by-`select=` VERSION OF `onlySelected` STOOD HERE and was removed by the v345 sync:
// the lookup is no longer a PostgREST select but the `track_order` function, whose column list
// lives in supabase/tracking.sql — so the one definition above (which reads the SQL file) is the
// only one, and a second copy would be a SyntaxError before a single test ran.

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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
    const no = byExactClass(box, "track-no");
    assert.ok(no, "the card carries the tracking slot on its own line");
    // ⚠️ ALIGNED WITH THE CARD'S OWN HEADING (2026-10-12, her ask). This read "Track your
    // delivery:" while the card the customer is looking at says "Track your order" — one thing
    // named two ways on one card, which is the drift she asked to have closed. The label still
    // does its original job: it marks this as a LINK to follow rather than a tracking NUMBER.
    assert.equal(no.children[0].text, "Track your order: ",
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
      await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
    assert.ok(trackCols.has("courier_fee"),
      "the lookup names courier_fee — it sends only the columns listed, so the charge the baker typed is invisible to the card until this asks for it");
    assert.ok(trackCols.has("customer"),
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
    assert.ok(trackCols.has("promo_code") && trackCols.has("promo_rm"),
      "the lookup names promo_code and promo_rm — it sends only the columns its list names, so the discount is invisible to the card until this asks for it");
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
    await trackOrder("A3F9C2", "0123456789");
    assert.ok(trackCols.has("courier_cod"),
      "the lookup names courier_cod — it sends only the columns listed, so the card can never know the charge is COD until this asks for it, and would word it as money owed to the baker");
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
    await trackOrder("A3F9C2", "0123456789");
    assert.match(feeText(deepByClass(box, "track-fee")), /Courier charge/,
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
    await trackOrder("A3F9C2", "0123456789");
    // ⚠️ JERKY-ONLY COLUMN, AND JERKY-ONLY ASSERTION. The bakery has no `postage_quoted`, so this
    // line survived the v345 sync untouched — and it had to be moved onto `trackCols` by hand,
    // because the column list it was reading moved out of the shop's URL and into the SQL. Left
    // as it was, it would have gone on passing on a URL the shop no longer builds.
    assert.ok(trackCols.has("postage_quoted"),
      "the lookup names postage_quoted — it sends only the columns its list names, so without this the card cannot tell an order whose delivery is still to be quoted from one with nothing left to pay, and would quietly say neither");
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
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
    await trackOrder("A3F9C2", "0123456789");
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
const plusOf = (card) => stepperIn(cardBodyOf(card)).children[2];
const noteRow = (card) => cardBodyOf(card).children.find((c) => hasClass(c, "line-note-row")) || null;
const noteAdd = (card) => (noteRow(card) ? noteRow(card).children.find((c) => hasClass(c, "line-note-add")) || null : null);
const noteBox = (card) => (noteRow(card) ? noteRow(card).children.find((c) => hasClass(c, "line-note")) || null : null);
const pressPlus = (card) => plusOf(card)._listeners.click[0]();
const tapNote = (card) => noteAdd(card)._listeners.click[0]();
const typeNote = (box, text) => { box.value = text; box._listeners.input[0].call(box); };

// ⚠️ A TEST THAT NEEDS SEVERAL PRODUCTS DECLARES THEM ITSELF (v347).
//
// The shop's fallback menu now lists exactly what is sold — one focaccia — because
// her decision was to trim it (see store/config.js). It used to hold a two-product
// SAMPLE, and these tests had been borrowing it: one wanted "two products with
// different change/cancel windows", another wanted "a product the baker never
// switched on". Neither was ever a guarantee — one of the borrowed products was a
// Sandwich the shop does not sell.
//
// withProducts() renders the menu the test actually needs, and puts the real one
// back afterwards. `render()` is the real page render, so the final call rebuilds
// the menu and gives the next test a clean page.
async function withProducts(list, fn) {
  const real = CONFIG.products;
  const realFetch = globalThis.fetch;
  CONFIG.products = list;
  render();
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  try {
    return await fn(list);
  } finally {
    CONFIG.products = real;
    globalThis.fetch = realFetch;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
}

// One product switched on for a note, a SECOND one that is not, rendered, driven,
// and both put back exactly as they were.
async function withNotedProduct(fn) {
  const base = CONFIG.products[0];
  return withProducts(
    [{ ...base, askNote: true }, { name: "A second item", price: 5, unit: "piece" }],
    (list) => fn(list[0]),
  );
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect";
    await registry["order-btn"].onclick();

    assert.ok(posted, "the order went through");
    assert.equal(Object.prototype.hasOwnProperty.call(posted.lines[0], "note"), false,
      "an empty box and no box at all place exactly the same order");
  });
});

test("★★★ the after-order reset clears the COLLECTION CENTRE — not only the way (v505)", () => {
  // ⚠️⚠️ HER REPORT, AND IT IS EXACT: __"After i place order, the screen response with order confirmation, and
  // page reseted. But the earlier order, step 3 choice of self collection centre still engaged. Why it is
  // so?"__ ⭐ **THE ANSWER WAS ONE LINE: the reset cleared `_picked` and set the way back to collect, and NEVER
  // CLEARED `_pointId` — which is WHICH CENTRE he chose.**
  // ⭐⭐ **So the next customer opened step 3 with the last customer's collection point still chosen — and
  // because the ORDER carries that id, an order could be stamped with a centre nobody picked.**
  // ⚠️ **AND 3,433 TESTS WERE GREEN WHILE IT WAS WRONG.** The test that did exist about clearing the point is
  // about **switching away from collect** (v436) — ⭐ **a different door onto the same state, and the
  // after-order reset went through neither.**
  //
  // ⚠️ ASKED OF THE SHOP'S OWN RESET FUNCTION — which is exactly what the order handler calls, so this is the
  // behaviour an order runs. ⭐ Stated plainly: it does NOT drive a basket and a tap to get here, because the
  // question is what the RESET does to a chosen centre, and a fixture that had to tap its way in would be
  // testing the tap.
  render();
  tapDay();
  const wrap = registry["fulfillment"];
  // ⭐ A centre, chosen — the state the last customer left behind.
  wrap._pointId = "pt_farlim";
  wrap._pointName = "Farlim";
  wrap._picked = true;

  wrap._resetFulfillment();                   // ⭐ the reset an order runs

  assert.equal(wrap._pointId, "",
    "★★ the next customer's step 3 still has the LAST customer's collection centre chosen — **and the order "
    + "carries that id, so an order can be stamped with a centre nobody picked**");
  assert.equal(wrap._pointName, "",
    "and the centre's NAME is still held, so the shop can still name it back as if it were his");
  assert.equal(wrap._picked, false, "and the way itself is reset, which is the half that always worked");
});

test("★★★ TWO DIFFERENT CUSTOMERS LEAVE THE SHOP IN THE SAME STATE (v506)", async () => {
  // ⚠️⚠️ HER QUESTION, AND IT IS THE BEST ONE OF THE DAY: __"i think you alway forgot. How to make sure not to
  // forget"__. ⭐ **And she is right — she handed me the same fault THREE TIMES: the collection CENTRE, then the
  // CARD that stayed unfolded, then the ④ that stayed green.**
  //
  // ⭐⭐ SO THIS IS NOT A LIST OF THINGS TO RESET. **A list is a thing somebody has to remember to add to** —
  // and the one who forgot three times is me.
  //
  // ⭐⭐⭐ AND THE IDEA THAT MAKES IT WORK: **it does not compare the shop against a blank page** (which a test
  // file cannot produce — the shop above it has already had a customer). **It compares TWO DIFFERENT CUSTOMERS.**
  // ⭐ **If the reset is complete, the shop after B is IDENTICAL to the shop after A** — and if ANY piece
  // survives, A's left A's value and B's left B's, so the two disagree.
  // ⚠️ **AND HOW THEY MUST DIFFER IS THE POINT:** different centre, different card opened, different address,
  // different name, different day, different basket. **Anything the reset forgets shows up as a difference
  // nobody wrote down** — ⭐ including pieces nobody has thought of yet.
  const read = () => {
    const wrap = registry["fulfillment"];
    const val = (id) => { const n = document.getElementById(id); return n ? String(n.value || "") : ""; };
    const done = (id) => { const n = document.getElementById(id); return !!(n && n.classList && n.classList.contains("done")); };
    return {
      "the basket": registry["bar-count"].textContent,
      "the total": registry["bar-total"].textContent,
      "his name": val("name-input"),
      "his number": val("whatsapp-input"),
      "his address": val("address-input"),
      "the note on the order": val("note-input"),
      "the promo code": val("promo-input"),
      "whether HE chose the way": !!wrap._picked,
      "the collection centre": String(wrap._pointId || ""),
      "the centre's name": String(wrap._pointName || ""),
      "the card left unfolded": String(wrap._open == null ? "" : wrap._open),
      "step 1 done": done("step1"),
      "step 2 done": done("step2"),
      "step 3 done": done("step3"),
      "the ④ beside Place order": done("bar-step"),
      "the step note is up": !document.getElementById("step-note").hidden,
    };
  };

  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts) => (opts && opts.method === "POST" ? { ok: true } : { ok: true, json: async () => [] });
  const order = async (who) => {
    render();
    tapDay();
    stepperIn(registry["menu"].children[0]).children[2]._listeners.click[0]();
    document.getElementById("name-input").value = who.name;
    document.getElementById("whatsapp-input").value = who.wa;
    const wrap = registry["fulfillment"];
    // ⚠️⚠️ AND THEY MUST DIFFER IN EVERY PIECE THAT CAN SURVIVE — **which my first version did NOT do**, and
    // the bites showed it: both customers opened the same card and neither touched the address, so those two
    // pieces matched BY CONSTRUCTION and **the comparison passed with the reset broken.** ⭐ **A test whose
    // fixture cannot tell the two apart is testing nothing** — the fault this suite has recorded before.
    wrap._value = "collect";
    wrap._picked = true;
    wrap._open = who.open;                 // ⭐ A opens one card, B the other
    wrap._pointId = who.point;
    wrap._pointName = who.pointName;
    const addr = document.getElementById("address-input");
    if (addr) addr.value = who.address;    // ⭐ and B leaves an address behind, A does not
    await registry["order-btn"].onclick();
    await afterOrderNotice();
    return read();
  };

  try {
    const afterA = await order({ name: "Aunty Bee", wa: "60123456789", point: "pt_farlim", pointName: "Farlim", open: "collect", address: "" });
    const afterB = await order({ name: "Mei Ling", wa: "60198765432", point: "pt_airputih", pointName: "Air Putih", open: "courier", address: "12 Jalan Bunga" });

    // ⚠️⚠️ AND THE ONE PIECE THE COMPARISON CANNOT CATCH, NAMED: ④. ⭐ It is green after EVERY order, so the
    // two customers agree about it whether the reset works or not — **the comparison finds what DIFFERS
    // between customers, and this is a constant the shop leaves set.** ⚠️ **That is the machine's own limit,
    // and it is why this one line is written out by hand** — her screenshot showed it still green while the
    // comparison was passing.
    assert.equal(afterA["the ④ beside Place order"], false,
      "★★ ④ IS STILL GREEN after the order — **the shop opens claiming step 4 is done before the next customer "
      + "has done anything**, which is the fault ① was fixed for. ⚠️ The comparison above cannot see this: ④ is "
      + "green for EVERY customer, so the two agree either way.");
    assert.equal(afterB["the ④ beside Place order"], false, "★ and the same after the second order");

    const wrong = [];
    for (const k of Object.keys(afterA)) {
      if (afterA[k] !== afterB[k]) {
        wrong.push(`${k}: the first customer left ${JSON.stringify(afterA[k])}, the second ${JSON.stringify(afterB[k])}`);
      }
    }
    assert.deepEqual(wrong, [],
      "★★★ THE SHOP DOES NOT COME BACK THE SAME AFTER TWO DIFFERENT CUSTOMERS — so something the first one did is "
      + "still there after the second, and the next customer will inherit exactly that:\n  - " + wrong.join("\n  - "));
  } finally {
    globalThis.fetch = realFetch;
  }
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
    // ⚠️ A NAME IS NOW REQUIRED TO PLACE AN ORDER (v452) — her decision, so that every order she
    // receives carries the name she confirms it against. Without this line the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    document.getElementById("whatsapp-input").value = "60123456789";
    document.getElementById("fulfillment")._value = "collect";
    await registry["order-btn"].onclick();

    // The person behind them adds the same item; the box must open on nothing.
    // ⚠️ AND THE DAY IS TAPPED FIRST (v465) — **which is also this test's subject.** The after-order reset
    // now clears the posting day's claim, so the person behind him starts at step 1 exactly as a new visitor
    // does. ⭐ Without this the `+` is correctly refused, because step 1 is genuinely his to choose again.
    tapDay();
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

// ── v407: her kitchen is offered once, not once per name ────────────────────

test("the shop offers her kitchen ONCE — as itself, or as the fallback, never both", () => {
  // ★★ v406 made the kitchen a Point she marks ("I want all self collection thru collection
  // point, not from the kitchen"). ⚠️⚠️ THE SHOP WAS NOT TOLD, so it went on printing its own
  // invented "Our kitchen" row above the list — and **the moment she marked a kitchen, a customer
  // saw the same place twice**: once invented, once under the name she gave it, as two choices
  // that looked like two different places. The flag now travels (see publishPoints and
  // mergeStorefront), and the invented row is the FALLBACK it was always meant to be.
  //
  // ⚠️ It is not tidiness: `render()` is the real page render, and this reads the real rows the
  // shop draws. The row's own name is what a customer taps, so it is what is asserted.
  const real = CONFIG.points;
  // ⚠️ Read through the text NODES rather than `.textContent`: this shim's text nodes are plain
  // `{nodeType:3, text}` records with no `textContent` of their own, so a `.textContent` read here
  // would return "" for every row and the whole test would pass against nothing at all.
  const textOf = (n) => (n.nodeType === 3 ? n.text : (n.children || []).map(textOf).join(""));
  const rows = () => registry["point-list"].children.map((r) => r.children[0].children[0].text);
  try {
    CONFIG.points = [{ id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 0 }];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.deepEqual(rows(), ["Our kitchen", "Farlim, Air Itam"],
      "with no kitchen marked, the invented row is kept — it is how the bakery has always been collectable");
    // ⚠️ WHAT IS ASSERTED IS WHAT THE ORDER CARRIES, not the highlight. The chosen place rides on
    // the wrapper as `_pointId`/`_pointName` and `order()` reads it straight back, so that pair is
    // the outcome; the `active` class is decoration, and this shim's `classList` is a no-op.
    // ⚠️⚠️ AND NOTHING IS CHOSEN ON ARRIVAL (v415), which is a change of behaviour and hers: this
    // used to assert that the invented kitchen arrived already chosen. Her words: __"click to choose
    // point, without click it should not highlight"__ — ⭐ **a place wearing the panel reads as a
    // place the customer PICKED, and he has picked nothing.** ⚠️ The EMPTY id is still what the
    // ORDER means by "the bakery", so an order placed without a tap goes exactly where it always did.
    assert.equal(registry["fulfillment"]._pointId, "", "nothing is chosen until he taps one");
    assert.equal(registry["fulfillment"]._pointName, "", "and no name is claimed for him either");

    CONFIG.points = [{ id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 0, isKitchen: true }];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.deepEqual(rows(), ["Farlim, Air Itam"],
      "marking a kitchen lists it once, under her own name, and drops the invented row");
    // ★★ AND IT WEARS THE KITCHEN'S OWN LINE (v408). ⚠️ v407 dropped the invented row without
    // giving the real one its words, so her own kitchen read "Self collection Point — we message
    // the exact spot…" — true, and useless: a customer collecting AT THE BAKERY was told exactly
    // what he would be told about a friend's shop. ⭐ Found by LOOKING at her live shop.
    const kitchenSub = registry["point-list"].children[0].children[1].children[0].text;
    // ⚠️ MUNCHIES' OWN WORDING for the kitchen line — the bakery says "where we bake".
    assert.match(kitchenSub, /where your treats are made/i,
      `the kitchen says it is the kitchen — it read: ${JSON.stringify(kitchenSub)}`);
    assert.ok(!/Self collection Point/i.test(kitchenSub),
      "and not the line every other place wears");

    CONFIG.points = [{ id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 0, isKitchen: true },
      { id: "pt_2", name: "Chai Leng Park, Prai", minOrderRM: 0 }];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.deepEqual(rows(), ["Farlim, Air Itam", "Chai Leng Park, Prai"],
      "and the other Points are still offered beside it");

    // ⚠️⚠️ AND NOTHING IS CHOSEN ON ARRIVAL (v415) — THIS ASSERTION USED TO SAY THE OPPOSITE.
    // Her words: __"click to choose point, without click it should not highlight"__, and the reason
    // is the one her v413 picture showed: **a place wearing the panel reads as a place the customer
    // PICKED, and he has picked nothing.** ⭐ So the marked kitchen is offered like any other place
    // and lit only when he taps it.
    assert.equal(registry["fulfillment"]._pointId, "", "nothing is chosen until he taps one");
    assert.equal(registry["fulfillment"]._pointName, "", "and no name is claimed for him either");
    const lit = registry["point-list"].children.filter((b) => String(b.className).includes("active"));
    assert.equal(lit.length, 0, "no row is wearing the highlight");

    // ⭐ AND AN ORDER PLACED WITHOUT CHOOSING STILL WORKS, exactly as it always has: the EMPTY id is
    // how every order has said "collect from the bakery" since long before there were Points. This
    // is a page that stops pretending, not one that asks a new question.
    assert.equal(registry["point-list"].children.length, 2, "both places are still offered");
    // ⚠️ And the card says what to do instead of pretending — the line that stands where the
    // highlight used to. It is inside the folded body, so it shows with the card.
    // ⚠️ THE WAY IS CHOSEN FIRST — munchies opens on Post (nationwide), its own default, so the
    // collect card is shut until he picks it. The bakery starts with neither chosen and does not
    // need this line. Same deliberate difference as `apply("courier")` in store/app.js.
    document.getElementById("fulfillment")._value = "collect";
    document.getElementById("fulfillment")._open = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(registry["point-pick"].hidden, false,
      "the card tells him the list is a thing to press");
    registry["point-list"].children[0]._listeners.click[0]();
    assert.equal(registry["point-pick"].hidden, true,
      "and stops saying it the moment he does — a page must not nag about what he just did");
    assert.equal(registry["fulfillment"]._pointId, "pt_1", "the tap is what chooses it");
  } finally {
    CONFIG.points = real;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v408: the code is said again above Place order ──────────────────────────

test("a code on the order is said again above Place order", () => {
  // ★★ Her words: __"If there is promo coupon attached, say it on top of Place Order, word like:
  // Your promo coupon will be attached together to the order for validation, actual payable will be
  // confirm by Whatsapp."__ ⭐ The page already said it ONCE, up at the code box ("We'll take it off
  // when we confirm your order") — and by the time a customer reaches the button, that is off the
  // screen. Here they are looking at ONE figure, the goods total on the bar, and this is the moment
  // they commit.
  //
  // ⚠️ Driven through the REAL controls — the box, "Use it", "Remove the code" — because the point
  // is that a customer who types a code sees this line, and one who never does never sees it.
  const realCodes = CONFIG.promoCodes;
  const bar = () => registry["promo-bar"];
  const plus = () => stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body")).children[2]._listeners.click[0]();
  try {
    // ⚠️ AN ORDINARY BAR IS UNTOUCHED — hidden, and empty rather than holding a stale sentence.
    assert.equal(bar().hidden, true, "no code on the order means no line on the bar");
    assert.equal(bar().textContent, "", "and nothing left in it to appear on the next repaint");

    CONFIG.promoCodes = mergeStorefront({}, {
      promoCodes: [{ code: "FRESH10", gives: { type: "rm", value: 10 } }],
    }).promoCodes;
    plus(); // something in the basket, so the code has a total to judge against
    registry["promo-input"].value = "FRESH10";
    registry["promo-apply"]._listeners.click[0]();

    assert.equal(bar().hidden, false, "a code on the order puts the line up where the money is");
    assert.match(bar().textContent, /FRESH10/, "and the code is named back to them, not just 'your code'");
    assert.match(bar().textContent, /confirm the final amount on WhatsApp/i,
      "the amount is CONFIRMED with them — never stated as already correct");
    // ⚠️ It promises no FIGURE. Whether the discount holds is hers to decide at the confirmation
    // (a code can be one-per-customer, or first-order only), so a number here would be a promise
    // the page cannot keep.
    assert.ok(!/RM\s*[\d.]/.test(bar().textContent), "no ringgit figure is promised on the bar");

    registry["promo-clear"]._listeners.click[0]();
    assert.equal(bar().hidden, true, "removing the code takes the line away again");
  } finally {
    CONFIG.promoCodes = realCodes;
    registry["promo-input"].value = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v410: the collection Areas, and the address she chooses to publish ──────

test("the shop keeps the AREA headings it can read, and only the fields it needs", () => {
  // Her words: __"top level is Penang Island & Prai. Under Penang Island will be Area like Sg Ara,
  // Balik Pulau, Farlim, Georgetown"__. Read exactly like the product categories beside it:
  // replaced wholesale, and re-validated on the shop's own terms so a malformed row cannot draw.
  const out = mergeStorefront({}, { pointAreas: [
    { name: "Penang Island", depth: 0, points: ["pt_1", "pt_2"], junk: "dropped" },
    { name: "Sg Ara", depth: 1, points: ["pt_2"] },
    { name: "   " },            // no name: dropped rather than drawn as a blank heading
    { points: ["pt_3"] },
    "nonsense",
  ] });
  assert.deepEqual(out.pointAreas, [
    { name: "Penang Island", depth: 0, points: ["pt_1", "pt_2"] },
    { name: "Sg Ara", depth: 1, points: ["pt_2"] },
  ], "her names, her depths, and the ids of what each carries — nothing else");
  assert.deepEqual(Object.keys(out.pointAreas[0]).sort(), ["depth", "name", "points"]);
  // ⚠️ An empty list is a real instruction, not silence: deleting her last area has to take the
  // headings off a page that is already open.
  assert.deepEqual(mergeStorefront({ pointAreas: [{ name: "Gone", depth: 0, points: [] }] },
    { pointAreas: [] }).pointAreas, []);
  assert.equal(mergeStorefront({ pointAreas: [{ name: "Kept", depth: 0, points: [] }] }, { name: "X" })
    .pointAreas[0].name, "Kept", "and a payload that says nothing about areas leaves them alone");
  assert.equal(mergeStorefront({}, { pointAreas: [{ name: "X", depth: "rubbish" }] })
    .pointAreas[0].depth, 0, "a depth the page cannot read is top level, never a guess");
});

test("★★ the address reaches the shop ONLY when she ticked it, and only when there is one", () => {
  // ⚠️⚠️ THE FIRST TIME A STREET ADDRESS HAS EVER BEEN PUBLISHED FROM THIS APP. The whitelist is
  // what decides it here, one step after publishPoints sent it — **a field a sender publishes and
  // a receiver does not keep was never sent**, the fault that shipped at v406 and again at v407.
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Sg Ara", showAddress: true, address: "12 Jalan Bunga, 11500 Air Itam" },
    { id: "pt_2", name: "Prai", showAddress: false, address: "9 Jalan Ria" },
    { id: "pt_3", name: "Blank tick", showAddress: true, address: "   " },
    { id: "pt_4", name: "No switch", address: "1 Jalan Lain" },
  ] });
  const by = (id) => out.points.find((p) => p.id === id);
  assert.equal(by("pt_1").address, "12 Jalan Bunga, 11500 Air Itam", "ticked: the address arrives");
  assert.equal("address" in by("pt_2"), false, "not ticked: no address key at all");
  assert.equal("address" in by("pt_3"), false, "ticked but blank: nothing to print");
  assert.equal("address" in by("pt_4"), false,
    "⚠️ an address with NO switch reads as not shown — the safe way round, and what every payload sent before today means");
  // ⚠️ And the private things still never reach here, whatever the switch says.
  const blob = JSON.stringify(out.points);
  assert.equal(blob.includes("Aunty Lim"), false, "the receiver is never published");
  assert.equal(blob.includes("60123456789"), false, "nor their phone");
});

test("★ the shop draws her area headings, and the places under them", () => {
  const realP = CONFIG.points;
  const realA = CONFIG.pointAreas;
  // ⚠️ Read through the TEXT NODES — this shim's text nodes carry no `textContent`, so a
  // `.textContent` read would return "" for every row and the test would pass against nothing.
  const kids = () => registry["point-list"].children.map((n) => (String(n.className).includes("point-area")
    ? `# ${n.children[0].text}` : n.children[0].children[0].text));
  try {
    CONFIG.points = [
      { id: "pt_loose", name: "Somewhere unfiled", minOrderRM: 0 },
      { id: "pt_island", name: "Penang Island", minOrderRM: 0 },
      { id: "pt_sgara", name: "Sg Ara", minOrderRM: 0, isKitchen: true },
      { id: "pt_prai", name: "Chai Leng Park, Prai", minOrderRM: 0 },
    ];
    // ⚠️ The list arrives in the SHOP'S order — the loose block first, then each area — because the
    // app publishes it that way (`shopPointOrder`). This page only reads it out.
    CONFIG.pointAreas = [
      { name: "Penang Island", depth: 0, points: ["pt_island", "pt_sgara"] },
      { name: "Prai", depth: 0, points: ["pt_prai"] },
    ];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.deepEqual(kids(), [
      "Somewhere unfiled",       // no heading — a real place, drawn first, never hidden
      "# Penang Island",         // the heading, drawn once
      "Penang Island",           // ⚠️ her own Point, named after the area it is filed in
      "Sg Ara",
      "# Prai",
      "Chai Leng Park, Prai",
    ], "her headings, each drawn ONCE in front of the first Point under it");

    // ⚠️ NO AREAS AT ALL IS THE PAGE IT HAS ALWAYS BEEN — no headings, and the invented kitchen row
    // back, because nothing is marked as the kitchen in this fixture's second life.
    CONFIG.pointAreas = [];
    CONFIG.points = [{ id: "pt_1", name: "Farlim, Air Itam", minOrderRM: 0 }];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.deepEqual(kids(), ["Our kitchen", "Farlim, Air Itam"],
      "with no areas the page is byte-for-byte the page it was before this version");

    // ★ AND THE ADDRESS, ON THE ROW SHE TICKED AND NO OTHER.
    CONFIG.points = [
      { id: "pt_1", name: "Shown", minOrderRM: 0, address: "12 Jalan Bunga" },
      { id: "pt_2", name: "Hidden", minOrderRM: 0 },
    ];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    // ⚠️ Found by NAME, not by position: with no kitchen marked the invented "Our kitchen" row is
    // drawn first, so `children[0]` is that row and an index would have asserted about the wrong
    // Point entirely.
    const rowFor = (nm) => registry["point-list"].children.find((r) =>
      r.children[0] && r.children[0].children[0] && r.children[0].children[0].text === nm);
    // ⚠️ `.includes`, not `===` — the span wears `point-sub point-addr`, because it keeps the
    // description's typography rather than being a class of its own.
    const addrOf = (nm) =>
      (rowFor(nm).children.find((c) => String(c.className).includes("point-addr")) || null);
    assert.ok(addrOf("Shown"), "the ticked Point carries an address line");
    assert.equal(addrOf("Hidden"), null,
      "and a Point she has not ticked carries none — the line cannot leak from the row above");
    assert.equal(addrOf("Shown").children[0].text, "12 Jalan Bunga");
  } finally {
    CONFIG.points = realP;
    CONFIG.pointAreas = realA;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v410: the place list IS the self-collect choice ──────────────────────────

test("★★ tapping a place chooses SELF COLLECT too — the two are one piece", () => {
  // Her words: __"there is 2 main selection, select self collect and a drop drown appear, should
  // not be in present interface"__. There are two ways to get an order, not three questions: the
  // places a customer can collect from are PART of choosing to collect, so a tap on one settles
  // both — ⚠️ **there is no longer a world where somebody has picked a place but has not said they
  // are collecting, or has said collecting and not said where.**
  const realP = CONFIG.points;
  try {
    CONFIG.points = [
      { id: "pt_kitchen", name: "Our place", minOrderRM: 0, isKitchen: true },
      { id: "pt_farlim", name: "Farlim, Air Itam", minOrderRM: 0 },
    ];
    // ⚠️ COURIER FIRST, and the order matters: it is the state in which the OLD page took the
    // places away, so asserting it before the tap is what makes the assertion the one that fires.
    // (Written the other way round, a fault that re-hid the list failed the tap assertion instead
    // and this one was never reached — a test whose guard is not the line it is named for.)
    // ⚠️ CHOOSING THE COURIER FOLDS THE CARD (v412) — the places are still BUILT, they are simply
    // not shown. ⭐ That is what her "hole" was: white place rows sitting open in a card the
    // customer had already decided against. This assertion used to read the opposite way, and the
    // change is deliberate and hers.
    document.getElementById("fulfillment")._value = "courier";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.ok(document.getElementById("point-list").children.length >= 2,
      "the places are still built, so opening the card again costs nothing");
    assert.equal(document.getElementById("point-list").hidden, true,
      "but choosing the courier folds the card shut");
    document.getElementById("fulfillment")._value = "collect";
    document.getElementById("fulfillment")._pointId = "";
    document.getElementById("fulfillment")._open = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    const places = document.getElementById("point-list").children;
    assert.ok(places.length >= 2, "the places are drawn inside the collect card");
    // ⚠️ WHERE THEY LIVE — inside the self-collect card rather than in a box of their own — is
    // asserted against the MARKUP in store-i18n.test.js, because this shim carries no static HTML
    // and so cannot see the card at all. What it CAN drive is the behaviour the tap causes.
    assert.equal(places[0].parentElement, document.getElementById("point-list"),
      "the rows are in the list the script fills");

    places[1]._listeners.click[0](); // the second place, i.e. Farlim
    const wrap = document.getElementById("fulfillment");
    assert.equal(wrap._value, "collect", "⚠️ the tap chose self collect as well as the place");
    assert.equal(wrap._pointId, "pt_farlim", "and the place it was on");

    // ⚠️ AND STILL DRAWN AFTER A REPAINT WHILE COURIER IS THE CHOICE — the hiding used to happen on
    // exactly this path (refreshPointList), not at the moment of a tap, so it is checked here too.
    document.getElementById("fulfillment")._value = "courier";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(document.getElementById("point-list").children.length, places.length,
      "and it is still true after a repaint");
  } finally {
    CONFIG.points = realP;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v436: a change that takes something away asks first ──────────────────────

// The three things every test below needs: two places, one of them NAMED THE WAY A REAL ONE IS —
// with a full stop at the end, because the shop prints the name as a sentence under each place and
// that is where the doubled stop came from.
function withAsks(fn) {
  const realP = CONFIG.points;
  try {
    CONFIG.points = [
      { id: "pt_kitchen", name: "Our place", minOrderRM: 0, isKitchen: true },
      { id: "pt_farlim", name: "Farlim, Air Itam.", minOrderRM: 0 },
    ];
    // ⚠️ THE PAGE ARRIVES WITH THE QUESTION SHUT — `hidden` is on the element in store/index.html —
    // and this shim carries no markup, so it cannot read that. **The one line that stands in for it
    // is here rather than in each test**, and the opening state itself is pinned against the HTML in
    // shop-info-card.test.js, where there IS a page to read.
    document.getElementById("ask-scrim").hidden = true;
    fn();
  } finally {
    CONFIG.points = realP;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
}
const askScrim = () => document.getElementById("ask-scrim");
const askBody = () => document.getElementById("ask-body").textContent;
const pressAsk = (which) => document.getElementById(which)._listeners.click[0]();
// ★★★ AND ONE ITEM IN THE BASKET, BECAUSE STEP 3 IS SHUT WITHOUT ONE (v456). Her words: __"lock the 2
// delivery cards too"__. ⚠️ **The three tests below are about ASKING before he changes how he gets his
// order — and that is an act INSIDE step 3.** ⭐ Their subject has not changed at all; what changed is
// that **the shop no longer lets a customer walk into step 3 with step 2 unfinished.** So they now
// arrive the way a customer does. ⚠️ A test that reached step 3 any other way would be testing a route
// the shop no longer has, and would pass whether the lock worked or not.
function addOneItem() {
  const stepper = stepperIn(registry["menu"].children[0]);
  stepper.children[2]._listeners.click[0](); // "+"
  assert.equal(registry["bar-count"].textContent, "1 item",
    "★ nothing went into the basket, so step 3 is still shut and this fixture proves nothing");
}
// Choose the second place. ⚠️ Set up AFTER `render()`, because wiring runs once at startup and a
// repaint does not re-choose anything for the customer.
function chooseFarlim() {
  const wrap = document.getElementById("fulfillment");
  wrap._value = "collect"; wrap._open = "collect"; wrap._pointId = ""; wrap._pointName = "";
  render();
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  addOneItem(); // ★ v456: step 3 does not open on an empty basket
  const places = document.getElementById("point-list").children;
  assert.ok(places.length >= 2, "the places were not drawn, so this proves nothing");
  places[1]._listeners.click[0]();
  assert.equal(wrap._pointId, "pt_farlim", "the place was not chosen, so this proves nothing");
}

test("★★ changing how he gets his order asks FIRST, and nothing moves until he answers", () => {
  // Her words: __"a confirmation pop up, asking whether customer intend to change to delivery? the
  // point selection will be cleared, vise versa"__ — ⭐ the rule she gave me for posting days at v404,
  // *taking something away always asks first*.
  // ⚠️⚠️ AND WHAT IT IS FOR: a customer who picked a point and then switched to delivery was left
  // looking at **a point still selected**, with nothing saying whether it still applied to his
  // order — the fault v416 named, of a page that has answered its own question.
  withAsks(() => {
    chooseFarlim();
    const wrap = document.getElementById("fulfillment");
    assert.equal(askScrim().hidden, true, "no question is up to begin with");

    wrap._pressWay("courier");

    assert.equal(askScrim().hidden, false, "★ the change went through without asking — it took his place away silently");
    assert.equal(wrap._value, "collect", "⚠️ and the way moved while the question was still open");
    assert.equal(wrap._pointId, "pt_farlim", "nor should his place have moved yet");
    // ⭐ THE QUESTION NAMES WHAT IS LOST — and the point's own full stop is not doubled into the
    // sentence around it. The real names end with one.
    assert.match(askBody(), /Farlim, Air Itam/, "the question does not name the place he is losing");
    assert.doesNotMatch(askBody(), /Itam\.\s*\./, "★ the point's own full stop was doubled in the sentence");

    pressAsk("ask-change");
    assert.equal(askScrim().hidden, true, "the question did not close");
    assert.equal(wrap._value, "courier", "his answer did not take effect");
    assert.equal(wrap._pointId, "", "★★ and the place he picked was NOT cleared");
    assert.equal(wrap._pointName, "", "its name went with it");
  });
});

test("★★ and KEEP leaves everything exactly as it was", () => {
  // The other half, and the one that must not be forgotten: a question is only a question if the
  // quiet answer is a real one. ⚠️ The press that opened it must not half-apply.
  withAsks(() => {
    chooseFarlim();
    const wrap = document.getElementById("fulfillment");
    const before = { v: wrap._value, p: wrap._pointId, n: wrap._pointName };
    wrap._pressWay("courier");
    pressAsk("ask-keep");

    assert.equal(askScrim().hidden, true, "the question did not close");
    assert.equal(wrap._value, before.v, "★ answering keep still changed the way");
    assert.equal(wrap._pointId, before.p, "and it took his place");
    assert.equal(wrap._pointName, before.n, "or its name");
  });
});

test("★ a change that costs him NOTHING is not interrupted", () => {
  // ⚠️ A question guarding nothing is noise on a page that already carries four notices a customer
  // must read. Nothing chosen here, so nothing can be lost.
  withAsks(() => {
    const wrap = document.getElementById("fulfillment");
    wrap._value = "collect"; wrap._open = "collect"; wrap._pointId = ""; wrap._pointName = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    addOneItem(); // ★ v456: and the way cannot be chosen on an empty basket

    wrap._pressWay("courier");
    assert.equal(askScrim().hidden, true, "★ he was asked to confirm a change that took nothing from him");
    assert.equal(wrap._value, "courier", "and the change did not go through");
  });
});

test("★★★ the two delivery cards choose NO way for an empty basket — and they say why (v456)", () => {
  // Her words: __"i skip step 2 and filled up step 3, it should not allow me to do step 3 at all?"__
  // and then, after I had locked only the two boxes she named: __"lock the 2 delivery cards too"__.
  // ⚠️ **The customer could still choose how to receive an order he had not placed.**
  const wrap = document.getElementById("fulfillment");
  // ⚠️⚠️ THE ARRIVAL STATE IS SET BY HAND, AND THE REASON MATTERS: **`render()` does NOT reset the
  // choice.** `apply("")` runs once, when `wireFulfillment()` is wired at start-up — so a test that
  // calls `render()` inherits the way the PREVIOUS test left behind. ⭐ That is not a fault in the shop
  // (a real customer's page is wired once and the after-order reset puts the way back through
  // `_resetFulfillment`), but it silently made this fixture start on "courier", which is why the guard
  // looked as though it had not fired at all.
  wrap._value = ""; wrap._open = null; wrap._picked = false;
  wrap._pointId = ""; wrap._pointName = "";
  render();
  tapDay(); // ★ step 1 is his; the basket is deliberately left EMPTY, which is the whole subject
  assert.equal(registry["bar-count"].textContent, "0 items", "precondition: nothing is in the basket");

  wrap._pressWay("courier");

  assert.equal(wrap._value, "", "★ a way was chosen for an order with nothing in it");
  assert.equal(wrap._open, null, "★ and its card was unfolded over an empty basket");
  assert.notEqual(wrap._picked, true,
    "★ he was credited with a choice he was never allowed to make, so step 3 could green on it");
  // ⭐⭐ AND IT ANSWERS. ⚠️ v452's rule, which this very file states out loud: **a disabled control on a
  // phone does not even acknowledge the tap**, so switching the card off would tell him nothing at all.
  const note = registry["step-note"];
  assert.equal(note.hidden, false, "★ the press was refused in silence");
  assert.equal(note.children[0].children[0].text, "Nothing in your order yet.",
    "★ the refusal does not say what is missing");
  // ⚠️ WHERE THE LINE LANDS IS A RULE OF ITS OWN — see test/step-lock.test.js, which pins that a refusal
  // is addressed to its own step, because a step-2 sentence printed under step 1 is her v455 fault back.
  assert.doesNotMatch(note.children[2].text, /Courier|delivery/i,
    "★ the refusal is talking about the card he pressed rather than about the basket that is empty");

  // ⭐ AND NOTHING ELSE ANSWERS EITHER — the other card, and a card already the current way.
  wrap._pressWay("collect");
  assert.equal(wrap._value, "", "★ the other card chooses a way for an empty basket");
  assert.equal(wrap._open, null, "★ …and unfolds itself over one");
});

test("★★ a PLACE tap is the same change, so it asks too — and the place travels with the answer", () => {
  // ⚠️ v410 made the places PART of choosing to collect, and this file's own test says it: *"there
  // is no longer a world where somebody has picked a place but has not said they are collecting."*
  // ⭐ **So this is the same change from the other side, and leaving it silent would keep a second
  // door into the very state she asked me to prevent.** ⚠️ And the place must be chosen only ONCE
  // HE ANSWERS — choosing it first would leave a refused tap holding a place on a courier order.
  withAsks(() => {
    const wrap = document.getElementById("fulfillment");
    const addr = document.getElementById("address-input");
    wrap._value = "courier"; wrap._open = "courier"; wrap._pointId = ""; wrap._pointName = "";
    addr.value = "12 Jalan Bunga, 10450 Penang";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens

    const places = document.getElementById("point-list").children;
    assert.ok(places.length >= 2, "the places were not drawn, so this proves nothing");
    places[1]._listeners.click[0]();

    assert.equal(askScrim().hidden, false, "★ tapping a place switched him to collecting without a word about his address");
    assert.equal(wrap._value, "courier", "⚠️ and it moved him while the question was open");
    assert.equal(wrap._pointId, "", "★ and it took the place before he had answered");

    pressAsk("ask-change");
    assert.equal(wrap._value, "collect", "his answer did not take effect");
    assert.equal(wrap._pointId, "pt_farlim", "★ and the place he tapped was not taken with it");
    assert.equal(addr.value, "", "★★ and his delivery address was NOT cleared");
  });
});

// ── v412: the Self collect card arrives folded ───────────────────────────────

test("★★ the Self collect card arrives FOLDED, and its own line is the handle", () => {
  // Her words: __"i want the self collect card at store to be folded as default"__, and __"when it
  // expend the unselected with a white background is like a hole, and like confusing"__ — ⚠️ which is
  // exactly what an open card full of white place rows does while the customer has already chosen
  // the courier. It reads as a white hole punched in the page at the moment they went the other way.
  const realP = CONFIG.points;
  try {
    CONFIG.points = [
      { id: "pt_k", name: "Our place", minOrderRM: 0, isKitchen: true },
      { id: "pt_f", name: "Farlim, Air Itam", minOrderRM: 0 },
    ];
    // ⚠️ RESET WHAT THE LAST TEST LEFT. The shim's `#fulfillment` is one element for the whole file
    // and `wireFulfillment` ran once, at import — so the method and the fold are carried over unless
    // this test says otherwise. Setting them here is the test being explicit, not the code being wrong.
    document.getElementById("fulfillment")._value = "collect";
    document.getElementById("fulfillment")._open = null;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    const wrap = document.getElementById("fulfillment");
    const list = document.getElementById("point-list");
    const caret = () => document.getElementById("collect-caret").textContent;

    assert.equal(list.hidden, true, "⚠️ it ARRIVES SHUT — that is the whole request");
    assert.equal(caret(), "▸", "and the caret points at what is behind it");
    assert.equal(wrap._value, "collect", "while still being the way it is set to — a customer need do nothing");

    // ⚠️ ONEPENING IT IS WHAT THE CUSTOMER'S TAP DOES — driven here through the same state that tap
    // sets, because ⚠️ **this shim carries no static markup, so it cannot reach the line a customer
    // presses.** The WIRING is therefore verified by looking at the page (and the markup rules that
    // it starts shut and wears a caret live in store-i18n.test.js); what is proved HERE is what the
    // screen does with the state the tap produces.
    wrap._open = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(list.hidden, false, "an open card shows its places");
    assert.equal(caret(), "▾", "and the caret turns over");

    wrap._open = null;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(list.hidden, true, "and a shut one shows none");

    // ⭐⭐ AND THE COURIER SHUTS IT WHATEVER THE FLAG SAYS. This is the "hole" itself — an open card
    // full of white rows in the way the customer did NOT take — and it is kept out of the DRAWING
    // rather than out of the one tap that sets it, so no repaint can bring it back.
    wrap._open = "collect";
    wrap._value = "courier";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(list.hidden, true,
      "choosing the courier means nothing white is left standing open, however the fold was left");
  } finally {
    CONFIG.points = realP;
    document.getElementById("fulfillment")._open = null;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

test("★★ a Point's own description replaces the shop's standard line", () => {
  // Her words: __"make the point description custmable in point card"__. ⭐ **The standard sentence
  // is the FALLBACK, not the default** — so a Point she has said nothing about reads exactly as it
  // does today and adding this cannot change a page by itself.
  const realP = CONFIG.points;
  try {
    CONFIG.points = [
      { id: "pt_a", name: "With words", minOrderRM: 0, description: "Aunty Lim's shop, beside the coffee shop" },
      { id: "pt_b", name: "Without words", minOrderRM: 0 },
      { id: "pt_c", name: "The kitchen", minOrderRM: 0, isKitchen: true },
      { id: "pt_d", name: "Kitchen with words", minOrderRM: 0, isKitchen: false, description: "Where we bake, behind the school" },
    ];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    const list = document.getElementById("point-list");
    // ⚠️ Read off `children`, because this shim has no element-level `querySelectorAll`.
    const subs = list.children
      .filter((b) => String(b.className).includes("point-opt"))
      .map((b) => ({ name: b.children[0].children[0].text, sub: b.children[1].children[0].text }));
    const subFor = (nm) => (subs.find((s) => s.name === nm) || {}).sub;
    assert.equal(subFor("With words"), "Aunty Lim's shop, beside the coffee shop",
      "her words are what a customer reads");
    assert.match(subFor("Without words"), /Collection Point/,
      "and the standard sentence stands in where she has written none");
    assert.match(subFor("The kitchen"), /where your treats are made/i, 
      "the marked kitchen keeps its own line too, until she writes one");
    assert.match(subFor("Kitchen with words"), /behind the school/,
      "⚠️ and her words outrank even the kitchen's — she wrote them about her own front door");
  } finally {
    CONFIG.points = realP;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

test("the shop keeps a Point's description, and adds it to nothing else (v412)", () => {
  // ⚠️ THE PUBLISH/MERGE PAIR AGAIN. A field a sender publishes and a receiver drops was never sent —
  // the fault that shipped at v406 and again at v407, and this is the third key through the same door.
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Written", description: "  Aunty Lim's shop  " },
    { id: "pt_2", name: "Blank", description: "   " },
    { id: "pt_3", name: "None" },
  ] });
  assert.equal(out.points[0].description, "Aunty Lim's shop", "trimmed, and kept");
  assert.equal("description" in out.points[1], false, "a blank one arrives as nothing");
  assert.equal("description" in out.points[2], false, "and an absent one gains no key");
});

test("the shop keeps a Point's days, and keeps ONLY a real restriction (v419)", () => {
  // ⚠️ THE PUBLISH/MERGE PAIR AGAIN — the fourth key through the same door, and the fault it guards
  // is always the same one: **a field a sender publishes and a receiver drops was never sent.**
  const out = mergeStorefront({}, { points: [
    { id: "pt_1", name: "Fridays only", days: [5] },
    { id: "pt_2", name: "Open always" },
    { id: "pt_3", name: "Nothing ticked", days: [] },
    { id: "pt_4", name: "All seven", days: [0, 1, 2, 3, 4, 5, 6] },
    { id: "pt_5", name: "Junk", days: [5, 5, 9, -1, "x", null] },
    { id: "pt_6", name: "Not a list", days: "Friday" },
  ] });
  const by = (id) => out.points.find((p) => p.id === id);
  assert.deepEqual(by("pt_1").days, [5], "a real restriction arrives");
  assert.equal("days" in by("pt_2"), false, "no days at all: no key — byte-for-byte yesterday's row");
  assert.equal("days" in by("pt_3"), false, "⚠️ nothing ticked is EVERY day, so it is not a restriction");
  assert.equal("days" in by("pt_4"), false,
    "⚠️ and all seven is the SAME answer as none — a line saying 'every day' would say nothing");
  assert.deepEqual(by("pt_5").days, [5],
    "⚠️ re-validated on the shop's OWN terms: deduped, sorted, and 9, -1, 'x' AND null dropped — "
    + "⚠️⚠️ null is NOT zero, or a hole in a half-synced array would promise Sunday");
  assert.equal("days" in by("pt_6"), false, "a string is not a list of days");
});

test("★★ a Place served on only some days SAYS SO — and every Place still draws (v419)", () => {
  // Her words: __"every point listed in store, just that if that point only for friday, then
  // mention it"__. ⚠️⚠️ SO NOTHING IS HIDDEN, GREYED OR FILTERED — the list is the same length, every
  // Place is exactly where it was, and the restricted one simply carries ONE MORE LINE.
  const realP = CONFIG.points;
  try {
    CONFIG.points = [
      { id: "pt_k", name: "Sg Ara", minOrderRM: 0, isKitchen: true },
      { id: "pt_a", name: "Fridays only", minOrderRM: 0, days: [5] },
      { id: "pt_b", name: "Open always", minOrderRM: 0 },
      { id: "pt_c", name: "Two days", minOrderRM: 0, days: [1, 3] },
    ];
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    const list = document.getElementById("point-list");
    // ⚠️ Read off `children`, because this shim has no element-level `querySelectorAll`.
    const rows = list.children.filter((b) => String(b.className).includes("point-opt"));
    const daysOf = (nm) => {
      const b = rows.find((r) => r.children[0] && r.children[0].children[0]
        && r.children[0].children[0].text === nm);
      if (!b) return "(no such row)";
      const span = (b.children || []).find((c) => String(c.className || "").includes("point-days"));
      return span ? String(span.children[0].text) : "";
    };
    assert.equal(rows.length, 4, "⚠️⚠️ every Place is still listed — nothing was filtered away");
    assert.equal(daysOf("Fridays only"), "Only available on Fri", "the single day is named");
    assert.equal(daysOf("Two days"), "Only available on Mon and Wed",
      "and a pair is joined the way a person says it, not as a raw list of numbers");
    assert.equal(daysOf("Open always"), "",
      "⚠️ and NO line at all for a Place she has not restricted, so the page she never touched is unchanged");
    assert.equal(daysOf("Sg Ara"), "", "the kitchen's own row is untouched by this too");
  } finally {
    CONFIG.points = realP;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ⚠️ THE POSTING DAY IS DRIVEN THROUGH `deliveryDays`, and the page always opens on the FIRST open day
// from tomorrow — so one weekday means the page is ALWAYS showing that weekday, whatever today is.
function withBakeDay(day, points) {
  const realP = CONFIG.points, realDays = CONFIG.deliveryDays;
  CONFIG.deliveryDays = [day];
  CONFIG.points = points;
  render();
  tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  return () => { CONFIG.points = realP; CONFIG.deliveryDays = realDays; render(); };
}

const POINT_ROWS = (list) => list.children.filter((b) => String(b.className).includes("point-opt"));
const ROW_NAMED = (rows, nm) => rows.find((r) => r.children[0] && r.children[0].children[0]
  && r.children[0].children[0].text === nm);

test("★★ a Place not served on the chosen posting day is PARKED — and still listed (v420)", () => {
  // Her words: __"selecting a posting day the point is not active will grey out that point"__. ⚠️⚠️ IT
  // GREYS, IT DOES NOT DISAPPEAR — the same park-don't-hide rule her smallest basket already keeps,
  // and the same look, because to a customer both say one thing: you cannot collect here.
  const restore = withBakeDay(5, [ // 5 = Friday, so the day this page is showing is a Friday
    { id: "pt_k", name: "Sg Ara", minOrderRM: 0, isKitchen: true },
    { id: "pt_fri", name: "Friday place", minOrderRM: 0, days: [5] },
    { id: "pt_mon", name: "Monday place", minOrderRM: 0, days: [1] },
    { id: "pt_any", name: "Any day place", minOrderRM: 0 },
  ]);
  try {
    const rows = POINT_ROWS(document.getElementById("point-list"));
    assert.equal(rows.length, 4, "⚠️⚠️ EVERY place is still on the page — nothing was removed");
    const off = (nm) => String(ROW_NAMED(rows, nm).className).includes("off");
    assert.equal(off("Friday place"), false, "the place served on the day he picked is open");
    assert.equal(off("Monday place"), true, "⚠️ and the one that is not is parked");
    assert.equal(off("Any day place"), false,
      "⚠️⚠️ A PLACE WITH NO DAYS AT ALL IS SERVED EVERY DAY — a missing key is NOT 'never', and "
      + "getting that backwards would take every unrestricted Place off the page");
    assert.equal(off("Sg Ara"), false, "nor is the marked kitchen ever parked");
  } finally { restore(); }
});

test("★ the day flips which place is parked, and ONLY that (v420)", () => {
  const restore = withBakeDay(1, [ // 1 = Monday this time
    { id: "pt_fri", name: "Friday place", minOrderRM: 0, days: [5] },
    { id: "pt_mon", name: "Monday place", minOrderRM: 0, days: [1] },
  ]);
  try {
    const rows = POINT_ROWS(document.getElementById("point-list"));
    const off = (nm) => String(ROW_NAMED(rows, nm).className).includes("off");
    assert.equal(off("Monday place"), false, "on a Monday the Monday place is the open one");
    assert.equal(off("Friday place"), true, "and the Friday place is the parked one");
  } finally { restore(); }
});

test("★★ tapping a parked place FLASHES its own warning, and the page does not move (v423)", () => {
  // Her words: __"when customer click on unavailable point, just flash the warning Only available on,
  // xxx. The screen jump is not desired"__.
  // ⚠️⚠️ THE JUMP WAS `showConfirm`'s OWN `scrollIntoView` — right for the ORDER guards, where he has
  // pressed Place order and must be told why not, and **wrong for a place he merely touched**: the
  // page leapt away from the list he was reading.
  const restore = withBakeDay(5, [
    { id: "pt_mon", name: "Monday place", minOrderRM: 0, days: [1] },
  ]);
  try {
    const list = document.getElementById("point-list");
    const wrap = document.getElementById("fulfillment");
    const row = ROW_NAMED(POINT_ROWS(list), "Monday place");
    row._listeners.click[0]();
    assert.equal(wrap._pointId, "", "⚠️ the tap did not choose a place he cannot collect from");
    assert.ok(String(row.className).includes("flash"), "⚠️ the row flashed instead");

    // ⭐ AND THE WARNING HE NEEDS IS ALREADY ON THE ROW — nothing new is said, and nothing is said
    // twice: the same line he can read before he taps is the line the tap points him at.
    const days = [...(row.children || [])].find((c) => String(c.className || "").includes("point-days"));
    assert.ok(days, "the row carries its own reason");
    assert.equal(String(days.children[0].text), "Only available on Mon", "and it says so");

    // ⚠️ AND THE BOX THAT SCROLLED THE PAGE IS NOT USED AT ALL. The visible effect is "the page did
    // not move", and a unit test cannot see a scroll — so what IS pinned is the door it would have
    // gone through, in the source. (The same reasoning `screen-names.test.js` gives for its pins.)
    const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
    assert.match(src, /if \(closed\) \{ flashRow\(b\); return; \}/,
      "⚠️⚠️ a parked place goes to the FLASH — it never reaches the confirm box");
    assert.ok(!/if \(closed\) \{ showConfirm/.test(src),
      "⚠️ and the old page-moving path is gone, not merely unused");
  } finally { restore(); }
});

test("★★ a parked place greys its WORDING, not its background (v425)", () => {
  // Her words: __"the unavailable point grey out is not the background grey out but wording grey
  // out"__. ⚠️ It filled with `--bg`, the PAGE cream, so a row inside the card's tint became a flat
  // page-coloured patch — **the same "hole" she caught at v413**, in a place she had not looked at
  // yet. ⭐ The row keeps the card's own surface now and is set apart the way reading works: **the
  // words go grey and the frame goes dashed**, and the two cues are kept together on purpose —
  // either alone is a colour-only signal.
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  for (const cls of [".point-opt.short", ".point-opt.off"]) {
    const at = css.indexOf(`${cls} {`);
    assert.ok(at > -1, `${cls} has a rule of its own`);
    const rule = css.slice(at, css.indexOf("}", at));
    assert.ok(!/background\s*:/.test(rule),
      `⚠️⚠️ ${cls} must not FILL its background — that is the hole she is complaining about, and it is `
      + `not the grey-out`);
    assert.match(rule, /border-style:\s*dashed/, `⚠️ and ${cls} keeps the dashes`);
  }

  // ⚠️⚠️ THE FADE IS `opacity`, AND IT IS TWO VALUES — her second telling was __"the grey not
  // obvious"__, and the first attempt proved her right: `--muted` is a WARM BROWN at 5.40:1, which
  // reads as ordinary text beside the body copy at 13px, so the row did not look unavailable at all.
  // ⭐ The numbers were measured against the card before choosing them, and the ASSERTION carries them
  // so a later tidy cannot quietly soften the fade again.
  assert.match(css, /\.point-opt\.off \.point-name,[\s\S]{0,140}opacity:\s*\.42/,
    "⚠️ the NAME fades hard — 42% is 2.40:1, unmistakably pale");
  assert.match(css, /\.point-opt\.off \.point-sub:not\(\.point-days\)[\s\S]{0,80}opacity:\s*\.42/,
    "⚠️ and so does the ordinary description");
  // ⚠️⚠️ AND THE LINE CARRYING THE REASON MUST **NOT** BE FADED — a correction to this very test
  // (v426). It used to assert 70% here, and 70% was WRONG: that line's colour is ALREADY `--muted`,
  // inherited from `.point-sub`, so folding a 70% opacity over it gave **2.94:1** — not the 5.21 the
  // comment claimed. ⭐ **I measured the colour and then applied a second fade over it, and the two
  // compound.** `--muted` at FULL strength is **5.40:1**, over the bar this app holds its accents to,
  // and her words were __"it is abit too fade"__. **She found it by reading the page.**
  assert.match(css, /\.point-opt\.off \.point-days,[\s\S]{0,160}opacity:\s*1;/,
    "⚠️⚠️ the reason line must NOT be faded a second time — its own colour is already the faded tone");

  // ⚠️⚠️ `:not(.point-days)` IS LOAD-BEARING, not tidiness: the days line wears `.point-sub
  // point-days` too, so a plain `.point-sub` rule at 42% would fade the very line being kept readable.
  assert.match(css, /\.point-opt\.off \.point-sub:not\(\.point-days\)/,
    "⚠️ the description rule must EXCLUDE the days line, which is also a .point-sub");

  // ⚠️⚠️ AND THE FLASH ENDS ON THE LINE'S RESTING COLOUR, WHICH IS THE WHOLE CRAFT OF IT (v426). Her
  // ask was __"can you flash the only available on friday in red color?"__ ⚠️ The line INHERITS its
  // colour from `.point-sub`, which is `--muted` — so a keyframe ending on anything else would flash
  // red and then SNAP the moment the animation let go.
  assert.match(css, /--red:\s*#c0392b/i,
    "⚠️ the shop's own red — the whole page is terracotta, so a borrowed 'red' would arrive looking "
    + "like the brand colour rather than standing out");
  // ⚠️⚠️ AND THE FLASH TOUCHES THE COLOUR ONLY. If it animated `opacity` too it would compound with
  // the fade again — which is exactly the mistake corrected just above, and the one that put a
  // warning at 2.94:1 in the first place.
  assert.ok(!/@keyframes point-flash-word \{[\s\S]{0,160}opacity/.test(css),
    "⚠️ the flash animates the COLOUR and nothing else — an opacity in here would fold a second fade "
    + "onto a line whose colour is already the faded tone");

  // ⚠️⚠️ AND THE KEYFRAME'S TWO COLOURS ARE WRITTEN OUT, SO THEY HAVE TO BE TIED BACK TO THE TOKENS.
  // They are literals because a `var()`-to-`var()` pair **did not interpolate** — the animation ran,
  // its name was on the element, and the colour never moved. ⭐ That freedom is exactly what lets the
  // numbers drift away from the words, so this is the check that stops it.
  const token = (n) => (css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
  // ⚠️ THE CYCLE **ENDS** ON `--muted`'s OWN VALUE — that is what keeps the line from snapping back
  // when the animation lets go. ⚠️ It does not START on it: her cycle OPENS on the red, because "on
  // for a second" means it is already on when it begins.
  assert.equal((css.match(/\d+%, 100% \{ color: (#[0-9a-fA-F]{6}); \}/) || [])[1],
    token("muted"), "⚠️ the flash ends on the colour the line actually rests at, or it snaps");
  assert.equal((css.match(/@keyframes point-flash-word \{[\s\S]{0,900}?0%, \d+% \{ color: (#[0-9a-fA-F]{6}); \}/) || [])[1],
    token("red"), "⚠️ and it OPENS on the red — 'on for a second' means already on");
  assert.equal((css.match(/\d+%, \d+% \{ color: (#[0-9a-fA-F]{6}); \}\s*\/\* --red/) || [])[1],
    token("red"), "⚠️ and flashes --red's own value");

  // ⚠️⚠️ AND THE ASSERTION THAT MATTERS IS HOW MANY MILLISECONDS OF RED THERE ARE — not the duration,
  // not the window, but the product of the two. Her words, TWICE: __"the red is too short time"__, and
  // then __"still too short"__ after the first increase. ⭐ **Measured as the customer gets it:**
  // 215ms first, then ~590ms, and both were too short. ⚠️ **The eye wants more than half a second to
  // take a line in AND use it** — so this asserts a full second per blink, and a later tidy that
  // softens either number fails here rather than on her phone.
  // ⭐ The pale gap between blinks is deliberate and must stay: **a line that simply stays red is a
  // colour change; a line that BLINKS is something happening.**
  // ⭐⭐ AND THE TWO STRETCHES ARE HER NUMBERS, NOT MINE: __"on 1sec, off 0.5sec cycle"__. ⚠️ She has
  // now told me this three times — *"the red is too short time"*, *"still too short"*, and then the
  // timing itself — so the TEST carries her figures rather than a floor of my choosing.
  const blinkMs = Number((css.match(/--flash-blink:\s*(\d+)ms/) || [])[1]);
  const win = (css.match(/(\d+)%,\s*(\d+)% \{ color: #[0-9a-fA-F]{6}; \}\s*\/\* --red/) || []);
  const pale = (css.match(/(\d+)%, 100% \{ color: #[0-9a-fA-F]{6}; \}\s*\/\* --muted/) || []);
  const onAt = Number(win[1]), offAt = Number(win[2]);
  const redMs = Math.round(blinkMs * (offAt - onAt) / 100);
  const paleMs = pale.length ? Math.round(blinkMs * (100 - Number(pale[1])) / 100) : 0;

  assert.ok(redMs >= 1000,
    `⚠️⚠️ ${redMs}ms of red per blink — she asked for a full second, and you cannot read a word in less`);
  assert.ok(paleMs >= 400 && paleMs <= 600,
    `⚠️ the OFF stretch is ${paleMs}ms — she asked for half a second, and the gap is what makes it a `
    + `BLINK rather than a colour change`);
  assert.equal(offAt < Number(pale[1]), true,
    "⚠️ the red really does end before the pale starts — the crossfade between them is deliberate, but "
    + "the two stretches must not overlap");
});

test("★★ the number of blinks and the timer come from ONE place (v427)", () => {
  // Her words: __"can you flash the red twice or trice"__ — ⚠️ **and asking for MORE blinks is exactly
  // what exposed the coupling.** How long the flashing runs lives in the stylesheet; the moment the
  // mark comes OFF lives in `flashRow`'s timer. ⚠️⚠️ **If they disagree the flash is cut off
  // mid-blink** — and it could only ever have been wrong in that direction, because the timer is the
  // thing that fires while `animation: none` fires nothing at all.
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  const js = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");

  assert.match(css, /--flash-blink:\s*\d+ms;/, "how long ONE red blink lasts");
  assert.match(css, /--flash-blinks:\s*\d+;/, "and how many of them there are");
  assert.match(css, /animation: point-flash-word var\(--flash-blink\) ease-out var\(--flash-blinks\)/,
    "⚠️ the animation takes BOTH numbers from those tokens");

  // ⚠️ AND THE TIMER ASKS RATHER THAN GUESSING. A hard-coded 1200 cut a three-blink flash off in the
  // middle of its second — which is the fault this pins shut.
  assert.match(js, /getPropertyValue\("--flash-blink"\)/, "⚠️ the timer reads the blink length");
  assert.match(js, /getPropertyValue\("--flash-blinks"\)/, "⚠️ and the count");
  assert.match(js, /return each \* many \+ 200;/,
    "⚠️ the total is the blinks times their length, plus a margin so the LAST one finishes");
  assert.ok(!/\}, 1200\);/.test(js),
    "⚠️⚠️ the timer carries no number of its own — that number IS the drift");
});

test("★★ the flash is on the WORDS, not on the row (v424)", () => {
  // Her words, the second and sharper telling: __"i mean just flash the word Only available on Wed,
  // Friday"__. ⚠️ **HER "JUST" IS THE INSTRUCTION.** The row is already greyed and dashed to say *not
  // this one*; what the customer actually needs told is **WHEN it is open**, so the line carrying that
  // is what blinks. ⚠️ v423 pulsed the whole row, and this is her correction of it.
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  assert.match(css, /\.point-opt\.off\.flash \.point-days/,
    "a place not served today flashes the line that carries the days");
  assert.match(css, /\.point-opt\.short\.flash \.point-sub/,
    "⚠️ and a place his basket has not reached flashes the line that carries ITS reason — which is the "
    + "description line, because that sentence REPLACED the description");
  assert.ok(!/^\.point-opt\.flash \{/m.test(css),
    "⚠️ and the row itself no longer pulses as a whole — that was the first reading, corrected");
  assert.match(css, /@keyframes point-flash-word/,
    "⚠️ and it is OPACITY only: no movement, no size, no position, so the words stay exactly where "
    + "they are on the line he is reading");
});

test("★★ the mark comes off on a TIMER — `animation: none` never fires `animationend` (v424)", () => {
  // ⚠️⚠️ A FAULT FIXED, FOUND BY READING THE RULE BACK. v423 set `animation: none` under
  // `prefers-reduced-motion: reduce` and removed the class on `animationend` — **and an animation that
  // never runs never ends.** The mark stayed on that row for good, and a second place tapped left the
  // first one lit as well. ⭐ The reader it would have hit is the one who asked for less movement, and
  // nobody would have thought to look there.
  const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  const at = src.indexOf("const flashRow =");
  const fn = src.slice(at, at + 1800);
  assert.match(fn, /setTimeout\(/, "⚠️ the class is removed on a timer, which always fires");
  assert.ok(!/addEventListener\("animationend"/.test(fn),
    "⚠️⚠️ and NOT on `animationend` — it never fires when the stylesheet sets animation: none");
  // ⚠️ `assert.match` FIRST, and it is not belt-and-braces: `indexOf(x) < indexOf(y)` is TRUE when x is
  // ABSENT (-1 is less than any position), so the order check alone would pass with the clear deleted.
  assert.match(fn, /clearTimeout\(/, "the previous timer is cleared");
  assert.ok(fn.indexOf("clearTimeout") < fn.indexOf("setTimeout"),
    "⚠️ and cleared BEFORE the new one is set, so a quick second tap is not un-flashed by the first");
});

test("★ the flash can fire AGAIN — removing and re-adding a class is not enough on its own (v423)", () => {
  // ⚠️⚠️ A BROWSER COALESCES "remove the class, add it back" IN ONE BREATH INTO NO CHANGE AT ALL, so
  // without a forced reflow between them the **SECOND tap on the same place would flash nothing** —
  // and a courtesy that works once and then silently stops is worse than none.
  //
  // ⚠️ THE REFLOW IS NOT OBSERVABLE FROM A TEST — it is the browser's own timing, and this shim has no
  // layout at all — so the fact is pinned where it lives, in the source, with the reason beside it.
  // ⭐ And the shim would let a reader believe the flash works twice: it fires no `animationend`, so
  // the class never comes off and a behavioural test would pass with the reflow deleted.
  const src = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  assert.match(src, /void b\.offsetWidth;/,
    "⚠️⚠️ the forced reflow is what makes a second tap flash — reading a layout property is the only "
    + "way to make the browser apply the removed class before the new one goes on");
  const flash = src.slice(src.indexOf("const flashRow ="), src.indexOf("const flashRow =") + 700);
  assert.ok(flash.indexOf("classList.remove") < flash.indexOf("offsetWidth")
    && flash.indexOf("offsetWidth") < flash.indexOf("classList.add"),
    "⚠️ and it sits BETWEEN the remove and the add, which is the only place it works");
});

test("★★ a place chosen for one day, on a day it is not served, falls back to the kitchen (v420)", () => {
  // ⚠️ THE DAY CAN MOVE UNDERNEATH A CHOICE ALREADY MADE — he picks a place on the Friday the page
  // opened on, then moves to a Wednesday. ⭐ It is the THIRD reason a place can stop being open —
  // paused, basket too small, and now not served today — and all three fall back the same way,
  // because the shop cannot post an order to a place the customer cannot go to.
  const restore = withBakeDay(5, [
    { id: "pt_mon", name: "Monday place", minOrderRM: 0, days: [1] },
  ]);
  try {
    const wrap = document.getElementById("fulfillment");
    wrap._pointId = "pt_mon";     // as if he had chosen it before the day moved
    wrap._pointName = "Monday place";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(wrap._pointId, "",
      "⚠️ the choice is dropped rather than kept — the kitchen is always there");
  } finally { restore(); }
});

test("★★ the courier's address arrives with the courier, not as a box under it (v412)", () => {
  // Her words: __"courier delivery and address should be one piece"__ — the mirror of the places in
  // the collect card. ⚠️ And the two are ONE state: only one card may be open, so the field of the
  // way the customer did NOT take is never standing open under it.
  const realP = CONFIG.points;
  try {
    CONFIG.points = [{ id: "pt_k", name: "Our place", minOrderRM: 0, isKitchen: true }];
    const wrap = document.getElementById("fulfillment");
    const addr = document.getElementById("address-field");
    const list = document.getElementById("point-list");
    const caret = (which) => document.getElementById(which + "-caret").textContent;

    wrap._value = "collect";
    wrap._open = null;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(addr.hidden, true, "⚠️ on arrival the address is shut in the courier card");
    assert.equal(caret("courier"), "▸", "and the courier says so");

    wrap._open = "courier";
    wrap._value = "courier";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(addr.hidden, false, "opening the courier card shows its address");
    assert.equal(caret("courier"), "▾", "the caret turns over");
    assert.equal(list.hidden, true, "⭐ and the collect card's places are shut behind it");

    // ⚠️ AND THE REVERSE — the two can never both be open, which is what "one piece" means here.
    wrap._open = "collect";
    wrap._value = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(list.hidden, false, "the collect card opens");
    assert.equal(addr.hidden, true, "and the courier's address shuts with it");
    assert.equal(caret("courier"), "▸");
  } finally {
    CONFIG.points = realP;
    document.getElementById("fulfillment")._open = null;
    document.getElementById("fulfillment")._value = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v415: nothing is chosen until he chooses ────────────────────────────────

test("★★ step 3 turns green only after he says HOW he is getting it", () => {
  // Her words: __"only by clicking either self collect or delivery, the number 3 change color"__.
  // ⚠️⚠️ IT CANNOT BE READ OFF THE METHOD ITSELF — `_value` is set to Self collect the moment the
  // page loads, so a rule asking "is a method chosen" is TRUE before a customer has touched
  // anything. ⭐ **What it asks is whether HE chose**, and the only honest record of that is a press.
  //
  // ⚠️ `_picked` is driven here rather than a real tap, because this shim carries no static markup
  // and so cannot reach the button — ⭐ **that half is verified by looking at the page and by the
  // markup rules in store-i18n.test.js.** What is proved here is what the rule does with it.
  const realP = CONFIG.points;
  try {
    CONFIG.points = [{ id: "pt_k", name: "Our place", minOrderRM: 0, isKitchen: true }];
    const wrap = document.getElementById("fulfillment");
    const type = (id, v) => {
      const el = registry[id];
      el.value = v;
      for (const f of (el._listeners.input || [])) f();
    };
    const done3 = () => String(registry["step3"].className).split(/\s+/).includes("done");

    wrap._picked = false;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    type("name-input", "Aunty Bee");
    type("whatsapp-input", "60123456789");
    assert.equal(wrap._value, "collect",
      "⚠️ the method is already set — which is exactly why it cannot be the thing that is asked");
    assert.equal(done3(), false,
      "a name and a number are NOT enough: he has not said how he is getting his bread");

    wrap._picked = true;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(done3(), true, "⭑ the choice, and only the choice, turns the third circle green");

    // ⚠️ AND IT IS STILL HIS NAME AND NUMBER THAT CARRY THE REST — the new condition sits BESIDE
    // them, not instead of them, so a page with neither is not green for having picked a way.
    wrap._picked = true;
    document.getElementById("name-input").value = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(done3(), false, "picking a way with no name is still not done");
  } finally {
    CONFIG.points = realP;
    document.getElementById("fulfillment")._picked = false;
    document.getElementById("name-input").value = "";
    document.getElementById("whatsapp-input").value = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

test("★★ step 1 turns green only after HE picks the day — never for the day the page picks for him", () => {
  // Her words: __"the 1,2,3 in the same round ball"__. ⚠️⚠️ **The three circles were not the same,
  // and this is why.** The first open posting day is chosen FOR him on load — deliberately, so an
  // order can never be blocked by forgetting to tap — and step 1 read *"is a day selected"* as
  // *"he has chosen"*. ⭐ **That is the exact fault step 3 above was built to avoid**, in its own
  // words: *"the page does not credit him with a choice he did not make."*
  //
  // ⭐ So all three circles now ask one question each, and every one of them is about HIM. On load
  // they carry a single colour, and each turns green as he does it — which is both what she asked
  // for and what this shop has always meant by the colour.
  const done1 = () => String(registry["step1"].className).split(/\s+/).includes("done");
  const find = (want) => {
    let hit = null;
    (function walk(n) {
      for (const c of n.children || []) {
        const cls = String(c.className || "");
        if (c.tagName === "BUTTON" && cls.includes("cal-cell") && cls.includes(want)) hit = hit || c;
        walk(c);
      }
    })(registry["dates"]);
    return hit;
  };

  // ⭐ AND THE PAGE SAYS SO. Her words: __"say, moonday was selectted for you, just click on the
  // prefered date if you have one"__ — ⚠️ **a page that does something on his behalf has to say so,
  // which is better than only stopping the circle claiming it.**
  const chosenLine = () => {
    let hit = null;
    (function walk(n) {
      for (const c of n.children || []) {
        if (String(c.className || "").includes("cal-chosen")) hit = hit || c;
        walk(c);
      }
    })(registry["dates"]);
    // ⚠️ THE TEXT LIVES IN THE CHILDREN on this shim — `sub()` builds a text node rather than
    // setting `textContent` — which is how the neighbouring test reads it too.
    return hit ? (hit.children || []).map((c) => String((c && (c.text || c.textContent)) || "")).join("") : "";
  };

  render();
  // ⚠️ THE VACUITY GUARD, and it is load-bearing here: with no open day drawn there is nothing the
  // rule could be about, and every assertion below would pass over an empty calendar.
  const picked = find("sel");
  assert.ok(picked, "the calendar drew no chosen day, so this proves nothing");
  assert.ok(String(picked.className).includes("tappable"), "the chosen day is not one he can tap");
  assert.equal(done1(), false,
    "★ the first circle was green before he had touched anything — the day was picked for him");
  assert.match(chosenLine(), /is suggested for you/,
    `★ the day was picked for him and the page never said so (it reads: ${JSON.stringify(chosenLine())})`);
  // ⚠️ AND IT NOW ASKS HIM TO TAP (v453). Her words: __"ask user to tap on the posting day to confirm it"__ —
  // ⭐ so this line does not merely SAY he is free to change it, it **asks him to confirm the day**, which is
  // what makes circle ①'s grey tell the truth and what the lock on step 2 is waiting for.
  assert.match(chosenLine(), /Tap it to confirm/,
    `the line does not ask him to confirm the day (it reads: ${JSON.stringify(chosenLine())})`);

  picked._listeners.click[0]();
  assert.equal(done1(), true, "⭑ his own tap on a day, and only that, turns the first circle green");
  // ⚠️ AND THE LINE STOPS OFFERING WHAT HE HAS NOW DONE — it is his own day, said plainly.
  // ⚠️ MUNCHIES' OWN WORDING: the tapped form here is "Your posting day: %1". The bakery says
  // "Your chosen bake day" — taking that verbatim would name a day this shop does not have.
  assert.match(chosenLine(), /Your posting day/,
    `★ the line still says the day was chosen for him after he chose one himself (it reads: ${JSON.stringify(chosenLine())})`);
  assert.doesNotMatch(chosenLine(), /is suggested for you/,
    "the page still tells him a day was picked for him after he picked his own");
});

test("★ nothing is lit on the places until a tap, and the card says what to do", () => {
  // Her words: __"click to choose point, without click it should not highlight"__ — ⭐ and this is
  // the rule her v413 picture was really about: **a place wearing the panel reads as a place the
  // customer picked, and he has picked nothing.**
  const realP = CONFIG.points;
  const realA = CONFIG.pointAreas;
  try {
    CONFIG.points = [{ id: "pt_k", name: "Our place", minOrderRM: 0, isKitchen: true },
      { id: "pt_f", name: "Farlim, Air Itam", minOrderRM: 0 }];
    // ⚠️ AN AREA IS IN THE FIXTURE ON PURPOSE. ⭐ The headings are children of this list too and
    // carry no `data-point-id`, so `choose("")` used to match them and hand them the "active" class
    // — ⚠️ **a wrong class with no styling, which drew nothing and lived from v410 unnoticed.** A
    // fixture with no areas has no headings, so it could not have caught it.
    CONFIG.pointAreas = [{ name: "Penang Island", depth: 0, points: ["pt_f"] }];
    const wrap = document.getElementById("fulfillment");
    wrap._value = "collect";
    wrap._pointId = "";
    wrap._open = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens

    const rows = registry["point-list"].children;
    assert.ok(rows.some((b) => String(b.className).includes("point-area")), "a heading is on the list");
    assert.equal(rows.filter((b) => String(b.className).includes("active")).length, 0,
      "⚠️ and NOTHING is lit — not a place, and not a heading either");
    // ⚠️ THE HEADING IS NAMED ON ITS OWN LINE, and that is not redundant: the count above passed
    // against a heading that had been given the highlight, because the class it was handed is one
    // nothing styles. ⭐ **A wrong class with no styling is a wrong class nobody sees** — it lived
    // from v410 until the browser was read directly (litHeadings: 2), so it gets its own assertion.
    const heading = rows.find((b) => String(b.className).includes("point-area"));
    assert.equal(String(heading.className).includes("active"), false,
      "the heading is a signpost, not a place — it can never carry the highlight");
    assert.equal(registry["point-pick"].hidden, false,
      "the card says the list is a thing to press instead");

    // ⚠️ Found by CLASS, not by position — the list holds headings as well as places, so an index
    // is a guess about how many of each there are. (The same mistake has cost this file twice.)
    const places = rows.filter((b) => String(b.className).includes("point-opt"));
    assert.ok(places.length >= 2, "both places are offered");
    const farlim = places.find((b) => String(b.className).includes("active") === false
      && b.children[0].children[0].text.includes("Farlim"));
    farlim._listeners.click[0]();
    assert.equal(wrap._pointId, "pt_f", "the tap chooses it");
    assert.equal(registry["point-pick"].hidden, true,
      "and the instruction goes — a page must not nag about what he just did");
  } finally {
    CONFIG.points = realP;
    CONFIG.pointAreas = realA;
    document.getElementById("fulfillment")._pointId = "";
    document.getElementById("fulfillment")._open = null;
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

// ── v416: neither way is chosen for him ─────────────────────────────────────

test("★★ neither way is chosen on arrival, and the question says it is one to answer", () => {
  // Her words: __"you need a 'click to choose' after the title, and self collect should not be
  // default"__, and then __"for delivery as well"__. ⚠️ **A page that opens with one of them edged
  // has answered its own question** — the same fault the places had at v415.
  const wrap = document.getElementById("fulfillment");
  const prompt = registry["fulfil-pick"];
  try {
    wrap._value = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(wrap._value, "", "nothing is chosen");
    assert.equal(prompt.hidden, false, "so the question carries a line saying it is one to answer");

    wrap._value = "collect";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(prompt.hidden, true, "and the line goes the moment he picks one");

    wrap._value = "courier";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
    assert.equal(prompt.hidden, true, "whichever one he picks");
  } finally {
    wrap._value = "";
    render();
    tapDay(); // ★ the step lock: step 1 must be HIS before step 2 opens
  }
});

test("★★ a posted order is stopped until it has an address — this shop's own stop, not v416's", async () => {
  // ⚠️⚠️ THERE IS NO HONEST DEFAULT FOR THIS ONE: an order has to carry whether a rider is coming or
  // the bread is being kept back, which is exactly why she asked for neither to be picked for him.
  // ⭐ AND IT FOLLOWS THE PAGE'S OWN PRECEDENT — the same stop a missing WhatsApp number already
  // gets — **and the button is never disabled**, because no site rule may hide or block a sale.
  refill();
  document.getElementById("whatsapp-input").value = "60123456789";
  const wrap = document.getElementById("fulfillment");
  try {
    // ⚠️⚠️ AN EMPTY WAY — AND THIS IS WHERE MUNCHIES DIFFERS FROM THE BAKERY ON PURPOSE (her choice,
    // 2026-10-12). The bakery treats "no way chosen" as the one thing an order must carry and refuses.
    // **This shop posts nationwide by default, so an empty way falls back to Post (nationwide)** — and
    // the order is then stopped by ITS OWN rule, the postal address.
    wrap._value = "";
    // ⚠️ A NAME IS REQUIRED (v452) — her decision. Without it the press refuses.
    document.getElementById("name-input").value = "Aunty Bee";
    await registry["order-btn"].onclick();
    // ★★★ AND IT IS *AT* THE TWO CARDS, NOT AT THE FOOT OF THE PAGE (v463). Her report, with a picture:
    // __"this warning not behaving"__ ⚠️⚠️ **The old version scrolled to the two cards and then
    // `showConfirm` scrolled AGAIN — to its own banner, which sits at the very bottom of the page, below
    // the Track-your-order card.** ⭐⭐ **So the message said "Tap Self collect or Courier delivery ABOVE"
    // while the page carried her away from them. The last scroll wins, and it was the wrong one.**
    const note = registry["step-note"];
    // ⚠️ READ THE LINE'S OWN CHILDREN, NOT `textContent` (v463). ⭐ **The test page's `textContent` is a
    // plain field that `replaceChildren` never recomputes** — so reading it answers the value from BEFORE
    // the line was filled, and an assertion built on it is asserting nothing. This file's other tests read
    // the children for exactly this reason.
    assert.ok(String(document.getElementById("address-input").className || "").includes("bad"),
      "★ an order with no way chosen falls back to Post (nationwide) — and is then stopped by the\n      postal-address rule, which is this shop's own");
    assert.match(String((registry["address-input-note"] || {}).textContent || ""), /postal address/i,
      "★ the postal address box was marked but says nothing about what it wants");
    assert.equal(registry["order-btn"].disabled, false,
      "⭐ the button is LIVE — this is a question, not a control that has been switched off");
    // ⚠️ WHERE THE LINE LANDS IS NOT ASSERTABLE HERE, AND THAT IS THE SHIM'S LIMIT RATHER THAN THE VIEW'S:
    // this page carries no markup, so `#fulfillment` has no parent and the line's own placement falls back.
    // ⭐ **It is a LIVE-MEASURED fact** — the line sits directly above the two cards, checked on the real
    // shop — and pretending otherwise here would be the "a test that proves nothing" fault this file keeps
    // recording.
    // ⚠️ AND WITH AN ADDRESS IT GOES STRAIGHT THROUGH — the stop is about the answer, not a wall.
    document.getElementById("address-input").value = "12 Jalan Bunga";
    const realFetch = globalThis.fetch;
    let posted = null;
    globalThis.fetch = async (url, opts) => {
      if (opts && opts.method === "POST") { posted = JSON.parse(JSON.parse(opts.body)[0].data); return { ok: true }; }
      return { ok: true, json: async () => [] };
    };
    try {
      // ⚠️ A NAME IS REQUIRED (v452) — her decision. Without it the press refuses.
      document.getElementById("name-input").value = "Aunty Bee";
      await registry["order-btn"].onclick();
      assert.ok(posted, "the order went through once he had given an address");
      assert.equal(posted.fulfillment, "courier",
        "carrying Post (nationwide) — the shop's own fallback for a way he never picked");
    } finally {
      globalThis.fetch = realFetch;
    }
  } finally {
    wrap._value = "";
  }
});


// ── v495: the receipt offers to clear the page, then does it by itself ───────
test("★★★ a new order retires the last one's receipt (v499, and the offer is gone at v509)", async () => {
  // ⚠️ HER WORDS, when the receipt was the thing bothering her: __"after the order confirmation … the earlier
  // order, step 3 choice of self collection centre still engaged"__ — and this is the half that was always
  // right: **a new customer arriving IS the reset.**
  // ⭐ AND SINCE v509 THERE IS NO OFFER TO RETIRE — only the receipt, which the new order replaces and
  // `retirePreviousOrder` takes away. ⚠️ **Nothing on this page reloads on a timer, and nothing offers to.**
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay();
  stepper.children[2]._listeners.click[0]();
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("fulfillment")._value = "collect";

  const realSetTimeout = globalThis.setTimeout;
  const armed = [];
  globalThis.setTimeout = (fn, ms) => { armed.push({ fn, ms, done: false }); return realSetTimeout(fn, ms); };
  const fire = (ms) => {
    const hit = armed.filter((a) => a.ms === ms && !a.done);
    for (const a of hit) { a.done = true; a.fn(); }
    return hit.length;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    await registry["order-btn"].onclick();
    fire(1000);                       // the receipt goes up
    assert.equal(registry["confirm-msg"].hidden, false, "precondition: the receipt is up");

    // ⭐ AND THE NEXT CUSTOMER ARRIVES — the first thing anyone does is tap a bake day.
    tapDay();
    assert.equal(registry["confirm-msg"].hidden, true,
      "★ the previous order's receipt is still on the page — **the next customer should not have to read "
      + "someone else's order**");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.fetch = realFetch;
  }
});

// ── v509: the receipt goes by itself, twenty seconds after the order ─────────
test("★★★ the receipt goes by itself twenty seconds after the order (v509)", async () => {
  // ⚠️⚠️ HER WORDS, AND HER NUMBER: __"it is good to see the page cleared. So i think we should remove the
  // order to reload. Just need to make the green Order Received! message vanish after 1min, can?"__ — and
  // then __"make it 20sec instead of 1min"__.
  // ⭐ THIS IS THE WHOLE OF WHAT IS LEFT of the reset feature: **no card, no Reload to press, no offer — the
  // green message goes on its own.** ⚠️ So what is asserted here is the thing she asked for and nothing
  // around it.
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay();
  stepper.children[2]._listeners.click[0]();
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("fulfillment")._value = "collect";

  // ⭐ THE NUMBER IS HERS, AND IT IS NAMED *HERE* so that changing it has to come past this test — the same
  // shape as the `SHOP_BUILD` pin. ⚠️ Read off the file rather than typed again: two copies of a number are
  // two numbers, and the day they disagree the test goes on passing while the shop does something else.
  const life = Number((readFileSync(new URL("../store/app.js", import.meta.url), "utf8")
    .match(/const RECEIPT_LIFE_MS = (\d+);/) || [])[1]);
  assert.equal(life, 20000,
    "the receipt's life is not her 20 seconds — __\"make it 20sec instead of 1min\"__");

  const realSetTimeout = globalThis.setTimeout;
  const armed = [];
  globalThis.setTimeout = (fn, ms) => { armed.push({ fn, ms, done: false }); return realSetTimeout(fn, ms); };
  const fire = (ms) => {
    const hit = armed.filter((a) => a.ms === ms && !a.done);
    for (const a of hit) { a.done = true; a.fn(); }
    return hit.length;
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    await registry["order-btn"].onclick();
    fire(1000);                       // the receipt goes up, and the life is armed inside that callback
    assert.equal(registry["confirm-msg"].hidden, false, "precondition: the receipt is up");

    assert.equal(fire(life), 1,
      `★ nothing is counting down on the receipt (${life}ms found nothing) — **the green Order Received! `
      + "message stays on the page until somebody does something about it**, which is the thing she asked "
      + "to be rid of");

    assert.equal(registry["confirm-msg"].hidden, true,
      "★ the receipt is still on the page twenty seconds after the order — the next customer reads someone "
      + "else's order number and tracking code");
    assert.equal(registry["confirm-msg"].children.length, 0,
      "★ the receipt was hidden but its lines were left inside it — **a node that is still in the page is "
      + "still read by anything that walks it**, so the next order would be built on top of the last one");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.fetch = realFetch;
  }
});

test("★★★ and a receipt whose twenty seconds passed while the page slept goes when the page is looked at (v509)", async () => {
  // ⚠️⚠️ WHY THIS HALF EXISTS AT ALL (v497): her report was __"footer say v496, but no offer to reload"__,
  // and **MEASURED on the live page `document.visibilityState` was `hidden` with the timer never having
  // fired.** ⭐ **A phone that has just taken an order gets put down** — so the one moment this feature is
  // for is exactly the moment the timer has not run. ⚠️ **A receipt that could only go on a timer would sit
  // in front of the NEXT customer for as long as the page stayed in the background**, which is the ordinary
  // case in a shop that runs on one phone at the counter.
  const card = registry["menu"].children[0];
  const stepper = stepperIn(card);
  tapDay();
  stepper.children[2]._listeners.click[0]();
  document.getElementById("name-input").value = "Aunty Bee";
  document.getElementById("whatsapp-input").value = "60123456789";
  document.getElementById("fulfillment")._value = "collect";

  // ⚠️ THE CLOCK IS THE SHOP'S OWN, SO IT IS THE THING TO MOVE — **not the timer, which is the thing that
  // cannot be relied on.** ⭐ Seeded from the real clock so the calendar and the day he picked stay where
  // they were, and only ever moved FORWARD by the seconds under test.
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  // The page being looked at: a finger on the glass is the signal no phone can fail to send (v498).
  const look = () => { for (const f of (document._docListeners.pointerdown || [])) f(); };

  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = () => 0;    // ⚠️ so the receipt's own timer can NEVER fire in this test
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  try {
    await registry["order-btn"].onclick();
    assert.equal(registry["confirm-msg"].hidden, false, "precondition: the receipt is up");

    // ⚠️ NOT YET: ten seconds in, a look must leave it alone — the customer may still be reading it.
    clock += 10000;
    look();
    assert.equal(registry["confirm-msg"].hidden, false,
      "★ the receipt left before its twenty seconds were up — a customer reading his own order number off "
      + "the screen had it taken away underneath him");

    // ⭐ AND AT TWENTY, WITH THE TIMER HAVING NEVER RUN, THE LOOK ITSELF TAKES IT AWAY.
    clock += 10000;
    look();
    assert.equal(registry["confirm-msg"].hidden, true,
      "★ a receipt whose twenty seconds passed while the page was hidden is still on the screen when the "
      + "next customer looks at it — **the timer is the thing that cannot be relied on, which is what v497 "
      + "measured on her own phone**");
  } finally {
    globalThis.setTimeout = realSetTimeout;
    Date.now = realNow;
    globalThis.fetch = realFetch;
  }
});

// ── v493: the warning belongs to the STEP, and the page goes to it ──────────
test("★★★ the refusal carries the page to the step that is missing — and only when it is off screen", () => {
  // Her words: __"1. step 1 not fill up. no matter the user is clicking on step 2, step3 or step 4, the
  // screen should scroll to step1, and below step one flashing the warning meaasge …"__
  render();                       // ⚠️ deliberately NO tapDay() — step 1 is the thing missing
  const card = registry["menu"].children[0];
  const plus = () => stepperIn(card).children[2]._listeners.click[0]();

  plus();                         // a STEP-2 control, pressed while STEP 1 is outstanding
  assert.equal(registry["bar-count"].textContent, "0 items", "precondition: the lock held at all");
  assert.equal(registry["step-note"].previousSibling, registry["dates"],
    "★ the line is not hanging under step 1 — the step that is actually missing");
  assert.deepEqual(registry["step-note"].scrolled, { block: "center", behavior: "smooth" },
    "★ pressing into step 2 with step 1 missing did not carry the page back to step 1 — he is left looking "
    + "at the card he pressed, being told about a step two screens above him");

  // ⭐⭐ AND IT DOES NOT MOVE WHEN THE STEP IS ALREADY ON SCREEN. ⚠️ Her rule is that the warning must be
  // SEEN, not that the page must always jump — and **a page that jumps while he is looking straight at the
  // thing being named is the fault v423 settled for the parked place.** ⭐ The shim reports this step as
  // sitting well inside an 800px viewport.
  registry["step-note"].scrolled = undefined;
  registry["step-note"].rect = { top: 40, bottom: 80, left: 0, right: 320, width: 320, height: 40 };
  plus();
  assert.equal(registry["step-note"].scrolled, undefined,
    "★ the page was moved even though the step it names was already fully on screen — a jump he did not "
    + "ask for, in front of the very thing he is being told about");
  assert.equal(registry["step-note"].hidden, false,
    "★ and the warning itself was not shown, so 'nothing moved' was proved by doing nothing at all");

  // ⚠️⚠️ AND THE SHIM IS PUT BACK — the registry is shared by EVERY test in this file, so a viewport left
  // behind here would quietly change what every later test means. ⭐ Measured: it did exactly that, and the
  // next test failed for a reason that had nothing to do with what it was checking.
  registry["step-note"].rect = undefined;
  registry["step-note"].scrolled = undefined;
});

test("★★ a step-2 warning is not wiped by a repaint just because STEP 1 is done (v493)", async () => {
  // ⚠️⚠️ THE CLEARING USED TO ASK `dayPicked` — **which is only step 1's question.** ⭐ That was right while
  // step 1 was the only step that could refuse, and wrong the moment the line can speak about step 2:
  // **a customer who had already picked his day would have the answer to a step-2 refusal wiped by the next
  // repaint.** v455's rule is kept and scoped to what it was always about — a form error does not outlive
  // ITS cause, which is the step the line names.
  render();
  tapDay();                       // ⭐ step 1 IS done — that is the whole point of this test
  const name = registry["name-input"];
  const note = registry["step-note"];

  // He presses STEP 4 with nothing in the basket → the first thing missing is STEP 2.
  await registry["order-btn"].onclick();
  assert.equal(note.hidden, false, "precondition: the refusal said nothing, so nothing below proves anything");
  assert.equal(note.previousSibling, registry["menu"],
    "precondition: the line is not at step 2, so this test is watching the wrong step");

  // ⚠️ AND NOW A REPAINT — the field's own `input` listener runs `paintSteps`, which is the code that clears
  // the line. With the day already picked, a clearing keyed to `dayPicked` wipes a step-2 answer here.
  (name._listeners.input || []).forEach((f) => f.call(name));
  assert.equal(note.hidden, false,
    "★ a repaint wiped the step-2 warning because STEP 1 was already done — the customer is told why and "
    + "then the page takes it back");
  assert.equal(note.previousSibling, registry["menu"],
    "★ the line left the step it was speaking about");
});

// ── v458: the shop's quantity can be TYPED ───────────────────────────────────
test("★★★ the shop's quantity can be TYPED — 30 loaves is not 30 taps", () => {
  // ⚠️⚠️ HER WORDS: __"for qty field i should be allow to key in qty also instead of just press the + & -"__
  // and __"when i want to enter 30 loaves, imagine pressing 30times"__.
  // ⭐ AND THE BOX ITSELF WAS A PLAIN `<span>` — measured on the live shop, so a customer had **no way to
  // type at all**, only taps. This is the shop's half of the same change.
  render();
  tapDay();   // ★ the step lock: step 1 must be HIS before step 2 opens
  const stepperOf = () => stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body"));
  const box = stepperOf().children[1];
  assert.equal(box.tagName, "INPUT",
    "★ the quantity is still a label with no way to type into it, so 30 loaves is 30 taps");

  const type = (v) => { box.value = v; (box._listeners.input || []).forEach((f) => f.call(box)); };
  type("3");
  type("30");

  // ⭐⭐ THE BOX SURVIVES — the menu is NOT rebuilt on a keystroke, so the second digit has somewhere to go.
  assert.equal(stepperOf().children[1], box,
    "★ the menu was rebuilt under the customer's thumb mid-keystroke — that is what eats the second digit");
  assert.equal(registry["bar-count"].textContent, "30 items", "★ the basket did not take the typed number");

  // ⚠️ AND WHEN HE IS DONE, THE CARD IS REBUILT FROM THE BASKET — so a box that comes back reading 30 is
  // proof the number reached the ORDER and not merely the screen.
  (box._listeners.change || []).forEach((f) => f.call(box));
  assert.equal(stepperOf().children[1].value, "30", "★ only the first digit reached the basket");
});

test("★★ a TYPED quantity obeys the bake-day lock, exactly as the + press does (v458)", () => {
  // ⚠️⚠️ **A TYPED NUMBER IS THE SAME ACT AS A TAP.** v454 made the + refuse until a posting day has been
  // tapped, and v456 made the whole of step 3 wait on step 2 — so a box that accepted a number anyway
  // would be **a door in the lock that nobody had noticed**, and the one step this whole thread is about
  // would have been walked straight past.
  render();   // ⚠️ deliberately NO tapDay()
  const stepper = () => stepperIn(registry["menu"].children[0].children.find((c) => c.className === "card-body"));
  const box = stepper().children[1];
  assert.equal(registry["bar-count"].textContent, "0 items", "precondition: nothing is in the basket");

  box.value = "4";
  (box._listeners.input || []).forEach((f) => f.call(box));
  assert.equal(registry["bar-count"].textContent, "0 items",
    "★ a typed number put bread in the basket with no posting day chosen");
  const note = registry["step-note"];
  assert.equal(note.hidden, false, "★ and he was told nothing about why");

  // ★★★ AND IT IS SAID AT STEP 1, WITH THE PAGE CARRIED THERE (v493). ⚠️⚠️ THIS REVERSES v459 AT HER
  // INSTRUCTION, and the words are hers: __"no matter the user is clicking on step 2, step3 or step 4, the
  // screen should scroll to step1, and below step one flashing the warning meaasge"__.
  // ⭐ v459 solved the same fault from the other end — the line came to the customer's thumb — and it worked;
  // ⚠️ **but it also put the line INSIDE the menu, which is rebuilt on every quantity change, and THAT is
  // the fault the next test exists for.** ⭐ At the step the line cannot be torn out at all, and the page
  // going to it is what makes it visible: **the refusal still works, and he is still told.**
  assert.equal(note.previousSibling, registry["dates"],
    "★ the line is not hanging directly under step 1, the step it is about");
  assert.deepEqual(registry["step-note"].scrolled, { block: "center", behavior: "smooth" },
    "★ the page was not carried to step 1 — the refusal worked and he was told nothing he could see");
  assert.ok(!registry["menu"].children.includes(note),
    "★ the line is inside the menu again, where a rebuild can throw it out");

  // ⚠️ AND WITH THE DAY TAPPED, THE SAME TYPE GOES THROUGH — so this is a lock and not a wall.
  tapDay();
  box.value = "4";
  (box._listeners.input || []).forEach((f) => f.call(box));
  assert.equal(registry["bar-count"].textContent, "4 items", "the lock did not release on a tapped day");
});

// ── v460: the warning is not erased by a repaint ────────────────────────────
test("★★★ a repaint cannot erase the warning — it is not inside the menu at all (v460, v493)", () => {
  // ⚠️⚠️ HER WORDS: __"why on step 2, i try to press + the warning come out, but if i press -, the warning
  // disappear and never come back again??"__ ⭐ **She was right, and it was worse than "disappears".**
  // ⭐ v459 put that line directly above the product card — **which put it INSIDE the menu** — and the menu
  // is rebuilt from scratch on every quantity change. ⚠️ Measured on the real shop before the fix: after +
  // the line was in the page; after − `getElementById` returned NOTHING; after + again, still nothing.
  // ★★★ AND SINCE v493 THE FAULT IS NOT MERELY FIXED, IT IS IMPOSSIBLE. The line hangs under a step
  // HEADING, and the headings are static markup no repaint replaces — ⭐ **which is what let v493 retire
  // `placeStepNote`, the machinery that used to put the line back by hand after every rebuild.**
  render();
  const card = () => registry["menu"].children.find((c) => c.dataset && c.dataset.product);
  const parts = () => stepperIn(card().children.find((c) => c.className === "card-body")).children;
  const note = registry["step-note"];

  parts()[2]._listeners.click[0]();   // +
  assert.equal(note.hidden, false, "the + press raised no warning, so nothing below proves anything");
  assert.ok(!registry["menu"].children.includes(note),
    "★ the line is hung inside the menu, which is the fault this test exists for");

  parts()[0]._listeners.click[0]();   // −  — a full rebuild of the menu
  // ⚠️⚠️ THE ASSERTION THAT IS HER REPORT. Membership of `children`, not `parentElement` — **a rebuild that
  // threw it out would leave a stale parent behind, which is a false pass.**
  assert.equal(note.hidden, false, "★ pressing − made the warning vanish");
  assert.equal(note.previousSibling, registry["dates"], "★ the warning left the step it is about");
  assert.ok(!registry["menu"].children.includes(note), "★ the rebuild took the line with it");

  // ⭐⭐ AND THE "NEVER COMES BACK" HALF, which is the part that made it useless rather than untidy.
  parts()[0]._listeners.click[0]();   // − again, another rebuild
  parts()[2]._listeners.click[0]();   // + again
  assert.equal(note.hidden, false, "★ the warning never came back after a rebuild");
  assert.equal(note.previousSibling, registry["dates"], "★ it came back, but not at the step it is about");
});

// ── v461: step 3 answers when it is touched too early ───────────────────────
test("★★★ step 3 is not switched off — it answers when he touches it", () => {
  // ⚠️⚠️ HER WORDS: __"i do step 3 skipping step 2, it just dont allow, but no warning"__
  // ⭐⭐ **AND THE REASON THERE WAS NO WARNING IS THAT THE BOX WAS `disabled` — A DISABLED CONTROL NEVER
  // RECEIVES THE TAP, so it has no way to say anything.** Measured on the live shop first: tapping the name
  // box did not even move the focus, and the line stayed hidden.
  // ⚠️ **THAT IS v452'S OWN RULE, quoted twenty lines away in the shop to justify the two delivery cards
  // REFUSING rather than being switched off — and then applied to these two fields the wrong way round.**
  render();
  const name = registry["name-input"];
  const wa = registry["whatsapp-input"];
  const note = registry["step-note"];
  assert.equal(registry["bar-count"].textContent, "0 items", "precondition: the basket is empty");

  // ⭐ IT IS HELD SHUT, NOT SWITCHED OFF. `readonly` still cannot be typed into and still looks closed,
  // **and a phone does not raise its keyboard for it — but it CAN be tapped, so it can answer.**
  assert.equal(name.disabled, false, "★ the name box is switched off, so no tap can ever reach it");
  assert.equal(name.readOnly, true, "★ the name box is not held shut — he can type an order with nothing in it");
  assert.ok(String(name.className || "").includes("locked"),
    "★ the box does not look shut, so he taps a box that looks ready and is told nothing");
  assert.equal(wa.readOnly, true, "the number box is open too");

  // ⭐⭐ AND THE TAP IS ANSWERED.
  (name._listeners.focus || []).forEach((f) => f.call(name));
  assert.equal(note.hidden, false, "★ touching the name box told him nothing at all");

  // ⚠️ AND WITH STEP 2 DONE, THE SAME BOX IS OPEN AND ASKS NOTHING — so this is a lock, not a wall.
  tapDay();
  const stepper = stepperIn(registry["menu"].children[0]);
  stepper.children[2]._listeners.click[0]();      // + — one item in the basket
  assert.equal(registry["bar-count"].textContent, "1 item", "the fixture did not reach step 3");
  assert.equal(registry["name-input"].readOnly, false, "★ the box is still held shut with an order in the basket");
  assert.equal(registry["name-input"].className.includes("locked"), false, "★ and still looks closed");
  // ⚠️ AND ONE LISTENER, NOT SEVENTY-THREE (v461) — see the note in `store/app.js`. Each duplicate
  // closed over the basket of its own render, and the older ones answered with a basket long gone.
  assert.equal((registry["name-input"]._listeners.focus || []).length, 1,
    "★ the box is collecting a fresh listener on every render, so old renders answer for the current one");
  (registry["name-input"]._listeners.focus || []).forEach((f) => f.call(registry["name-input"]));
  assert.equal(registry["step-note"].hidden, true, "★ he was told off for a step he had already done");
});

// ── v461: the warning BLINKS ────────────────────────────────────────────────
test("★★★ the step warning blinks, and its flash ends where the words rest", () => {
  // ⚠️⚠️ HER QUESTION, and it is the right one: __"did you blink the warning?"__ ⭐ **It did not — the line
  // simply appeared**, and her report a moment earlier was __"it just dont allow, but no warning"__. **A
  // sentence that arrives silently part-way down a long page can still be missed**, and every other warning
  // in this shop already blinks.
  render();
  const note = registry["step-note"];
  // ⚠️ CLEARED FIRST, because this node is SHARED across every render in this file and an earlier test's
  // flash is still on it. ⭐ So the assertion is the TRANSITION — the refusal puts the blink on.
  note.classList.remove("flash");
  note.classList.remove("on");
  assert.equal(String(note.className).includes("flash"), false, "the flash could not be cleared");

  // ⚠️ The bake day is not tapped, so a quantity is refused — the same refusal her report is about.
  const stepper = stepperIn(registry["menu"].children[0]);
  const box = stepper.children[1];
  box.value = "4";
  (box._listeners.input || []).forEach((f) => f.call(box));

  assert.equal(note.hidden, false, "no warning appeared, so nothing below proves anything");
  assert.ok(String(note.className).includes("flash"),
    "★ the warning appeared WITHOUT BLINKING — it is the only warning in this shop that does not");

  // ⚠️⚠️ AND IT IS THE SHOP'S ONE FLASH, NOT A SECOND ONE: the same two tokens drive the count and the
  // length of every blink on the page, so a second set of numbers cannot drift into existence (v427).
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  for (const sel of [".step-note.flash {", ".step-note.flash strong {"]) {
    const rule = new RegExp(sel.replace(".", "\\.") + "[^}]*\\}").exec(css);
    assert.ok(rule, `★ the step warning has no rule for ${sel}`);
    assert.match(rule[0], /var\(--flash-blink\)/, `★ ${sel} carries its own blink length`);
    assert.match(rule[0], /var\(--flash-blinks\)/, `★ …and its own blink count`);
  }

  // ⚠️⚠️ AND THE LAST KEYFRAME IS THE COLOUR THE ELEMENT RESTS AT, or it flashes and then SNAPS — the trap
  // this stylesheet already records for the parked place.
  const token = (n) => (css.match(new RegExp(`--${n}:\\s*(#[0-9a-fA-F]{6})`)) || [])[1];
  const block = (name) => {
    const m = new RegExp(`@keyframes ${name} \\{[\\s\\S]*?\\n\\}`).exec(css);
    assert.ok(m, `★ the step warning has no @keyframes ${name}`);
    return m[0];
  };
  const line = block("step-note-flash");
  const word = block("step-note-flash-word");
  assert.equal((line.match(/\d+%, 100% \{ background-color: (#[0-9a-fA-F]{6});/) || [])[1],
    token("brown-soft"), "⚠️ the line's flash ends somewhere other than where the line rests, so it snaps");
  assert.equal((word.match(/\d+%, 100% \{ color: (#[0-9a-fA-F]{6}); \}/) || [])[1],
    token("brown-dark"), "⚠️ the words' flash ends somewhere other than where they rest, so they snap");
  assert.equal((line.match(/0%, \d+% \{ background-color: (#[0-9a-fA-F]{6});/) || [])[1],
    token("red"), "⚠️ and the line OPENS on her red — 'on for a second' means already on");

  // ⚠️⚠️⚠️ AND THIS IS THE ASSERTION THAT WAS MISSING, AND IT IS THE WHOLE OF v462. **A FLASH MUST MOVE
  // SOMETHING AN EYE CAN SEE.** The first version blinked `#c0392b` against `#a84322` — **the animation ran
  // perfectly, and the two colours are 1.10:1 apart, because both are reds.** Her words: __"all warning so
  // far not flashing"__. ⭐ **She was right and the animation was running.** ⭐ A contrast floor is the only
  // thing that can tell "it flashes" from "it is a colour".
  const lum = (hex) => {
    const [r, g, b] = hex.match(/[0-9a-fA-F]{2}/g).map((h) => parseInt(h, 16) / 255);
    const f = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const apart = (a, b) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const flashColour = (line.match(/0%, \d+% \{ background-color: (#[0-9a-fA-F]{6});/) || [])[1];
  const restColour = token("brown-soft");
  const seen = apart(flashColour, restColour);
  assert.ok(seen >= 3,
    `⚠️⚠️ the flash moves the background from ${flashColour} to ${restColour} — only ${seen.toFixed(2)}:1 `
    + `apart, so on a phone it reads as one colour and the warning does not blink at all`);
});

test("★★★ the tracking lookup now needs the PHONE as well as the code", async () => {
  // ⚠️⚠️ A six-character code is about 16.7 million values and this lookup is open to anyone: at a few
  // hundred orders a stranger making requests could reach a real order and read that customer's name,
  // address and driver's phone. ⭐ The phone is the second key, and it is never published publicly.
  const box = document.getElementById("track-result");
  const texts = (n, out = []) => {
    for (const kid of n.children || []) {
      if (kid.nodeType === 3) out.push(String(kid.text));
      else texts(kid, out);
    }
    return out;
  };
  const bodies = [];
  globalThis.fetch = async (url, opts) => {
    bodies.push(JSON.parse(opts.body));
    return { ok: true, json: async () => [] };
  };
  try {
    await trackOrder("A3F9C2", "");
    assert.equal(bodies.length, 0,
      "★ a lookup went out on the CODE ALONE — **that is the door the phone is there to close**");
    assert.match(texts(box).join(" "), /phone number/i,
      "and the card does not say the phone is needed");

    await trackOrder("A3F9C2", "012-345 6789");
    assert.equal(bodies.length, 1, "the lookup was not made at all once both were given");
    assert.equal(bodies[0].p_phone, "0123456789",
      "★ the phone went as TYPED, dashes and spaces and all — **a lookup that refused over a dash would be "
      + "a bug, not a security rule**");
    assert.equal(bodies[0].p_code, "A3F9C2", "and the code still goes with it");
  } finally {
    globalThis.fetch = async () => ({ ok: true, json: async () => [] });
  }
});
