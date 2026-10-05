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

import { el, button, copyText, emptyState, confirmDialog, showPopup, toast, menuRow } from "../ui.js";
import { qrSvg } from "../qr.js";
import { shopLink } from "../promo-card.js";
import { fmtRM, newId, save } from "../state.js";
import { todayISO, toISODate, longDate } from "../dates.js";
import { fetchPromoVisits, maybeSyncStorefront } from "../supabase.js";
import { translateTo, translateAllowed } from "../translate.js";
import { blankCode, codeProblem, codesOf, labelProblem, makeCode, normalizeCode, offerOf, SAY_MAX, stoppedBy } from "../promo.js";
import { usageByCode, usageOf } from "../promo-usage.js";

export function renderPromoCodes(root, state) {
  renderAll(root, state);
  // How many times each label was OPENED is a cloud fact, and this screen is drawn
  // synchronously — so each code's card carries an empty slot and this fills it when the
  // answer lands. Nothing is awaited and nothing blocks the paint.
  fillVisitSlots(root, state);
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
    ...rows,
    // ── ★ THE OTHER HALF (v314) ─────────────────────────────────────────────
    // A code is only one of the two things she can hand a customer. The other is
    // a customer's own LINK, and until v314 the two were a screen apart with
    // nothing saying they were related. Her ask: "can we make to more seamless
    // with other promo?" → "One place, read as a family". **The axis is the
    // ARTEFACT, not the reward, and both schemes stay (her decision, v289) — do
    // not propose merging them.**
    el("h2", { class: "section" }, "Or give a customer their own link"),
    el("div", { class: "card", style: "padding:4px 14px" },
      menuRow("#/bring-a-friend", "🔗 Bring a friend",
        "A link a customer forwards — it costs nothing to issue, and it still works after being passed on")));
}

/* ── How many times a label was opened (v288) ──────────────────────────────────
   The bakery's own words for why this number exists: she can already see what a code SOLD,
   recounted from her own orders, but not whether the label was picked up at all. Those are
   different problems — print more labels, or change the offer — and until now she could not
   tell them apart.

   NOTHING IS SHOWN UNTIL THE CLOUD ANSWERS. A failed or unfinished read leaves the slot
   empty, the same bargain `pendingReviewCount` strikes on the Home screen: a zero here is a
   positive claim ("nobody opened your label") and this screen must not make it on the
   strength of a request that never came back. A code the cloud DID answer about and which
   has no opens yet says so in words — that zero is real and worth seeing.

   THE RUN TOKEN IS THE UNMOUNT GUARD. Every render bumps `visitsRun`; a reply carrying an
   older number is dropped, so a slow answer from a screen she has left can never paint into
   the one she is looking at. */
let visitsRun = 0;
const VISIT_STRIP_DAYS = 28;

async function fillVisitSlots(root, state) {
  const run = (visitsRun += 1);
  const codes = codesOf(state);
  const out = await fetchPromoVisits(state, codes);
  if (run !== visitsRun) return;                 // a later render has taken over
  if (!out.ok) return;                           // say nothing rather than a false zero
  // A class selector and `dataset`, not `[data-visits]` and `getAttribute` — the second pair
  // works in a browser and reads as undefined under the tests' own DOM stand-in, which is the
  // kind of shim gap that once printed the word "null" onto a real receipt.
  const slots = root.querySelectorAll ? root.querySelectorAll(".visit-slot") : [];
  for (const slot of slots) {
    if (!slot || slot.isConnected === false) continue;
    const code = String((slot.dataset || {}).visits || "");
    slot.replaceChildren(...visitLines(code ? out.byCode.get(code) : null));
  }
}

function visitLines(entry) {
  const total = Number(entry && entry.total) || 0;
  if (!total) {
    return [el("p", { class: "hint" }, "Not opened yet — nobody has followed this label's link.")];
  }
  return [
    el("p", { class: "hint" }, `Opened ${total} time${total === 1 ? "" : "s"}`),
    visitStrip(entry),
  ];
}

// The last four weeks, a bar a day. She asked to see a code going cold, and a run of low
// bars says that faster than a list of dates does. A day with no opens is a faint stub
// rather than a gap, so "quiet" never reads as "no data".
function visitStrip(entry) {
  const today = new Date(`${todayISO()}T00:00:00`);
  const days = [];
  for (let back = VISIT_STRIP_DAYS - 1; back >= 0; back -= 1) {
    const d = new Date(today);
    d.setDate(d.getDate() - back);
    const iso = toISODate(d);
    days.push({ iso, n: Number((entry.days || new Map()).get(iso)) || 0 });
  }
  const peak = Math.max(1, ...days.map((x) => x.n));
  const bars = days.map((x) => el("span", {
    class: x.n ? "visit-bar" : "visit-bar quiet",
    style: `height:${x.n ? Math.max(4, Math.round((x.n / peak) * 24)) : 2}px`,
    title: `${x.iso} — ${x.n} open${x.n === 1 ? "" : "s"}`,
  }));
  return el("div", { class: "visit-strip-row" },
    el("span", { class: "visit-cap" }, "opens, last 28 days"),
    el("span", { class: "visit-strip" }, ...bars));
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
  ["Print it, if it is public", "This opens the label: print it as often as you like, and copy the link to paste into WhatsApp. Nothing is fixed by printing — the offer stays editable, and a code is retired by ending it."],
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
      "One of the eleven has nothing to press yet: there is no test code for step 5. The label for step 6 is the QR on a public code's row below — tap it to copy or print — and the brakes that follow are all live here."));
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

// Why a code cannot have a label yet, in her words. Both of these are refusals of
// the PAPER, not of the code — the code is fine and keeps working; it is the label
// that cannot be made honest yet. So both say what to do instead of just no.
//
// "Raise or lower it at any time" is deliberate (v287): with the freeze gone the
// ceiling is hers to move BOTH ways, and the old sentence — "it can never be
// lowered once the card is out" — would send her hunting for a rule that is gone.
function labelWords(p) {
  switch (p.fail) {
    case "noCeiling": return "Set a cost ceiling first — that is step 4, on this code's own row. A label carries no number and no end date, so the ceiling is the only thing left bounding what it can cost you: without one, a launch that takes off has nothing to stop it. You can raise or lower it at any time.";
    case "labelNoCode": return "Give the code a name first — a label that prints no code is one the shop cannot accept.";
    default: return "That code cannot be given a label as it stands.";
  }
}

// The chip that says, on the row, what a code's life is. A paused or ended code
// used to look exactly like a live one in the list — the only tell was that it
// had quietly stopped being offered — so the state is stated rather than implied.
function stateChips(c) {
  const chips = [];
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

/* THE PRINT PRESS (step six). It saves nothing and freezes nothing — it just opens
   the card page for this code.

   IT USED TO BE "THE POINT OF NO RETURN". Until v287 printing pinned the offer for
   good, and the confirmation spelled out what was about to stop being changeable.
   The owner removed that on 4 Oct 2026: a label is printed and copied as often as
   she likes, the offer stays editable, and a label is RETIRED instead — by ending
   the code, which already meant "new uses stop, orders already placed keep what
   they were promised". So there is nothing left to confirm, and this is a plain
   press again.

   The gate that remains is the engine's: a label needs a name and a cost ceiling,
   because a label carries no number. `labelProblem` holds it whichever screen calls. */
function ceilingSentence(c) {
  const n = c.often.type === "quota" ? Number(c.often.n) : 0;
  const rm = Number(c.often.maxRM) || 0;
  const bits = [];
  if (n > 0) bits.push(`${n} order${n === 1 ? "" : "s"}`);
  if (rm > 0) bits.push(`${fmtRM(rm)} given away`);
  if (!bits.length) return "";
  const at = bits.length > 1 ? `${bits[0]} or ${bits[1]}, whichever is reached first` : bits[0];
  return ` The label does not say it, but the code stops itself at ${at} — you can raise or lower that at any time.`;
}

function printCode(state, c) {
  const problem = labelProblem(c);
  if (problem) return toast(labelWords(problem));
  window.open(`promo-card.html?code=${encodeURIComponent(c.code)}`, "_blank");
}

/* ── THE LABEL (v287) ──────────────────────────────────────────────────────────
   One per code: its QR, on the row, and a press that opens it to be copied or
   printed. Her words: *"we have QRs, some active some retired, when a promo code
   come together with a QR, when you tab on label, you are allow to copy, print."*

   The QR carries exactly the link the shop already accepts —
   `../store/?promo=CODE`, built by `shopLink` (promo-card.js), the same function the
   printed card uses — so a label made here and a card made there point at one URL.

   A QR on its own does not say it can be pressed, so it carries the word **Label**
   under it. That is the whole of its affordance: it looks like a label, it is
   captioned Label, and it opens when tapped. */
function labelEl(state, c) {
  const url = shopLink(c.code, "https://munchies.com.my/admin/index.html");
  const svg = qrSvg(url, { quiet: 2, dark: "#2b1d14", light: "#ffffff" });
  const box = el("div", {
    class: "label-qr", role: "button", tabindex: "0",
    "aria-label": `Label for ${c.code} — open it to copy the link or print it`,
    onclick: () => openLabel(state, c),
  },
    svg ? el("div", { class: "label-qr-svg", html: svg }) : el("div", { class: "label-qr-fail" }, "QR"),
    el("span", { class: "label-qr-cap" }, "Label"));
  return box;
}

function openLabel(state, c) {
  const url = shopLink(c.code, "https://munchies.com.my/admin/index.html");
  const svg = qrSvg(url, { quiet: 2, dark: "#2b1d14", light: "#ffffff" });
  const retired = c.state === "ended";
  showPopup(el("div", { class: "popup-title-row" }, `Label — ${c.code}`), () => el("div", {},
    el("div", { class: "label-big" }, svg ? el("div", { class: "label-qr-svg", html: svg }) : null),
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      [clauseWords(c), ...rulesWords(c)].join(" · ")),
    el("p", { class: "hint", style: "margin:6px 0 0" }, url),
    el("p", { class: "hint", style: "margin:8px 0 0" },
      "A label can be printed or copied as often as you like, and the offer stays editable. If you change it, a label already in someone's hand is honoured at whatever the code says when they order."),
    // Printing a retired label would hand out a dead code, so it is not offered — and
    // it SAYS so rather than leaving a press that is simply missing.
    retired
      ? el("p", { class: "hint", style: "margin:8px 0 0" },
          "This code has ended, so there is nothing to print — a label with an ended code would not work. Copy the link if you want to look at what it says. Make a NEW code if you want to run this offer again.")
      : null,
    el("div", { class: "popup-actions" },
      button("Copy link", () => copyText(url, "Link copied — paste it into WhatsApp"), "soft"),
      retired ? null : button("Print it", () => printCode(state, c), "primary"))));
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
  // A code the customer can read off a card without having to guess (v286). It only fills the
  // box in — she can type over it, and can go on typing her own codes exactly as before. It
  // avoids the codes already in use, because a card that carries a name already meaning
  // something else would take the wrong amount off.
  const suggest = button("Suggest one", () => {
    name.value = makeCode(state.promoCodes || []);
  }, "soft");
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
  // WHO THIS CODE BELONGS TO (v289). A bring-a-friend LINK is for a casual, friend-to-friend
  // advocate and costs nothing to issue; a CODE and a LABEL is for a formal partner who prints
  // brochures and runs marketing. Naming that partner here is what makes their label
  // attributable: the code's own `used` count and its label's opens become their tally, with
  // nothing new to track.
  //
  // The picker lists the CUSTOMER PROFILES — the synced record per person (`state.customers`),
  // not the customer list, which is derived from orders and has no id to tie to. A name and
  // number are shown from the store, so the id is what travels and the name is what she reads.
  const personLabel = (pp) => String(pp.name || "").trim()
    || String(pp.whatsapp || "").trim()
    || "Unnamed customer";
  const people = (Array.isArray(state.customers) ? state.customers : [])
    .filter((pp) => pp && pp.id)
    .sort((a, b) => personLabel(a).localeCompare(personLabel(b)));
  const holder = el("select", { class: "input" },
    el("option", { value: "", selected: !(seed.holder && seed.holder.id) },
      people.length ? "Nobody — this code stands on its own" : "Nobody — no customers to name yet"),
    ...people.map((pp) => el("option", {
      value: pp.id, selected: !!(seed.holder && seed.holder.id === pp.id),
    }, personLabel(pp))));
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
    // WHO THIS CODE BELONGS TO (v289). Stored as the PROFILE'S ID, never its key and never just
    // the name — a key moves when a WhatsApp number is corrected and collapses when two people
    // share a name, and a name can be retyped. The name is frozen beside it so the row still
    // reads as who it was even if the profile is later renamed or merged away.
    const chosen = people.find((pp) => pp.id === holder.value) || null;
    rec.holder = { id: chosen ? chosen.id : "", name: chosen ? personLabel(chosen) : "" };
    rec.say = say.value.trim();
    rec.sayZh = sayZh.value.trim();
    rec.sayMs = sayMs.value.trim();
    const problem = codeProblem(state.promoCodes, rec, code ? code.id : "");
    if (problem) return { error: codeProblemWords(problem) };
    const record = normalizeCode({ ...rec, id: rec.id });
    // NOTHING HERE REFUSES A CHANGE ON ACCOUNT OF A LABEL HAVING BEEN PRINTED (v287).
    // Until then a printed code was frozen — the name, what it gives, who it is for,
    // the smallest basket, what it sits beside, its end date and its ceiling all
    // stopped moving, and that rule was checked HERE so anything that ever saved a
    // code got the same answer. The owner removed it: a label is printed and copied
    // as often as she likes, the offer stays editable, and a label is retired by
    // ending the code. What is left is `codeProblem` above, which is about the code
    // being usable at all rather than about paper.
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

  return { name, suggest, holder, kind, who, from, to, basket, often, beside, vis, say, sayZh, sayMs,
    valueField, capField, basketField, oftenField, ceilingField, translateSay, collect };
}

function editorFields(editor) {
  return [
    el("div", { class: "field" }, el("label", {}, "Code"),
      el("div", { class: "code-row" }, editor.name, editor.suggest),
      el("p", { class: "hint" }, "What the customer types. Letters and numbers only, so it reads easily off a card — FRESH10, not FRESH 10. The Suggest one button makes a code with no 0, O, 1, I or L in it, because those are the characters people mix up when they read a code off a card and type it in. Your own codes are unaffected — it only fills the box in, and you can type over it.")),
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
    el("div", { class: "field" }, el("label", {}, "🎁 Whose code is this"), editor.holder,
      el("p", { class: "hint" }, "For a partner or a friend who hands your labels out — a shop, a friend running their own marketing. Naming them is what makes their label tell itself apart from anyone else's: their orders and their label's opens are counted against this code, and it is what you look at when their reward comes round. Leave it as Nobody for a plain promotion you hand out yourself. Their name is never published to the shop — it stays in your own app.")),
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
      // One note now, not two (v287): there is no printed-and-fixed code any more, so
      // the sentence about what a label pins down has nowhere left to be true. What
      // remains is the one thing an edit has always promised — it cannot reach back
      // into an order that already used the code.
      //
      // AND THE SECOND HALF OF THAT SENTENCE IS THE TRADE SHE MADE. With printing no
      // longer freezing an offer, a label already in someone's hand is honoured at
      // whatever the code says when they ORDER. She is told that here, where she is
      // about to change one — told, never stopped: no rule blocks the edit.
      el("p", { class: "hint" },
        "Changing what a code gives does not change an order that already used it — every order keeps the code as it was written when the customer typed it. It does change what a label handed out LAST WEEK will give, because a label is priced when the customer orders, not when they picked it up."),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update code", () => {
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
      // THE LABEL, on the row (v287). Her words: *"we have QRs, some active some
      // retired … when you tab on label, you are allow to copy, print"*. It is drawn
      // from the code's own QR and takes its own press, so the list reads as a set of
      // labels with the life chips saying which are still going.
      labelEl(state, c),
      el("div", { style: "min-width:0;flex:1 1 auto" },
        // The code's LIFE sits beside its name, where a paused or ended code used to
        // look exactly like a live one (v278). The chips say what the row cannot say
        // on its own, and they say it before the offer rather than after it.
        el("p", { class: "card-title" }, c.code, ...stateChips(c)),
        el("p", { class: "card-sub" }, [clauseWords(c), ...rulesWords(c)].join(" · ")),
        el("p", { class: "hint" },
          [c.vis === "personal" ? "personal — never shown" : "public — shown in the shop",
            // WHOSE CODE THIS IS, on her own screen only (v289). It is deliberately NOT on the
            // printed label and NOT in what the shop publishes — see publishCodes in promo.js.
            // The name is the one frozen on the code, so it reads right even if the profile has
            // been renamed or merged away since.
            c.holder && c.holder.name ? `🎁 ${c.holder.name}'s code` : "",
            c.say ? "your own words" : "",
            useWords(c, u)]
            .filter(Boolean).join(" · "))),
      el("div", { class: "li-right" },
        // Step 6 on the row itself. A label is a public thing, so a personal code is
        // never offered one, and an ended code has nothing left worth printing — but
        // the press is still there for a paused one, because pausing is reversible and
        // she may well print again once she switches it back on. (v287: a code that has
        // been printed is no longer excluded — printing no longer pins anything.)
        c.vis === "public" && c.state !== "ended"
          ? button("Print it", () => printCode(state, c), "ghost small")
          : null,
        button("Edit", () => openEditCodePopup(state, code, root), "ghost small"),
        button("Delete", () => deleteCode(state, code, root, u.used), "ghost small"))),
    brakes.length ? el("div", { class: "row-actions" }, ...brakes) : null,
    // Where the OPENS land (v288). Drawn empty and filled later, because that number lives in
    // the cloud and this screen is drawn synchronously — and left empty for good when the
    // cloud cannot be reached, so a failure reads as "not known" rather than as "nobody".
    el("div", { class: "visit-slot", dataset: { visits: c.code } }),
    claimed ? el("p", { class: "warn" }, claimedWords(c, claimed)) : null);
}

function deleteCode(state, code, root, used) {
  // A code with a label printed is no longer refused a delete (v287). It used to be,
  // because a card in someone's hand would simply stop working with nothing to explain
  // why — but the answer to that is to END the code, not to forbid the delete, and the
  // confirm below already says so when orders carry it. Deleting is still allowed even
  // then, and that is safe
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
