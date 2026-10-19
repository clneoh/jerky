// ui.js — safe DOM building and shared render helpers.
// el() uses textContent by default so user data can never be injected as HTML.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  // ★★★ A DIV WITH A CLICK IS A BUTTON, AND SAYS SO (v566).
  // ⚠️⚠️ Twenty-four controls in this app are a div or a span with an `onclick` and nothing else — the Home
  // tiles, a delivery day, a history row — ⭐ **so a keyboard or a switch could not reach them at all**, and a
  // screen reader did not announce them as pressable. ⭐ Doing it HERE means every one of them, and every one
  // written tomorrow, is a button without a call site being touched.
  // ⚠️ Only when the caller has not said otherwise, and never on a real <button>/<a>.
  const clickish = attrs && typeof attrs.onclick === "function" && /^(div|span|li)$/i.test(tag);
  const madeButton = clickish && !attrs.role && !("tabindex" in attrs);
  if (madeButton) { attrs = { ...attrs, role: "button", tabindex: "0" }; }
  for (const [k, v] of Object.entries(attrs)) {
    // Skip null/undefined AND false: `selected: false` must not become a
    // setAttribute call — "selected" is a boolean attribute, so ANY presence
    // (even ="false") selects the option. Previously every <option> in a
    // select() ended up selected and browsers showed the last one.
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if (k === "value") node.value = v;
    else if (k === "checked") node.checked = v;
    else if (k === "selected") node.selected = v;
    else node.setAttribute(k, v);
  }
  for (const child of children.flat()) {
    if (child == null || child === false) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  // ⚠️ And Enter/Space press it, the way a real button does — otherwise the tab stop is a dead end.
  if (madeButton) {
    node.addEventListener("keydown", (e) => {
      // ⚠️ ONLY WHEN THE KEY WAS PRESSED ON THIS CONTROL (v568). A chip that CONTAINS a ✕ gets the ✕'s own
      // key press bubbling up; acting on it would run the chip's press instead of the button's — the ✕
      // would paste the chip's name back into the box instead of removing it.
      if (e.target !== node) return;
      if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
      e.preventDefault();
      attrs.onclick(e);
    });
  }
  return node;
}

// ★★★ EVERY BOX GETS ITS OWN NAME (v566).
//
// ⚠️⚠️ THE APP HAD 246 `<label>` ELEMENTS AND **NOT ONE `for=`**, and about 178 of its boxes carried no
// `aria-label` at all: ⭐ **so a screen reader announced every one of them as "edit text", and voice control
// could not say which box was which.** ⚠️ The labels were there and VISIBLE — this app has always drawn the
// words above each field — but a label that is only *near* a box is not attached to it.
// ⭐ Doing it here, once, after each render, means every screen (and every screen written tomorrow) gets the
// words it already prints. ⚠️ It never overwrites a name a field was given.
function tagOf(node) {
  return String((node && node.tagName) || "").toLowerCase();
}

function labelFor(box) {
  // ⚠️⚠️ A LABEL THAT WRAPS THE BOX ALREADY NAMES IT — AND IT MUST WIN (v568). ⭐ The first version of this
  // helper looked past a wrapping label and took the PREVIOUS row's instead, so `<label><input>Monday</label>`
  // was named "Sun", Tuesday "Mon", and so on — ⭐ **and an `aria-label` OVERRIDES the correct implicit name,
  // so a control that was already right was relabelled wrong.** ⚠️ Found by an adversarial read of the
  // change, not by its tests; the wrapped case is pinned now.
  for (let up = box.parentNode, depth = 0; up && depth < 4; up = up.parentNode, depth++) {
    if (tagOf(up) === "label") return up;
    if (tagOf(up) === "body" || tagOf(up) === "html") break;
  }
  // 2) the nearest label BEFORE it, walking out of a few wrappers
  let node = box;
  for (let depth = 0; depth < 4 && node; depth++) {
    let sib = node.previousSibling;
    while (sib) {
      if (sib.nodeType === 1) {
        if (tagOf(sib) === "label") return sib;
        const inner = typeof sib.querySelector === "function" ? sib.querySelector("label") : null;
        if (inner) return inner;
      }
      sib = sib.previousSibling;
    }
    node = node.parentNode;
  }
  // 2) otherwise the first label in the block the box sits in
  let scope = box.parentNode;
  for (let depth = 0; depth < 3 && scope; depth++) {
    const l = typeof scope.querySelector === "function" ? scope.querySelector("label") : null;
    if (l) return l;
    scope = scope.parentNode;
  }
  return null;
}

// Name every unnamed box in `root`. Returns how many it named (0 is a normal answer, not a fault).
export function nameFields(root) {
  if (!root || typeof root.querySelectorAll !== "function") return 0;
  const boxes = root.querySelectorAll("input, select, textarea");
  let named = 0;
  for (const box of boxes) {
    if (!box || typeof box.getAttribute !== "function" || typeof box.setAttribute !== "function") continue;
    if (box.getAttribute("aria-label") || box.getAttribute("aria-labelledby")) continue;
    const id = box.getAttribute("id");
    if (id && typeof root.querySelector === "function") {
      try { if (root.querySelector(`label[for="${id}"]`)) continue; } catch { /* odd id; keep going */ }
    }
    const label = labelFor(box);
    if (!label) continue;
    let words = String(label.textContent || "").replace(/\s+/g, " ").trim();
    if (!words) {
      // ⚠️⚠️ A SWITCH'S WORDS SIT BESIDE IT (v591). ⚠️ The markup is `<label class=switch><input><span>
      // <span></label>` with the description in the NEXT sibling — so the label's own text is empty and the
      // box was given NO name at all: **a screen reader said just "checkbox", and voice control could not
      // name it.** ⭐ The words next to the switch are its name.
      const side = label.nextElementSibling || label.previousElementSibling;
      words = side ? String(side.textContent || "").replace(/\s+/g, " ").trim() : "";
    }
    if (!words) continue;
    box.setAttribute("aria-label", words);
    named += 1;
  }
  return named;
}

// ⚠️⚠️ A DIALOG HOLDS THE KEYBOARD AND HANDS IT BACK (v591). ⚠️ Both dialog styles claimed `aria-modal`
// but did NOT trap Tab or restore focus: **Tab walked out of the card into the page behind it**, Escape then
// stopped working (its listener is on the card/layer), and closing left focus on `<body>` — a keyboard user
// restarted at the top. ⭐ These two helpers give every dialog the same two behaviours.
function focusablesIn(root) {
  if (!root || typeof root.querySelectorAll !== "function") return [];
  try {
    return [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter((n) => n && !n.disabled && !n.hidden);
  } catch { return []; }
}

function trapTab(e, root) {
  if (!e || e.key !== "Tab") return false;
  const list = focusablesIn(root);
  const active = (typeof document !== "undefined" && document.activeElement) || null;
  if (!list.length) {
    e.preventDefault();
    try { root.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
    return true;
  }
  const first = list[0];
  const last = list[list.length - 1];
  if (e.shiftKey && (active === first || active === root || !list.includes(active))) {
    e.preventDefault();
    try { last.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
    return true;
  }
  if (!e.shiftKey && (active === last || !list.includes(active))) {
    e.preventDefault();
    try { first.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
    return true;
  }
  return false;
}

// ⚠️⚠️ A GLYPH IS NOT A NAME (v593). ⚠️ "‹", "›" and "✕" were announced by their CHARACTER names, so a
// screen reader said "‹, button" and voice control could not say "next month". ⭐ Every glyph press is named
// here, once, so every one written tomorrow is named too; call sites that know more say more.
const GLYPH_NAMES = { "‹": "Previous", "›": "Next", "✕": "Remove", "×": "Remove", "＋": "One more", "+": "One more", "−": "One less", "-": "One less" };

export function button(text, onClick, cls = "") {
  const node = el("button", { class: `btn ${cls}`.trim(), onclick: onClick }, text);
  const name = GLYPH_NAMES[String(text).trim()];
  if (name) node.setAttribute("aria-label", name);
  return node;
}

// ⚠️⚠️ A CHOSEN PILL IS SAID, NOT ONLY COLOURED (v594). ⚠️ Money, Profit, Deliveries, the account editor and
// the planner all mark a chosen option with `cal-mode-on` and nothing else — ⚠️ **a screen reader heard a row
// of buttons with no way to tell which one was in force.** ⭐ One builder, so every pill says its state.
export function modeButton(text, on, onClick) {
  const node = button(text, onClick, `ghost small${on ? " cal-mode-on" : ""}`);
  node.setAttribute("aria-pressed", on ? "true" : "false");
  return node;
}

// ★ ONE ROW OF "SOMEWHERE ELSE TO GO" (v312). A title, a line under it saying
// what it is for, and a chevron on the right.
//
// ⚠️ ONE BUILDER, DELIBERATELY. The More screen lists every screen, and the
// Products screen now lists three of them as well; a second row builder would be
// a second place the shape can drift, and two rows that look alike and behave
// differently are the fault this app treats as a bug — the v290 lesson about a
// second form, applied to a row.
//
// The right-hand group exists so an async count pill (Reviews' "N waiting") can
// be tucked in beside the chevron rather than floating to the middle of the row.
export function menuRow(href, title, sub, { newTab = false } = {}) {
  return el("a",
    { class: "menu-item", href, ...(newTab ? { target: "_blank", rel: "noopener" } : {}) },
    el("div", {},
      el("div", {}, title),
      el("div", { class: "card-sub", style: "font-weight:400" }, sub)),
    el("span", { class: "menu-right" }, el("span", { class: "chev" }, "›")));
}

// The class a picker wears for the value it now holds — "" when it holds
// nothing, or when the choice carries no tone.
function toneClass(options, value) {
  const chosen = options.find((o) => String(o.value) === String(value));
  return chosen && chosen.tone ? `tone-${chosen.tone}` : "";
}

export function select(options, value, onchange, placeholder = "") {
  const s = el("select", {});
  if (placeholder) s.appendChild(el("option", { value: "", disabled: true, selected: !value }, placeholder));

  // Options may name a section (the product picker splits the menu into on the
  // shop / sold out / taken down), and each run of them becomes an <optgroup>.
  // Every platform draws those as their own headed block — the phone's wheel
  // included, which is the one place a page cannot reach. A menu that comes out
  // as a single section is left ungrouped: a lone heading is just noise.
  const groups = new Set(options.map((o) => o.group || ""));
  const sectioned = groups.size > 1;
  let group = "";
  let parent = s;
  for (const o of options) {
    const name = sectioned ? (o.group || "") : "";
    if (name !== group) {
      group = name;
      if (name) {
        parent = el("optgroup", { label: name, class: o.tone ? `tone-${o.tone}` : "" });
        s.appendChild(parent);
      } else {
        parent = s;
      }
    }
    parent.appendChild(el("option", {
      value: o.value, selected: o.value === value, class: o.tone ? `tone-${o.tone}` : "",
    }, o.label));
  }
  // A toned menu is marked so the stylesheet can adopt it where the browser
  // supports a picker a page may draw (see app.css) — and left alone everywhere
  // else, where the native list takes over.
  const toned = options.some((o) => o.tone);
  // The current value is tracked rather than read back off the node, because the
  // first paint happens before a browser has settled which option is selected.
  let current = value;
  const paint = () => {
    // Rebuilt from the classes already there, so a caller's own class (the status
    // filter sets "input") is never thrown away by a repaint.
    const rest = String(s.className || "").split(/\s+/)
      .filter((c) => c && !c.startsWith("tone-") && c !== "toned");
    s.className = [...rest, toned ? "toned" : "", toneClass(options, current)].filter(Boolean).join(" ");
  };
  // `onchange` is called with the select as `this`, which is the contract every caller
  // has been written against since this picker had one — several read the new value as
  // `this.value`. That used to happen by itself: the handler was the listener, so a
  // browser called it with the element as `this`. v121 wrapped it in an arrow to repaint
  // the tone, and an arrow cannot carry a `this`, so every one of those handlers has
  // been throwing on its first line since — the picker still changed on screen, so
  // nothing looked broken, and the code after the throw simply never ran.
  s.addEventListener("change", () => { current = s.value; paint(); if (onchange) onchange.call(s); });
  paint();
  return s;
}

export function fmtQty(n, unit) {
  const rounded = Math.round((Number(n) || 0) * 1000) / 1000;
  return `${rounded}${unit}`;
}

export function fillMeter(total, capacity) {
  const ratio = capacity > 0 ? total / capacity : 0;
  const exceeded = total > capacity;
  const pct = Math.min(100, Math.max(4, ratio * 100));
  const fill = el("div", { class: `meter-fill${exceeded ? " over" : ""}`, style: `width:${pct}%` });
  return el("div", { class: `meter${exceeded ? " over" : ""}` },
    fill,
    el("span", { class: "meter-label" }, `${total}/${capacity}`));
}

export function badge(status) {
  const map = {
    open: ["Open", "badge-open"],
    closed: ["Closed", "badge-closed"],
    past: ["Past", "badge-past"],
    full: ["Full", "badge-full"],
    over: ["Over", "badge-over"],
  };
  const [label, cls] = map[status] || [String(status), "badge-past"];
  return el("span", { class: `badge ${cls}` }, label);
}

export function emptyState(title, hint) {
  return el("div", { class: "empty" },
    el("p", { class: "empty-icon" }, "🐾"),
    el("h3", {}, title),
    hint ? el("p", { class: "muted" }, hint) : null);
}

// ⚠️⚠️ AND IT CAN OFFER A SECOND REAL ANSWER (v577). ⭐ A question like "has the extra been paid too?"
// has no neutral Cancel — closing the card would leave her question unanswered while the order saves
// either way. ⚠️ `onNo` makes the left-hand button an ANSWER (`noLabel`) instead of a dismissal, so both
// outcomes are spoken rather than one being the absence of a press.
export function confirmDialog(message, onYes, { danger = false, yesLabel = "Confirm", onNo = null, noLabel = "Cancel" } = {}) {
  const layer = document.getElementById("confirm-layer");
  const textId = `confirm-text-${++popupSeq}`;
  const card = el("div", {
    class: "confirm-card", role: "alertdialog", "aria-modal": "true", "aria-labelledby": textId, tabindex: "-1",
  },
    el("p", { class: "confirm-text", id: textId }, message),
    el("div", { class: "confirm-actions" },
      // ⚠️⚠️ THE ACTION RUNS BEFORE FOCUS IS HANDED BACK (v595). ⚠️ `close()` restored it first, and a delete's
      // re-render then removed that control — ⚠️ **focus fell to `<body>`, the very fault v591 set out to fix.**
      // ⭐ Close and act, then restore only what is still on the page.
      button(noLabel, () => { close({ restore: false }); try { if (onNo) onNo(); } finally { restoreOpener(); } }, "ghost"),
      button(yesLabel, () => { close({ restore: false }); try { onYes(); } finally { restoreOpener(); } }, danger ? "danger" : "primary")));
  // ⚠️ THE CONTROL THAT OPENED THE QUESTION GETS THE KEYBOARD BACK WHEN IT CLOSES (v591).
  const opener = (typeof document !== "undefined" && document.activeElement) || null;
  layer.replaceChildren(card);
  layer.hidden = false;
  // ⚠️ The same two gaps a pop-up had (v566): no Escape, and focus left where it was.
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    trapTab(e, card);
  };
  card.addEventListener("keydown", onKey);
  try { card.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
  function restoreOpener() {
    try {
      // ⚠️⚠️ A DIALOG THE ACTION OPENED KEEPS THE KEYBOARD (v599). ⚠️ "Save it" opens the refund card before
      // this runs, and the title fallback then took focus OUT of the card it had just opened — ⚠️ **the refund
      // sheet was on screen with its first control skipped and the keyboard nowhere near it.** ⭐ If focus is
      // already inside another VISIBLE dialog, leave it exactly where the action put it.
      const active = typeof document !== "undefined" ? document.activeElement : null;
      if (active && active !== opener && insideOpenCard(active)) return;
      if (opener && opener.focus && opener.isConnected !== false) { opener.focus({ preventScroll: true }); return; }
      // ⚠️⚠️ AND WHEN THE ACTION REBUILT THE SCREEN, FOCUS GOES SOMEWHERE SAID (v598). ⚠️ A delete's re-render
      // removes the control that opened the question, so focus fell to `<body>` and the next Tab started at the
      // top — ⚠️ **the very fault v591 set out to fix.** ⭐ The screen's own title takes the keyboard.
      const title = typeof document !== "undefined" && document.getElementById && document.getElementById("view-title-text");
      if (title && title.focus) {
        if (typeof title.setAttribute === "function") title.setAttribute("tabindex", "-1");
        title.focus({ preventScroll: true });
      }
    } catch { /* no focus in a shim */ }
  }
  function close({ restore = true } = {}) {
    card.removeEventListener("keydown", onKey);
    layer.hidden = true;
    layer.replaceChildren();
    if (restore) restoreOpener();
  }
}

// ⚠️ IS THIS NODE INSIDE A VISIBLE CARD? (v599) — read from the layers themselves, because a node removed
// from a closed layer is still `document.activeElement` for one instant and must not count.
function insideOpenCard(node) {
  if (!node || typeof document === "undefined" || typeof document.getElementById !== "function") return false;
  for (const id of ["confirm-layer", "popup-layer"]) {
    const layer = document.getElementById(id);
    if (!layer || layer.hidden !== false || !layer.children) continue;
    const stack = Array.from(layer.children);
    while (stack.length) {
      const n = stack.pop();
      if (!n) continue;
      if (n === node) return true;
      if (n.children) stack.push(...Array.from(n.children));
    }
  }
  return false;
}

// A card opens over the screen it is about, and on a phone it covers the very
// thing she opened it to decide about: the batch clock sits over the bars it
// moves. So a card's own title bar is a handle — every card's, because the head
// is the same strip on all of them, and a card that looked identical but refused
// to move is a difference she would only find by trying it twice.
//
// The position is not remembered. A card is built fresh by showPopup, so the next
// one opens where cards have always opened: the drag is a way to push a card
// aside while she works, not a setting.
//
// The card moves by a transform, which leaves the layer's own layout untouched.
// What keeps that honest is the clamp. A transformed box still counts toward a
// scroller's scrollable overflow, so a card dragged past the edge would hand
// .popup-layer a scroll surface it has never had — and she could then scroll her
// own close button off the top, where no finger reaches it. Holding the whole card
// inside the layer contributes no overflow at all and means no control can ever be
// parked out of reach. On a phone the card is already nearly the full width, so the
// travel she gets is vertical, which is the axis she wants.
function dragByHead(card, head, layer) {
  let dx = 0;
  let dy = 0;
  let start = null;

  const finish = () => {
    // Implicit release would cover it, but every other drag in this app releases
    // explicitly and there is no reason for this one to be the exception.
    if (start) {
      try { head.releasePointerCapture(start.id); } catch { /* already gone */ }
    }
    start = null;
    head.classList.remove("dragging");
  };

  head.addEventListener("pointerdown", (e) => {
    // The close button lives on this strip. A press on it is a press on the
    // button, not on the handle — and it has to stay that way, because a captured
    // pointer would send the button's own click somewhere else. No card in the app
    // puts anything else in its head today; the guard is what keeps that true if
    // one ever does.
    if (e.target && e.target.closest &&
        e.target.closest("button, input, select, textarea, label, a")) return;
    // On a phone a long press on the title raises the selection callout, which
    // fires pointercancel and kills the drag in her hand.
    e.preventDefault();
    const box = layer.getBoundingClientRect();
    const at = card.getBoundingClientRect();
    // `at` already includes whatever an earlier drag left behind, so the card's
    // own untouched corner is that rect less the offset in force. Reading the rect
    // again mid-drag would count the offset twice and the card would run away.
    start = {
      id: e.pointerId, x: e.clientX, y: e.clientY, dx, dy, box,
      left: at.left - dx, top: at.top - dy, width: at.width, height: at.height,
    };
    head.classList.add("dragging");
    // A pointer already gone by the time this runs cannot be captured, and it
    // throws rather than saying so — but the drag works either way, so losing the
    // capture must not lose the drag with it.
    try { head.setPointerCapture(e.pointerId); } catch { /* older engine, or a pointer already gone */ }
  });

  head.addEventListener("pointermove", (e) => {
    if (!start) return;
    const s = start;
    let nx = s.dx + (e.clientX - s.x);
    let ny = s.dy + (e.clientY - s.y);
    // A little air, so a card parked against the edge does not read as cropped by it.
    const air = 6;
    const loX = s.box.left + air - s.left;
    const hiX = s.box.right - s.width - air - s.left;
    const loY = s.box.top + air - s.top;
    const hiY = s.box.bottom - s.height - air - s.top;
    // A card as wide or as tall as the screen has nowhere to go. An inverted range
    // means exactly that, and it is not a fault to clamp away — the clamp stands
    // down and the card sits where the layer puts it.
    if (loX <= hiX) nx = Math.min(Math.max(nx, loX), hiX);
    if (loY <= hiY) ny = Math.min(Math.max(ny, loY), hiY);
    dx = nx;
    dy = ny;
    card.style.transform = `translate(${dx}px, ${dy}px)`;
  });

  head.addEventListener("pointerup", finish);
  head.addEventListener("pointercancel", finish);
}

// ── Dragging a row into a new position among its own group ───────────────────
//
// Two screens reorder with this: Categories (a category among its brothers) and
// Products (a product among its heading's products, or among the ones no heading
// carries). It lives here now that it has two consumers rather than beside one
// of them, because two copies of one gesture drift apart — the second screen
// would slowly stop behaving like the first.
//
// What the caller supplies:
//   row          the element that moves (it must be a child of `box`)
//   handle       the grip inside it; the pointer events are bound here
//   boxOf()      the element whose children are the rows. A function rather
//                than the element, because a row is usually wired before it is
//                put in the list and so has no parent yet
//   rowSelector  the class that marks a row as one of this list's rows, so a
//                heading or a card of another kind between them is not one
//   kin(n)       may a drop land among this row? (the Categories screen asks
//                whether it is a brother; the Products screen whether it is the
//                same heading's)
//   onDrop(slot) called with the position among the kin that the bar has been
//                showing all along, so the model and the picture cannot disagree
//
// The drop is marked with a BAR on the row it would land above, never with a gap
// pushed into the list: a gap in the flow moves every row below it on each
// pointer sample, which both jitters under the finger and shifts the very
// midpoints the next sample is measured against.
export const ROW_MARKS = ["row-dim", "row-above", "row-below"];

export function wireRowReorder({ row, handle, boxOf, rowSelector, kin, onDrop }) {
  const otherRows = () => [...boxOf().children]
    .filter((n) => n !== row && n.classList && n.classList.contains(rowSelector));
  const kinRows = () => otherRows().filter((n) => kin(n));

  let drag = null;
  // ⚠️ WHETHER THIS GESTURE WAS A DRAG OR A PRESS (v477) — read by the click guard at the foot.
  let moved = false;

  const clearMarks = () => {
    for (const n of boxOf().children) n.classList.remove(...ROW_MARKS);
  };

  const finish = () => {
    if (!drag) return;
    // Everything the drag put on the screen comes off however it ended: a
    // cancelled pointer must not leave a row floating over the list.
    try { handle.releasePointerCapture(drag.pointerId); } catch { /* already gone */ }
    row.classList.remove("dragging");
    row.style.transform = "";
    clearMarks();
    drag = null;
  };

  const mark = () => {
    clearMarks();
    row.classList.add("dragging");
    // Every row that is not kin dims: dropping among them would do nothing, so
    // the reach of the grip is visible before she lets go rather than after.
    const near = new Set(kinRows());
    for (const n of otherRows()) if (!near.has(n)) n.classList.add("row-dim");
  };

  const drop = () => {
    const rest = kinRows();
    const anchor = rest[drag.slot] || null;
    onDrop(drag.slot, rest.map((n) => n.dataset.id));
    // The node is moved to match — never a re-render of the list, which would
    // throw every row back to its start and take the page's scroll with it.
    if (anchor) boxOf().insertBefore(row, anchor);
    else if (rest.length) boxOf().insertBefore(row, rest[rest.length - 1].nextElementSibling || null);
    row.style.transform = "";
    finish();
  };

  handle.addEventListener("pointerdown", (e) => {
    if (e.button != null && e.button !== 0) return;
    // On a phone a long press on the grip raises the selection callout, which
    // fires pointercancel and kills the drag in her hand.
    e.preventDefault();
    const at = row.getBoundingClientRect();
    drag = { pointerId: e.pointerId, y: e.clientY, top: at.top, height: at.height, slot: 0, marked: false };
    moved = false;
    mark();
    try { handle.setPointerCapture(e.pointerId); } catch { /* older engine, or a pointer already gone */ }
  });

  handle.addEventListener("pointermove", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    // A thumb that has travelled this far is dragging, not pressing. ⚠️ The threshold is what keeps
    // a genuine tap — a thumb always jitters a pixel or two — from being read as a drag.
    if (Math.abs(e.clientY - drag.y) > 6) moved = true;
    row.style.transform = `translateY(${e.clientY - drag.y}px)`;
    const mid = drag.top + (e.clientY - drag.y) + drag.height / 2;
    const rest = kinRows();
    let slot = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const r = rest[i].getBoundingClientRect();
      if (mid < r.top + r.height / 2) { slot = i; break; }
    }
    if (slot === drag.slot && drag.marked) return;
    drag.slot = slot;
    drag.marked = true;
    mark();
    // The bar goes above the row it would land above, or under the last one when
    // it would land at the end of the group.
    if (rest[slot]) rest[slot].classList.add("row-above");
    else if (rest.length) rest[rest.length - 1].classList.add("row-below");
  });

  handle.addEventListener("pointerup", (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drop();
  });
  handle.addEventListener("pointercancel", finish);

  // ⚠️⚠️ A DRAG MUST NOT ALSO READ AS A PRESS (v477). `setPointerCapture` retargets the pointerup to
  // this grip, so the browser dispatches a `click` on it after every drop — and on a row that is ALSO
  // tappable that click bubbles up and opens the editor she just dragged.
  //
  // Her words when the money lists asked for a handle: __"make me a handle, and the handle rule is a
  // universal one."__ ⭐ **A rule about handles is a rule about every handle**, so this guard lives
  // here beside the gesture rather than in each row remembering to defend itself — the file's own
  // reason for owning the gesture at all.
  //
  // ⚠️ `moved` is cleared on the NEXT pointerdown rather than in `finish()`, because `finish()` runs
  // BEFORE the click arrives: clearing it there would let every drop through.
  handle.addEventListener("click", (e) => {
    if (!moved) return;
    e.stopPropagation();
    moved = false;
  });
}

// ── NOTHING MOVES UNDER HER THUMB ────────────────────────────────────────────
//
// The app's own anchor-and-delta rule, and it belongs here rather than in either of the two
// screens that now use it, because it is a fact about the LAYERS, not about a card.
//
// The problem it solves, in her words, twice: "once i click reset pin the screen jump" and
// "when i say look this address up, why the interface jump out of the page?" A press that
// reveals an answer inserts text, rows or a map ABOVE something else, and whatever is below
// the insertion is pushed down the screen by exactly the height added. Nothing in the browser
// compensates for that, because the browser has no idea which part of the card she was
// looking at.
//
// So: name the node she is watching, measure its screen `top`, let the repaint happen, and
// scroll its container by however far it moved. The correction is the app's own idiom, not an
// invention — orders.js does it for the row the baker is acting on, scenario.js for its inner
// containers, and showPopup's refresh above for a wholesale rebuild.

// WHICH container actually scrolls this node. Found BY HAND rather than with `closest()`,
// because the app has two scrollers and a selector the browser answers but a test's stand-in
// screen does not is a rule the tests cannot see. `.popup-body` is the pop-up's own; anything
// else scrolls the document.
export function scrollerFor(node) {
  for (let n = node && node.parentNode; n; n = n.parentNode) {
    if (n.nodeType !== 1) continue;
    if (` ${String(n.className || "")} `.includes(" popup-body ")) return n;
  }
  return document.scrollingElement || document.documentElement;
}

// ONE CALL, ONE CORRECTION — and a press may set off several of these in a row, which is safe
// because each call measures its own "before" through the scroll the last one left behind.
// What would NOT be safe is NESTING them: an inner call would move the scroll and the outer
// would then add its own stale delta on top, ending up twice as far from her. So this wraps
// ONE function per call site, and the tests that drive a real press assert the anchor lands
// back on its exact pixel — an overshoot is how nesting would show itself.
export function keepStill(anchor, fn) {
  // No rect to measure: the repaint runs and nothing is corrected. A stand-in screen with no
  // layout answers this way, deliberately, and this must never be the thing that throws on a
  // phone whose node has gone.
  if (!anchor || !anchor.getBoundingClientRect) { fn(); return; }
  const was = anchor.getBoundingClientRect().top;
  fn();
  // The anchor has to still be on the page to have a spot worth defending, and a node that
  // left it has no viewport position at all.
  if (!anchor.isConnected) return;
  const scroller = scrollerFor(anchor);
  if (!scroller) return;
  const moved = anchor.getBoundingClientRect().top - was;
  if (moved) scroller.scrollTop += moved;
}

// A reusable centered pop-up (used for editing an order). Layers over the whole
// screen with a dimmed scrim; `makeBody(refresh, close)` is called to (re)fill
// the scrollable body, so callers re-invoke `refresh()` after changing anything
// that should re-render the form (e.g. adding an item row). Returns close().
// ⚠️ Unique ids for the title a dialog points at; two cards are never on screen at once, but the
// counter keeps a stale id from ever matching a new card.
let popupSeq = 0;

export function showPopup(title, makeBody, { wide = false, onTitle = null, className = "" } = {}) {
  const layer = document.getElementById("popup-layer");
  if (!layer) return () => {};
  // ⚠️ AND THE CONTROL THAT OPENED THE CARD GETS THE KEYBOARD BACK (v591).
  const opener = (typeof document !== "undefined" && document.activeElement) || null;
  let closeFn = null;
  const close = () => {
    // ⚠️ The Escape listener lives on the LAYER, not the page: the card is focused, so a key press
    // bubbles to it, and a shim that has no `document.addEventListener` still works.
    const f = closeFn; closeFn = null;
    if (f) f();
    layer.hidden = true;
    layer.replaceChildren();
    try { if (opener && opener.focus && opener.isConnected !== false) opener.focus({ preventScroll: true }); } catch { /* gone */ }
  };
  const body = el("div", { class: "popup-body" });
  // Repainting a pop-up replaces the body wholesale, which is fine for a short
  // card but not for one tall enough to scroll: emptying the body drops its scroll
  // to the top, so a repaint while she is working down a long card throws her back
  // to the top of it. Keep where she was reading.
  //
  // AND A CARD MAY HAND BACK A LIST (v195). `replaceChildren` is VARIADIC: a single
  // array argument is neither a node nor a string, so the DOM converts it with
  // String() and the card draws the words "[object HTMLParagraphElement],[object
  // HTMLDivElement],…" — every element it was handed thrown away, and no control left
  // to press. The pickup-pin card shipped exactly that way: `openPlacePicker` returns
  // its seven elements as a list, its card drew nothing but the text, and there was no
  // test on that screen to catch it. `el()` next door already flattens a list of
  // children, so the two builders agree now and the list is spread here rather than at
  // every call site.
  const refresh = () => {
    const keepTop = body.scrollTop;
    const made = makeBody(refresh, close);
    body.replaceChildren(...(Array.isArray(made) ? made : [made]));
    // ⚠️ A CARD'S BOXES ARE NAMED TOO (v566) — the Edit forms live here, not on a screen the router draws.
    try { nameFields(body); } catch { /* an unnamed box is not a dead card */ }
    body.scrollTop = keepTop;
  };
  // ★★★ A CARD IS A DIALOG, AND IT SAYS SO (v566). ⚠️⚠️ The title was a plain div and the card had no
  // role, so a screen reader announced an unnamed region and the most-used control in the app was read as
  // "✕". ⭐ `role="dialog"` + `aria-modal` + a title the card points at is what makes it a card, and the
  // close button now has a name. ⚠️ Escape closes it, because a keyboard user had no way out but Tab.
  const titleId = `popup-title-${++popupSeq}`;
  const titleEl = el("div", { class: "popup-title", id: titleId }, title);
  // The card's heading is built once and never repainted, which is right for every
  // card whose heading is a name it was opened with. The one card whose heading
  // follows something she is still typing — the person's name — takes the node and
  // rewrites it itself, because there is no other way to reach a heading that lives
  // outside the body the card is free to rebuild.
  if (onTitle) onTitle(titleEl);
  const closeBtn = el("button", { class: "btn ghost small", type: "button", "aria-label": "Close", onclick: close }, "✕");
  const head = el("div", { class: "popup-head" }, titleEl, closeBtn);
  // ⚠️ A CARD MAY NAME ITSELF (v390), so a stylesheet can size THAT card without a rule broad enough to
  // move every other one. Her words: __"can optimise for desktop as well"__ — the stock card is a
  // table, and a table is the one thing that gets better with width.
  const card = el("div", {
    class: `popup-card${wide ? " wide" : ""}${className ? ` ${className}` : ""}`,
    role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, tabindex: "-1",
  }, head, body);
  layer.replaceChildren(card);
  layer.hidden = false;
  // ⚠️ Escape, on the layer itself, and only while this card is the one on screen.
  const onKey = (e) => {
    // ⚠️ `firstChild` in a browser, `children[0]` in a shim — one answer, read the same way.
    const top = layer.firstChild || (layer.children && layer.children[0]) || null;
    if (layer.hidden || (top && top !== card)) return;
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    trapTab(e, card);
  };
  layer.addEventListener("keydown", onKey);
  closeFn = () => layer.removeEventListener("keydown", onKey);
  try { card.focus({ preventScroll: true }); } catch { /* no focus in a shim */ }
  dragByHead(card, head, layer);
  refresh();
  return close;
}

// A thrown value said as a sentence. A browser throws Errors, so an Error's own message is
// what belongs on the screen; a bare string is taken at its word. Anything ELSE is refused a
// voice: String() on an object prints "[object Object]", and that is the v195 fault — a word
// on her screen that is the app's own plumbing rather than a fact. A value with nothing to
// say gets the honest sentence instead.
export function saidOf(err) {
  const raw = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const t = String(raw || "").trim();
  return t ? `${t.replace(/\.?$/, "")}.` : "the app could not say what went wrong.";
}

// A press that cannot leave its button dead (v217).
//
// The app's own contract for a service outside it is that a call never throws — "a thrown
// error [at a button in a pop-up she pressed while standing in a kitchen] is a dead screen
// with no words on it" (couriers/api.js). That contract covers the CHANNEL. The guard in
// front of the channel is the screen's own, and every press that asked a courier held a flag
// (`busy`, `jobBusy`) which it set before its first await and cleared again on each of its
// own ways out. Anything that threw in between left the flag set, and a set flag makes every
// later press return at once, with nothing said, on a button still grey. That is the shape
// of fault the baker reported as "the get price from lalamove not responding", and it is the
// one thing this helper exists to make impossible: `hold` releases the flag and the button
// comes back whatever happened, and a throw is SAID rather than swallowed.
//
// `btn` is optional because a press can wait on a card of her own, whose yes-button is the
// dialog's and not ours. `said` is where the sentence goes; it is required, so a call site
// cannot quietly go back to swallowing.
export async function guarded({ btn = null, hold, work, said, trouble }) {
  hold(true);
  if (btn) btn.disabled = true;
  try {
    await work();
  } catch (err) {
    said(`${trouble} — ${saidOf(err)}`);
  } finally {
    hold(false);
    if (btn) btn.disabled = false;
  }
}

// ⚠️⚠️ A PRESS THAT CANNOT PRINT SAYS SO (v592). ⚠️ The journal had this guard; the purchase order and the
// expense history called `window.print()` bare — ⚠️ **on a browser without printing the press threw, and with
// it silently did nothing.** ⭐ One guard, the same sentence the journal uses.
export function printPage() {
  if (typeof window !== "undefined" && typeof window.print === "function") {
    // ⚠️ A print that THROWS says so (v598) — a defined-but-broken print used to leave the press silent.
    try { window.print(); return true; }
    catch { toast("This phone couldn't print — use Share instead."); return false; }
  }
  toast("This phone can't print — use Share instead.");
  return false;
}

export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    // ⚠️⚠️ A TOAST NOBODY ANNOUNCES IS A SILENT SAVE (v566). ⭐ Every "Saved" was invisible to a screen
    // reader: a plain div that appears and leaves. `role="status"` is the polite announcement, which is
    // the right weight for a confirmation she does not have to act on.
    t = el("div", { class: "toast", role: "status", "aria-live": "polite" });
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove("show"), 2200);
}

// Copy to the clipboard, sharing the app's pattern for "what if it fails":
// fall back to a pop-up with a selectable textarea (never prompt(), which can't
// hold long text on a phone). Toast shows okMsg on success.
export function copyText(text, okMsg = "Copied") {
  const success = () => toast(okMsg);
  const fallback = () => {
    const box = el("textarea", { class: "input", readonly: true, value: String(text),
      style: "width:100%;min-height:160px" });
    showPopup(el("div", { class: "popup-title-row" }, "Copy this"), (refresh, close) =>
      el("div", {},
        el("p", { class: "card-sub", style: "margin:0 0 8px" },
          "Your phone couldn't copy automatically. Long-press the box, select all, then Copy."),
        box,
        el("div", { class: "popup-actions" }, button("Close", close, "primary"))), { wide: true });
  };
  const via = (p) => p.then(success).catch(fallback);
  if (navigator.clipboard) via(navigator.clipboard.writeText(String(text)));
  else fallback();
}
