// test/store-feedback.test.js — the suggestion box on the shop front (v247).
//
// Her request, verbatim: "i want to be able to facilitate customer using shop front to
// feedback to web developer … print in the box, typing over it will customer own words.
// Ather they send, web studio will reply with 'you idea well taken care off, new updates
// soon!' can use Resend to accomplish the job?"
//
// This file covers both halves: what the shop sends (store/feedback.js) and what the
// function on the other end promises (supabase/functions/shop-feedback/index.ts, read as
// source — the suite cannot load a Deno function, see test/edge-function-imports.test.js).
//
// TWO THINGS HERE ARE NOT STYLE, AND EVERY OTHER ASSERTION IN THIS FILE SERVES THEM:
//
//   • THE RECIPIENT NEVER COMES FROM THE CUSTOMER. A public form that can name where the
//     mail goes is an open relay — anyone could point it at anyone, with this bakery's
//     verified sending domain on the envelope. So the body the shop builds is asserted to
//     carry NO recipient field at all, and the function is asserted to read the address
//     from the bakery's own published settings and never off the request.
//
//   • A SEND THAT FAILED IS NEVER THANKED. The customer is told the words did not go, so
//     they try the WhatsApp link instead. A thank-you drawn over a message that never left
//     is the one outcome worth building a test against.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { STORE } from "../store-lang.js";
import { LANGS } from "../i18n.js";
import { sendFeedback, loadDraft, saveDraft } from "../store/feedback.js";
import { CONFIG } from "../store/config.js";
import { ENGINE_VERSION } from "../admin/js/version.js";

const FN_SRC = readFileSync(new URL("../supabase/functions/shop-feedback/index.ts", import.meta.url), "utf8");
const SHOP_SRC = readFileSync(new URL("../store/feedback.js", import.meta.url), "utf8");

// A stubbed wire, shaped exactly like the real one: a Response has `ok`, `status` and
// `json()`. Returns the capture so a test can read what would have gone out, and a restore
// so no stub outlives its test.
function stubFetch(reply) {
  const real = globalThis.fetch;
  const sent = [];
  globalThis.fetch = async (url, opts = {}) => {
    sent.push({
      url: String(url),
      method: (opts.method || "GET").toUpperCase(),
      headers: opts.headers || {},
      body: opts.body,
      keepalive: !!opts.keepalive,
    });
    if (typeof reply === "function") return reply(url, opts);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  return { sent, restore() { globalThis.fetch = real; } };
}

function jsonReply(obj, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => obj };
}

// ---------------------------------------------------------------------------
// What the shop sends
// ---------------------------------------------------------------------------

test("the words go to the shop-feedback function, with the shop's own public key", async () => {
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    const out = await sendFeedback({ message: "Please add a bigger photo", page: "shop", lang: "en", honeypot: "" });
    assert.equal(out.ok, true);
    assert.equal(out.key, "fbThanks");

    assert.equal(wire.sent.length, 1, "exactly one request");
    const one = wire.sent[0];
    assert.equal(one.method, "POST");
    assert.equal(one.url, `${CONFIG.supabase.url}/functions/v1/shop-feedback`,
      "the path is the function's own name — a rename in one place only is a 404 nobody would see until a customer tried");
    assert.equal(one.headers.Authorization, `Bearer ${CONFIG.supabase.anonKey}`);
  } finally { wire.restore(); }
});

test("the shop sends ONLY the headers the function will accept", async () => {
  // The CORS preflight trap, which has already cost this repo once. The browser asks the
  // function which headers it will take and then refuses to send anything the answer does
  // not name. shop-feedback's list is "Authorization, Content-Type"; an extra `apikey`
  // — which every OTHER Supabase call in this shop does send, because the REST endpoints
  // require it — breaks the preflight with a bare "TypeError: Failed to fetch" that says
  // nothing about why.
  const m = FN_SRC.match(/["']Access-Control-Allow-Headers["']\s*:\s*["']([^"']+)["']/);
  assert.ok(m, "the function declares its allowed headers, or this guard cannot work");
  const allowed = m[1].split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);

  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await sendFeedback({ message: "hello there", page: "shop", lang: "en", honeypot: "" });
    const sent = Object.keys(wire.sent[0].headers).map((h) => h.toLowerCase());
    for (const h of sent) {
      assert.ok(allowed.includes(h),
        `the shop sends only headers the function will accept — it sent ${JSON.stringify(sent)}, the function allows ${JSON.stringify(allowed)}`);
    }
    assert.deepEqual(sent.sort(), ["authorization", "content-type"], "and it sends exactly those two");
  } finally { wire.restore(); }
});

test("the body carries the words and NO recipient — the shop can never choose where mail goes", async () => {
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await sendFeedback({
      message: "  A bigger photo please  ", page: "/store/", origin: "munchies.com.my",
      lang: "zh", honeypot: "",
    });
    const body = JSON.parse(wire.sent[0].body);
    assert.deepEqual(Object.keys(body).sort(),
      ["engine", "lang", "message", "origin", "page", "website"],
      "the whole of what the shop may say: the words, the address they were written at, the build, the language, and the honeypot");
    assert.equal(body.message, "A bigger photo please", "the words are trimmed and sent as written");
    assert.equal(body.page, "/store/", "the path the customer was actually on");
    assert.equal(body.origin, "munchies.com.my", "and the project that path belongs to");
    assert.equal(body.lang, "zh");

    // Named one by one, because these are the field names an open relay would be built
    // out of and a future edit could reintroduce them without any other test noticing.
    for (const bad of ["to", "email", "emails", "recipient", "recipients", "from", "replyTo", "cc", "bcc"]) {
      assert.equal(body[bad], undefined, `the shop must never send "${bad}" — the recipient is the function's to decide`);
    }
    assert.ok(!/recipient|"to"\s*:/.test(wire.sent[0].body), "and never in any other spelling either");
  } finally { wire.restore(); }
});

test("the words travel with the build they were written on, and the shop has no second copy of the number", async () => {
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await sendFeedback({ message: "a real suggestion", page: "/store/", origin: "munchies.com.my", lang: "en", honeypot: "" });
    const body = JSON.parse(wire.sent[0].body);
    // Not a string the page was asked to supply — the running module's own version, so a
    // customer on a phone still holding yesterday's copy reports yesterday's number rather
    // than the one the developer assumes. That is the entire value of the field.
    assert.equal(body.engine, ENGINE_VERSION,
      "the engine number is the one this build ships, taken from admin/js/version.js and never retyped");
  } finally { wire.restore(); }

  // One number, one file. A `store/version.js` would be a second place to remember on every
  // bump, and the two would disagree within a release or two — which is precisely the thing
  // the number exists to prevent.
  assert.ok(!/ENGINE_VERSION\s*=/.test(SHOP_SRC),
    "the shop declares no engine number of its own; it imports the backoffice's");
  assert.ok(/from\s+"\.\.\/admin\/js\/version\.js"/.test(SHOP_SRC),
    "and it says where the number comes from");
});

test("a page that cannot say where it is still sends the words, with what it has", async () => {
  // The address is a courtesy, not a requirement: an older cached page, or a context with
  // no `location`, must not lose a customer's sentence over a missing project name.
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    const out = await sendFeedback({ message: "a real suggestion", lang: "en", honeypot: "" });
    assert.equal(out.ok, true, "the send still goes");
    const body = JSON.parse(wire.sent[0].body);
    assert.equal(body.origin, "", "with nothing invented where the page could not say");
    assert.equal(body.page, "", "and no path guessed either");
    assert.equal(body.engine, ENGINE_VERSION, "the build is still named — that much the page always knows");
  } finally { wire.restore(); }
});

test("a message with nothing in it is refused here, and never reaches the network", async () => {
  for (const words of ["", "   ", "ok"]) {
    const wire = stubFetch(new Error("should not be called"));
    try {
      const out = await sendFeedback({ message: words, page: "shop", lang: "en", honeypot: "" });
      assert.equal(out.ok, false, `${JSON.stringify(words)} is not something to mail`);
      assert.equal(out.key, "fbEmpty");
      assert.equal(wire.sent.length, 0, "nothing went out");
    } finally { wire.restore(); }
  }
});

test("every way a send can fail comes back as a failure, never as the thank-you", async () => {
  const cases = [
    ["the service refused", jsonReply({ error: "no developer email is set" }, 503)],
    ["the service errored", jsonReply({ error: "boom" }, 500)],
    ["a 200 saying it did not work", jsonReply({ ok: false })],
    ["an answer that is not JSON at all", { ok: true, status: 200, json: async () => { throw new Error("not json"); } }],
    ["the network is down", new Error("offline")],
  ];
  for (const [why, reply] of cases) {
    const wire = stubFetch(reply);
    try {
      const out = await sendFeedback({ message: "a real suggestion", page: "shop", lang: "en", honeypot: "" });
      assert.equal(out.ok, false, `${why} must not be dressed up as a success`);
      assert.equal(out.key, "fbFailed", why);
    } finally { wire.restore(); }
  }
});

test("with nowhere configured to send, the customer is told so rather than thanked", async () => {
  const wire = stubFetch(new Error("should not be called"));
  const sb = CONFIG.supabase;
  CONFIG.supabase = { url: "", anonKey: "" };
  try {
    const out = await sendFeedback({ message: "a real suggestion", page: "shop", lang: "en", honeypot: "" });
    assert.equal(out.ok, false);
    assert.equal(out.key, "fbFailed");
    assert.equal(wire.sent.length, 0);
  } finally {
    CONFIG.supabase = sb;
    wire.restore();
  }
});

test("a send that stays on the page is an ordinary request, not one that outlives it", async () => {
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await sendFeedback({ message: "a real suggestion", page: "shop", lang: "en", honeypot: "" });
    assert.equal(wire.sent[0].keepalive, false,
      "only the send made ON THE WAY OUT needs the request to survive the page");
  } finally { wire.restore(); }
});

test("the honeypot travels with the message, untouched", async () => {
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await sendFeedback({ message: "a real suggestion", page: "shop", lang: "en", honeypot: "http://spam.example" });
    assert.equal(JSON.parse(wire.sent[0].body).website, "http://spam.example",
      "the trap only works if it arrives — a shop that dropped it would make every bot look like a person");
  } finally { wire.restore(); }
});

// ---------------------------------------------------------------------------
// The autosave: their words are kept on their own device
// ---------------------------------------------------------------------------

test("a draft survives being read back, and an emptied one is dropped entirely", () => {
  globalThis.localStorage.clear();
  assert.equal(loadDraft(), "", "nothing kept yet reads as nothing, not as null");

  saveDraft("the photos could be bigger");
  assert.equal(loadDraft(), "the photos could be bigger", "what they typed is what comes back");

  saveDraft("");
  assert.equal(loadDraft(), "", "and clearing it leaves nothing behind");
  assert.equal(globalThis.localStorage.map.size, 0,
    "an emptied box must remove the key, not store an empty sentence in it");

  saveDraft("   ");
  assert.equal(loadDraft(), "", "whitespace is not a sentence either");
});

test("a draft is capped, so one box cannot fill a device's storage", () => {
  globalThis.localStorage.clear();
  saveDraft("x".repeat(9000));
  assert.equal(loadDraft().length, 4000, "the same ceiling the message itself has");
  assert.ok(loadDraft().length < 9000, "the extra is dropped rather than kept");
});

test("storage that is missing or refuses to work is never an error the customer meets", () => {
  const real = globalThis.localStorage;
  try {
    delete globalThis.localStorage;
    assert.equal(loadDraft(), "", "a browser with no storage reads as an empty box");
    saveDraft("anything"); // must not throw

    globalThis.localStorage = {
      getItem() { throw new Error("private mode"); },
      setItem() { throw new Error("private mode"); },
      removeItem() { throw new Error("private mode"); },
    };
    assert.equal(loadDraft(), "", "a browser that refuses to read keeps the box working");
    saveDraft("anything"); // must not throw
  } finally {
    globalThis.localStorage = real;
  }
});

// ---------------------------------------------------------------------------
// What the function promises
// ---------------------------------------------------------------------------

test("the function reads the developer's address from the bakery's own settings, never off the request", () => {
  assert.ok(/storefront_config/.test(FN_SRC),
    "the address comes from the published config row the shop page itself reads");
  assert.ok(/developerEmails/.test(FN_SRC), "and it is the developer's own address list");

  // The request may supply the words, where they were written, which build wrote them, in
  // which language, and the honeypot — and a recipient is not among them. `origin` and
  // `engine` were added for the mail's own header block (v252); everything here is
  // descriptive of the send, and none of it chooses where the mail goes.
  const read = [...FN_SRC.matchAll(/payload\s*&&\s*payload\.(\w+)/g)].map((m) => m[1]);
  assert.ok(read.length >= 3, `the payload is read for what it carries: ${JSON.stringify(read)}`);
  for (const name of read) {
    assert.ok(["message", "page", "origin", "engine", "lang", "website"].includes(name),
      `the function reads payload.${name}, which is not one of the things a caller may say`);
  }
  assert.ok(!/payload\s*&&\s*payload\.to\b/.test(FN_SRC), "there is no `to` to be read");
});

test("a filled honeypot is answered like a real send and never mailed", () => {
  const trapAt = FN_SRC.indexOf("honeypot filled");
  const sendAt = FN_SRC.indexOf("api.resend.com/emails");
  assert.ok(trapAt > -1, "the trap is checked at all");
  assert.ok(sendAt > -1, "and the send is there to be skipped");
  assert.ok(trapAt < sendAt, "the trap is checked BEFORE anything is mailed");
  assert.ok(/return json\(\{ ok: true \}\)/.test(FN_SRC.slice(trapAt - 200, trapAt + 80)),
    "a bot is told it worked — telling it otherwise is how it learns to stop filling the field");
});

test("the function never lets a customer's words into a mail header", () => {
  // The subject is built from the engine number and the date, never from the message, and
  // it is flattened to one line before it is used — a newline in a header is a
  // header-injection hole. Since v252 the engine number is the one caller-supplied value
  // that reaches the subject, so it is stripped to digits and dots before it gets there:
  // a header is no place for anything whose shape a caller chose.
  assert.ok(/oneLine\(/.test(FN_SRC), "the subject is flattened");
  assert.ok(!/subject[^\n]*message/.test(FN_SRC), "and it is never built out of the customer's text");
  assert.ok(/const engine = [^\n]*replace\(\/\[\^0-9\.\]\/g, ""\)/.test(FN_SRC),
    "the engine number is reduced to digits and dots before it can reach the subject");
  // The body is sent as `text`, so nothing a customer types can become markup.
  assert.ok(/[{,]\s*text\s*[,}]/.test(FN_SRC), "the mail is sent as plain text, never as HTML");
});

test("the mail says which project, which page, which build and when — the same shape the wish-list mail uses", () => {
  // She read a feedback email and asked why it carried none of what the wish-list email
  // carries. The two are read side by side in the same inbox, so they use the same words:
  // a subject of "<what> · Engine v<n> · <date>", and a "Project:" and "Sent:" pair in the
  // body. Anything else is two formats to read instead of one.
  assert.ok(/oneLine\(\s*engine \? `Shop feedback · Engine v\$\{engine\} · \$\{datePart\}`/.test(FN_SRC),
    "the subject names the build and the date, in the wish-list mail's own shape");
  assert.ok(/`Project: \$\{project\}`/.test(FN_SRC), "the body names the project");
  assert.ok(/`Sent: \$\{sent\}`/.test(FN_SRC), "and the moment it arrived");
  assert.ok(/\$\{origin\}\$\{page\}/.test(FN_SRC),
    "the project is the live origin and path the customer was reading, joined rather than retyped");
  assert.ok(/New feedback for the shop page/.test(FN_SRC), "and the block says what it is");

  // The clock is the bakery's own. The function runs in UTC, where 08:52 is the same moment
  // as 16:52 in Penang — and it is the baker reading this, on her own phone.
  assert.ok(/timeZone: "Asia\/Kuala_Lumpur"/.test(FN_SRC),
    "the time is shown on the bakery's clock, not the server's");
  assert.ok(!/toISOString\(\)/.test(FN_SRC),
    "and never as a raw UTC stamp, which is what she could not read through before");
});

test("the mail is laid out in the wish-list mail's own order: the block first, the words last", () => {
  // She asked for the wish mail to be the reference ("Refer it"), and referred to it by
  // pointing at a mail she had already read. So the order is copied from it, not chosen:
  // the block that says what this is goes at the TOP, and the customer's words follow it
  // after one blank line. A rule between them would be a third format to read.
  const bodyAt = FN_SRC.indexOf("const text = [");
  assert.ok(bodyAt > -1, "the body is built in one place");
  const body = FN_SRC.slice(bodyAt, bodyAt + 700);
  assert.ok(/^\s*const text = \[\s*\n\s*`New feedback for the shop page/.test(body),
    "the block is the first thing in the body, as it is in the wish-list mail");
  assert.ok(body.indexOf("message,") > body.indexOf("`Project: ${project}`"),
    "and the customer's words come after it, never before");
  assert.ok(!/— — —/.test(body),
    "there is no rule: the blank line is the whole separator, as in the wish-list mail");
  assert.ok(!/sent from the shop's suggestion box/.test(body),
    "and no trailing footer the wish-list mail does not have either");
});

test("the language is named, never printed as a code", () => {
  // "en" is a value; "English" is a word. The baker reads this on her phone.
  const mapAt = FN_SRC.indexOf("const LANG_NAMES");
  assert.ok(mapAt > -1, "the three languages the shop asks in are named in one place");
  const map = FN_SRC.slice(mapAt, mapAt + 200);
  for (const [code, name] of [["en", "English"], ["ms", "Malay"], ["zh", "Chinese"]]) {
    assert.ok(new RegExp(`\\b${code}:\\s*"${name}"`).test(map),
      `"${code}" is written out as "${name}"`);
  }
  assert.ok(/Written in \$\{languageName\(lang\)\}/.test(FN_SRC),
    "and the mail uses the name rather than the raw code it was handed");
});

test("the function and the shop agree on the path", () => {
  const dir = "shop-feedback";
  assert.ok(FN_SRC.length && SHOP_SRC.includes(`/functions/v1/${dir}`),
    `the shop calls /functions/v1/${dir}, which is the folder this function is deployed from`);
});

// ---------------------------------------------------------------------------
// The box, drawn
// ---------------------------------------------------------------------------

// The shop's rendering is driven through the real store/app.js under a DOM shim, the same
// way test/store.test.js does it. The shim is deliberately the browser's shape and not a
// kinder one: replaceChildren is variadic and stringifies, and a null argument becomes a
// text node reading "null" — which is exactly the class of defect this repository has
// shipped four times (see test/store.test.js for the full account).
function createEl(tag) {
  return {
    tagName: String(tag || "").toUpperCase(), nodeType: 1, children: [], attrs: {}, dataset: {},
    className: "", style: {}, textContent: "", value: "", checked: false, disabled: false, hidden: false,
    scrollTop: 0, _listeners: {},
    classList: {
      _set: new Set(),
      add(c) { this._set.add(c); }, remove(c) { this._set.delete(c); },
      toggle(c, on) {
        if (on === undefined) { if (this._set.has(c)) this._set.delete(c); else this._set.add(c); }
        else if (on) this._set.add(c);
        else this._set.delete(c);
        return this._set.has(c);
      },
      contains(c) { return this._set.has(c); },
    },
    appendChild(c) { if (c != null) this.children.push(c); return c; },
    append(...cs) { for (const c of cs) if (c != null) this.children.push(c); },
    replaceChildren(...cs) { this.children = cs.map((c) => (c && c.nodeType ? c : { nodeType: 3, text: String(c) })); },
    addEventListener(t, f) { (this._listeners[t] ||= []).push(f); },
    removeEventListener() {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k]; },
    removeAttribute(k) { delete this.attrs[k]; },
    focus() {}, click() {},
    querySelector() { return null; }, querySelectorAll() { return []; },
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
// The window, with the one event the box listens for on it: `pagehide`, which is how a
// browser tells the page it is being left — and the moment the auto-send fires.
globalThis.window = {
  open() {},
  _listeners: {},
  addEventListener(type, fn) { (this._listeners[type] ||= []).push(fn); },
};
globalThis.fetch = async () => ({ ok: true, json: async () => [] });

// The device's own storage, held by the test so it can be read and emptied between tests.
// It is the real contract of localStorage — get/set/remove, string values only, and a key
// that is absent rather than null — because the draft's whole job is to survive a reload
// and a shim that forgot between calls would prove nothing.
function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem(k) { return map.has(String(k)) ? map.get(String(k)) : null; },
    setItem(k, v) { map.set(String(k), String(v)); },
    removeItem(k) { map.delete(String(k)); },
    clear() { map.clear(); },
  };
}
globalThis.localStorage = fakeStorage();

// A FRESH copy of store/app.js for every driven test. The box's own state — what has been
// typed into it, and whether it has been sent — is held in the module on purpose, because
// a repaint must not throw it away (renderStatic runs again on every language switch). The
// cost is that one test's send would be the next test's starting point, so each gets its
// own module through a cache-busting query. The CONFIG it reads is the SAME shared one,
// because app.js imports ./config.js without the query and Node caches that on its own.
let appCopies = 0;
async function freshApp() {
  appCopies += 1;
  return import(`../store/app.js?fresh=${appCopies}`);
}

// Render the footer with a given published developer list and hand back the module and
// the box it drew. `emails` is left set for the rest of the test, because the box's own
// Send handler re-renders from the live CONFIG — a restored one would hide the box
// underneath a send that had just succeeded.
async function drawWith(emails, { keepDraft = false } = {}) {
  // The draft outlives a module on purpose, so it is the one thing a test must start
  // without — otherwise the sentence one test typed would be standing in the next test's
  // box. A test about the draft itself asks for it to be kept.
  if (!keepDraft) globalThis.localStorage.clear();
  // Each fresh copy of the module wires its own `pagehide`, so the listeners from earlier
  // copies are dropped: the page that was drawn last is the page that is leaving.
  globalThis.window._listeners = {};
  const m = await freshApp();
  if (emails) CONFIG.developerEmails = emails;
  else delete CONFIG.developerEmails;
  m.renderStatic(CONFIG);
  return { m, holder: registry["fb-foot"] };
}

// The parts of the box, as renderFeedback draws them: ONE row holding the box and the
// trap, with the one line of answer — when there is one — underneath it. There is no
// Send button by her instruction, so nothing here looks for one.
function parts(holder) {
  const row = holder.children.find((c) => c.className === "fb-row");
  return {
    row,
    box: row && row.children.find((c) => c.tagName === "TEXTAREA"),
    trap: row && row.children.find((c) => c.tagName === "INPUT"),
    say: holder.children.find((c) => c.className && String(c.className).startsWith("fb-say")),
  };
}

// Press Enter in the box. With no button to click this IS the send, and it is the only
// thing in the footer that sends anything — so every driven test below goes through it.
// The listener returns the send's promise precisely so this can await it.
const pressEnter = (p, key = "Enter") =>
  p.box._listeners.keydown[0]({ key, preventDefault() {} });
// Leave the page. This is the auto-send's ONLY trigger — nothing goes out while the
// customer is still here — and `pagehide` is the moment a browser promises the page will
// still run code.
const leavePage = () => { for (const f of [...(globalThis.window._listeners.pagehide || [])]) f(); };
// The leave-send's own answer arrives after the page would have gone. One turn of the
// event loop is enough to hear what a still-living page hears.
const settle = () => new Promise((r) => setTimeout(r, 0));
const textOf = (node) => (node.children || []).map((c) => (c.nodeType === 3 ? c.text : textOf(c))).join("");
const sentWords = (wire) => wire.sent.map((s) => JSON.parse(s.body).message);

test("with no developer address published there is no box, and nothing to send into", async () => {
  const { holder } = await drawWith(null);
  assert.equal(holder.hidden, true, "a box with nowhere to send the words is worse than no box");
  assert.equal(holder.children.length, 0);
});

test("with an address published the box is drawn, and it prints her own prompt", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  assert.equal(holder.hidden, false);
  const p = parts(holder);
  assert.ok(p.box, "there is a box to type in");
  assert.equal(p.box.attrs.placeholder, STORE.en.fbPh,
    "the prompt in the box is the sentence she asked for, and it is translated");
  assert.equal(p.box.value, "", "and it is empty until the customer types over it");
  assert.equal(p.box.attrs.maxlength, "4000", "with a ceiling on how much one message can be");
  assert.equal(p.box.attrs["aria-label"], STORE.en.fbPh, "and the prompt is what a screen reader announces");
});

test("the shop page names the engine build it is running, under the developer's credit", async () => {
  // She asked for the shop to carry the same kind of number the backoffice shows on More,
  // so a phone can be read and believed. It belongs in the developer's own corner, under
  // the credit — the customer came for bread, not for a build number.
  const realName = CONFIG.developerName;
  try {
    CONFIG.developerName = "Knight Neoh";
    CONFIG.developerWhatsapp = "";
    const { m } = await drawWith(["knightneoh@gmail.com"]);
    m.renderStatic(CONFIG);

    const foot = registry["dev-foot"];
    assert.equal(foot.hidden, false, "the credit is drawn");
    const label = foot.children.find((c) => c.className === "dev-engine");
    assert.ok(label, "and the engine line is one of its children");
    // `el()` puts text in as a child text node rather than through textContent — the same
    // shape the browser gets, so the label is read the way the browser would render it.
    const said = label.children.map((c) => (c && c.nodeType === 3 ? c.text : "")).join("");
    assert.equal(said, `Engine v${ENGINE_VERSION}`,
      "reading the number the build actually is — the same one the backoffice shows");

    // Under the credit, not instead of it: a version line floating above the name would
    // read as the shop's own, and a shop with no developer set has no corner to put it in.
    assert.equal(foot.children[foot.children.length - 1], label, "it is the last line of the credit");
  } finally {
    CONFIG.developerName = realName;
    delete CONFIG.developerWhatsapp;
  }
});

test("there is no Send button — Enter is the send", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  assert.equal(p.row.children.length, 2, "the row is the box and the trap, and nothing else");
  assert.equal(p.say.hidden, true, "at rest the footer does not even say how it works — nothing is typed to act on");

  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    p.box.value = "a real suggestion";
    p.box._listeners.input[0]();
    assert.equal(wire.sent.length, 0, "typing alone sends nothing");
    assert.equal(p.say.textContent, STORE.en.fbHint,
      "once there are words, the one line under the box says how to send them");
    await pressEnter(p);
    assert.equal(wire.sent.length, 1, "and Enter is what sends");
  } finally { wire.restore(); }
});

test("no other key sends, and the words are kept while the message flies", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    p.box.value = "the photos could be bigger";
    p.box._listeners.input[0]();
    await pressEnter(p, "a");
    await pressEnter(p, "Backspace");
    assert.equal(wire.sent.length, 0, "only Enter is the send; a letter typed in the box is just a letter");

    // While it is in flight there is no second press to make: the box is off, and the
    // line says what is happening. Both are read from the state, not from the DOM, so a
    // repaint mid-send cannot put them back.
    let release;
    const held = new Promise((r) => { release = r; });
    globalThis.fetch = async () => { await held; return jsonReply({ ok: true }); };
    const flying = pressEnter(p);
    assert.equal(p.box.disabled, true, "the box will not take a second message");
    assert.equal(p.say.textContent, STORE.en.fbSending, "and the line says the message is going");
    release();
    await flying;
    assert.equal(textOf(holder), STORE.en.fbThanks, "which it did");
  } finally { wire.restore(); }
});

test("at rest it is ONE line that grows only when the words do not fit", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  assert.equal(p.box.attrs.rows, "1", "the box is a single line, not a form standing in the footer");
  assert.equal(p.box.value, "", "nothing is typed in it, so the only thing read is the hint");

  // The growing is the JS's, and it is the ONLY thing here that can only be proved in a
  // browser: this shim has no layout, so scrollHeight is 0 and there is no height to
  // measure. What is asserted is that typing asks for the natural height and is never
  // pinned to a number — the real growth is measured live at 375px.
  p.box.value = "a real suggestion";
  p.box._listeners.input[0]();
  assert.equal(p.box.style.height, "auto", "with no layout to measure, the box asks for its own height");
  assert.equal(p.box.attrs.rows, "1", "and it is never turned back into a tall block");
});

test("the honeypot is a field no person can reach", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const trap = parts(holder).trap;
  assert.ok(trap, "the trap is drawn");
  assert.equal(trap.attrs.name, "website", "the field name bots fill in");
  assert.equal(trap.attrs.tabindex, "-1", "not reachable by tabbing");
  assert.equal(trap.attrs["aria-hidden"], "true", "and not announced to a screen reader");
});

test("pressing Enter with nothing written says so, and sends nothing", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(new Error("should not be called"));
  try {
    p.box.value = "   ";
    p.box._listeners.input[0]();
    await pressEnter(p);
    assert.equal(p.say.textContent, STORE.en.fbEmpty);
    assert.equal(wire.sent.length, 0, "a fat thumb is not a suggestion");
    assert.equal(p.box.disabled, false, "and the box is still there to type in once they have something to say");
  } finally { wire.restore(); }
});

test("a send that worked is answered with her own reply, in the place of the box", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    p.box.value = "the photos could be bigger";
    p.box._listeners.input[0]();
    await pressEnter(p);
    assert.equal(wire.sent.length, 1, "the words went out");
    assert.equal(JSON.parse(wire.sent[0].body).message, "the photos could be bigger");
    assert.equal(holder.children.length, 1, "the box is replaced, not left standing under the reply");
    assert.equal(textOf(holder.children[0]), STORE.en.fbThanks,
      "and the reply is the sentence she asked for, word for word");
    assert.equal(holder.children[0].className, "fb-say fb-done");
  } finally { wire.restore(); }
});

test("a send that did NOT work keeps the box and never thanks them", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(jsonReply({ error: "boom" }, 500));
  try {
    p.box.value = "the photos could be bigger";
    p.box._listeners.input[0]();
    await pressEnter(p);
    const after = parts(holder);
    assert.ok(after.box, "the box is still there — the words are not lost");
    assert.equal(after.box.value, "the photos could be bigger", "and their words are still in it, exactly as typed");
    assert.equal(after.say.textContent, STORE.en.fbFailed,
      "they are told plainly, and pointed at the developer's WhatsApp link drawn just above");
    assert.ok(after.say.className.includes("fb-bad"), "and it does not read as a success");
    assert.notEqual(textOf(holder), STORE.en.fbThanks, "the thank-you is nowhere on the screen");
    assert.equal(after.box.disabled, false, "so they can try again");

    // Typing again is them answering the failure — the line about the last send stops
    // being true the moment the next one starts, and the hint takes its place.
    after.box.value = "the photos could be bigger, please";
    after.box._listeners.input[0]();
    assert.equal(after.say.textContent, STORE.en.fbHint, "the failure line is gone, and the hint is back");
  } finally { wire.restore(); }
});

test("a language switch does not throw away what they were writing, or the reply", async () => {
  // renderStatic() runs again on every language switch, and it rebuilds the footer from
  // nothing. Anything the customer had typed lives in the DOM, so without the state held
  // outside it, a half-written sentence would be wiped by a press of the 中文 pill — and a
  // thank-you somebody was still reading would be replaced by an empty box they had
  // already sent.
  const { m, holder } = await drawWith(["knightneoh@gmail.com"]);
  let p = parts(holder);
  p.box.value = "half a thought about the menu";
  // The textarea's own input event is what carries the words out of the DOM.
  p.box._listeners.input[0]();
  m.renderStatic(CONFIG);
  p = parts(registry["fb-foot"]);
  assert.equal(p.box.value, "half a thought about the menu", "the sentence survives the repaint");

  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await pressEnter(p);
    m.renderStatic(CONFIG);
    assert.equal(textOf(registry["fb-foot"]), STORE.en.fbThanks,
      "and a reply already given is not un-said by a later repaint");
  } finally { wire.restore(); }
});

// ---------------------------------------------------------------------------
// The autosave, on the screen
// ---------------------------------------------------------------------------

test("words written and never sent are still there when they come back", async () => {
  const first = await drawWith(["knightneoh@gmail.com"]);
  let p = parts(first.holder);
  p.box.value = "the checkout asks me too many questions";
  // What the textarea's own input event carries out of the DOM.
  p.box._listeners.input[0]();
  assert.equal(globalThis.localStorage.getItem("fbDraft"), "the checkout asks me too many questions",
    "the words are kept on the device as they are typed, not on a send");

  // They never pressed Enter — they tapped away and closed the page. Coming back is a
  // fresh load with a fresh module, so the draft is the only thing that outlives them.
  const again = await drawWith(["knightneoh@gmail.com"], { keepDraft: true });
  p = parts(again.holder);
  assert.equal(p.box.value, "the checkout asks me too many questions",
    "the sentence is where they left it");
  assert.equal(p.say.textContent, STORE.en.fbHint,
    "and the box reads as if they had just typed it — the hint is back, not a stale failure");
});

test("tapping away keeps the words too", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  // Their words arrive in the box without an input event — this is the tap-away half of
  // "never press Enter", and blur is the only thing that sees it.
  p.box.value = "the map is hard to use on a phone";
  p.box._listeners.blur[0]();
  assert.equal(globalThis.localStorage.getItem("fbDraft"), "the map is hard to use on a phone");
});

test("a send that worked leaves no draft behind", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  p.box.value = "the photos could be bigger";
  p.box._listeners.input[0]();
  assert.ok(globalThis.localStorage.getItem("fbDraft"), "it was kept while they were writing");

  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    await pressEnter(p);
  } finally { wire.restore(); }

  assert.equal(globalThis.localStorage.getItem("fbDraft"), null,
    "the words arrived, so there is nothing left to keep — their next visit starts clean");
});

test("a send that failed keeps the words for a reload, not just for the box", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  p.box.value = "the photos could be bigger";
  p.box._listeners.input[0]();

  const wire = stubFetch(jsonReply({ error: "boom" }, 500));
  try {
    await pressEnter(p);
  } finally { wire.restore(); }

  const again = await drawWith(["knightneoh@gmail.com"], { keepDraft: true });
  assert.equal(parts(again.holder).box.value, "the photos could be bigger",
    "a failure they walk away from is not a sentence lost either");
});

// ---------------------------------------------------------------------------
// Leaving the page is the send
// ---------------------------------------------------------------------------

test("words left in the box go out when they leave the page, without anything being pressed", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    p.box.value = "the photos could be bigger";
    p.box._listeners.input[0]();
    assert.equal(wire.sent.length, 0, "nothing goes out while they are still here — a half-written sentence must not be mailed");

    leavePage();
    assert.deepEqual(sentWords(wire), ["the photos could be bigger"],
      "closing the shop is the send; there was no button and no Enter");
    assert.equal(wire.sent[0].keepalive, true,
      "and it is handed to the browser in the one way that outlives the page it was made from");
  } finally { wire.restore(); }
});

test("a page with nothing written sends nothing when it is left", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(new Error("should not be called"));
  try {
    leavePage();
    p.box.value = "no";
    p.box._listeners.input[0]();
    leavePage();
    assert.equal(wire.sent.length, 0, "an empty box and a fat thumb are not suggestions");
  } finally { wire.restore(); }
});

test("leaving with no connection keeps the words instead of taking them down with the page", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  p.box.value = "the map is hard to use on a phone";
  p.box._listeners.input[0]();

  const wire = stubFetch(jsonReply({ ok: true }));
  const real = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const pretend = (onLine) => Object.defineProperty(globalThis, "navigator", { value: { onLine }, configurable: true });
  pretend(false);
  try {
    leavePage();
    assert.equal(wire.sent.length, 0, "a request that cannot be delivered is not made");
    assert.equal(globalThis.localStorage.getItem("fbDraft"), "the map is hard to use on a phone",
      "so their words wait on the device rather than going down with the page");
    assert.equal(p.box.value, "the map is hard to use on a phone", "and they are still in the box");

    // Back on a connection, leaving sends them as it would have.
    pretend(true);
    leavePage();
    assert.deepEqual(sentWords(wire), ["the map is hard to use on a phone"]);
  } finally {
    Object.defineProperty(globalThis, "navigator", real);
    wire.restore();
  }
});

test("one sentence is handed over once, however many times the page is left", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    p.box.value = "the checkout asks me too many questions";
    p.box._listeners.input[0]();
    leavePage();
    // The back/forward cache fires this again when the page is restored.
    leavePage();
    leavePage();
    assert.deepEqual(sentWords(wire), ["the checkout asks me too many questions"],
      "a second copy of one sentence in the developer's inbox is not a gift");

    // Typing again is a new sentence, and a new sentence has not gone yet.
    p.box.value = "the checkout asks me too many questions, and the map is slow";
    p.box._listeners.input[0]();
    leavePage();
    assert.equal(wire.sent.length, 2, "and that one goes when they leave with it");
  } finally { wire.restore(); }
});

test("a send on the way out leaves no draft behind for a second visit to re-send", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  p.box.value = "the photos could be bigger";
  p.box._listeners.input[0]();
  assert.ok(globalThis.localStorage.getItem("fbDraft"), "it was kept while they were writing");

  const wire = stubFetch(jsonReply({ ok: true }));
  try {
    leavePage();
    await settle();
  } finally { wire.restore(); }

  assert.equal(globalThis.localStorage.getItem("fbDraft"), null,
    "the words went, so there is nothing left on the device to go a second time");
  assert.equal(textOf(holder), STORE.en.fbThanks,
    "and a page still here to hear the answer gives it, exactly as Enter does");
  const again = await drawWith(["knightneoh@gmail.com"], { keepDraft: true });
  assert.equal(parts(again.holder).box.value, "", "their next visit opens on an empty box");
});

test("a leave-send that failed while the page was still here puts the words back", async () => {
  const { holder } = await drawWith(["knightneoh@gmail.com"]);
  const p = parts(holder);
  p.box.value = "the map is hard to use on a phone";
  p.box._listeners.input[0]();

  const wire = stubFetch(jsonReply({ error: "boom" }, 500));
  try {
    leavePage();
    await settle();
  } finally { wire.restore(); }

  assert.equal(globalThis.localStorage.getItem("fbDraft"), "the map is hard to use on a phone",
    "a failure nobody was around to read must not be a sentence lost");
  const again = await drawWith(["knightneoh@gmail.com"], { keepDraft: true });
  assert.equal(parts(again.holder).box.value, "the map is hard to use on a phone",
    "so the next visit finds it exactly where they left it");
});

// ---------------------------------------------------------------------------
// All three languages
// ---------------------------------------------------------------------------

test("the box is translated into all three languages, and actually translated", () => {
  const keys = ["fbPh", "fbHint", "fbSending", "fbThanks", "fbFailed", "fbEmpty"];
  for (const l of LANGS) {
    for (const key of keys) {
      assert.ok(typeof STORE[l][key] === "string" && STORE[l][key].trim(), `${l}.${key} is present`);
    }
  }
  for (const key of keys) {
    assert.notEqual(STORE.zh[key], STORE.en[key], `zh.${key} was left in English`);
    assert.notEqual(STORE.ms[key], STORE.en[key], `ms.${key} was left in English`);
  }
  // Her own sentences, word for word, in the English the customer sees. The question
  // spells out "User Interface" rather than "UI" - she ruled that shorthand out as a word
  // a customer does not use - and she asked for "Tell me" back, which makes it a two-line
  // prompt at 375px; the box opens to show it whole (see promptHeight in store/app.js).
  assert.equal(STORE.en.fbPh, "Webmaster: Like the User Interface? Tell me & I will improve it!");
  assert.equal(STORE.en.fbThanks, "Your idea is well taken care of. New updates soon!");
});
