// views/codes.js — the shops you hand samples to, the printed QR labels, and the
// page a scan lands on (20 Sep 2026). Her ask, in her words: a QR that is not
// single-purpose (a shop, a product offer with an expiry, a bring-a-friend
// introduction), configurable enough that the app does not have to change later,
// with a small label beside the QR so she can tell labels apart by eye.
//
// Nothing here computes a discount. An order freezes the price it was sold at
// (state.js `unitPrice`) and Money and Profit read that, so a silent storefront
// discount would rewrite recorded revenue. Instead the page STATES the offer and
// this screen TELLS HER what to take off when she confirms on WhatsApp — exactly
// how the existing referral credit already works.
//
// The QR is drawn by js/qr.js, which returns a string and touches no DOM, so every
// PNG/print call here sits behind a button the test shims never fire.

import { el, button, select, showPopup, toast, confirmDialog, copyText } from "../ui.js";
import { byId, codeLabel, findCode, liveOffer, newId, round2, save } from "../state.js";
import { KINDS, KIND_LABEL, kindOf, makeCode, labelUrl, shopUrl, tasterUrl, offerText, offerMinText, offerLine, codeStats, sheetLabels, visitTally } from "../codes.js";
import { customerList, phoneDigits } from "../customers.js";
import { attachProfiles, customerRowName } from "../profiles.js";
import { qrMatrix, qrSvg, qrPngBytes } from "../qr.js";
import { todayISO } from "../dates.js";
import { isOverridden, markAuto, markManual, translateAllowed, translateTo } from "../translate.js";
import { maybeSyncStorefront, pullVisits, VISIT_LIMIT } from "../supabase.js";

// Module scope, the way the other screens keep a picker's state: the card is
// rebuilt on every change, so a DOM node cannot remember anything.
let sheetCount = 12;
let sheetStyle = "card";
let copyOpen = false;

// The two lines of landing-page copy she can write, and the two languages each
// one is translated into.
const COPY_FIELDS = [
  ["heading", "Heading", 80],
  ["body", "A short paragraph", 300],
];
const LANGS = [["Zh", "zh", "中文"], ["Ms", "ms", "Bahasa Malaysia"]];

// ── small field builders ──────────────────────────────────────────────────

// The house field shape: a plain <label>, the input, and a hint as card-sub text.
function field(label, node, hint) {
  return el("div", { class: "field" },
    el("label", {}, label),
    node,
    hint ? el("p", { class: "card-sub", style: "margin:4px 0 0" }, hint) : null);
}

function numBox(value, onSet, step = "1") {
  const node = el("input", { class: "input", type: "number", min: "0", step });
  node.value = value == null || value === "" ? "" : String(value);
  node.addEventListener("change", () => onSet(node.value === "" ? "" : Number(node.value) || 0));
  return node;
}

function dateBox(value, onSet) {
  const node = el("input", { class: "input", type: "date" });
  node.value = String(value || "");
  node.addEventListener("change", () => onSet(node.value || ""));
  return node;
}

// A switch the house way (the same .switch / .switch-track the rest of the app
// draws), with its own sentence beside it.
function switchRow(text, on, onSet, hint) {
  const node = el("input", { type: "checkbox", checked: on === true });
  node.addEventListener("change", () => onSet(node.checked));
  return el("div", { class: "qr-switch" },
    el("label", { class: "switch" },
      node, el("span", { class: "switch-track" }, el("span", { class: "switch-knob" }))),
    el("span", { class: "qr-switch-text" },
      text,
      hint ? el("span", { class: "card-sub" }, hint) : null));
}

// ── the QR, as something a browser can draw and print ─────────────────────

// The QR as an <img> of our own SVG. An inline <svg> would need createElementNS,
// which the test shims do not provide; an image needs nothing but setAttribute.
// qrSvg carries its own width/height, so this can never be rasterised at the
// browser's 150x150 default and then stretched into a smear.
function qrImg(text, px, cls = "") {
  let src = "";
  try {
    src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(qrSvg(qrMatrix(text), { scale: 8 }));
  } catch (err) {
    console.error("QR", err);
  }
  return el("img", { class: `qr-img ${cls}`.trim(), src, width: String(px), height: String(px), alt: "QR code" });
}

// Only ever called from a button press, so the PNG bytes never reach a test shim.
function saveQrPng(text, filename) {
  let bytes = null;
  try {
    bytes = qrPngBytes(qrMatrix(text));
  } catch (err) {
    console.error("QR PNG", err);
  }
  if (!bytes) { toast("Could not draw the QR here"); return; }
  const url = URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
  const a = el("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// ── the screen ────────────────────────────────────────────────────────────

export function renderCodes(root, state) {
  const draw = () => root.replaceChildren(
    el("h2", { class: "section" }, "Shops & codes"),
    el("div", { class: "btn-row" },
      button("📷 Scan a label", () => openScan(state, draw), "primary")),
    shopsCard(state, draw),
    codesCard(state, draw),
    visitsCard(state, draw),
    landingCard(state, draw),
    el("p", { class: "card-sub", style: "margin:0 2px" },
      "A code is one printed label. Print it, stick it on a sample card or a counter card, and whatever a customer does next is counted against it — you do not have to change anything in the app to start a new promotion or add another shop. The offer on a code is stated on the page and applied by you when you confirm the order on WhatsApp, because every order records the price it sold at and the books have to keep that."),
  );
  draw();
}

// ── the shops ─────────────────────────────────────────────────────────────

function sampleText(p) {
  const n = Number(p.samplesGiven) || 0;
  return `${n} sample${n === 1 ? "" : "s"} given`;
}

function shopsCard(state, redraw) {
  const partners = (state.partners || []).filter(Boolean).slice()
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
  const cur = state.settings.currency || "RM";

  const rows = partners.map((p) => {
    const mine = (state.codes || []).filter((c) => c && c.partnerId === p.id);
    const total = mine.reduce((acc, c) => {
      const s = codeStats(state, c);
      return { orders: acc.orders + s.orders, sales: acc.sales + s.sales };
    }, { orders: 0, sales: 0 });

    const bump = (delta) => {
      p.samplesGiven = Math.max(0, (Number(p.samplesGiven) || 0) + delta);
      save(state);
      redraw();
    };

    return el("div", { class: "card-row qr-row" },
      el("div", { class: "qr-row-main" },
        el("p", { class: "card-title" },
          String(p.name || "(no name)"),
          p.active === false ? el("span", { class: "muted" }, "  retired") : null),
        el("p", { class: "card-sub" }, [
          sampleText(p),
          mine.length ? `${mine.length} label${mine.length === 1 ? "" : "s"}` : "no label yet",
          total.orders ? `${total.orders} order${total.orders === 1 ? "" : "s"}` : null,
          total.sales ? `${cur}${round2(total.sales)}` : null,
          Number(p.commissionPct) ? `${round2(p.commissionPct)}% commission` : null,
        ].filter(Boolean).join(" · "))),
      el("div", { class: "qr-row-btns" },
        el("button", { class: "btn ghost small", title: "One fewer sample", onclick: () => bump(-1) }, "−"),
        el("button", { class: "btn ghost small", title: "One more sample", onclick: () => bump(1) }, "+"),
        button("Edit", () => openPartnerForm(state, p, redraw), "ghost small")));
  });

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "Pet shops"),
        el("p", { class: "card-sub" }, partners.length
          ? "Tap − / + each time you hand over a sample"
          : "The shops handing out your samples")),
      button("＋ Add a shop", () => openPartnerForm(state, null, redraw), "ghost small")),
    ...rows);
}

function openPartnerForm(state, partner, redraw) {
  const isNew = !partner;
  const draft = isNew
    ? { id: newId("pt"), name: "", whatsapp: "", commissionPct: 10, samplesGiven: 0, notes: "", active: true }
    : { ...partner };

  showPopup(isNew ? "Add a shop" : "Edit shop", (refresh, close) => {
    const name = el("input", { class: "input", value: draft.name, placeholder: "Pet Shop Alpha" });
    const wa = el("input", { class: "input", value: draft.whatsapp, placeholder: "012-345 6789" });
    const pct = el("input", { class: "input", type: "number", min: "0", max: "100",
      value: draft.commissionPct === "" || draft.commissionPct == null ? "" : String(draft.commissionPct) });
    const samples = el("input", { class: "input", type: "number", min: "0", value: String(draft.samplesGiven || 0) });
    const notes = el("textarea", { class: "input", rows: "3" });
    notes.value = String(draft.notes || "");

    const saveIt = () => {
      const got = String(name.value || "").trim();
      if (!got) { toast("Give the shop a name first"); return; }
      const row = {
        ...draft,
        name: got,
        whatsapp: String(wa.value || "").trim(),
        commissionPct: pct.value === "" ? 0 : Number(pct.value) || 0,
        samplesGiven: Math.max(0, Number(samples.value) || 0),
        notes: String(notes.value || "").trim(),
      };
      if (isNew) state.partners.push({ ...row, createdAt: new Date().toISOString() });
      else Object.assign(partner, row);
      save(state);
      redraw();
      close();
    };

    const removeIt = () => {
      const mine = (state.codes || []).filter((c) => c && c.partnerId === partner.id);
      if (mine.length) {
        toast(`This shop still has ${mine.length} label${mine.length === 1 ? "" : "s"} — retire them first`);
        return;
      }
      confirmDialog(`Remove ${partner.name || "this shop"}?`, () => {
        state.partners = state.partners.filter((p) => p !== partner);
        save(state);
        redraw();
        close();
      }, { danger: true, yesLabel: "Remove" });
    };

    return el("div", {},
      field("Shop name", name),
      field("WhatsApp", wa, "Digits only is fine — the app adds the country code"),
      field("Commission", pct,
        "% you will pay this shop on what its code brings in. Nothing is paid automatically; this is the rate you agreed, kept here so you do not have to remember it."),
      field("Samples given", samples, "Counts up as you hand them over — the − / + on the row does this too"),
      field("Notes", notes),
      switchRow("Still working with this shop", draft.active !== false, (v) => { draft.active = v; }),
      el("div", { class: "popup-actions" },
        button("Save", saveIt, "primary"),
        isNew ? null : button("Remove", removeIt, "danger")));
  }, { wide: true });
}

// ── the codes ─────────────────────────────────────────────────────────────

function codesCard(state, redraw) {
  const codes = (state.codes || []).filter((c) => c && c.code).slice()
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  const cur = state.settings.currency || "RM";
  const today = todayISO();

  const rows = codes.map((c) => {
    const partner = byId(state.partners || [], c.partnerId);
    const st = codeStats(state, c);
    const off = liveOffer(c, today);
    const dead = c.active === false;
    const sub = [
      partner ? partner.name : KIND_LABEL[kindOf(c)],
      partner ? sampleText(partner) : null,
      st.orders ? `${st.orders} order${st.orders === 1 ? "" : "s"}` : "no orders yet",
      st.sales ? `${cur}${round2(st.sales)}` : null,
      off ? offerLine(off, cur, today) : null,
      dead ? "retired" : null,
    ].filter(Boolean).join(" · ");

    return el("div", { class: "card-row qr-row" + (dead ? " qr-off" : "") },
      qrImg(labelUrl(c), 64, "qr-thumb"),
      el("div", { class: "qr-row-main" },
        el("p", { class: "card-title" }, codeLabel(c)),
        el("p", { class: "card-sub" }, sub)),
      el("div", { class: "qr-row-btns" },
        button("Label", () => openLabel(state, c, redraw), "ghost small"),
        button("Edit", () => openCodeForm(state, c, redraw), "ghost small")));
  });

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "Codes & labels"),
        el("p", { class: "card-sub" }, codes.length
          ? `${codes.length} label${codes.length === 1 ? "" : "s"} — tap Label to print or save the QR`
          : "One label per shop, offer or introduction")),
      button("＋ New code", () => openCodeForm(state, null, redraw), "ghost small")),
    codes.length ? null : el("p", { class: "card-sub" },
      "Nothing yet. A code can point at a shop handing out samples, a promotion on one product with its own end date, or a page a customer passes on to a friend."),
    ...rows);
}

// ── what the labels brought in ────────────────────────────────────────────

// Visits live in the cloud and nowhere else: the public page may add one and
// nobody anonymous may read them back, so this is a signed-in read, the same as
// Customer reviews. It is the only card on this screen that needs Supabase, so
// when it cannot load it says which thing is missing rather than going blank.
function visitsCard(state, redraw) {
  const box = el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", {},
        el("p", { class: "card-title" }, "Label visits"),
        el("p", { class: "card-sub" }, "How many times each label's page was opened, and which pet")),
      button("↻ Refresh", () => fill(), "ghost small")),
    el("p", { class: "card-sub" }, "Loading…"));

  fill();
  return box;

  async function fill() {
    const r = await pullVisits(state);
    if (!box.isConnected) return;
    if (!r.ok) {
      box.replaceChildren(
        el("div", { class: "card-row" },
          el("div", {},
            el("p", { class: "card-title" }, "Label visits"),
            el("p", { class: "card-sub" }, "Opens of the page a scan lands on")),
          button("↻ Refresh", () => fill(), "ghost small")),
        el("p", { class: "card-sub" }, String(r.reason || "Couldn't load the visits")),
        el("p", { class: "card-sub", style: "margin-top:8px" },
          "A visit is written by the page itself, so this card needs cloud sync on and the one-time SQL run once (supabase/taster_visits.sql)."));
      return;
    }
    const tally = visitTally(r.rows);
    const today = todayISO();
    const codes = (state.codes || []).filter((c) => c && c.code);
    const rows = codes.map((c) => {
      const n = tally.byCode.get(String(c.code).toUpperCase()) || 0;
      return { c, n };
    }).sort((a, b) => b.n - a.n);

    const summary = [
      `${tally.total} visit${tally.total === 1 ? "" : "s"}`,
      tally.pets.dog || tally.pets.cat
        ? `${tally.pets.dog} dog${tally.pets.dog === 1 ? "" : "s"} · ${tally.pets.cat} cat${tally.pets.cat === 1 ? "" : "s"}`
        : null,
      tally.pets.none ? `${tally.pets.none} did not say` : null,
    ].filter(Boolean).join(" · ");

    const children = [
      el("div", { class: "card-row" },
        el("div", {},
          el("p", { class: "card-title" }, "Label visits"),
          el("p", { class: "card-sub" }, "How many times each label's page was opened, and which pet")),
        button("↻ Refresh", () => fill(), "ghost small")),
      el("p", { class: "card-sub", style: "margin:0 0 8px" }, summary),
    ];

    if (!tally.total) {
      children.push(el("p", { class: "card-sub" },
        "No visits yet. A visit is counted when someone opens a label's page and tells us which pet it is for."));
    } else {
      // Only the labels that were opened, so the list says something rather than
      // listing every code at zero. A visit whose code we cannot match still
      // counts in the total above.
      const shown = rows.filter((x) => x.n > 0);
      if (shown.length) {
        children.push(...shown.map(({ c, n }) =>
          el("div", { class: "card-row" },
            el("div", { class: "qr-row-main" },
              el("p", { class: "card-title" }, codeLabel(c)),
              el("p", { class: "card-sub" }, `${n} visit${n === 1 ? "" : "s"}`)),
            el("div", { class: "qr-row-btns" },
              button("Label", () => openLabel(state, c, redraw), "ghost small")))));
      } else {
        children.push(el("p", { class: "card-sub" },
          "Visits arrived, but none of them matched a label you still have."));
      }
    }
    if (r.capped) {
      children.push(el("p", { class: "card-sub", style: "margin-top:8px" },
        `Counting the most recent ${VISIT_LIMIT} visits — older ones are in Supabase but not in this figure.`));
    }
    children.push(el("p", { class: "card-sub", style: "margin-top:8px" },
      "A visit is one opened page, not one person: the same customer opening the link twice counts twice, and a page opened without a code counts in the total only."));
    box.replaceChildren(...children);
  }
}

// ── hold a phone up to a printed label ────────────────────────────────────

// Camera scanning only exists where the browser offers both a camera and a
// barcode decoder — today that is Chrome/Edge on Android and desktop, NOT iPhone
// Safari. So the typed code is always here beside it and is never the fallback:
// it is the way an iPhone reads a label, and the way anyone reads a label whose
// square is scuffed. What she gets either way is the label identified: what it
// is, whether the offer is still running, what it has brought in so far.
function openScan(state, redraw) {
  const video = el("video", { class: "qr-scan-video", playsinline: "true", muted: "true" });
  const note = el("p", { class: "card-sub" });
  const found = el("div", {});
  const input = el("input", { class: "input", type: "text", maxlength: "12",
    autocomplete: "off", autocapitalize: "characters", spellcheck: "false",
    placeholder: "e.g. K3X9" });
  let stop = () => {};
  let stream = null;

  const canScan = typeof navigator !== "undefined"
    && !!navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function"
    && typeof window !== "undefined" && "BarcodeDetector" in window;

  const close = showPopup("Scan a label", () => el("div", {},
    canScan
      ? el("div", { class: "qr-scan" }, video, note)
      : el("p", { class: "card-sub" },
        "This browser cannot read a QR with the camera. Type the short letters printed beside the square — that works everywhere, iPhone included."),
    field("Or type the code from the label", input, "The short letters printed beside the square."),
    el("div", { class: "btn-row" },
      button("Look it up", () => look(input.value), "primary"),
      canScan ? button("Start the camera", start, "ghost") : null),
    found));

  // The ✕ that closes a popup is drawn by ui.js, so there is no on-close hook to
  // hang cleanup on. Instead the loop notices its own video has left the page and
  // puts the camera light out — which also covers closing it any other way.
  stop = () => {
    if (stream) { for (const t of stream.getTracks()) t.stop(); stream = null; }
    video.srcObject = null;
  };
  const cleanup = setInterval(() => {
    if (!video.isConnected) { stop(); clearInterval(cleanup); }
  }, 1000);

  return close;

  async function start() {
    if (stream) return;
    note.textContent = "Waiting for the camera…";
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
    } catch (err) {
      note.textContent = "The camera could not be opened. Allow camera access, or type the code instead.";
      return;
    }
    video.srcObject = stream;
    try { await video.play(); } catch (err) { /* autoplay refusal is harmless here */ }
    note.textContent = "Hold the label steady inside the frame.";
    let det = null;
    try { det = new window.BarcodeDetector({ formats: ["qr_code"] }); }
    catch (err) { det = null; }
    if (!det) {
      note.textContent = "The camera is on, but this browser cannot read a QR. Type the code instead.";
      return;
    }
    const tick = setInterval(async () => {
      if (!stream) { clearInterval(tick); return; }
      let hits = [];
      try { hits = await det.detect(video); } catch (err) { hits = []; }
      if (!hits.length) return;
      const raw = String(hits[0].rawValue || "");
      const code = codeFromScan(raw);
      if (!code) return;
      clearInterval(tick);
      stop();
      note.textContent = "Found it.";
      look(code);
    }, 400);
  }

  function look(value) {
    const wanted = String(value || "").trim().toUpperCase();
    if (!wanted) { found.replaceChildren(el("p", { class: "card-sub" }, "Type the code first.")); return; }
    const c = findCode(state, wanted);
    if (!c) {
      found.replaceChildren(el("p", { class: "card-sub" },
        `No label of yours reads ${wanted}. Check the letters beside the square.`));
      return;
    }
    const partner = byId(state.partners || [], c.partnerId);
    const off = liveOffer(c, todayISO());
    const st = codeStats(state, c);
    const cur = state.settings.currency || "RM";
    found.replaceChildren(
      el("p", { class: "card-title" }, codeLabel(c)),
      el("p", { class: "card-sub" }, [
        partner ? partner.name : KIND_LABEL[kindOf(c)],
        off ? offerLine(off, cur, todayISO()) : "no offer running",
        st.orders ? `${st.orders} order${st.orders === 1 ? "" : "s"}` : "no orders yet",
      ].filter(Boolean).join(" · ")),
      el("div", { class: "btn-row" },
        el("a", { class: "btn ghost small", href: tasterUrl(c.code), target: "_blank", rel: "noopener" },
          "What the customer sees"),
        el("a", { class: "btn ghost small", href: shopUrl(c.code), target: "_blank", rel: "noopener" },
          "Order for this shop")));
  }
}

// A scanned QR is a whole URL, so the code has to be taken out of it — but a
// square may also simply hold the letters if she ever prints one that way.
function codeFromScan(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text, "https://x.invalid/");
    const c = url.searchParams.get("c");
    if (c) return String(c).trim().toUpperCase();
  } catch (err) { /* not a URL — fall through and treat it as the code itself */ }
  return /^[A-Za-z0-9-]{2,16}$/.test(text) ? text.toUpperCase() : "";
}

function openCodeForm(state, code, redraw) {
  const isNew = !code;
  const t = state.settings.taster || {};
  const cur = state.settings.currency || "RM";
  const today = todayISO();
  const draft = isNew
    ? {
      id: newId("cd"),
      code: makeCode(state.codes || []),
      label: "",
      kind: "shop",
      partnerId: "",
      productId: "",
      headline: "",
      active: true,
      createdAt: new Date().toISOString(),
      offer: newOffer(t, today),
    }
    : { ...code, offer: { ...(code.offer || {}) } };

  showPopup(isNew ? "New code" : "Edit code", (refresh, close) => {
    // Changing the kind rebuilds this form from `draft`, so whatever is typed in
    // the three text boxes has to be written back first — otherwise picking a
    // different kind silently discards a label or a code she just typed. A plain
    // function declaration so it can be called from the handler above while the
    // nodes it reads are declared below (it only ever runs on a real change).
    function keepTyped() {
      draft.label = label.value;
      draft.code = String(codeText.value || "").trim().toUpperCase();
      draft.headline = headline.value;
    }

    // The hint for each kind is a line of its own under the box rather than a
    // section heading in the list: the picker's sections are runs of options (the
    // product list's on-the-shop / sold-out), so four one-item sections would put
    // four sentences in the wheel. The body is rebuilt on every change, so the
    // line that shows is the line for the kind now chosen.
    const kindSel = select(
      KINDS.map(([id, label]) => ({ value: id, label })),
      draft.kind,
      () => { draft.kind = kindSel.value; keepTyped(); refresh(); });

    const label = el("input", { class: "input", value: draft.label || "", maxlength: "24",
      placeholder: draft.code });
    const codeText = el("input", { class: "input", value: draft.code || "", maxlength: "12" });
    const headline = el("input", { class: "input", value: draft.headline || "", maxlength: "80",
      placeholder: "One line above the offer on the page" });

    const partnerSel = draft.kind === "shop"
      ? select([{ value: "", label: "— none yet —" },
        ...(state.partners || []).map((p) => ({ value: p.id, label: p.name || "(no name)" }))],
      draft.partnerId || "", () => { draft.partnerId = partnerSel.value; })
      : null;

    const productSel = draft.kind === "promo"
      ? select([{ value: "", label: "— any product —" },
        ...(state.products || []).map((p) => ({ value: p.id, label: p.name || "(no name)" }))],
      draft.productId || "", () => { draft.productId = productSel.value; })
      : null;

    // A bring-a-friend label belongs to ONE customer, so it is picked from the
    // people she has already served rather than typed: the credit scheme matches
    // a referrer by the digits of their number, and a typo here would silently
    // mean the credit is never claimed. A saved profile's name wins over the
    // name on the orders, the way every other customer list reads it.
    const people = customerList(state, "recent", "phone", today);
    attachProfiles(state, people);
    const referrerSel = draft.kind === "intro"
      ? select([{ value: "", label: people.length ? "— pick a customer —" : "— nobody to pick yet —" },
        ...people.map((r) => ({
          value: phoneDigits(r.whatsapp),
          label: `${customerRowName(r)} · ${r.whatsapp}`,
        }))],
      draft.referrerDigits || "", () => { draft.referrerDigits = referrerSel.value; })
      : null;

    // The offer, for the two kinds that can carry one. "Bring a friend" uses the
    // credit scheme instead, and a plain code states nothing.
    const off = draft.offer || (draft.offer = {});
    const carriesOffer = draft.kind === "promo" || draft.kind === "shop";
    const typeSel = carriesOffer
      ? select([{ value: "nothing", label: "No offer" },
        { value: "rm", label: `Amount off (${cur})` },
        { value: "pct", label: "Percent off (%)" }],
      off.type || "nothing", () => { off.type = typeSel.value; refresh(); })
      : null;

    // Gated on the kind, not just on what is in the record: a code switched from
    // "promo" to "bring a friend" keeps its old offer on the object, and without
    // `carriesOffer` here the amount boxes stayed on screen with no Offer select
    // above them — an offer she could neither see nor switch off.
    const shown = carriesOffer && (off.type === "rm" || off.type === "pct");
    const offerBody = shown ? el("div", { class: "qr-offer" },
      el("div", { class: "qr-two" },
        field(off.type === "pct" ? "Percent off" : `Amount off (${cur})`,
          numBox(off.value, (v) => { off.value = v; }, "any")),
        field(`Minimum spend (${cur})`, numBox(off.minSpend, (v) => { off.minSpend = v; }, "any"),
          "Leave blank for no minimum")),
      el("div", { class: "qr-two" },
        field("Starts", dateBox(off.from, (v) => { off.from = v; })),
        field("Ends", dateBox(off.to, (v) => { off.to = v; }),
          "After this day the offer stops showing, on its own")),
      switchRow("New customers only", off.newOnly === true, (v) => { off.newOnly = v; },
        "A customer counts as new when that WhatsApp number has never ordered before")) : null;

    const saveIt = () => {
      const got = String(codeText.value || "").trim().toUpperCase();
      if (!got) { toast("A code needs its own short code"); return; }
      const clash = (state.codes || []).find(
        (c) => c !== code && String(c.code || "").trim().toUpperCase() === got);
      if (clash) { toast(`${got} is already on "${codeLabel(clash)}"`); return; }
      const row = {
        ...draft,
        code: got,
        label: String(label.value || "").trim(),
        headline: String(headline.value || "").trim(),
        // A kind with no offer box states nothing — so a code switched away from
        // "promo" drops the offer instead of carrying one nobody can see.
        offer: carriesOffer ? cleanOffer(off) : { type: "nothing" },
        // Same rule for the referrer: only a bring-a-friend label points the
        // credit at someone, so a code switched away from "intro" keeps no
        // number at all rather than one no box on this form can show.
        referrerDigits: draft.kind === "intro" ? phoneDigits(referrerSel && referrerSel.value) : "",
      };
      if (isNew) state.codes.push(row);
      else Object.assign(code, row);
      save(state);
      maybeSyncStorefront(state);
      redraw();
      close();
    };

    const retireIt = () => {
      if (code.active === false) { toast("Already retired"); return; }
      confirmDialog(
        `Stop "${codeLabel(code)}"? Scans still open the page, but the offer stops showing and the code comes off the shop.`,
        () => {
          code.active = false;
          save(state);
          maybeSyncStorefront(state);
          redraw();
          close();
        }, { danger: true, yesLabel: "Retire" });
    };

    return el("div", {},
      field("What this code is for", kindSel,
        (KINDS.find(([id]) => id === kindOf(draft)) || [])[2]),
      field("The words on the label", label,
        "Printed in small type beside the QR, so you can tell one label from another at a glance. Blank uses the code itself."),
      field("The code itself", codeText,
        "What goes in the link. Short is good — 5 characters is plenty."),
      partnerSel ? field("Shop", partnerSel) : null,
      productSel ? field("Product", productSel) : null,
      referrerSel ? field("Whose label is this", referrerSel,
        "The customer who hands it out. Their number rides in the link, so the usual bring-a-friend credit applies on its own.") : null,
      typeSel ? field("Offer", typeSel) : null,
      offerBody,
      field("A line on the page (optional)", headline,
        "Shown above the offer, so one label can say something the others do not."),
      switchRow("This label is in use", draft.active !== false, (v) => { draft.active = v; }),
      el("div", { class: "popup-actions" },
        button("Save", saveIt, "primary"),
        isNew ? null : button("Retire", retireIt, "danger")));
  }, { wide: true });
}

// The offer a new code starts with, from the landing page's own defaults. A
// window is only filled in when she asked for one (`validDays` blank = open-ended).
function newOffer(t, today) {
  const type = t.offerType === "pct" ? "pct" : t.offerType === "rm" ? "rm" : "nothing";
  const days = Number(t.validDays);
  return {
    type,
    value: type === "nothing" ? "" : Number(t.offerValue) || "",
    minSpend: Number(t.offerMin) || "",
    from: today,
    to: type === "nothing" || !(days > 0) ? "" : addDays(today, days),
  };
}

function addDays(iso, n) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + n);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

// Keep only what an offer is made of, so a form left half-filled cannot store a
// shape some later reader has to guess at.
function cleanOffer(off) {
  const type = off && (off.type === "rm" || off.type === "pct") ? off.type : "";
  if (!type) return { type: "nothing" };
  return {
    type,
    value: Number(off.value) || 0,
    minSpend: Number(off.minSpend) || 0,
    from: String(off.from || ""),
    to: String(off.to || ""),
    newOnly: off.newOnly === true,
  };
}

// ── the label: preview, save, print ───────────────────────────────────────

// A printed label carries the offer SHORT — "RM5 off · on RM30 and above" — and
// never the end date. The page the scan opens says the full sentence; a sticky
// label only has room for what a customer reads at arm's length, and a wrapped
// four-line offer made the label twice as tall as the QR.
function stampOffer(off, cur) {
  if (!off) return "";
  return [offerText(off, cur), offerMinText(off, cur)].filter(Boolean).join(" · ");
}

function stampEl(state, code, px, withKind) {
  const off = liveOffer(code, todayISO());
  const cur = state.settings.currency || "RM";
  const short = stampOffer(off, cur);
  return el("div", { class: `qr-stamp style-${sheetStyle}` },
    qrImg(labelUrl(code), px),
    el("div", { class: "qr-stamp-text" },
      el("p", { class: "qr-stamp-brand" }, brandOf(state)),
      el("p", { class: "qr-stamp-code" }, codeLabel(code)),
      el("p", { class: "qr-stamp-code2" },
        withKind ? `${code.code} · ${KIND_LABEL[kindOf(code)]}` : code.code),
      short ? el("p", { class: "qr-stamp-offer" }, short) : null,
      off && off.newOnly ? el("p", { class: "qr-stamp-new" }, "New customers") : null,
      el("p", { class: "qr-stamp-cta" }, "Scan for your treat")));
}

function statRow(label, value) {
  return el("div", { class: "info-row" },
    el("span", {}, label),
    el("span", { class: "info-val" }, value));
}

function brandOf(state) {
  return String(((state.settings.storefront || {}).name) || "").trim() || "Munchies Furkidz";
}

function openLabel(state, code, redraw) {
  const cur = state.settings.currency || "RM";
  showPopup(`Label · ${codeLabel(code)}`, (refresh, close) => {
    const url = labelUrl(code);
    const st = codeStats(state, code);

    return el("div", {},
      el("div", { class: "qr-preview" }, qrImg(url, 220)),
      el("p", { class: "qr-url" }, url),
      el("div", { class: "popup-actions qr-actions" },
        button("Save the QR as a picture", () => saveQrPng(url, `qr-${code.code}.png`), "primary"),
        button("Print labels", () => { close(); openPrintSheet(state, code, redraw); }, "soft"),
        button("Copy the link", () => copyText(url, "Link copied"), "ghost"),
        button("Open what the customer sees", () => window.open(url, "_blank", "noopener"), "ghost")),
      el("p", { class: "card-sub" },
        "The picture is a PNG at 8 pixels per square — big enough to print sharply on a counter card and to scan from a phone screen."),
      el("div", { class: "card qr-stats" },
        statRow("Orders through this code", String(st.orders)),
        statRow("Things sold", String(st.units)),
        statRow("Taken in", `${cur}${round2(st.sales)}`)),
      el("p", { class: "card-sub" },
        "Counted from the orders customers placed with this code on them. An order you type in yourself is a counter sale and carries no code, so it is not counted here."));
  }, { wide: true });
}

// ── the printable sheet ───────────────────────────────────────────────────

function openPrintSheet(state, code, redraw) {
  showPopup(`Print · ${codeLabel(code)}`, (refresh, close) => {
    const countBox = el("input", { class: "input qr-count", type: "number", min: "1", max: "60" });
    countBox.value = String(sheetCount);
    countBox.addEventListener("change", () => {
      sheetCount = Math.max(1, Math.min(Number(countBox.value) || 1, 60));
      refresh();
    });

    const styles = el("div", { class: "label-styles" },
      el("span", { class: "muted" }, "Size"),
      ...[["card", "Card"], ["mini", "Mini"]].map(([id, text]) => el("button", {
        class: `style-pill${sheetStyle === id ? " active" : ""}`,
        type: "button",
        onclick: () => { sheetStyle = id; refresh(); },
      }, text)));

    const n = sheetLabels(code, sheetCount).length;

    return el("div", {},
      el("div", { class: "qr-sheet-controls" },
        el("label", { class: "field" }, el("span", {}, "How many"), countBox),
        styles),
      el("div", { class: "label-preview-wrap" },
        el("div", { class: "qr-sheet" },
          ...Array.from({ length: n }, () => stampEl(state, code, sheetStyle === "mini" ? 110 : 150, true)))),
      el("div", { class: "popup-actions" },
        button("Print", () => printSheet(), "primary"),
        button("Close", close, "ghost")));
  }, { wide: true });

  // The body class lives only for the instant of printing, so a leftover class can
  // never blank a later PO or packing-label print (the same guard orders.js uses).
  function printSheet() {
    document.body.classList.add("codes-print");
    const done = () => {
      document.body.classList.remove("codes-print");
      window.removeEventListener("afterprint", done);
      clearTimeout(timer);
    };
    const timer = setTimeout(done, 2000);
    window.addEventListener("afterprint", done);
    window.print();
  }
}

// ── the landing page copy ─────────────────────────────────────────────────

function landingCard(state, redraw) {
  const t = state.settings.taster || (state.settings.taster = {});
  const cur = state.settings.currency || "RM";
  const set = (key, value) => {
    t[key] = value;
    save(state);
    maybeSyncStorefront(state);
  };
  const offerWord = t.offerType === "pct" ? `${t.offerValue}% off`
    : t.offerType === "rm" ? `${cur}${t.offerValue} off` : "no offer";

  return el("div", { class: "card" },
    el("div", { class: "card-row qr-fold", onclick: () => { copyOpen = !copyOpen; redraw(); } },
      el("div", {},
        el("p", { class: "card-title" }, `The page a scan lands on ${copyOpen ? "▾" : "▸"}`),
        el("p", { class: "card-sub" },
          `${t.askPet !== false ? "Asks dog or cat" : "Does not ask dog or cat"} · ${t.follow !== false ? "shows your socials" : "no socials line"} · a new label offers ${offerWord}`)),
      button("Fill 中文 / BM", () => fillAll(state, redraw), "ghost small")),
    copyOpen ? el("div", {},
      ...COPY_FIELDS.map(([en, label, max]) => copyLine(t, state, en, label, max, set, redraw)),
      switchRow("Ask whether it's a dog or a cat", t.askPet !== false, (v) => set("askPet", v)),
      switchRow("Show the follow-us line", t.follow !== false, (v) => set("follow", v)),
      el("p", { class: "qr-sub-head" }, "What a new label offers by default"),
      el("div", { class: "qr-two" },
        field("Offer",
          (() => {
            const sel = select([{ value: "rm", label: `Amount off (${cur})` },
              { value: "pct", label: "Percent off (%)" },
              { value: "nothing", label: "No offer" }],
            t.offerType || "rm", () => { set("offerType", sel.value); redraw(); });
            return sel;
          })()),
        field("Amount", numBox(t.offerValue, (v) => set("offerValue", v), "any"))),
      el("div", { class: "qr-two" },
        field("Suggested minimum spend", numBox(t.offerMin, (v) => set("offerMin", v), "any")),
        field("How long a new offer runs", numBox(t.validDays, (v) => set("validDays", v)),
          "In days — blank means it never expires")),
      el("p", { class: "card-sub" },
        "New labels start with this offer already filled in; you can change it on any single label. Type an English line, then press Fill 中文 / BM. Change a translated box by hand and it stays yours; press Fill again and only the boxes you left alone are re-filled.")) : null);
}

// One English line, its two translated boxes, and a ↻ that asks for one box again.
function copyLine(t, state, en, label, max, set, redraw) {
  const english = el("input", { class: "input", value: t[en] || "", maxlength: String(max) });
  english.addEventListener("change", () => {
    set(en, String(english.value || "").trim());
    redraw();
  });
  return el("div", { class: "qr-copy-line" },
    field(label, english),
    el("div", { class: "qr-trans" },
      ...LANGS.map(([suffix, lang, langLabel]) => {
        const variant = `${en}${suffix}`;
        const box = el("input", {
          class: "input qr-trans-input" + (isOverridden(t, variant) ? " is-mine" : ""),
          value: t[variant] || "",
          placeholder: langLabel,
        });
        // Typing here makes the box hers: automatic filling never touches it again.
        box.addEventListener("change", () => {
          const value = String(box.value || "").trim();
          set(variant, value);
          if (value) markManual(t, variant);
          else markAuto(t, variant, String(t[en] || "").trim());
          redraw();
        });
        return el("div", { class: "qr-trans-slot" },
          box,
          el("button", { class: "btn ghost small", title: "Translate this line again",
            onclick: () => regenOne(t, state, variant, en, redraw) }, "↻"));
      })));
}

// Fill every box that is blank or still holding our own earlier translation.
async function fillAll(state, redraw) {
  const t = state.settings.taster || {};
  if (!translateAllowed()) { toast("No connection — translations fill when you're back online"); return; }
  let filled = 0;
  for (const [en] of COPY_FIELDS) {
    const english = String(t[en] || "").trim();
    if (!english) continue;
    for (const [suffix, lang] of LANGS) {
      const variant = `${en}${suffix}`;
      if (isOverridden(t, variant)) continue;
      const got = await translateTo(fetch, english, lang);
      if (!got) continue;
      t[variant] = got;
      markAuto(t, variant, english);
      filled += 1;
    }
  }
  save(state);
  maybeSyncStorefront(state);
  redraw();
  toast(filled ? `Filled ${filled} box${filled === 1 ? "" : "es"}` : "Nothing needed filling");
}

// The ↻: translate this one line again, now. The new wording is machine text, so
// a box she had typed over becomes translatable again (the products card's rule).
async function regenOne(t, state, variant, en, redraw) {
  if (!translateAllowed()) { toast("No connection — translations fill when you're back online"); return; }
  const english = String(t[en] || "").trim();
  if (!english) { toast("Type the English first"); return; }
  const got = await translateTo(fetch, english, variant.endsWith("Zh") ? "zh" : "ms");
  if (!got) { toast("Couldn't translate just now — try again in a moment"); return; }
  t[variant] = got;
  markAuto(t, variant, english);
  save(state);
  maybeSyncStorefront(state);
  redraw();
  toast("Translated");
}
