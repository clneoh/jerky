// journal.js — a book that can leave the screen (3 Oct 2026).
//
// Her words: "those journals in profits and other journals should be printable and able to be
// shared". Every journal in the app is a list of rows with a total, and until today each one
// existed only inside a pop-up she could scroll — nothing she could hand to anyone, keep, or
// paste into a message.
//
// A journal is described ONCE, as a `sheet`, and ALL FOUR renderings read that description: the
// screen, the paper, the message and the PDF file can therefore never disagree about a row or a
// total. It is the same guarantee `expenseRows` and `tradingRows` already keep against the
// statement itself.
//
// Amounts are carried as NUMBERS, never as formatted strings. Screen, paper, message and PDF
// then all run the same `fmtRM`, so a figure written one way in the app and another way on the
// paper is not possible by construction.

import { el, button, copyText, toast } from "./ui.js";
import { fmtRM } from "./state.js";
import { longDate, todayISO } from "./dates.js";
import { A4, makePdf, textWidth, wrapText } from "./pdf.js";

// The rule a plain-text journal draws between its head, its rows and its totals. A fixed
// width deliberately: a rule that stretched with the longest row would drift line to line
// inside a proportional font like WhatsApp's.
const RULE = "-".repeat(30);

// How wide the `what` column is padded before the money. Capped, so one very long line cannot
// push every figure off to the right where nobody can read the column.
const PAD_MAX = 44;

// The day a sheet was printed, said in her own date style. A sheet built for the printer was
// printed the moment the press happened, which is why this is read here and not stored.
const printedOf = (s) => s.printed || longDate(todayISO());

// How one movement's money is written. A money journal shows the way it moved BEFORE the
// figure — "−RM 30.00" — rather than the sign a statement line wears after the currency, so
// the sheet has to say which convention it is using or the paper would read differently from
// the screen it came from. `dir` is empty for every other journal, which leaves the amount as
// the statement writes it.
const money = (amount, dir, cur) => `${dir === "out" ? "−" : ""}${fmtRM(amount, cur)}`;

// The one column width a plain-text sheet pads both its rows and its totals to, read off
// everything that shares the column. Capped, so one very long line cannot push every figure off
// to the right where nobody can read it.
function columnWidth(s) {
  const longest = Math.max(0, ...s.lines.filter((l) => !l.heading).map((l) => l.what.length),
    ...s.totals.map((t) => t.label.length));
  return Math.min(PAD_MAX, longest);
}

// Whose books these are, for the top of a sheet that has left the app. The shop's own name is
// the one she has already written, so a page and the shop can never disagree about who baked it.
export function bakeryName(state) {
  const s = (state && state.settings) || {};
  return String(((s.storefront || {}).name) || "").trim() || "Munchies Furkidz";
}

// One journal, as a plain description and nothing else — no DOM, no storage, no wording about
// where it goes. `lines` are the movements in the order they should be read, each optionally
// wearing a statement class (a subtotal row) or being a heading with no money of its own;
// `totals` are the closing figures, drawn after a rule of their own.
export function journalSheet({
  title, subtitle = "", lines = [], totals = [], empty = "", note = "",
  where = "", bakery = "", from = "", printed = "",
} = {}) {
  return {
    title: String(title || "Journal"),
    subtitle: String(subtitle || ""),
    lines: (lines || []).map((l) => ({
      what: String(l && l.what != null ? l.what : ""),
      amount: Number(l && l.amount) || 0,
      cls: (l && l.cls) || "",
      // "out" when the money left, "" when it arrived or when the amount is already signed.
      dir: (l && l.dir) || "",
      // A heading exists because a statement read on paper has to say where trading ends and
      // running costs begin; the screen can lean on the section wording above the card, and a
      // page cannot. A heading carries no figure, so it is never padded into a money column.
      heading: !!(l && l.heading),
    })),
    totals: (totals || []).map((t) => ({
      label: String(t && t.label != null ? t.label : ""),
      amount: Number(t && t.amount) || 0,
      cls: (t && t.cls) || "pl-total",
    })),
    empty: String(empty || "Nothing to show here."),
    note: String(note || ""),
    where: String(where || ""),
    bakery: String(bakery || ""),
    // The bakery's own postal block, for the documents that need a letterhead — an
    // invoice does, and every other journal passes nothing. It is the SAME text she
    // typed once for the mailing labels (settings.mailingAddress), so a page and a
    // parcel can never carry two different addresses for one bakery.
    from: String(from || ""),
    printed: String(printed || ""),
  };
}

// The `from` block split into lines, with a first line that only repeats the bakery
// name dropped. The mailing-label card tells her to make the bakery's name the FIRST
// line of that block, so a head drawn straight from it would say the name twice. One
// that opens by repeating it simply does not: the name keeps its own larger line and
// the block keeps its address.
export function fromLines(from, bakery = "") {
  const rows = String(from || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const name = String(bakery || "").trim().toLowerCase();
  if (name && rows.length && rows[0].toLowerCase() === name) rows.shift();
  return rows;
}

// The same sheet as plain text, for the share sheet and the clipboard. Built from the sheet
// rather than from the screen, so the two can never drift apart.
export function buildJournalText(sheet, cur = "RM") {
  const s = journalSheet(sheet);
  const out = [`${s.bakery ? `${s.bakery} — ` : ""}${s.title}`];
  // The letterhead travels with the text too, so an invoice pasted into a message
  // still says who it is from and where to find them.
  out.push(...fromLines(s.from, s.bakery));
  if (s.subtitle) out.push(s.subtitle);

  if (!s.lines.length) {
    out.push("", s.empty);
  } else {
    const width = columnWidth(s);
    out.push(RULE);
    // A subtotal row gets a rule above it, so the text reads the way the screen does.
    s.lines.forEach((l, i) => {
      if ((l.cls || l.heading) && i > 0) out.push(RULE);
      if (l.heading) out.push(l.what);
      else out.push(`${l.what.padEnd(width)}  ${money(l.amount, l.dir, cur)}`);
    });
  }
  if (s.totals.length) {
    const width = columnWidth(s);
    out.push(RULE);
    for (const t of s.totals) out.push(`${t.label.padEnd(width)}  ${fmtRM(t.amount, cur)}`);
  }

  if (s.note) out.push("", s.note);
  if (s.where) out.push(`From ${s.where}.`);
  return out.join("\n");
}

// The same sheet as the screen shows it, for a book that is read in place rather than in a
// pop-up of its own — the Money screen draws one both ways. Reading the sheet rather than the
// books a second time is what makes "the paper says what the screen says" true by
// construction instead of by care.
export function journalBodyEl(sheet, cur = "RM") {
  const s = journalSheet(sheet);
  return el("div", {},
    s.lines.length
      ? el("div", {}, ...s.lines.map((l) => el("div", { class: "info-row journal-line" },
          el("span", { class: "j-what" }, l.what),
          el("span", { class: "info-val" }, money(l.amount, l.dir, cur)))))
      : el("p", { class: "card-sub" }, s.empty),
    ...s.totals.map((t) => el("div", { class: `info-row ${t.cls}` },
      el("span", {}, t.label),
      el("span", { class: "info-val" }, fmtRM(t.amount, cur)))),
    s.note ? el("p", { class: "card-sub", style: "margin:10px 0 0" }, s.note) : null);
}

// The sheet as it reaches paper. Everything here is written for the printer only — it lives
// inside the print layer, which is hidden on screen — so it can carry the letterhead such a
// page needs without putting a second title above the one already on the pop-up.
export function journalSheetEl(sheet, cur = "RM") {
  const s = journalSheet(sheet);
  return el("div", { class: "journal-sheet" },
    el("div", { class: "js-head" },
      s.bakery ? el("p", { class: "js-bakery" }, s.bakery) : null,
      ...fromLines(s.from, s.bakery).map((line) => el("p", { class: "js-from" }, line)),
      el("h2", { class: "js-title" }, s.title),
      s.subtitle ? el("p", { class: "js-sub" }, s.subtitle) : null),
    s.lines.length
      ? el("div", { class: "js-rows" }, ...s.lines.map((l) => (l.heading
          ? el("p", { class: "js-section" }, l.what)
          : el("div", { class: `info-row journal-line${l.cls ? ` ${l.cls}` : ""}` },
              el("span", { class: "j-what" }, l.what),
              el("span", { class: "info-val" }, money(l.amount, l.dir, cur))))))
      : el("p", { class: "card-sub" }, s.empty),
    ...s.totals.map((t) => el("div", { class: `info-row ${t.cls}` },
      el("span", {}, t.label),
      el("span", { class: "info-val" }, fmtRM(t.amount, cur)))),
    // A note may be more than one paragraph — the statement's is two, and paper has no other
    // way to show a break — so a blank line in the note becomes a paragraph of its own. HTML
    // would otherwise run them together, because a newline is just a space on a page.
    ...s.note.split("\n\n").filter((p) => p.trim()).map((p) => el("p", { class: "js-note" }, p)),
    el("p", { class: "js-foot" },
      [s.where ? `From ${s.where}` : "", `printed ${printedOf(s)}`].filter(Boolean).join(" · ")));
}

// ── The sheet as a PDF file ─────────────────────────────────────────────────────────────────
//
// The fourth rendering of the same sheet, and the one that fixes the fault she reported: the
// share sheet opened on her phone with WhatsApp missing from it, because a bare block of text
// is not a thing WhatsApp offers itself for. A file is. So the journal leaves as a document —
// one she can also keep, forward and re-open, which is what she asked for.

// A4 at 20 mm margins, which is what the printed sheet also uses.
const PDF_MARGIN = 56.7;
const PDF_RIGHT = A4.w - PDF_MARGIN;
// Nothing is drawn below this, so the footer below it always has clear paper under it.
const PDF_BOTTOM = PDF_MARGIN + 38;
const PDF_LEAD = 14;
const INK = [0.19, 0.16, 0.14];
const MUTED = [0.44, 0.42, 0.4];
const RULE_INK = [0.74, 0.71, 0.68];

// Everything a page of the journal is drawn with, kept in one place so the arithmetic that
// advances down the page happens in exactly one spot. `y` is always the BASELINE of the next
// line to be drawn, and drawing a line is the only thing that moves it — which is what stops a
// rule being drawn through a sentence, the trap a fixed pixel table falls into.
function sheetPages(s, cur) {
  const pages = [];
  let ops = null;
  let y = 0;

  // A money column measured across the whole sheet, so every figure ends on the same edge. The
  // digits and "RM" are the same width in both faces, so one measurement serves the bold totals.
  const moneyW = Math.max(0, ...[
    ...s.lines.filter((l) => !l.heading).map((l) => money(l.amount, l.dir, cur)),
    ...s.totals.map((t) => fmtRM(t.amount, cur)),
  ].map((m) => textWidth(m, { size: 10 })));
  const colW = Math.max(120, PDF_RIGHT - PDF_MARGIN - moneyW - 16);

  const put = (text, x, options = {}) => {
    ops.push({ op: "text", x, y, text, font: options.font || "F1",
      size: options.size || 10, color: options.color || INK });
  };
  const rule = (width, color) => ops.push({
    op: "rule", x1: PDF_MARGIN, y1: y, x2: PDF_RIGHT, y2: y,
    width: width == null ? 0.6 : width, color: color || RULE_INK });

  const startPage = (continued) => {
    ops = [];
    pages.push({ w: A4.w, h: A4.h, ops });
    y = A4.h - PDF_MARGIN;
    if (continued) {
      put(`${s.title} (continued)`, PDF_MARGIN, { font: "F2", size: 11, color: MUTED });
      y -= 22;
      rule(0.5);
      y -= 16;
      return;
    }
    if (s.bakery) { put(s.bakery, PDF_MARGIN, { font: "F2", size: 9, color: MUTED }); y -= 16; }
    // The letterhead, on the same muted small face as the name above it — it is an
    // address, not a heading, and the title below has to stay the loudest thing here.
    for (const line of fromLines(s.from, s.bakery)) {
      put(line, PDF_MARGIN, { size: 8.5, color: MUTED });
      y -= 11.5;
    }
    put(s.title, PDF_MARGIN, { font: "F2", size: 18 });
    y -= 24;
    if (s.subtitle) { put(s.subtitle, PDF_MARGIN, { size: 10, color: MUTED }); y -= 15; }
    y -= 3;
    rule(0.8);
    y -= 17;
  };

  // Called before anything is drawn, with the height that thing will need. A break therefore
  // always happens between two whole things, never through one.
  const need = (height) => { if (y - height < PDF_BOTTOM) startPage(true); };

  // One row: its words, wrapped into the column the money leaves free, with the figure on the
  // first line and right-aligned. `ruleAbove` draws the line that separates a subtotal.
  const row = (what, figure, { font = "F1", size = 10, ruleAbove = 0 } = {}) => {
    const figureW = figure ? textWidth(figure, { font, size }) : 0;
    const chunks = wrapText(what, Math.max(60, PDF_RIGHT - PDF_MARGIN - figureW - 16), { font, size });
    need((ruleAbove ? ruleAbove + 7 : 0) + chunks.length * PDF_LEAD);
    if (ruleAbove) { y -= ruleAbove; rule(0.6); y -= 7; }
    chunks.forEach((chunk, i) => {
      put(chunk, PDF_MARGIN, { font, size });
      if (i === 0 && figure) put(figure, PDF_RIGHT - figureW, { font, size });
      y -= PDF_LEAD;
    });
  };

  startPage(false);

  if (!s.lines.length) {
    put(s.empty, PDF_MARGIN, { size: 10, color: MUTED });
    y -= PDF_LEAD;
  } else {
    s.lines.forEach((l, i) => {
      if (l.heading) {
        need(26);
        y -= 9;
        put(l.what, PDF_MARGIN, { font: "F2", size: 10 });
        y -= 15;
        return;
      }
      const subtotal = !!(l.cls && /total|net/.test(l.cls));
      // The same rule the screen and the message draw above a subtotal, and never as the first
      // line of the sheet, where a rule would only underline the head.
      row(l.what, money(l.amount, l.dir, cur),
        { font: subtotal ? "F2" : "F1", ruleAbove: subtotal && i > 0 ? 6 : 0 });
    });
  }

  if (s.totals.length) {
    y -= 6;
    s.totals.forEach((t, i) => {
      row(t.label, fmtRM(t.amount, cur),
        { font: "F2", ruleAbove: i === 0 ? 6 : 2 });
    });
  }

  if (s.note) {
    y -= 8;
    need(24);
    // A blank line in the note is a paragraph, the same as it is on the screen and the paper.
    for (const para of s.note.split("\n\n").filter((p) => p.trim())) {
      const chunks = wrapText(para, PDF_RIGHT - PDF_MARGIN, { size: 8.5 });
      need(chunks.length * 11.5 + 6);
      for (const chunk of chunks) {
        put(chunk, PDF_MARGIN, { size: 8.5, color: MUTED });
        y -= 11.5;
      }
      y -= 6;
    }
  }

  // The footer belongs to the last page and to no other, so it is drawn at a fixed height
  // rather than in the flow — which is why the flow was stopped above it.
  const foot = [s.where ? `From ${s.where}` : "", `printed ${printedOf(s)}`].filter(Boolean).join(" · ");
  if (foot) {
    y = PDF_MARGIN + 16;
    rule(0.5, [0.8, 0.78, 0.75]);
    y = PDF_MARGIN + 4;
    put(foot, PDF_MARGIN, { size: 7.5, color: MUTED });
  }

  return pages;
}

// The sheet as the bytes of a PDF file. Hand-written, because this app has no build step and no
// PDF library — see `pdf.js`.
export function journalPdf(sheet, cur = "RM") {
  const s = journalSheet(sheet);
  return makePdf(sheetPages(s, cur));
}

// What the document is called when it arrives in the chat. Named after the journal, because
// that is the name she will look for in WhatsApp's list of documents a week later — not a hash.
export function journalPdfName(sheet) {
  const s = journalSheet(sheet);
  const safe = s.title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim();
  return `${safe || "Journal"}.pdf`;
}

// The journal as a File the phone can hand to another app. Returns null where there is no File
// API at all, which is the honest answer rather than a broken object.
function journalFile(s, cur) {
  if (typeof File !== "function" || typeof Blob !== "function") return null;
  try {
    return new File([journalPdf(s, cur)], journalPdfName(s), { type: "application/pdf" });
  } catch (err) {
    return null;
  }
}

// The last resort on a phone with no share sheet: the document is saved to the phone instead,
// so she still ends up with the PDF she asked for rather than a block of text she did not.
function saveJournalPdf(s, cur) {
  if (typeof document === "undefined" || typeof URL === "undefined"
    || typeof URL.createObjectURL !== "function") return false;
  let url = "";
  try {
    url = URL.createObjectURL(new Blob([journalPdf(s, cur)], { type: "application/pdf" }));
    const link = el("a", { href: url, download: journalPdfName(s) });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    return true;
  } catch (err) {
    if (url) URL.revokeObjectURL(url);
    return false;
  }
}

// Where the sheet is built for the printer. Made on demand rather than carried in the app
// shell: nothing on screen ever needs it, and a page that has never printed has no node in
// the tree at all.
function printLayer() {
  if (typeof document === "undefined" || !document.body) return null;
  let layer = document.getElementById("print-layer");
  // The layer is recognised by its CLASS, not its id alone: a stand-in screen's getElementById
  // hands back a freshly created node for any id it has never seen, and adopting that node would
  // mean printing into something the stylesheet was never meant to match.
  if (layer && String(layer.className || "").includes("print-layer")) return layer;
  layer = el("div", { class: "print-layer", id: "print-layer" });
  document.body.appendChild(layer);
  return layer;
}

// Print one sheet. The body class lives only for the instant of printing, and is cleared on
// `afterprint` AND by a fallback timer — the same guard the packing labels already carry, so a
// class left behind by a browser that never fires the event can never hide the app afterwards.
export function printJournal(sheet, cur = "RM") {
  // A press that cannot do its job says so and names the press that will — a control that
  // silently does nothing reads as a broken screen. It is checked BEFORE anything is built:
  // a press that cannot print should leave no trace of having tried.
  const canPrint = typeof window !== "undefined" && typeof window.print === "function";
  const layer = canPrint ? printLayer() : null;
  if (!layer) {
    toast("This phone can't print — use Share instead.");
    return;
  }
  layer.replaceChildren(journalSheetEl(sheet, cur));
  document.body.classList.add("journal-print");
  const done = () => {
    document.body.classList.remove("journal-print");
    layer.replaceChildren();
    if (typeof window !== "undefined") window.removeEventListener("afterprint", done);
    clearTimeout(timer);
  };
  const timer = setTimeout(done, 2000);
  if (typeof window !== "undefined") window.addEventListener("afterprint", done);
  window.print();
}

// Share one sheet. The journal goes as a PDF FILE, because that is the one form WhatsApp
// actually offers itself for — a bare block of text is not, and that was the fault she hit.
//
// A phone is asked what it can take, in order, and the first thing it can do is what happens:
//
//   1. the file, where the phone says it can share one — straight into WhatsApp, Mail or Files;
//   2. the text, where it can share but not share a file, so a journal still leaves the app;
//   3. the file saved to the phone, where there is no share sheet at all;
//   4. the clipboard, where even that is not available.
//
// A cancel is a DECISION, not a failure: it is swallowed silently at every step and never falls
// through to the next one. Copying the journal behind her back after she closed the sheet is
// the one outcome here worse than doing nothing.
export async function shareJournal(sheet, cur = "RM") {
  const s = journalSheet(sheet);
  const text = buildJournalText(s, cur);
  const nav = typeof navigator !== "undefined" ? navigator : null;
  const file = journalFile(s, cur);

  const cancelled = (err) => !!(err && err.name === "AbortError");

  if (nav && typeof nav.share === "function") {
    // `canShare` is what the phone answers with, and it is asked rather than assumed: a phone
    // that would refuse `files` throws, and a refusal we caused ourselves reads as a fault.
    let fileOk = false;
    if (file && typeof nav.canShare === "function") {
      try { fileOk = nav.canShare({ files: [file] }) === true; } catch (err) { fileOk = false; }
    }
    if (fileOk) {
      try {
        await nav.share({ files: [file], title: s.title });
        return;
      } catch (err) {
        if (cancelled(err)) return;
        // The phone refused the file after saying it could take one. The text share below is
        // the way through, rather than leaving her with nothing.
      }
    }
    try {
      await nav.share({ title: s.title, text });
      return;
    } catch (err) {
      if (cancelled(err)) return;
    }
  }

  if (file && saveJournalPdf(s, cur)) {
    toast("Saved as a PDF — send it from WhatsApp");
    return;
  }
  copyText(text, "Journal copied — paste it into WhatsApp or an email");
}

// The two presses, as buttons. Returned as a list so each caller wraps them in the row its
// own screen uses — a pop-up's action row, or the button row a whole card wears.
export function journalButtons(sheet, cur = "RM") {
  return [
    button("Print", () => printJournal(sheet, cur), "soft"),
    button("Share", () => shareJournal(sheet, cur), "soft"),
  ];
}
