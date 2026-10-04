// promo.js — the promo-code engine. Pure (no DOM, no localStorage, and no
// English words) so the shop, the backoffice and the Node tests all judge a code
// by exactly the same rules. The customer's wording lives in store-lang.js and
// the app's in promo-lang.js; this file only ever answers in data.
//
// The whole point of v268 was that five places each worked the same thing out
// and disagreed with each other. So there is ONE judge here — evaluate() — and
// both doors of the shop come through it: the standing today line, and the code
// the customer types.
//
// A code carries six families and nothing else. Every family has a position that
// means "I have no opinion here", which is what lets a seventh be added later
// without changing a single code that already exists or a card already printed.

// Deliberately a LEAF — this module imports nothing at all. It is read by the
// backoffice, by the customer's shop page and by the Node tests, and the shop
// must not have to drag the whole backoffice state module (and its storage) into
// a customer's browser to judge one code. `admin/js/state.js` already exports a
// round2 this could borrow; it is repeated here to keep that promise.
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// The code as the customer would type it: no stray spaces, no case to argue
// about. Both the stored code and the typed one come through here.
export function normCode(s) {
  return String(s == null ? "" : s).trim().toUpperCase();
}

export function findCode(list, s) {
  const want = normCode(s);
  if (!want) return null;
  const rows = Array.isArray(list) ? list : [];
  const found = rows.find((c) => c && normCode(c.code) === want);
  return found ? normalizeCode(found) : null;
}

// The name a customer could actually type off a card. ONE definition, because
// three places have to agree on it: the form that refuses a bad name, the list
// the shop is given, and the shop's own filter on that list (the published row is
// world-readable and world-writable by anyone holding the public key, so the shop
// re-checks it rather than trusting it).
export function codeNameOk(s) {
  return /^[A-Z0-9]{3,16}$/.test(normCode(s));
}

// ── v286: a suggested code the customer can read off a card ──────────────────
//
// A code is read by eye TWICE: she types it when she makes it, and the customer types it off
// the printed card. The pairs people get wrong doing that are 0/O, 1/I and 1/L — a customer
// holding a card that says `FRESH1O` has no way to know which one it is. So a SUGGESTED code
// is cut from an alphabet with none of those five characters in it.
//
// NOTHING IS FORCED BY THIS. The box stays hers to type into, and every code that already
// exists keeps working exactly as it did — the shape rule (codeNameOk) is unchanged and still
// allows the look-alikes, because a code she has already printed cannot be renamed.
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 5;

function randomChars(n) {
  const out = [];
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(n);
    crypto.getRandomValues(buf);
    for (let i = 0; i < n; i += 1) out.push(CODE_ALPHABET[buf[i] % CODE_ALPHABET.length]);
    return out.join("");
  }
  // The same fallback the rest of the app uses, so nothing here depends on crypto existing.
  for (let i = 0; i < n; i += 1) {
    out.push(CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]);
  }
  return out.join("");
}

// A fresh code that is not already in use. `taken` may be a list of codes or a list of code
// RECORDS — the two shapes this app hands it — and the only thing that matters is that a
// printed card is never given a name that already means something else: two codes sharing one
// name is the fault the shop cannot recover from, because it would take the wrong amount off.
export function makeCode(taken = []) {
  const used = new Set(
    [...(taken || [])].map((c) => normCode((c && c.code) || c || "")),
  );
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const c = randomChars(CODE_LENGTH);
    if (!used.has(c)) return c;
  }
  // 31^5 is 28.6 million, so reaching here means `taken` is not what we think it is. A longer
  // code is the honest answer — never hand back one that is already in use.
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const c = randomChars(CODE_LENGTH + 3);
    if (!used.has(c)) return c;
  }
  return randomChars(CODE_LENGTH + 6);
}

// A brand-new code, every family at its no-opinion default. The one exception is
// "when" — a code with no start date starts the day it is made, so the default
// from-date is filled by the caller, not here (this file never reads the clock).
//
// `used` and `given` are not a family she sets: they are the counts derived from
// her real orders, carried on the record so the shop can judge "has this been
// fully claimed". They live here so that a code's stored shape is stated exactly
// once, and normaliseCode can always answer with that whole shape.
//
// `say` is the one place she writes for the customer in her own words. Blank is
// the normal state and means "let the shop say it its own way" — the shop's own
// sentence is composed from the code's parts and exists in all three languages,
// so a code with nothing written here still reads properly in 中文 and BM. The
// three boxes mirror the storefront policy text (see Settings → Storefront):
// English is hers to write, the other two are machine-filled and hers to correct,
// and a blank translation falls back to the English she wrote.
export function blankCode() {
  return {
    code: "",
    state: "live", // live | paused | ended
    vis: "public", // public = may be advertised; personal = never advertised
    who: { type: "all" }, // all | first
    when: { from: "", to: "" }, // ISO dates; to "" = no end date
    basket: { type: "none", amount: 0 }, // none | amount
    gives: { type: "rm", value: 0, cap: 0 }, // rm | pct | delivery
    often: { type: "unlimited", n: 0, maxRM: 0 }, // unlimited | once | quota
    beside: { type: "anything" }, // anything | nocredit
    // WHOSE CODE THIS IS (v289). A formal partner prints labels and runs marketing, and this is
    // what makes their label attributable — the code's own `used` count and its label's opens
    // become that person's tally, with nothing new to track. `who` above is a CLASS of buyer
    // ("anyone" / "a first order only"), never a person; this is the person.
    //
    // `id` IS THE PROFILE'S OWN ID, NOT ITS `key`. A key MOVES: correcting a customer's WhatsApp
    // number re-keys them, a name-only customer who gains a number flips from name to digits, and
    // two people sharing a name with no number collapse onto ONE key — which would bind two
    // different printed codes to one shared person. A profile id is issued once, survives a
    // re-key, and survives a merge.
    //
    // `name` IS FROZEN BESIDE IT, the way orderLineName freezes a sold product's name: a profile
    // she later renames or merges away still reads as who it was when the code was made.
    //
    // AND IT IS DELIBERATELY NEVER PUBLISHED — see publishCodes. The shop's row is world-readable.
    holder: { id: "", name: "" },
    say: "",   // her own sentence for the shop, or "" for the shop's own words
    sayZh: "",
    sayMs: "",
    used: 0, // orders that have carried it — derived, never incremented here
    given: 0, // ringgit those orders gave away — derived the same way
  };
}

// How much of her own sentence the shop will carry. Long enough for two lines on
// a phone, short enough that the strip above the menu cannot grow into a wall of
// text and push the delivery days off the screen.
export const SAY_MAX = 160;

// Never trust a hand-edited, half-synced or half-published record: every family
// is clamped back to something the rules can actually run on, so a malformed row
// can never crash a screen or, worse, quietly widen an offer.
export function normalizeCode(rec) {
  const b = blankCode();
  const src = rec && typeof rec === "object" ? rec : {};
  const pick = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
  const money = (v) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  };
  const iso = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
  const who = src.who && typeof src.who === "object" ? src.who : {};
  const when = src.when && typeof src.when === "object" ? src.when : {};
  const basket = src.basket && typeof src.basket === "object" ? src.basket : {};
  const gives = src.gives && typeof src.gives === "object" ? src.gives : {};
  const often = src.often && typeof src.often === "object" ? src.often : {};
  const beside = src.beside && typeof src.beside === "object" ? src.beside : {};
  const count = (v) => {
    const n = Number(v);
    return Number.isInteger(n) && n > 0 ? n : 0;
  };
  const words = (v) => String(v == null ? "" : v).trim().slice(0, SAY_MAX);
  return {
    // The row's identity has to survive this or it is LOST: the editor files a
    // new code by the id it generated, and the row is found again to edit or
    // delete by that same id. A normaliser that quietly dropped it would leave
    // rows nothing could ever address.
    id: String(src.id == null ? "" : src.id),
    code: normCode(src.code),
    state: pick(src.state, ["live", "paused", "ended"], b.state),
    vis: pick(src.vis, ["public", "personal"], b.vis),
    who: { type: pick(who.type, ["all", "first"], b.who.type) },
    when: { from: iso(when.from), to: iso(when.to) },
    basket: {
      type: pick(basket.type, ["none", "amount"], b.basket.type),
      amount: money(basket.amount),
    },
    gives: {
      type: pick(gives.type, ["rm", "pct", "delivery"], b.gives.type),
      value: money(gives.value),
      cap: money(gives.cap),
    },
    often: {
      type: pick(often.type, ["unlimited", "once", "quota"], b.often.type),
      // A quota of 0 is not "no quota", it is a limit she has not finished
      // setting — and the engine reads 0 as no opinion at all, which would make
      // the code unlimited. It is refused by codeProblem, so this clamp only ever
      // catches a hand-edited or half-synced row.
      n: count(often.n),
      maxRM: money(often.maxRM),
    },
    beside: { type: pick(beside.type, ["anything", "nocredit"], b.beside.type) },
    // THE FOURTH LIST. A field blankCode names but this does not is STRIPPED here, on the next
    // read — and nothing would fail, because the shape test in test/promo.test.js iterates a
    // hardcoded family list that does not include this one. The round-trip test added with it
    // (deepEqual of normalizeCode(blankCode()) against blankCode()) is what makes a future
    // forgotten list turn red instead of quietly killing the feature.
    //
    // `name` is capped like her own sentence: it is a person's name, not a paragraph.
    holder: { id: String((src.holder && src.holder.id) || ""), name: words(src.holder && src.holder.name) },
    say: words(src.say),
    sayZh: words(src.sayZh),
    sayMs: words(src.sayMs),
    // Counted, not trusted: a negative or nonsense tally clamps to none, so a
    // bad number can never make a code look exhausted when it is not.
    used: count(src.used),
    given: money(src.given),
  };
}

// Every code in the app's state, normalised. One place, so a screen never has to
// remember to clean a row before reading it.
export function codesOf(state) {
  const list = (state && state.promoCodes) || [];
  return (Array.isArray(list) ? list : []).filter((c) => c && normCode(c.code)).map(normalizeCode);
}

// What the offer IS, as data — never as words.
//   { kind:"rm",       value }        → "RM5 off"
//   { kind:"pct",      value, cap }   → "10% off"   (cap > 0 → "10% off, up to RM15")
//   { kind:"delivery" }               → "Free delivery"
export function offerOf(code) {
  const g = (code && code.gives) || {};
  if (g.type === "delivery") return { kind: "delivery" };
  if (g.type === "pct") return { kind: "pct", value: Number(g.value) || 0, cap: Number(g.cap) || 0 };
  return { kind: "rm", value: Number(g.value) || 0 };
}

// What that offer is worth on a given basket. A delivery code is worth the
// delivery fee, which this file does not know — the caller passes it in, and 0
// means "this order had no delivery fee to waive".
export function worthOf(code, total, deliveryFee = 0) {
  const o = offerOf(code);
  const t = Number(total) || 0;
  if (o.kind === "delivery") return { ...o, money: round2(Number(deliveryFee) || 0) };
  if (o.kind === "pct") {
    let money = t * (o.value / 100);
    if (o.cap > 0) money = Math.min(money, o.cap);
    return { ...o, money: round2(money) };
  }
  return { ...o, money: round2(o.value) };
}

// The minimum this code wants in the basket, or 0 for "no opinion".
export function minimumOf(code) {
  const b = (code && code.basket) || {};
  return b.type === "amount" ? Number(b.amount) || 0 : 0;
}

// How much MORE the basket needs before this code works on it — 0 when the basket
// already reaches the code's smallest basket, or when the code asks for no
// smallest basket at all.
//
// One answer, asked by both doors: evaluate() refuses with it, and the shop's own
// line for a code it is stating-but-not-gating words itself from it. A shortfall
// worked out twice is a shortfall that can disagree with itself.
export function shortfallOf(code, items) {
  const need = minimumOf(code) - (Number(items) || 0);
  return need > 0 ? round2(need) : 0;
}

/* What a code GIVES on an order it is already on. The one difference from
   worthOf, and the whole reason this exists: worthOf answers "what is this offer
   worth on a basket", which is a question about the OFFER. This answers "what
   does this code actually give on this sale", which is a question about the SALE
   — and an offer whose smallest basket this sale never reached gives nothing at
   all, exactly as a free-delivery code gives nothing on an order being collected.

   This is the seam every figure the customer is asked for comes through (see
   customerTotal in courier.js), so the smallest basket is honoured in ONE place
   rather than at each screen that quotes a total.

   It reads the basket and never the calendar. A code that has since been paused,
   ended or used up still gives what it gave on the order it was placed on: that
   is history, and history is not rewritten. Whether the basket was ever big
   enough is not a fact about the code's life but about this one order, which
   does not change either.                                                       */
export function awardOf(code, items, deliveryFee = 0) {
  if (!code) return { code: "", money: 0 };
  const basket = Number(items) || 0;
  if (shortfallOf(code, basket) > 0) return { code: "", money: 0 };
  const money = worthOf(code, basket, Number(deliveryFee) || 0).money;
  return { code: money > 0 ? code.code : "", money: money > 0 ? money : 0 };
}

/* The part of the judgement that depends on nothing but the code and the day:
   is it switched on, is it inside its dates, has it already given away
   everything it was allowed to. Answers with the reason it is stopped, or null.

   Split out, NOT copied, because the shop's standing line has to ask exactly
   this question — "is this a code worth putting in front of a customer?" — and
   has no basket to ask it with. evaluate() below calls this, so the line and the
   code box can never drift apart on what "still running" means.                 */
export function stoppedBy(code, today = "") {
  if (!code) return { fail: "unknown" };
  if (code.state === "paused") return { fail: "paused" };
  if (code.state === "ended") return { fail: "ended", on: code.when.to };
  if (today && code.when.from && today < code.when.from) return { fail: "notYet", on: code.when.from };
  if (today && code.when.to && today > code.when.to) return { fail: "ended", on: code.when.to };
  // Used up — either bound, whichever is reached first. The count and the
  // ringgit are derived from her real orders by usageOf (see js/promo-usage.js);
  // nothing here reads a tally the shop could have written.
  //
  // `bound` names WHICH limit ran out. The customer never reads it — both bounds
  // present as the one "fully claimed" refusal, so no new wording exists and
  // neither the count nor the money is ever put in front of them. It is there
  // because the bound is HER information: her own screen needs to say whether the
  // code ran out of orders or out of ringgit, and that comparison is worked out
  // here rather than a second time in a screen that could drift from this one.
  const overCount = code.often.type === "quota" && Number(code.often.n) > 0 && code.used >= Number(code.often.n);
  const overMoney = Number(code.often.maxRM) > 0 && Number(code.given) >= Number(code.often.maxRM);
  if (overCount || overMoney) {
    return { fail: "claimed", bound: overCount ? (overMoney ? "both" : "count") : "money" };
  }
  return null;
}

/* The check order. The FIRST failure is the one the customer reads, so every
   reason with no way forward is asked BEFORE the only one that has a way
   forward. A customer is never sent to fetch another loaf for a discount they
   could never have got.                                                        */
export function evaluate(list, typed, ctx = {}) {
  const code = findCode(list, typed); // 1 · do we know it
  if (!code) return { ok: false, fail: "unknown" };

  const stopped = stoppedBy(code, ctx.today); // 2-4 · switched on, dates, used up
  if (stopped) return { ok: false, ...stopped };

  // 5 · is THIS person allowed (best-effort in a shop that has no login)
  const used = Array.isArray(ctx.usedCodes) ? ctx.usedCodes.map(normCode) : [];
  if (code.often.type === "once" && used.includes(code.code)) return { ok: false, fail: "used" };
  if (code.who.type === "first" && ctx.firstOrderExempt !== true && ctx.isNew === false) {
    return { ok: false, fail: "firstOnly" };
  }

  if (code.beside.type === "nocredit" && ctx.creditApplied === true) return { ok: false, fail: "clash" }; // 6

  const total = Number(ctx.total) || 0;
  const short = shortfallOf(code, total); // 7 · big enough — the ONLY fixable reason, so it is last
  if (short > 0) return { ok: false, fail: "small", short };

  const w = worthOf(code, total, ctx.deliveryFee); // 8 · state the offer, with its working
  return { ok: true, code, offer: w, money: w.money, delivery: w.kind === "delivery" };
}

/* Which of her codes the shop may ADVERTISE. A personal code must still be
   judged when it is typed — that is the only way its owner can use it — so it is
   published, but it never appears in the standing line and never goes on a card.
   The published list is public by nature (it is read with the shop's own public
   key), so "personal" means never-advertised, never secret.                     */
export function publishCodes(state, counts = null) {
  // Only names the shop could ever honour. A code whose name cannot be typed
  // (too short, too long, a stray character) would be advertised by a page that
  // then refused it — so it is left out of the list entirely rather than sent
  // and dropped again downstream. It still shows on her own screen, where she
  // can see and fix it; nothing she made is hidden from her.
  return codesOf(state).filter((c) => codeNameOk(c.code)).map((c) => {
    // The two counts are DERIVED, never carried: the caller passes a counter that
    // recounts from her real orders at the moment of publishing (see
    // js/promo-usage.js). A tally stored on the record would be stale the instant
    // an order arrived on another phone, and a stale "used" is exactly what would
    // leave the shop advertising a code she has already given away in full. With
    // no counter the record's own numbers stand, so a test or a second business
    // can publish a hand-made list unchanged.
    const n = typeof counts === "function" ? counts(c) : null;
    // THIS LIST IS DELIBERATE AND `holder` IS NOT IN IT (v289). A code may belong to a named
    // customer, and that name is the baker's own customer book — while the row this builds is
    // PUBLISHED and world-readable, so anyone holding the shop's public key could read it.
    // Adding `holder` here would put her customers' names on the open internet. It stays on her
    // own screen, on the admin's code card, and nowhere else. test/promo.test.js holds it there.
    return {
      code: c.code,
      state: c.state,
      vis: c.vis,
      used: n ? n.used : c.used,
      given: n ? n.given : c.given,
      who: c.who,
      when: c.when,
      basket: c.basket,
      gives: c.gives,
      often: c.often,
      beside: c.beside,
      // Her own sentence, when she wrote one. Published because the shop is where
      // it is read; blank is the normal state and means the shop composes it.
      say: c.say,
      sayZh: c.sayZh,
      sayMs: c.sayMs,
    };
  });
}

// Why a code cannot be saved as it stands — null when it is fine. Answers in a
// machine reason, never a sentence, so the screen that asked can word it and a
// second business can word it differently. Asking here rather than in the form
// means anything that ever writes a code gets the same answer.
export function codeProblem(list, rec, selfId = "") {
  const c = normalizeCode(rec);
  if (!c.code) return { fail: "empty" };
  if (!codeNameOk(c.code)) return { fail: "shape", code: c.code };
  // The name is checked for being taken BEFORE the boxes are checked for being
  // filled, because the name is the one thing she has already decided. Told the
  // name is spoken for, she retypes it and keeps her amount — one correction.
  // Told the amount is missing, she fills it in, presses again, and only then
  // learns the name was taken all along — two round trips for one message.
  const rows = Array.isArray(list) ? list : [];
  if (rows.some((r) => r && r.id !== selfId && normCode(r.code) === c.code)) {
    return { fail: "dupe", code: c.code };
  }
  if (c.gives.type === "rm" && c.gives.value <= 0) return { fail: "noAmount" };
  if (c.gives.type === "pct" && c.gives.value <= 0) return { fail: "noPercent" };
  if (c.gives.type === "pct" && c.gives.value >= 100) return { fail: "percentTooBig" };
  // A limit of "somewhere between none and one" is not a limit: a quota of 0
  // would be read by the engine as no opinion at all and quietly become
  // unlimited, which is the opposite of what she asked for.
  if (c.often.type === "quota" && c.often.n <= 0) return { fail: "noQuota" };
  if (c.when.from && c.when.to && c.when.to < c.when.from) return { fail: "datesBackwards" };
  return null;
}

/* THE GATE ON A LABEL — the only rule left about handing a code out.

   A label carries no number and no end date (a date is a promise it could not
   keep, and a count is one it could not count), so the ceiling is the only bound
   it leaves standing. A code with no ceiling would go out on paper — or into a
   message — with nothing at all stopping what it can cost her.

   Zero means NO LIMIT here, not a small one: it is the top of the scale rather
   than the bottom, which is why the test is `<= 0` on both bounds and why setting
   either one is enough to pass.

   A code with no name is refused too: a label that prints no code is one the shop
   cannot accept, so the name is checked before the ceiling.

   WHAT USED TO BE HERE, and why it is not (v278 → v286, removed v287). Printing
   once froze a code for good — the name, what it gives, who it is for, the
   smallest basket and what it cannot sit beside could never be re-written, and
   only the end date (later) and the ceiling (up) could move. The owner removed
   that on 4 Oct 2026: a label is now printed and copied as often as she likes,
   the offer stays editable, and a label is RETIRED instead. Retiring already
   existed — `ended` stops new uses while orders already placed keep what they
   were promised, and `paused` is the reversible version — so nothing new was
   needed for it.

   The one consequence, which the screen, the guide and the changelog all say out
   loud rather than hide: a label already in someone's hand is honoured at
   whatever the offer says when they ORDER, not when they picked it up.        */
export function labelProblem(rec) {
  const c = normalizeCode(rec);
  if (!c.code) return { fail: "labelNoCode" };
  const n = c.often.type === "quota" ? Number(c.often.n) || 0 : 0;
  const rm = Number(c.often.maxRM) || 0;
  if (n <= 0 && rm <= 0) return { fail: "noCeiling" };
  return null;
}
