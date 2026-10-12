// test/shop-info-card.test.js — the shop's "Bake days" / "Order by" card must read as two
// SENTENCES, not as two columns of words.
//
// Her report, with a picture: __"instead of a line, customer might confused that it is 2 group of
// word, one left one right"__
//
// ⚠️⚠️ SHE WAS RIGHT, AND IT WAS ONE LINE OF CSS. `.info-row` was `display: flex;
// justify-content: space-between` — which pins the word to the LEFT edge and its answer to the
// RIGHT edge with **nothing joining them**. A customer reading down the left and then down the
// right gets the pairing wrong, and this card is the one place on the shop that states the two
// rules an order depends on: which days she bakes, and when ordering closes.
//
// ⭐ THE SHAPE SHE CHOSE, OFF A DRAWN SHEET: **one line, one sentence** — `Bake days: Mon, Wed, Fri`.
//
// ⭐ NO TEST CAN SEE LAYOUT, SO THIS PINS THE RULE INSTEAD (the v388 lesson): the row must not push
// its two halves apart, and the label and its answer must be one run of text with the colon
// between them.
//
// ⚠️ AND THE COLON LIVES IN THE MARKUP, NOT IN THE TRANSLATED STRING — so all three languages keep
// their own wording and none has to carry punctuation it never had (store-lang.js).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
const html = readFileSync(new URL("../store/index.html", import.meta.url), "utf8");

// The rule itself, found BY CONTENT — never by where it happens to sit in the file, because an
// unrelated rule appended above it would then silently move the subject.
const RULE = /\.info-row\s*\{([^}]*)\}/.exec(css);
const row = (id) => new RegExp(`<p class="info-row">([\\s\\S]*?)<span id="${id}"[^>]*>`).exec(html);

test("★★ the card must not push its label and its answer to opposite edges", () => {
  assert.ok(RULE, "no .info-row rule in the shop's stylesheet at all, so this proves nothing");
  assert.doesNotMatch(RULE[1], /space-between/,
    "★ the row is spacing its halves apart again — that is the two-groups-of-words she caught");
  assert.doesNotMatch(RULE[1], /display:\s*flex/,
    "★ the row is a flex line again, so nothing ties the label to its answer");
});

test("★ each label and its answer read as ONE run of text, with the colon between them", () => {
  for (const [id, label] of [["delivery-days", "Bake days"], ["cutoff", "Order by"]]) {
    const m = row(id);
    assert.ok(m, `the shop's card no longer carries the "${label}" row`);
    // The colon must sit between the label and the value — that is the whole of the chosen shape.
    assert.match(m[1], /<\/strong>\s*:\s*$/,
      `★ "${label}" is no longer followed straight away by its answer (between them: ${JSON.stringify(m[1].slice(-40))})`);
  }
});

test("⚠️ and the two values still land in their own spans, so the shop can fill them in", () => {
  // ⚠️ The ids are what `store/app.js` writes the real days and cut-off into. A card that looked
  // right but lost its target would read as a fault with nothing in it.
  const days = /<span id="delivery-days" class="info-val"><\/span>/.test(html);
  const cutoff = /<span id="cutoff" class="info-val"><\/span>/.test(html);
  assert.ok(days, "the Bake days answer has nowhere to go");
  assert.ok(cutoff, "the Order by answer has nowhere to go");
});

// ⚠️ A RULE, NOT A PIXEL — no test can see layout, so what is pinned is the DECLARATION. The
// selector is anchored to the start of a line so `.seg-btn.active .seg-name` cannot answer for the
// bare `.seg-name`, which is a different rule about a different state.
const ruleFor = (sel) => {
  const m = new RegExp(`(?:^|\\n)\\s*${sel.replace(/\./g, "\\.")}\\s*\\{([^}]*)\\}`).exec(css);
  assert.ok(m, `no standalone ${sel} rule in the shop's stylesheet, so this proves nothing`);
  return m[1];
};

test("★★ an AREA heading is NOT the brand red — it is a signpost, not a warning", () => {
  // Her words: __"area should not be in red, put as black"__. ⚠️ **On this shop the terracotta is
  // the voice for things the customer must NOTICE** — an instruction to tap, a day that is closed.
  // An area name asks for nothing: it says where the places under it are.
  const body = ruleFor(".point-area");
  assert.doesNotMatch(body, /var\(--brown-dark\)/,
    "★ the area heading is wearing the shop's attention colour again — it is a heading on a list");
  assert.match(body, /var\(--ink\)/, "the area heading is not set in the shop's ordinary ink");
  // ⭐ AND IT IS NOT SHOUTED (v434), her second look at the same line: __"why capitalised the
  // AREA?"__ ⚠️ **The capitals were never in the data** — the name is stored as 'Penang Island' and
  // `text-transform` drew it in caps. **A rule that re-added it would silently shout the signpost
  // again**, which is exactly the kind of change nothing on a screen would report.
  assert.doesNotMatch(body, /text-transform:\s*uppercase/,
    "★ the area heading is in capitals again — the name is written as she writes it");
});

test("★★ what a bake day IS, said under the step that asks him to pick one", () => {
  // Her words: __"I think customer 1st confusion is that we never explain what is a bake day to
  // them."__ ⚠️ **It was used five times on the page and explained none of them** — and the only
  // hint about WHEN the bread is ready sat inside the Self collect option, so a courier customer
  // never met it.
  //
  // ⚠️⚠️ **PLACEMENT IS THE WHOLE POINT OF THIS TEST.** It has to sit between the "1 Pick a bake
  // day" heading and the calendar: he is choosing a day, and that is the moment he wonders what one
  // is. ⭐ **A line floated to the bottom of the page would answer a question nobody is asking yet**
  // — and it is asserted from the MARKUP because this line is pure page, its words filled in by the
  // same `data-i18n` pass as everything else.
  const head = html.indexOf('id="step1"');
  const note = html.indexOf('class="bake-day-what"');
  const cal = html.indexOf('id="dates"');
  assert.ok(head >= 0 && cal >= 0, "the first step or its calendar has gone from the page");
  assert.ok(note >= 0, "the page never says what a bake day is");
  assert.ok(head < note && note < cal,
    "★ the explanation is not between the step heading and the calendar — it sits " +
    (note < head ? "before the step" : "after the calendar it is meant to explain"));
  assert.match(html.slice(note, note + 400), /data-i18n="bakeDayWhat"/,
    "the explanation is not tagged, so it would never be translated");
});

test("★★ the shop's one question arrives SHUT, and it covers the screen", () => {
  // Her words: __"a confirmation pop up, asking whether customer intend to change to delivery?"__ —
  // ⚠️⚠️ **the first time this page asks anything at all**, so its opening state is worth pinning:
  // `#confirm-msg` is a notice with no buttons and the privacy sheet is read-only, and a question
  // that arrived OPEN would sit over the shop from the moment the page loads.
  // ⭐ Asserted from the MARKUP because the shop's test shims carry no static HTML — the one line
  // that stands in for it in store.test.js says so.
  const m = /<div class="ask-scrim" id="ask-scrim"([^>]*)>/.exec(html);
  assert.ok(m, "the shop's question has gone from the page");
  assert.match(m[1], /\bhidden\b/, "★ the question does not arrive shut — it would cover the shop on load");
  // ⚠️ `display: flex` with no `[hidden]` rule would beat the attribute, so both halves are pinned.
  const css = readFileSync(new URL("../store/app.css", import.meta.url), "utf8");
  assert.match(css, /\.ask-scrim\[hidden\]\s*\{\s*display:\s*none/,
    "★ the question is a flex box with no [hidden] rule, so `hidden` cannot shut it");
  // ⭐ AND IT IS A DIALOG, not a banner: two buttons, and the quiet one first.
  assert.match(html, /id="ask-keep"[\s\S]{0,120}id="ask-change"/,
    "the two answers are not in the shop's order — quiet first, primary last");
});

test("★★ the pin is an OFFER, not a step — one line out here, the reasoning inside the map", () => {
  // Her words: __"Pin a map can be confusion that is not mandatory to be faced by customer,
  // especially when we have auto complete. Pin helps on certain scenarios that we understand, maybe
  // we just fade that function"__.
  // ⚠️⚠️ **It was a whole paragraph and a full-width bordered button at the same weight as the
  // address field above them**, so it read as the next thing to do.
  const ask = /<p class="card-sub pin-ask" id="pin-ask">([\s\S]*?)<\/p>/.exec(html);
  assert.ok(ask, "the pin's own line has gone from the page");
  assert.match(ask[1], /id="pin-map"/, "the press is not inside the line it belongs to");
  assert.match(ask[1], /pinHintShort/, "the line does not carry its short sentence");
  assert.doesNotMatch(ask[1], /pinHint"/,
    "★ the long explanation is still sitting out here — it belongs inside the map");

  // ⭐ AND IT IS INSIDE, between the map and the two answers it is read with.
  const hold = html.indexOf('id="pin-hold"');
  const why = html.indexOf('pinHint"');
  const keep = html.indexOf('id="pin-keep"');
  assert.ok(hold >= 0 && why >= 0 && keep >= 0, "the map, the reasoning or its answers have gone");
  assert.ok(hold < why && why < keep,
    "★ the reasoning is not inside the map — it reads as part of the step it is meant to excuse");

  // ⚠️ AND THE PRESS IS A LINK, NOT A BUTTON THE WIDTH OF THE CARD.
  const btn = /<button type="button" id="pin-map" class="([^"]*)"/.exec(html);
  assert.ok(btn, "the pin press has gone");
  assert.doesNotMatch(btn[1], /\bpin-btn\b/,
    "★ the press is a full-width button again — that is the weight that made it look required");
  assert.match(btn[1], /\bpin-link\b/, "the press no longer carries the shop's link style");
  assert.match(css, /\.pin-link\s*\{[\s\S]*?text-decoration:\s*underline/,
    "…and that class has no rule of its own, so it would be an unstyled control");
});

test("★★ the fourth ball stands BESIDE Place order, and is the same ball as the other three", () => {
  // Her words (v435): __"it is actually a 4 steps ordering process. not 3. the 4th is place
  // order."__ — ⚠️ **the page numbered 1, 2, 3 and its fourth step wore no number at all.**
  // Her words (v438), correcting how it was drawn: __"the number 4 should not be inside the the
  // Place order button, it should sit beside, same size with other number to be consistant, make
  // the place order button smaller to make roon for the 4 ball"__.
  // ⚠️⚠️ **v435 PUT IT INSIDE** — `#order-btn::before`, a 20px white disc — so **the fourth number
  // did not match the three he had just followed**, which is the whole of "to be consistant".
  // ⚠️⚠️ COMMENTS ARE STRIPPED FIRST. My own explanation above names `#order-btn::before`, and a
  // bare grep for it **failed on the note that records its removal** — the trap this project has
  // written down already: *a guard must not trip on its own explanation.*
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /#order-btn::before\s*\{/,
    "★ the number is drawn inside the button again — she asked for it beside");

  // ⭐ IT STANDS IN THE SEQUENCE: after the summary, before the press.
  assert.match(html, /<span class="bar-step" id="bar-step"[^>]*>4<\/span>\s*<button id="order-btn"/,
    "the fourth ball is not standing beside the Place order button");

  // ★★ AND IT IS THE SAME BALL — every property that makes a ball a ball is compared with the three
  // above. ⚠️⚠️ **THE COLOUR IS IN THE LIST BECAUSE IT WAS THE ONE I LEFT OUT.** Asked why the 4 was
  // that colour, the honest answer was that I had copied it without asking whether it still worked:
  // **beside the Place order button it measures 1.17:1 — the same colour**, so the two merge. Her
  // verdict, and it settles it: __"the 1,2,3 is good enough, im expecting 4 to be consistant with
  // them as they serve the same purpose."__ ⭐ **The ball is the constant; the layout accommodates
  // it.** So the fill and the numeral are compared like everything else — **a claim of consistency
  // is worth nothing unless the thing that drifted is the thing that is checked.**
  const step = ruleFor(".step-num");
  const ball = ruleFor(".bar-step");
  for (const prop of ["width", "height", "border-radius", "font-size", "font-weight", "background", "color"]) {
    const a = new RegExp(`\\b${prop}:\\s*([^;]+);`).exec(step);
    const b = new RegExp(`\\b${prop}:\\s*([^;]+);`).exec(ball);
    assert.ok(a, `the other three balls do not declare ${prop}`);
    assert.ok(b, `the fourth ball does not declare ${prop}`);
    assert.equal(b[1].trim(), a[1].trim(),
      `★ the fourth ball's ${prop} is ${b[1].trim()} against the other three's ${a[1].trim()}`);
  }

  // ⚠️⚠️ AND IT NEVER DIMS (v439). Equality of two declarations is not equality on the screen:
  // v438's `background` matched ①②③ exactly, and the ball still arrived PALE, because a second
  // rule dimmed it. ⭐ **Her picture found it — ④ pale pink beside solid ② and ③ — and her
  // question: __"is the color 1234 consistant?"__** ⭐ **①②③ mark a step and never change with the
  // basket, so ④ is the same kind of thing: a label is not a state.** ⚠️ Two ways it could come
  // back, and each is checked on its own — a rule that fades it, or script that classes it.
  assert.doesNotMatch(rules, /\.bar-step\.off\s*\{/,
    "★ the fourth ball has a dimmed state again — that is the pale 4 she caught beside solid 2 and 3");
  const app = readFileSync(new URL("../store/app.js", import.meta.url), "utf8");
  // ⚠️⚠️ v439 BANNED ALL SCRIPT FROM TOUCHING THE BALL, ON THE REASONING THAT "A LABEL IS NOT A STATE" —
  // AND THAT WAS TOO BROAD. What it was right about is the BASKET: an empty basket must never dim a step
  // number. But ④ IS a step, the fourth one, and ①②③ all turn green when the customer finishes theirs (her
  // v434 rule). **The ball was left as the one step number that could never report itself.** Her words:
  // __"on the store front, when customer press place an order, the number 4 never have the chance to turn
  // green, why not allow it to turn green for 1 sec"__
  assert.match(app, /classList\.toggle\("done", !!on\)/,
    "★ the fourth ball has no done state at all — that is the fault she reported");
  // ⭐ AND IT IS THE SAME GREEN ①②③ WEAR, not a colour invented for it.
  assert.match(css, /\.bar-step\.done\s*\{[^}]*#3b7449/,
    "★ the fourth ball's done state is not the same green as the other three");

  // ⚠️⚠️ AND THE SALE IS NEVER WAITED ON — THIS IS THE ASSERTION THAT MATTERS MOST. The ball must be greened
  // BEFORE the order is sent, so it paints during the send; the hold happens only once the bakery's app
  // already has the order. **A green that delayed the order would be a colour worth less than a sale.**
  const greenAt = app.indexOf("greenBarStep(true)");
  const sentAt = app.indexOf("await placeOrder(");
  assert.ok(greenAt >= 0 && sentAt >= 0, "the press or the send has moved — this proves nothing");
  assert.ok(greenAt < sentAt,
    "★ the ball is greened only AFTER the order is sent, so a slow send would show no step finishing");
  // ⭐ AND HER ONE SECOND IS ONE NUMBER IN ONE PLACE (v427/v428 — a duration in the CSS and a moment in the
  // JS are two numbers for one fact, and they can only ever disagree one way).
  assert.match(app, /const GREEN_HOLD_MS = 1000;/,
    "★ her one second is not a single number in the shop");
  assert.doesNotMatch(css, /\.bar-step\.done\s*\{[^}]*transition/,
    "★ the ball's green carries a duration of its own — that is the second number the v427 fault came from");
});

test("★ 'Self collect' is a TITLE, in the shop's own title — 16px, serif", () => {
  // Her words: __"Self collect should be in bigger font being a title"__. ⚠️ **The answer is not a
  // size invented for it: it wears `.card-title`, the one heading shape this shop already has**, so
  // it reads like the product names above it rather than like body text.
  const body = ruleFor(".seg-name");
  assert.match(body, /font-size:\s*16px/, "'Self collect' is not at the shop's card-title size");
  assert.match(body, /font-family:\s*var\(--serif\)/, "'Self collect' is not in the shop's title face");
});

test("⚠️ and the colon is NOT inside a translated string", () => {
  // ⭐ The three languages keep their own words. A colon baked into the English key would arrive in
  // Chinese and Bahasa too, where it is not the punctuation those sentences use.
  const lang = readFileSync(new URL("../store-lang.js", import.meta.url), "utf8");
  for (const key of ["deliveryDays", "orderBy"]) {
    const hits = lang.match(new RegExp(`${key}:\\s*"[^"]*"`, "g")) || [];
    assert.equal(hits.length, 3, `expected ${key} in all three languages, found ${hits.length}`);
    for (const h of hits) {
      assert.doesNotMatch(h, /[:：]"\s*$/,
        `★ the translated string carries its own colon, so the markup now shows two: ${h}`);
    }
  }
});
