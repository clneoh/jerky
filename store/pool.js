// pool.js — shared availability pool + per-product delivery-date rules for the
// customer page. Pure module: no DOM, no network — runs under Node for tests.
//
// A value pack (e.g. "Focaccia Family (4 pcs)") draws from the SAME daily pool
// as its base product (the single Focaccia). The backoffice publishes the pool
// in two pieces: an availability row for the base keyed by its own name (the
// pieces left that day), and a `component: {name, qty}` marker on the pack's
// menu entry. This module turns those into honest caps so one cart can never
// order more pieces of a base than remain — 3 packs + 3 singles on a 12-piece
// pool is clamped, never sent.

const DAY_MS = 86400000;

// "YYYY-MM-DD" shifted by whole days. Parsed as UTC (Malaysia has no DST, so
// calendar days line up with the local keys app.js builds).
export function addDaysKey(key, days) {
  const [y, m, d] = String(key || "").split("-").map(Number);
  if (!y || !m || !d) return "";
  return new Date(Date.UTC(y, m - 1, d) + days * DAY_MS).toISOString().slice(0, 10);
}

function isDayKey(k) {
  return typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);
}

// How many days before delivery a product's orders close. Entirely the
// product's own closeDays: a number ≥ 0 wins, and blank (or any product that
// isn't one of ours) means no early close at all — every delivery date is open.
export function closeDaysFor(product) {
  const p = product || {};
  const n = p.closeDays;
  if (n != null && Number.isInteger(Number(n)) && Number(n) >= 0) return Number(n);
  return 0;
}

// How many days before delivery a customer may still change or cancel this
// product's order — the baker's stated window, nothing enforced. Blank (or a
// product that isn't ours) has no window: it returns null and never drags a
// mixed order's window down. 0 is a stated value ("no advance limit"), and only
// participates as the most generous end of a mixed order.
export function cancelDaysFor(product) {
  const p = product || {};
  const n = p.cancelDays;
  // An empty or whitespace-only box is blank, not a zero: Number("") is 0, so
  // guard the string case before the numeric test below.
  if (n == null || (typeof n === "string" && n.trim() === "")) return null;
  if (Number.isInteger(Number(n)) && Number(n) >= 0) return Number(n);
  return null;
}

// The single window a mixed order states: the STRICTEST (largest day count)
// among the products that state one — a customer with a 3-day product in the
// basket must ask at least 3 days ahead. null when no product states a window.
export function strictestCancelDays(products) {
  let out = null;
  for (const p of products || []) {
    const n = cancelDaysFor(p);
    if (n != null && (out == null || n > out)) out = n;
  }
  return out;
}

// Why this product can't be ordered for this delivery date — null when it is
// open. The rules are optional and per product: a fixed from–to window of
// delivery dates, and/or orders closing N days before delivery. Blank products
// (value packs included) are open on any date. Unknown dates never lock a
// product.
//
// The RULE comes back as data, never as a sentence: the customer page writes it
// in the visitor's language, and formats the date itself — an English weekday
// baked in here would leak into the Chinese and Malay pages.
//
//   { kind: "from",  date: "YYYY-MM-DD" }  earlier than the window opens
//   { kind: "to",    date: "YYYY-MM-DD" }  later than the window closes
//   { kind: "close", days: N }             inside the window, but too near
export function closedReason(product, dateKey, todayKey) {
  if (!dateKey || !todayKey) return null;
  const p = product || {};
  const from = isDayKey(p.validFrom) ? p.validFrom : "";
  const to = isDayKey(p.validTo) ? p.validTo : "";
  if (from && dateKey < from) return { kind: "from", date: from };
  if (to && dateKey > to) return { kind: "to", date: to };
  const close = closeDaysFor(p);
  if (close > 0 && dateKey < addDaysKey(todayKey, close)) return { kind: "close", days: close };
  return null;
}

// Group the storefront products that share one pool. A value pack carries
// component: {name, qty} (published only when its recipe is exactly qty × an
// active, limited base). The base product itself joins as a member with n = 1,
// so a cart mixing singles and packs shares a single budget. Returns a Map
// baseName → { baseName, members: [{name, n}] }, members sorted n-descending
// so a budget shortfall clamps a whole pack before loose singles.
export function poolGroups(products) {
  const map = new Map();
  for (const p of products || []) {
    const c = p && p.component;
    const baseName = c && String(c.name || "").trim();
    const n = c ? Number(c.qty) : 0;
    if (!baseName || !(n > 1)) continue; // n = 1 would just be the base itself
    let g = map.get(baseName);
    if (!g) { g = { baseName, members: [] }; map.set(baseName, g); }
    g.members.push({ name: String(p.name).trim(), n });
  }
  for (const p of products || []) {
    const g = map.get(String(p.name).trim());
    if (!g || g.members.some((m) => m.name === String(p.name).trim())) continue;
    g.members.push({ name: String(p.name).trim(), n: 1 });
  }
  for (const g of map.values()) g.members.sort((a, b) => (b.n - a.n) || (a.name < b.name ? -1 : 1));
  return map;
}

// The group a product belongs to, or undefined. A pack names its base through
// component; the base product has no component and matches by its own name.
export function groupFor(groups, product) {
  const name = String((product && (product.component ? product.component.name : product.name)) || "").trim();
  if (!name) return undefined;
  const g = groups.get(name);
  return g && g.members.some((m) => m.name === String(product.name).trim()) ? g : undefined;
}

// Max units of each member the customer may hold next to the rest of their
// cart: cap(m) = floor((baseLeft − Σ other members' pieces) / n). Own qty is
// not subtracted, so the + button may top the member up to this cap. When there
// is no live base row (baseLeft undefined) the pool is unlimited today — every
// member maps to undefined, meaning no cap and no stamp.
export function poolCaps(group, baseLeft, cart) {
  const caps = new Map();
  if (baseLeft == null) {
    for (const m of group.members) caps.set(m.name, undefined);
    return caps;
  }
  let pieces = 0;
  for (const m of group.members) pieces += (cart.get(m.name) || 0) * m.n;
  for (const m of group.members) {
    const others = pieces - (cart.get(m.name) || 0) * m.n;
    caps.set(m.name, Math.max(0, Math.floor((baseLeft - others) / m.n)));
  }
  return caps;
}

// The base pieces a cart's value packs consume, for the order payload. Packs
// only (a base sold directly is already a top-level order line — never listed
// here), aggregated per base: [{name: base product name, qty: Σ pack qty × n}].
// Empty when the cart has no packs. Never adds to the order's total or count.
export function poolPieces(products, cart) {
  const out = [];
  for (const p of products || []) {
    const c = p && p.component;
    const inCart = (cart && cart.get ? cart.get(p.name) : 0) || 0;
    if (!c || !inCart) continue;
    let row = out.find((x) => x.name === c.name);
    if (!row) { row = { name: c.name, qty: 0 }; out.push(row); }
    row.qty += inCart * Number(c.qty);
  }
  return out;
}

// Enforce one shared budget on the current cart: clamp every member so
// Σ qty·n ≤ baseLeft, largest n first (deterministic — a whole pack is kept
// over loose singles when they can't all fit). Returns a Map member → clamped
// qty for this group (0 means the member leaves the cart). Empty when there is
// no live budget.
export function clampPool(cart, group, baseLeft) {
  const clamped = new Map();
  if (baseLeft == null) return clamped;
  const sorted = [...group.members].sort((a, b) => (b.n - a.n) || (a.name < b.name ? -1 : 1));
  let remaining = baseLeft;
  for (const m of sorted) {
    const qty = Math.min(cart.get(m.name) || 0, Math.floor(remaining / m.n));
    clamped.set(m.name, qty);
    remaining -= qty * m.n;
  }
  return clamped;
}
