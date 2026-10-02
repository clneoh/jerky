// views/promo.js — the promo codes she hands out.
//
// THE PROMO CODE SCREEN (v269). One card makes a code; one row per code after
// that. Every rule the code carries — who, when, how big a basket, how often,
// what it cannot sit beside — lives in the record and is judged by the ONE engine
// in js/promo.js, which the shop imports too. This screen never decides whether a
// code is good; it only writes codes down and words the engine's answers.
//
// Same shape as Parcel couriers / Suppliers / Units: an always-on "New code"
// card, each row with Edit, one pop-up shared by both.
//
// What a code carries, and what this screen lets her set. From v270 all six
// families are here: what it gives, who it is for, when it runs, the smallest
// basket it works on, how often, and what it cannot sit beside. The seventh
// option the discussion left open — "cannot sit beside another code" — is
// deliberately absent: the shop allows exactly one typed code per order and the
// standing line always stands down for it, so such a control could never refuse
// anything. A control that can never refuse is a control that does nothing.

import { el, button, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { fmtRM, newId, save } from "../state.js";
import { todayISO, longDate } from "../dates.js";
import { maybeSyncStorefront } from "../supabase.js";
import { translateTo, translateAllowed } from "../translate.js";
import { blankCode, codeProblem, freezeProblem, frozenProblem, normalizeCode, offerOf, SAY_MAX, stoppedBy } from "../promo.js";
import { usageByCode, usageOf } from "../promo-usage.js";

export function renderPromoCodes(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const list = state.promoCodes || [];
  const rows = list.length
    ? list.map((c) => codeCard(state, c, root))
    : [emptyState("No codes yet",
      "Make one, print it on a card, and a customer types it into the shop. When an order comes in carrying a code, the app takes the amount off the Total itself — in the confirmation, every later message and the customer's own tracking page — and names the code beside the figure, so the money you collect and the money they were told always agree.")];
  root.replaceChildren(
    newCodeCard(state, root),
    stepsCard(state),
    el("h2", { class: "section" }, `Promo codes (${list.length})`),
    ...rows);
}

/* THE ELEVEN STEPS (v277). The whole life of a promotion, in the order she would
   actually do it, on the one screen where she manages codes. The wording is the
   discussion's own; the sixth step is the point of no return — the only one that
   cannot be undone — so it is the only row drawn shaded.

   Folded away by default, because this screen's job is to make and manage codes
   and eleven rows of prose standing above them would be a wall she scrolls past
   every visit. The one line that folds it is not a label, it is the answer she
   came for: where her own codes actually are, and what they have given away.

   Nothing here is pressable, deliberately. The presses live on the code rows —
   pause and end are steps nine and ten — so no step can look like a control that
   does something and then not do it. Two of the eleven have nothing to press in
   this build, and the note under the list says which, rather than leaving her to
   read step 6 and look for a printer that is not there. */
const STEPS = [
  ["Write the promise down first", "One sentence: what it gives, who it is for, until when, and the most it could cost you. If that sentence needs a comma to hold it together, it is probably two codes."],
  ["Make it", "New code. Answer the six families, and nothing else — everything about the code follows from those."],
  ["Say who may see it", "Public, so it can be printed and can appear in the shop's own line; or personal, so it only works when typed and is never advertised. This is a decision, not a default."],
  ["Set the cost ceiling", "The most you will ever give away on this code. When it is reached, the code stops itself."],
  ["Test it on your own phone", "A test code behaves exactly like the live one but only works for your number. Walk the shop, read the line it produces, and read at least one refusal — so you have seen the words before a customer ever does."],
  ["Print it, if it is public", "This is the point of no return. From here the offer is frozen, and only the end date can move — and only later."],
  ["Launch it", "The promise is written down against the code, dated. A public code starts appearing in the shop's line by itself."],
  ["Watch it", "The screen shows the orders it brought, the customers, and how much has been given away against your ceiling."],
  ["Pause it if you must", "Always available, and it tells you how many orders are already holding the promise before you press it."],
  ["End it", "New uses stop. Orders already placed keep what they were promised — ending a code never takes back a discount already given."],
  ["Read it back", "Once it has finished: how many orders, how many new customers, what it sold, and what it cost you. That is the number that tells you whether to do it again."],
];

// Where her codes actually are, for the line that folds the list away. Counted
// from the codes themselves and the same recount every other figure on this
// screen uses, so this line can never disagree with the rows underneath it.
function lifeSummary(state) {
  const list = state.promoCodes || [];
  if (!list.length) return "no codes yet";
  const live = list.filter((c) => c.state === "live").length;
  const paused = list.filter((c) => c.state === "paused").length;
  const ended = list.filter((c) => c.state === "ended").length;
  const given = [...usageByCode(state).values()].reduce((n, u) => n + u.given, 0);
  const bits = [];
  if (live) bits.push(`${live} live`);
  if (paused) bits.push(`${paused} paused`);
  if (ended) bits.push(`${ended} ended`);
  if (given > 0) bits.push(`${fmtRM(given)} given away`);
  return bits.join(" · ");
}

function stepsCard(state) {
  const body = el("ol", { class: "steps" }, ...STEPS.map(([title, detail], i) =>
    el("li", { class: i === 5 ? "gate" : "" },
      el("b", {}, title, i === 5 ? el("span", { class: "gate-tag" }, "point of no return") : null),
      el("i", {}, detail))));
  body.hidden = true;
  const line = el("span", { class: "steps-line" }, lifeSummary(state));
  const arrow = el("span", { class: "steps-arrow" }, "▸");
  // The handle is two rows on purpose: the name and the arrow share the first, and
  // where her codes actually are takes the whole second row. Sharing one row at
  // 375px cut the summary short — "RM 20.00 given a…" — and a clipped figure is a
  // figure she cannot read, which is the one thing this line exists to be.
  const head = el("button", { class: "steps-toggle" },
    el("span", { class: "steps-top" },
      el("span", { class: "steps-name" }, "The eleven steps"),
      arrow),
    line);
  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    arrow.textContent = body.hidden ? "▸" : "▾";
  });
  return el("div", { class: "card" },
    head,
    el("p", { class: "hint", style: "margin:4px 0 0" },
      "The life of a promotion, in the order you would actually do it. Nothing here is a press — pause and end are on each code below."),
    body,
    el("p", { class: "hint", style: "margin:4px 0 0" },
      "One of the eleven has nothing to press yet: there is no test code for step 5. The printed card for step 6 is the Print it press on a public code's row below, and the freezes and the brakes that follow it are all live here."));
}

// A code as she typed it, cleaned the one way the engine recognises it: no stray
// spaces, no case to argue about. Shown back to her as the customer will type it.
function tidy(t) {
  return String(t || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 16);
}

// The offer in words, and the smallest basket it will work on. English, here,
// because this screen is hers — the shop composes the same offer from the same
// parts in the customer's own language (see store-lang.js).
function offerWords(code) {
  const o = offerOf(code);
  if (o.kind === "delivery") return "Free delivery";
  if (o.kind === "pct") return `${o.value}% off${o.cap > 0 ? `, up to ${fmtRM(o.cap)}` : ""}`;
  return `${fmtRM(o.value)} off`;
}

function clauseWords(code) {
  const min = code.basket.type === "amount" ? Number(code.basket.amount) : 0;
  return min > 0 ? `${offerWords(code)} on ${fmtRM(min)} and above` : offerWords(code);
}

// The rest of what a code carries, in the fewest words that still say exactly
// what will happen. Only the families she has actually given an opinion are
// named, so a plain code reads as plainly as it did before there were families.
function rulesWords(c) {
  const out = [];
  if (c.when.from && c.when.to) out.push(`${longDate(c.when.from)} to ${longDate(c.when.to)}`);
  else if (c.when.from) out.push(`from ${longDate(c.when.from)}`);
  else if (c.when.to) out.push(`until ${longDate(c.when.to)}`);
  if (c.who.type === "first") out.push("first order only");
  if (c.often.type === "once") out.push("once per customer");
  if (c.often.type === "quota") out.push(`first ${c.often.n} order${c.often.n === 1 ? "" : "s"} only`);
  // The other half of the ceiling, on the same line: a code capped in ringgit
  // used to read as though it had no cap at all, which is the one thing this row
  // must never do — she would have to open the pop-up to find the limit she set.
  if (Number(c.often.maxRM) > 0) out.push(`${fmtRM(c.often.maxRM)} given away at most`);
  if (c.beside.type === "nocredit") out.push("not with the bring-a-friend credit");
  return out;
}

function codeProblemWords(p) {
  if (!p) return "";
  switch (p.fail) {
    case "empty": return "Give the code a name the customer can type.";
    case "shape": return `"${p.code}" cannot be a code. Use 3 to 16 letters and numbers, so it reads easily off a card.`;
    case "noAmount": return "Say how much comes off.";
    case "noPercent": return "Say what percentage comes off.";
    case "percentTooBig": return "A percentage has to be under 100.";
    case "noQuota": return "Say how many orders it is for. Blank or 0 would make it unlimited, which is the opposite of what you asked for.";
    case "datesBackwards": return "The end date is before the start date.";
    case "dupe": return `${p.code} is already a code. Two codes cannot share a name.`;
    default: return "That code cannot be saved as it stands.";
  }
}

// The engine's freeze reasons, in her words. Each one names the thing on the card
// that would stop being true, and the two that are about direction say which way
// is still allowed — because "you cannot move the end date" is wrong and would
// send her looking for a press that does not exist. Moving it LATER is always
// allowed; it is only being pulled back that is refused.
function frozenProblemWords(p, code) {
  switch (p.fail) {
    case "frozenName": return `${code.code} is printed, so the name stays ${code.code}. Make a new code if you need a different name.`;
    case "frozenGives": return "What it gives is on the card, so it cannot change — the card still says what it said.";
    case "frozenWho": return "Who it is for is on the card, so it cannot change.";
    case "frozenBasket": return "The smallest basket is on the card, so it cannot change.";
    case "frozenBeside": return "What it cannot be used with is part of the offer on the card, so it cannot change.";
    case "frozenDates": return "A printed code's end date can only be moved later, never pulled earlier, and a code with no end date cannot be given one. Being generous with someone holding a card cannot hurt them; taking it back can.";
    case "frozenCeiling": return "A printed code's ceiling can only be raised, never lowered. If the launch is going well you can allow it more — you cannot give it less.";
    default: return "That change would re-write an offer that is already printed on a card.";
  }
}

// Why a code cannot be printed yet, in her words. Both of these are refusals of
// the CARD, not of the code — the code is fine and keeps working; it is the paper
// that cannot be made honest yet. So both say what to do instead of just no.
function freezeWords(p) {
  switch (p.fail) {
    case "noCeiling": return "Set a cost ceiling first — that is step 4, on this code's own row. A card carries no number and no end date, so the ceiling is the only thing left bounding what it can cost you: without one, a launch that takes off has nothing to stop it. Raise the ceiling any time afterwards; it can never be lowered once the card is out.";
    case "freezeNoCode": return "Give the code a name first — a card that prints no code is a card the shop cannot accept.";
    default: return "That code cannot be printed as it stands.";
  }
}

// The chip that says, on the row, what a code's life is. A paused or ended code
// used to look exactly like a live one in the list — the only tell was that it
// had quietly stopped being offered — so the state is stated rather than implied.
function stateChips(c) {
  const chips = [];
  if (c.frozen) chips.push(el("span", { class: "st-chip frozen" }, "Printed — fixed"));
  if (c.state === "paused") chips.push(el("span", { class: "st-chip paused" }, "Paused"));
  if (c.state === "ended") chips.push(el("span", { class: "st-chip expired" }, "Ended"));
  return chips;
}

/* THE TWO BRAKES, on the row where the discussion puts them (steps nine and ten).
   They are the whole of what a printed code still allows, so they outlive every
   other press on the row — and each one says what it will do BEFORE it does it,
   including how many orders are already holding the promise.

   TWO RECORDS, and the difference is the whole reason this takes two. `rec` is the
   row as it is STORED; `c` is the normalised copy codeCard makes so the row can be
   judged with the recounted numbers. Reading through `c` is right — it is the one
   that knows how many orders really carry the code. WRITING through it is not: v278
   first shipped these presses the copy, so a press of Pause set `state` on an object
   the next repaint threw away. The dialog opened, the press looked like it had
   worked, and the code never paused. Read through `c`; write through `rec`.

   Pausing and ending are different things on purpose. A pause is a break and is
   always reversible; ending is final, and that is what makes it a brake rather
   than a second pause. The end confirmation says so and points at pause, so the
   choice between them is hers and she is told it is a choice.                   */
function lifeButtons(state, rec, c, root, used) {
  if (c.state === "ended") return [];
  if (c.state === "paused") {
    return [
      button("Resume", () => {
        rec.state = "live";
        commit(state, root, `${c.code} is back on`);
      }, "ghost small"),
      button("End", () => endCode(state, rec, c, root, used), "ghost small"),
    ];
  }
  return [
    button("Pause", () => pauseCode(state, rec, c, root, used), "ghost small"),
    button("End", () => endCode(state, rec, c, root, used), "ghost small"),
  ];
}

// How many orders are already holding this code's promise, as a sentence. Written
// once and used by both brakes, because a brake that miscounts the orders it is
// about to strand is a brake she cannot trust — and "2 orders carries it and keeps
// what it was promised" is exactly what a single-branch plural produces (v278).
// `tail` is the clause specific to the press: what happens to those orders.
function holdingsWords(n, tail = "") {
  if (n === 1) return `1 order carries it already and keeps what it was promised${tail}.`;
  if (n > 1) return `${n} orders carry it already and keep what they were promised${tail}.`;
  return "Nothing has used it yet.";
}

function pauseCode(state, rec, c, root, used) {
  const holding = used
    ? holdingsWords(used, " — nothing already promised changes")
    : "Nothing has used it yet, so nothing is stranded.";
  confirmDialog(
    `Pause "${c.code}"? The shop stops offering it and stops taking it. ${holding} You can switch it back on at any time.`,
    () => { rec.state = "paused"; commit(state, root, `${c.code} paused`); },
    { yesLabel: "Pause it" });
}

function endCode(state, rec, c, root, used) {
  const u = usageOf(state, rec);
  const holding = holdingsWords(used, u.given > 0 ? ` — ${fmtRM(u.given)} in all` : "");
  confirmDialog(
    `End "${c.code}" for good? New uses stop, and an ended code cannot be switched back on. ${holding} If you only want a break, pause it instead.`,
    () => { rec.state = "ended"; commit(state, root, `${c.code} ended`); },
    { danger: true, yesLabel: "End it" });
}

/* STEP SIX, THE POINT OF NO RETURN. The press both makes the card and freezes the
   offer, in that order, because the card page reads the frozen code out of her own
   saved state — so the save has to have landed before the page opens, or the paper
   would draw an offer that is not the one the app now holds.

   Nothing is lost by a mis-press: the card only exists once she prints it, and
   closing a tab prints nothing. But the freeze is real, and it is undone only by
   making a new code — so the confirmation names what is about to be fixed, and
   names what is still hers to move, before either happens.

   The button that leads here is only drawn for a public code that is neither
   printed nor ended (step 3 decides who may see it, step 6 is only about the ones
   that may be seen), so this function's own gate is a second check rather than the
   only one — the engine's rule holds whichever screen ever calls it.             */
function ceilingSentence(c) {
  const n = c.often.type === "quota" ? Number(c.often.n) : 0;
  const rm = Number(c.often.maxRM) || 0;
  const bits = [];
  if (n > 0) bits.push(`${n} order${n === 1 ? "" : "s"}`);
  if (rm > 0) bits.push(`${fmtRM(rm)} given away`);
  if (!bits.length) return "";
  const at = bits.length > 1 ? `${bits[0]} or ${bits[1]}, whichever is reached first` : bits[0];
  return ` The card will not say it, but the code stops itself at ${at} — you can raise that later, never lower it.`;
}

function printCode(state, rec, c, root) {
  const problem = freezeProblem(rec);
  if (problem) return toast(freezeWords(problem));
  confirmDialog(
    `Print "${c.code}" on a card? This is the point of no return. From here the offer is frozen: the amount, who it is for, the smallest basket and the name all go on saying what they say, because the card in the customer's hand cannot be amended. What the card does not say is still yours to move — the end date later, never earlier, and nothing else.${ceilingSentence(c)}`,
    () => {
      rec.frozen = true;
      // Save first, open second: the card page reads the frozen code back out of
      // her own stored state, so a card drawn before the save would be drawn from
      // the code as it was — the one thing this press must never do.
      commit(state, root, `${c.code} printed — the offer is fixed`);
      window.open(`promo-card.html?code=${encodeURIComponent(c.code)}`, "_blank");
    },
    { yesLabel: "Print it" });
}

function buildCodeEditor(state, code) {
  // A new code starts today and never ends, which is the shape of a code someone
  // hands out without thinking about dates. Everything else starts at the engine's
  // own no-opinion default, read from blankCode() rather than retyped here, so the
  // form and the record can never disagree about what "I have not decided" is.
  const seed = code ? normalizeCode(code) : { ...blankCode(), when: { from: todayISO(), to: "" } };

  const name = el("input", {
    class: "input", placeholder: "e.g. FRESH10", autocapitalize: "characters",
    value: seed.code,
  });
  const kind = el("select", { class: "input" },
    el("option", { value: "rm", selected: seed.gives.type === "rm" }, "Ringgit off"),
    el("option", { value: "pct", selected: seed.gives.type === "pct" }, "Percent off"),
    el("option", { value: "delivery", selected: seed.gives.type === "delivery" }, "Free delivery"));
  const value = el("input", {
    class: "input", type: "number", min: "0", step: "0.01", inputmode: "decimal",
    value: seed.gives.value ? String(seed.gives.value) : "",
  });
  const cap = el("input", {
    class: "input", type: "number", min: "0", step: "0.01", inputmode: "decimal",
    value: seed.gives.cap ? String(seed.gives.cap) : "",
  });
  const who = el("select", { class: "input" },
    el("option", { value: "all", selected: seed.who.type === "all" }, "Anyone"),
    el("option", { value: "first", selected: seed.who.type === "first" }, "A first order only"));
  const from = el("input", { class: "input", type: "date", value: seed.when.from });
  const to = el("input", { class: "input", type: "date", value: seed.when.to });
  const basket = el("select", { class: "input" },
    el("option", { value: "none", selected: seed.basket.type === "none" }, "No smallest basket"),
    el("option", { value: "amount", selected: seed.basket.type === "amount" }, "Only on a basket of at least"));
  const basketAmount = el("input", {
    class: "input", type: "number", min: "0", step: "0.01", inputmode: "decimal",
    value: seed.basket.amount ? String(seed.basket.amount) : "",
  });
  const often = el("select", { class: "input" },
    el("option", { value: "unlimited", selected: seed.often.type === "unlimited" }, "As often as they like"),
    el("option", { value: "once", selected: seed.often.type === "once" }, "Once per customer"),
    el("option", { value: "quota", selected: seed.often.type === "quota" }, "Only for the first"));
  const oftenN = el("input", {
    class: "input", type: "number", min: "1", step: "1", inputmode: "numeric",
    value: seed.often.n ? String(seed.often.n) : "",
  });
  // The other half of the ceiling: the most this code may ever give away, added
  // up across every order it is used on. It is deliberately NOT part of the
  // "how often" answer — a code anyone may use as often as they like can still
  // be worth capping, and a percentage has no natural end without one — so it is
  // asked on its own line rather than hidden behind one of the three options.
  const oftenMax = el("input", {
    class: "input", type: "number", min: "0", step: "0.01", inputmode: "decimal",
    value: seed.often.maxRM ? String(seed.often.maxRM) : "",
  });
  const beside = el("select", { class: "input" },
    el("option", { value: "anything", selected: seed.beside.type === "anything" }, "Nothing in particular"),
    el("option", { value: "nocredit", selected: seed.beside.type === "nocredit" }, "Not with the bring-a-friend credit"));
  const vis = el("select", { class: "input" },
    el("option", { value: "public", selected: seed.vis === "public" }, "Public — shown in the shop"),
    el("option", { value: "personal", selected: seed.vis === "personal" }, "Personal — never shown"));

  // Her own sentence for the shop, in her own words. Blank is the normal state:
  // the shop then says it its own way, in the customer's own language, and says
  // the dates and any smallest basket by itself. Written, it appears under that
  // line — never instead of it, because that line is what names the code.
  const say = el("textarea", { class: "input", rows: 2, maxlength: String(SAY_MAX), value: seed.say,
    placeholder: "e.g. Our birthday month — RM10 off your first order, and tell us what you think of it." });
  const sayZh = el("textarea", { class: "input", rows: 2, maxlength: String(SAY_MAX), value: seed.sayZh,
    placeholder: "Auto-translated 中文 — blank shows the English" });
  const sayMs = el("textarea", { class: "input", rows: 2, maxlength: String(SAY_MAX), value: seed.sayMs,
    placeholder: "Auto-translated Bahasa Malaysia — blank shows the English" });

  // The boxes that only matter for one answer. Kept in place and simply hidden,
  // so switching back and forth never loses what she typed — and an empty box is
  // what the engine reads as "no opinion here", so a hidden one is harmless.
  const valueField = el("div", { class: "field" }, el("label", {}, "How much comes off"), value);
  const capField = el("div", { class: "field" },
    el("label", {}, "Most it can ever come to (optional)"), cap,
    el("p", { class: "hint" }, "A percentage with no most-it-can-come-to has no limit at all. Fill this in and the offer can never cost more than this."));
  const basketField = el("div", { class: "field" }, el("label", {}, "Smallest basket (RM)"), basketAmount);
  const oftenField = el("div", { class: "field" }, el("label", {}, "How many orders"), oftenN);
  const ceilingField = el("div", { class: "field" },
    el("label", {}, "Stop after giving away (RM)"),
    oftenMax,
    el("p", { class: "hint" },
      "Whichever comes first — the order count above, or this much money. Leave it empty for a code with no limit at all. A code that has a limit stops being offered the moment that limit is reached, and stops being accepted: the total is counted from your own orders, never from anything the shop writes down."));

  function paintFields() {
    const k = kind.value;
    valueField.hidden = k === "delivery";
    valueField.querySelector("label").textContent = k === "pct" ? "What percentage comes off" : "How much comes off";
    capField.hidden = k !== "pct";
    basketField.hidden = basket.value !== "amount";
    oftenField.hidden = often.value !== "quota";
  }
  kind.addEventListener("change", paintFields);
  basket.addEventListener("change", paintFields);
  often.addEventListener("change", paintFields);
  paintFields();

  function collect() {
    const rec = code ? { ...code } : { id: newId("promo"), ...blankCode() };
    rec.code = tidy(name.value);
    rec.gives = { type: kind.value, value: Number(value.value) || 0, cap: Number(cap.value) || 0 };
    rec.who = { type: who.value };
    rec.when = { from: from.value || "", to: to.value || "" };
    rec.basket = { type: basket.value, amount: Number(basketAmount.value) || 0 };
    rec.often = {
      type: often.value,
      n: Math.floor(Number(oftenN.value) || 0),
      maxRM: Number(oftenMax.value) || 0,
    };
    rec.beside = { type: beside.value };
    rec.vis = vis.value;
    rec.say = say.value.trim();
    rec.sayZh = sayZh.value.trim();
    rec.sayMs = sayMs.value.trim();
    const problem = codeProblem(state.promoCodes, rec, code ? code.id : "");
    if (problem) return { error: codeProblemWords(problem) };
    const record = normalizeCode({ ...rec, id: rec.id });
    // PRINTING PINS THE PROMISE (v278). Once a card is in someone's hand the offer
    // on it has to go on being true, so a frozen code refuses any change to what it
    // gives, who it is for, the smallest basket, what it sits beside, or its name —
    // and refuses having its end date pulled earlier or its ceiling lowered. The
    // engine holds the rule (frozenProblem); this only turns its reason into words.
    // Checked HERE, with the other validation, rather than in the Update press, so
    // anything that ever saves a code gets the same answer.
    if (code && code.frozen) {
      const frozen = frozenProblem(code, record);
      if (frozen) return { error: frozenProblemWords(frozen, code) };
    }
    return { record };
  }

  // Fill the 中文 and BM boxes from the English, leaving anything she has typed
  // herself alone. The same bargain as the storefront policy text: machine-filled
  // once, hers to edit for ever after.
  async function translateSay() {
    const src = say.value.trim();
    if (!src) return toast("Write it in English first");
    if (!translateAllowed()) return toast("No connection — translations fill when you're back online");
    let filled = 0;
    for (const [lang, box] of [["zh", sayZh], ["ms", sayMs]]) {
      if (box.value.trim()) continue;
      try {
        const out = await translateTo((url) => fetch(url), src, lang);
        if (out && out.trim()) { box.value = out.trim(); filled++; }
      } catch { /* leave it blank and try the rest */ }
    }
    toast(filled ? "Translated — edit it if you like" : "Nothing to translate");
  }

  return { name, kind, who, from, to, basket, often, beside, vis, say, sayZh, sayMs,
    valueField, capField, basketField, oftenField, ceilingField, translateSay, collect };
}

function editorFields(editor) {
  return [
    el("div", { class: "field" }, el("label", {}, "Code"), editor.name,
      el("p", { class: "hint" }, "What the customer types. Letters and numbers only, so it reads easily off a card — FRESH10, not FRESH 10.")),
    el("div", { class: "field" }, el("label", {}, "What it gives"), editor.kind),
    el("div", { class: "form-grid" }, editor.valueField, editor.capField),
    el("div", { class: "form-grid" },
      el("div", { class: "field" }, el("label", {}, "Runs from"), editor.from),
      el("div", { class: "field" }, el("label", {}, "Runs until (optional)"), editor.to)),
    el("p", { class: "hint" }, "Leave the end date empty for a code that never runs out. The shop stops accepting it the day after its end date."),
    el("div", { class: "field" }, el("label", {}, "Who it is for"), editor.who),
    el("div", { class: "field" }, el("label", {}, "Smallest basket it works on"), editor.basket),
    el("div", { class: "form-grid" }, editor.basketField, el("div", {})),
    el("div", { class: "field" }, el("label", {}, "How often it can be used"), editor.often),
    el("div", { class: "form-grid" }, editor.oftenField, el("div", {})),
    el("p", { class: "hint" }, "\"Once per customer\" and \"a first order only\" are judged from what that customer's phone remembers, and a new phone remembers nothing — so the shop TELLS them and takes the order anyway. The real check is yours, when you confirm it. A limited number of orders is different: it is counted from your own orders, so it genuinely stops being offered when it is reached."),
    editor.ceilingField,
    el("div", { class: "field" }, el("label", {}, "What it cannot be used with"), editor.beside,
      el("p", { class: "hint" }, "The bring-a-friend welcome discount comes out of the same money as a code that gives ringgit off, so this stops the two stacking on one order.")),
    el("div", { class: "field" }, el("label", {}, "Who can see it"), editor.vis,
      el("p", { class: "hint" }, "Public codes are put on the shop page for everyone. Personal codes are never advertised — you give the code to one person — but they still work when typed, and anyone who reads the page's own data can see them, so the limit is that they are never shown, not that they are secret.")),
    el("div", { class: "field" }, el("label", {}, "What the shop says about it (optional)"), editor.say,
      el("p", { class: "hint" }, "Leave this blank and the shop writes the line itself: what comes off, any smallest basket, the end date, and the code to type — in the customer's own language. Write something here and it shows UNDER that line, in your words. That line always stays, because it is what tells the customer the code to type.")),
    el("div", { class: "form-grid" },
      el("div", { class: "field" }, el("label", {}, "中文"), editor.sayZh),
      el("div", { class: "field" }, el("label", {}, "Bahasa Malaysia"), editor.sayMs)),
    el("div", { class: "btn-row" },
      button("Translate", editor.translateSay, "soft"),
      el("p", { class: "hint", style: "margin:0 align-self:center" }, "Fills whichever of the two is still blank, and never overwrites your own words.")),
  ];
}

function commit(state, root, message) {
  save(state);            // her phones: the code rows
  maybeSyncStorefront(state); // the shop: the published list the page reads
  toast(message);
  renderAll(root, state);
}

function newCodeCard(state, root) {
  const editor = buildCodeEditor(state, null);
  return el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New code"),
    ...editorFields(editor),
    button("Add code", () => {
      const { error, record } = editor.collect();
      if (error) return toast(error);
      state.promoCodes.push(record);
      commit(state, root, `${record.code} added`);
    }, "block primary"));
}

function openEditCodePopup(state, code, root) {
  const editor = buildCodeEditor(state, code);
  showPopup(el("div", { class: "popup-title-row" }, `Edit ${code.code}`), (refresh, close) => {
    return el("div", {},
      ...editorFields(editor),
      // A printed code's promise is fixed, so the note under the fields says WHAT is
      // still hers to move rather than leaving her to find out by being refused, and
      // the button names the two things it will actually save (v278). An unprinted
      // code keeps the note it has always had.
      el("p", { class: "hint" },
        code.frozen
          ? "This code is printed on a card, so its offer is fixed: not the amount, not who it is for, not the smallest basket, not the name. What the card does not say can still move — the end date later, the ceiling up. Either way, changing a code never changes an order that already used it."
          : "Changing what a code gives does not change an order that already used it. Every order keeps the code as it was written when the customer typed it."),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button(code.frozen ? "Update the end date and ceiling" : "Update code", () => {
          const { error, record } = editor.collect();
          if (error) return toast(error);
          Object.assign(code, record);
          close();
          commit(state, root, `${code.code} updated`);
        }, "primary")));
  }, { wide: true });
}

// What the code has done so far and how much of each limit that is, recounted
// from her own orders every time this screen is drawn. Two limits can be set and
// either can be the one that ran out, so both are always shown against their own
// ceiling — she can see a code at 4 of 5 orders and RM18 of RM50 before it stops,
// which is what tells her whether to raise the count or the money.
function useWords(c, u) {
  const n = c.often.type === "quota" ? Number(c.often.n) : 0;
  const cap = Number(c.often.maxRM) || 0;
  const bits = [];
  if (n > 0) bits.push(`${u.used} of ${n} order${n === 1 ? "" : "s"} used`);
  else bits.push(u.used ? `used on ${u.used} order${u.used === 1 ? "" : "s"}` : "not used yet");
  if (cap > 0) bits.push(`${fmtRM(u.given)} of ${fmtRM(cap)} given away`);
  return bits.join(" · ");
}

// The sentence for a code that has run out — the only place she is told WHICH
// limit ran out, because that is hers to know and the customer's never to see
// (the shop has one "fully claimed" answer and no idea which bound produced it).
function claimedWords(c, stopped) {
  const n = c.often.type === "quota" ? Number(c.often.n) : 0;
  const cap = Number(c.often.maxRM) || 0;
  const orders = `${n} order${n === 1 ? "" : "s"}`;
  const money = fmtRM(cap);
  if (stopped.bound === "both") {
    return `Fully claimed — all ${orders} used, and ${money} given away. The shop has stopped offering it.`;
  }
  if (stopped.bound === "money") {
    return `Fully claimed — it has given away its ${money}. The shop has stopped offering it.`;
  }
  return `Fully claimed — all ${orders} used. The shop has stopped offering it.`;
}

function codeCard(state, code, root) {
  const u = usageOf(state, code);
  // Judged with the RECOUNTED numbers, never the record's own. The stored counts
  // are only ever what the last publish wrote, so a code whose limit was reached
  // by an order that arrived this morning still reads zero on the record — and
  // judging that would leave a used-up code wearing no banner at all. The same
  // substitution the publish seam makes, for the same reason: the orders are the
  // tally, and the record is only the last thing written down.
  const c = normalizeCode({ ...code, used: u.used, given: u.given });
  const stopped = stoppedBy(c, todayISO());
  const claimed = stopped && stopped.fail === "claimed" ? stopped : null;
  // A row has to say everything the code will do, not just what it gives, or she
  // has to open the Edit pop-up to remember the dates she set. The offer and its
  // rules on one line; who can see it and how it has done, quieter, underneath —
  // and a code that has run out says so in a banner, because a code that has
  // quietly stopped working is the one thing this screen must never hide.
  const brakes = lifeButtons(state, code, c, root, u.used);
  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        // The code's LIFE sits beside its name, where a paused or ended code used to
        // look exactly like a live one (v278). The chips say what the row cannot say
        // on its own, and they say it before the offer rather than after it.
        el("p", { class: "card-title" }, c.code, ...stateChips(c)),
        el("p", { class: "card-sub" }, [clauseWords(c), ...rulesWords(c)].join(" · ")),
        el("p", { class: "hint" },
          [c.vis === "personal" ? "personal — never shown" : "public — shown in the shop",
            c.say ? "your own words" : "",
            useWords(c, u)]
            .filter(Boolean).join(" · "))),
      el("div", { class: "li-right" },
        // Step 6 on the row itself. A card is a public thing, so a personal code
        // is never offered one; an ended code has nothing left to print; and a
        // code that is already printed says so in its chip instead.
        c.vis === "public" && !c.frozen && c.state !== "ended"
          ? button("Print it", () => printCode(state, code, c, root), "ghost small")
          : null,
        button("Edit", () => openEditCodePopup(state, code, root), "ghost small"),
        button("Delete", () => deleteCode(state, code, root, u.used), "ghost small"))),
    brakes.length ? el("div", { class: "row-actions" }, ...brakes) : null,
    c.frozen
      ? el("p", { class: "hint", style: "margin:8px 0 0" },
          "Printed on a card, so the offer is fixed. What the card does not say can still move — the end date later, the ceiling up — and nothing else can.")
      : null,
    claimed ? el("p", { class: "warn" }, claimedWords(c, claimed)) : null);
}

function deleteCode(state, code, root, used) {
  // A printed code is never deleted (v278): a card in someone's hand would simply
  // stop working, with nothing to explain why, and the row would be gone so she
  // could not even see that was what happened. The tap is not dead — it says why and
  // names the press that does the job, because ending stops new uses and leaves the
  // card honest, which is the thing deleting cannot do.
  if (code.frozen) {
    return toast(`${code.code} is printed, so it cannot be deleted — a card in someone's hand would just stop working. End it instead: that stops new uses and leaves the card honest.`);
  }
  // Otherwise deleting is allowed even when orders carry the code, and that is safe
  // rather than careless: the code was written onto each order when the shop sent it,
  // so those orders keep reading correctly and keep showing her what she owes. What
  // deleting really does is stop the shop accepting it.
  confirmDialog(used
    ? `Delete code "${code.code}"? ${used} order${used === 1 ? " carries" : "s carry"} it — those keep it, and you still owe them what you promised. The shop stops accepting the code.`
    : `Delete code "${code.code}"? The shop stops accepting it.`,
  () => {
    state.promoCodes = (state.promoCodes || []).filter((c) => c.id !== code.id);
    commit(state, root, `${code.code} deleted`);
  }, { danger: true, yesLabel: "Delete" });
}
