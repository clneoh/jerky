// ui.js — safe DOM building and shared render helpers.
// el() uses textContent by default so user data can never be injected as HTML.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
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
  return node;
}

export function button(text, onClick, cls = "") {
  return el("button", { class: `btn ${cls}`.trim(), onclick: onClick }, text);
}

export function select(options, value, onchange, placeholder = "") {
  const s = el("select", { onchange });
  if (placeholder) s.appendChild(el("option", { value: "", disabled: true, selected: !value }, placeholder));
  for (const o of options) {
    const opt = el("option", { value: o.value, selected: o.value === value }, o.label);
    s.appendChild(opt);
  }
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

export function confirmDialog(message, onYes, { danger = false, yesLabel = "Confirm" } = {}) {
  const layer = document.getElementById("confirm-layer");
  const card = el("div", { class: "confirm-card" },
    el("p", { class: "confirm-text" }, message),
    el("div", { class: "confirm-actions" },
      button("Cancel", () => close(), "ghost"),
      button(yesLabel, () => { close(); onYes(); }, danger ? "danger" : "primary")));
  layer.replaceChildren(card);
  layer.hidden = false;
  function close() {
    layer.hidden = true;
    layer.replaceChildren();
  }
}

// A reusable centered pop-up (used for editing an order). Layers over the whole
// screen with a dimmed scrim; `makeBody(refresh, close)` is called to (re)fill
// the scrollable body, so callers re-invoke `refresh()` after changing anything
// that should re-render the form (e.g. adding an item row). Returns close().
export function showPopup(title, makeBody, { wide = false } = {}) {
  const layer = document.getElementById("popup-layer");
  if (!layer) return () => {};
  const close = () => {
    layer.hidden = true;
    layer.replaceChildren();
  };
  const body = el("div", { class: "popup-body" });
  const refresh = () => body.replaceChildren(makeBody(refresh, close));
  const card = el("div", { class: `popup-card${wide ? " wide" : ""}` },
    el("div", { class: "popup-head" },
      el("div", { class: "popup-title" }, title),
      button("✕", close, "ghost small")),
    body);
  layer.replaceChildren(card);
  layer.hidden = false;
  refresh();
  return close;
}

export function toast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = el("div", { class: "toast" });
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
