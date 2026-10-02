// test/promo.test.js — the promo-code engine. Pure module, no DOM needed.
// Run with: node --test test/
//
// These are the rules the SHOP and the BACKOFFICE both run, so every test here
// is written as a property of the judgement rather than a snapshot of it: a test
// that would still pass after the rule was changed is not testing the rule.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankCode, codeNameOk, codeProblem, codesOf, evaluate, findCode, minimumOf,
  normCode, normalizeCode, offerOf, publishCodes, SAY_MAX, stoppedBy, worthOf,
} from "../admin/js/promo.js";

const TODAY = "2026-10-02";

// A code as the app would store one: every family present, only the ones a test
// cares about overridden.
function code(over = {}) {
  return {
    ...blankCode(),                                   // every family, at its default
    id: "promo_1",
    code: "FRESH10",
    gives: { type: "rm", value: 10, cap: 0 },         // the offer a test gets if it does not say
    ...over,
  };
}

// The context the shop judges with: today, the basket in front of the customer,
// and what that phone remembers about them.
function ctx(over = {}) {
  return { today: TODAY, total: 50, ...over };
}

// ── Matching ──────────────────────────────────────────────────────────────

test("a code is matched however it is typed — case and spacing cannot lose a discount", () => {
  const list = [code({ code: "FRESH10" })];
  for (const typed of ["FRESH10", "fresh10", "  Fresh10  ", "fReSh10"]) {
    const r = evaluate(list, typed, ctx());
    assert.equal(r.ok, true, `"${typed}" should be accepted`);
    assert.equal(r.code.code, "FRESH10", "and answered with the stored spelling");
  }
});

test("an empty or unknown code is unknown, never a default", () => {
  const list = [code({ code: "FRESH10" })];
  for (const typed of ["", "   ", "SUMMER", null, undefined]) {
    const r = evaluate(list, typed, ctx());
    assert.equal(r.ok, false);
    assert.equal(r.fail, "unknown", `"${typed}" must not match anything`);
  }
});

test("normCode is the one spelling, and findCode answers null rather than a near-miss", () => {
  assert.equal(normCode(" fresh10 "), "FRESH10");
  assert.equal(findCode([code({ code: "FRESH10" })], "FRESH1"), null, "a prefix is not a code");
  assert.equal(findCode([code({ code: "FRESH10" })], "FRESH100"), null, "a longer name is not a code");
  assert.equal(findCode(null, "FRESH10"), null, "an unpublished list is not a crash");
});

// ── The record shape ──────────────────────────────────────────────────────

test("a hand-written or half-synced record is clamped, never trusted and never thrown", () => {
  const c = normalizeCode({
    code: "f r e s h",
    state: "banana",
    vis: "secret",
    gives: { type: "pct", value: "10", cap: -5 },
    basket: { type: "amount", amount: "30" },
    often: { type: "quota", n: "2.5", maxRM: "abc" },
    who: { type: "everyone" },
    when: { from: "02/10/2026", to: "2026-12-31" },
    beside: { type: "nocode" },
  });
  assert.equal(c.state, "live", "an unknown state falls back to the one that works");
  assert.equal(c.vis, "public", "an unknown visibility is never treated as a kind of secret");
  assert.equal(c.who.type, "all");
  assert.equal(c.beside.type, "anything");
  assert.equal(c.when.from, "", "a date that is not ISO is dropped, not half-read");
  assert.equal(c.when.to, "2026-12-31");
  assert.equal(c.gives.cap, 0, "a negative cap is not a cap");
  assert.equal(c.basket.amount, 30, "a numeric string is a number");
  assert.equal(c.often.n, 0, "a fractional order count is not a count");
  assert.equal(c.often.maxRM, 0);
});

test("every family has a no-opinion default, so a record that predates a family still runs", () => {
  const c = normalizeCode({ code: "OLDCODE" });
  const b = blankCode();
  assert.equal(c.code, "OLDCODE");
  for (const family of ["state", "vis", "who", "when", "basket", "gives", "often", "beside"]) {
    assert.deepEqual(c[family], b[family], `${family} was left without its no-opinion default`);
  }
  assert.equal(c.frozen, false);
  assert.equal(c.used, 0);
  assert.equal(c.given, 0);
});

test("cleaning a record never loses the two things it is addressed and judged by", () => {
  // The id is how the screen finds the row again to edit or delete it; the counts
  // are how the shop knows a code has been fully claimed. A normaliser that drops
  // either is a normaliser that quietly breaks them, so both are pinned here.
  const c = normalizeCode({ id: "promo_7", code: "FRESH10", used: 4, given: "12.50" });
  assert.equal(c.id, "promo_7");
  assert.equal(c.used, 4);
  assert.equal(c.given, 12.5);
  assert.equal(normalizeCode({ code: "FRESH10" }).id, "", "a row with no id is given none, not a made-up one");
  assert.equal(normalizeCode({ code: "F", used: -3, given: "abc" }).used, 0, "a nonsense tally is no tally");
  assert.equal(normalizeCode({ code: "F", used: -3, given: "abc" }).given, 0);
});

test("a code's name is one rule, shared by the form and by what the shop is handed", () => {
  for (const good of ["ABC", "FRESH10", "A1B2C3"]) assert.equal(codeNameOk(good), true, `${good} is typeable`);
  for (const bad of ["AB", "WAY-TOO-LONG-A-CODE", "HAS SPACE", "", "FRESH 10"]) {
    assert.equal(codeNameOk(bad), false, `"${bad}" cannot be read off a card`);
  }
  assert.equal(codeNameOk("fresh10"), true, "a name is judged in the one spelling the engine uses");
});

// ── What the offer is worth ───────────────────────────────────────────────

test("an amount off is worth its amount, whatever the basket", () => {
  const w = worthOf(code({ gives: { type: "rm", value: 10, cap: 0 } }), 4);
  assert.equal(w.kind, "rm");
  assert.equal(w.money, 10, "a RM10 code is RM10 off a RM4 basket too — the bakery decides what to do about that, not the shop");
});

test("a percentage is worth its share of the basket, capped when a cap is set", () => {
  const uncapped = code({ gives: { type: "pct", value: 10, cap: 0 } });
  assert.equal(worthOf(uncapped, 50).money, 5);
  const capped = code({ gives: { type: "pct", value: 10, cap: 3 } });
  assert.equal(worthOf(capped, 50).money, 3, "the cap holds the offer down");
  assert.equal(worthOf(capped, 20).money, 2, "and does not raise it below the cap");
});

test("free delivery is worth the fee it waives, and nothing when there is no fee", () => {
  const c = code({ gives: { type: "delivery", value: 0, cap: 0 } });
  assert.equal(worthOf(c, 50, 8).money, 8);
  assert.equal(worthOf(c, 50).money, 0, "a self-collect order has no fee to waive");
  assert.equal(evaluate([c], "FRESH10", ctx({ deliveryFee: 8 })).delivery, true);
});

test("the offer is answered as parts, never as a sentence in one language", () => {
  assert.deepEqual(offerOf(code({ gives: { type: "pct", value: 10, cap: 15 } })), { kind: "pct", value: 10, cap: 15 });
  assert.deepEqual(offerOf(code({ gives: { type: "delivery", value: 0, cap: 0 } })), { kind: "delivery" });
});

// ── The check order ───────────────────────────────────────────────────────

test("the eight steps answer in order, each with its own reason", () => {
  const cases = [
    [{ state: "paused" }, "paused"],
    [{ state: "ended" }, "ended"],
    [{ when: { from: "2026-11-01", to: "" } }, "notYet"],
    [{ when: { from: "2026-01-01", to: "2026-09-30" } }, "ended"],
    [{ often: { type: "quota", n: 3, maxRM: 0 }, used: 3 }, "claimed"],
    [{ often: { type: "quota", n: 9, maxRM: 20 }, used: 1, given: 20 }, "claimed"],
    [{ often: { type: "once", n: 0, maxRM: 0 } }, "used"],
    [{ who: { type: "first" } }, "firstOnly"],
    [{ beside: { type: "nocredit" } }, "clash"],
    [{ basket: { type: "amount", amount: 80 } }, "small"],
  ];
  const extra = {
    used: { usedCodes: ["FRESH10"] },
    firstOnly: { isNew: false },
    clash: { creditApplied: true },
  };
  for (const [over, expected] of cases) {
    const r = evaluate([code(over)], "FRESH10", ctx(extra[expected] || {}));
    assert.equal(r.ok, false, `${expected}: should be refused`);
    assert.equal(r.fail, expected);
  }
});

test("a reason with no way forward is always asked before the one with a way forward", () => {
  // Ended AND below its minimum. The customer must be told it ENDED: sending
  // them to fetch another RM30 for a discount they could never have got is the
  // exact fault this order exists to prevent.
  const dead = code({ when: { from: "2026-01-01", to: "2026-09-30" }, basket: { type: "amount", amount: 80 } });
  assert.equal(evaluate([dead], "FRESH10", ctx({ total: 10 })).fail, "ended");
  // And the same for every other reason that cannot be fixed by spending more.
  const usedUp = code({ often: { type: "quota", n: 1, maxRM: 0 }, used: 1, basket: { type: "amount", amount: 80 } });
  assert.equal(evaluate([usedUp], "FRESH10", ctx({ total: 10 })).fail, "claimed");
  const paused = code({ state: "paused", basket: { type: "amount", amount: 80 } });
  assert.equal(evaluate([paused], "FRESH10", ctx({ total: 10 })).fail, "paused");
});

test("the shortfall is reported so the customer can be told how much more to add", () => {
  const r = evaluate([code({ basket: { type: "amount", amount: 30 } })], "FRESH10", ctx({ total: 18 }));
  assert.equal(r.fail, "small");
  assert.equal(r.short, 12);
});

test("a code that ends today has not ended", () => {
  const c = code({ when: { from: "2026-09-01", to: TODAY } });
  assert.equal(evaluate([c], "FRESH10", ctx()).ok, true, "the last day is a day it works");
});

test("a code that starts today has started", () => {
  const c = code({ when: { from: TODAY, to: "" } });
  assert.equal(evaluate([c], "FRESH10", ctx()).ok, true);
});

test("an order that costs nothing is never made to satisfy a minimum", () => {
  // total 0 and no minimum: the code still applies (a delivery code on an order
  // whose fee is waived by hand). The engine must not invent a floor.
  const c = code({ gives: { type: "delivery", value: 0, cap: 0 } });
  assert.equal(evaluate([c], "FRESH10", ctx({ total: 0 })).ok, true);
  assert.equal(minimumOf(code()), 0);
});

// ── One judgement, not two ────────────────────────────────────────────────

test("stoppedBy and evaluate never disagree about whether a code is still running", () => {
  // The shop's standing line asks stoppedBy (it has no basket); the code box asks
  // evaluate (it has one). If these ever drift, the page advertises a code it
  // then refuses — so the property is stated outright, over every shape.
  const shapes = [
    code(), code({ state: "paused" }), code({ state: "ended" }),
    code({ when: { from: "2026-11-01", to: "" } }),
    code({ when: { from: "2026-01-01", to: "2026-09-30" } }),
    code({ often: { type: "quota", n: 2, maxRM: 0 }, used: 2 }),
    code({ often: { type: "quota", n: 9, maxRM: 30 }, used: 1, given: 30 }),
    code({ often: { type: "quota", n: 9, maxRM: 0 }, used: 1, given: 30 }),
  ];
  for (const c of shapes) {
    const stopped = stoppedBy(c, TODAY);
    // A generous basket and a brand-new customer, so nothing but the code's own
    // state can refuse it.
    const r = evaluate([c], "FRESH10", ctx({ total: 9999, isNew: true }));
    assert.equal(r.ok, !stopped,
      `${c.often.type}/${c.state}/${c.when.from}→${c.when.to}: stoppedBy says ${stopped ? stopped.fail : "running"}, evaluate says ${r.ok ? "ok" : r.fail}`);
  }
});

// ── What the shop is given ────────────────────────────────────────────────

test("every usable code is published, personal ones included, and nothing malformed is", () => {
  const state = {
    promoCodes: [
      code({ code: "FRESH10" }),
      code({ id: "promo_2", code: "AUNTY5", vis: "personal" }),
      code({ id: "promo_3", code: "" }),          // never named — not a code
      code({ id: "promo_4", code: "WAY-TOO-LONG-A-CODE" }),
    ],
  };
  const out = publishCodes(state);
  assert.deepEqual(out.map((c) => c.code), ["FRESH10", "AUNTY5"],
    "a personal code is published — it is the only way its owner can use it — a nameless one is not, and neither is one whose name could never be typed");
  assert.equal(codesOf(state).length, 3,
    "but her own screen still holds every row she has, so nothing she made is hidden from her");
});

test("a published code carries the rules the shop has to judge it with", () => {
  const c = code({
    when: { from: "2026-10-01", to: "2026-12-31" },
    basket: { type: "amount", amount: 30 },
    often: { type: "once", n: 0, maxRM: 25 },
  });
  const [out] = publishCodes({ promoCodes: [c] });
  assert.deepEqual(out.when, { from: "2026-10-01", to: "2026-12-31" });
  assert.deepEqual(out.basket, { type: "amount", amount: 30 });
  assert.deepEqual(out.often, { type: "once", n: 0, maxRM: 25 });
  assert.equal(out.code, "FRESH10");
});

// ── What the app refuses to save ──────────────────────────────────────────

test("a code that cannot work is refused by name, in data rather than in a sentence", () => {
  const list = [code({ code: "TAKEN" })];
  const shape = (o) => codeProblem(list, code(o));
  assert.equal(shape({ code: "" }).fail, "empty");
  assert.equal(shape({ code: "AB" }).fail, "shape", "too short to read off a card");
  assert.equal(shape({ code: "HAS A SPACE" }).fail, "shape");
  assert.equal(shape({ code: "TAKEN" }).fail, "dupe", "two codes must never share a name");
  assert.equal(shape({ code: "FRESH10" }), null, "a good code is not refused");
  assert.equal(codeProblem(list, code({ code: "TAKEN" }), "promo_1"), null,
    "a code edited in place is not a duplicate of itself");
  assert.equal(codeProblem([], code({ gives: { type: "rm", value: 0, cap: 0 } })).fail, "noAmount");
  assert.equal(codeProblem([], code({ gives: { type: "pct", value: 0, cap: 0 } })).fail, "noPercent");
  assert.equal(codeProblem([], code({ gives: { type: "pct", value: 100, cap: 0 } })).fail, "percentTooBig");
  assert.equal(codeProblem([], code({ when: { from: "2026-10-10", to: "2026-10-01" } })).fail, "datesBackwards");
});

test("a name she has already used is reported before a box she has left empty", () => {
  // Both are wrong on the same press. The name is the field she has already
  // decided, so it is the one worth naming first: she retypes it and keeps her
  // amount. Report the empty box instead and she fills it in, presses again, and
  // only then hears the name was taken.
  const list = [{ id: "promo_1", code: "FRESH10" }];
  const both = code({ code: "FRESH10", gives: { type: "rm", value: 0, cap: 0 } });
  assert.equal(codeProblem(list, both).fail, "dupe");
  // …and with the name free, the empty box is what it says.
  assert.equal(codeProblem(list, code({ code: "FRESH20", gives: { type: "rm", value: 0, cap: 0 } })).fail, "noAmount");
});

test("a quota of zero is refused, because the engine would read it as no limit at all", () => {
  // "No opinion" and "none at all" are opposite answers that share a spelling:
  // the engine reads n <= 0 as no opinion, i.e. unlimited. A limit of nothing
  // must therefore never reach it, or a code she capped at zero silently becomes
  // the one code with no cap.
  const zero = codeProblem([], code({ often: { type: "quota", n: 0, maxRM: 0 } }));
  assert.equal(zero && zero.fail, "noQuota");
  assert.equal(codeProblem([], code({ often: { type: "quota", n: -1, maxRM: 0 } })).fail, "noQuota");
  assert.equal(codeProblem([], code({ often: { type: "quota", n: 3, maxRM: 0 } })), null,
    "a real count is a real limit");
  assert.equal(codeProblem([], code({ often: { type: "unlimited", n: 0, maxRM: 0 } })), null,
    "and a code that is unlimited on purpose is not a quota with a missing count");
});

// ── Her own words on the strip ────────────────────────────────────────────

test("the bakery's own sentence is kept as she typed it, and cannot grow into a wall of text", () => {
  const c = normalizeCode({
    code: "FRESH10",
    say: "  Fresh from the oven  ",
    sayZh: "  刚出炉  ",
    sayMs: "  Baru keluar oven  ",
  });
  assert.equal(c.say, "Fresh from the oven", "what she typed survives, without the space around it");
  assert.equal(c.sayZh, "刚出炉");
  assert.equal(c.sayMs, "Baru keluar oven");
  const long = "x".repeat(SAY_MAX + 40);
  const capped = normalizeCode({ code: "FRESH10", say: long });
  assert.equal(capped.say, long.slice(0, SAY_MAX), "a sentence the strip cannot carry is cut at the end, never reworded");
  assert.equal(normalizeCode({ code: "FRESH10" }).say, "", "a code with no sentence of hers has none, not a placeholder");
  assert.equal(normalizeCode({ code: "FRESH10", say: null }).say, "");
  assert.equal(blankCode().say, "", "and a fresh code starts with the shop composing its own line");
});

test("her own words are published beside the code, because the shop is where they are read", () => {
  const [out] = publishCodes({
    promoCodes: [code({ say: "Baked this morning, still warm.", sayZh: "今早刚出炉。", sayMs: "Dibakar pagi ini." })],
  });
  assert.equal(out.say, "Baked this morning, still warm.");
  assert.equal(out.sayZh, "今早刚出炉。");
  assert.equal(out.sayMs, "Dibakar pagi ini.");
  const [plain] = publishCodes({ promoCodes: [code()] });
  assert.equal(plain.say, "", "blank is the normal state — the shop then composes the line itself");
});

test("her own sentence can never change what a code is called", () => {
  // The name is judged on its own. A sentence that happens to contain a code
  // must not make a good name bad or a bad name good — the customer reads the
  // name, not the sentence, when they type it at the box.
  const c = normalizeCode({ code: "FRESH10", say: "Type FRESH10 at the checkout" });
  assert.equal(c.code, "FRESH10", "the sentence is not spliced into the name");
  assert.equal(codeProblem([], code({ code: "AB", say: "Ask us for the good code" })).fail, "shape",
    "and a name too short to read off a card is still refused, however nice the sentence is");
});
