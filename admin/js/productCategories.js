// productCategories.js — the shop's category tree, as a pure module so the
// screen that edits it, the product editor that files a product into it, the
// publish to the customer page and the tests all read the same rules.
//
// A category is a FLAT record carrying its parent's id, not a node with a
// children array:
//
//   { id, name, nameZh?, nameMs?, parentId: "" | <catId>, sort: 0, productOrder?: [prdId] }
//
// Flat, because the cloud sync carries whole records keyed by id (sync.js
// computeRecords): a nested tree has no per-node id, so one edit anywhere would
// rewrite a single giant record and two phones editing different branches would
// clobber each other. parentId also means any depth falls out for free — For Dog
// › Treats › Pork is just three records pointing at each other.
//
// ORDER IS A STORED NUMBER, never the array position. computeRecords emits one
// record per row keyed by id, so a row's POSITION in state.productCategories
// never travels between phones; only a field inside the record does. `sort` is
// that field, renumbered 0..n-1 across a parent's children on every drop.
//
// Membership lives on the PRODUCT (product.categories = [catId, ...], ordered,
// first = the primary one), not on the category. One write site (the product
// editor), no sweep when a product is deleted, and deleting or renaming a
// category never touches product data.

const byId = (list, id) => (list || []).find((c) => c && c.id === id) || null;

// A category's parent as an id, with "" meaning a top-level category. Written
// through one helper so a missing parentId never reaches a comparison as
// undefined (which would quietly make a root look like a child of nothing).
export function parentOf(cat) {
  return cat && typeof cat.parentId === "string" ? cat.parentId : "";
}

// The children of one parent, in your order. Ties break on id so two
// records that have never been dragged still come out in a stable order on
// every phone rather than the order the sync happened to deliver them in.
export function childrenOf(list, parentId = "") {
  const want = typeof parentId === "string" ? parentId : "";
  return (list || [])
    .filter((c) => c && c.id && parentOf(c) === want)
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.id).localeCompare(String(b.id)));
}

// Depth-first walk of the whole tree: every category once, parents before their
// children, siblings in order, each with its depth and the ids of its ancestors.
// This is the single ordering the screen, the product-editor picker and the
// shop all read, so they can never disagree about what "her order" means.
export function flattenTree(list) {
  const out = [];
  const walk = (parentId, depth, path) => {
    for (const c of childrenOf(list, parentId)) {
      out.push({ cat: c, depth, path });
      // A cycle can only exist if records were hand-edited; stopping at a depth
      // no real menu reaches keeps the walk finite instead of hanging the tab.
      if (depth < 32) walk(c.id, depth + 1, [...path, c.id]);
    }
  };
  walk("", 0, []);
  return out;
}

// Every category under `id`, plus the id itself — what a category may not be
// re-parented into (its own subtree) and what a delete must find empty before
// it is allowed through.
export function subtreeIds(list, id) {
  const seen = new Set([id]);
  let grew = true;
  // Breadth-first over parent links rather than the ordered walk, so a cycle
  // among the records cannot send this into an endless loop.
  while (grew) {
    grew = false;
    for (const c of list || []) {
      if (!c || !c.id || seen.has(c.id)) continue;
      if (seen.has(parentOf(c))) { seen.add(c.id); grew = true; }
    }
  }
  return seen;
}

// The chain from the top down to `id`, the category itself last — the words a
// heading reads when it is nested ("For Dog › Treats").
export function pathTo(list, id) {
  const chain = [];
  const seen = new Set();
  let cur = byId(list, id);
  while (cur && !seen.has(cur.id)) {
    seen.add(cur.id);
    chain.unshift(cur);
    cur = byId(list, parentOf(cur));
  }
  return chain;
}

// Move `id` to sit among `parentId`'s children at `toIndex`, and renumber that
// group's `sort` 0,1,2... A category may not be dropped inside its own subtree
// (the drop would orphan the branch from the root); that is refused by handing
// the list back untouched, so a bad drop is a no-op rather than corruption.
export function moveCategory(list, id, parentId, toIndex) {
  const cat = byId(list, id);
  if (!cat) return list;
  const parent = typeof parentId === "string" ? parentId : "";
  if (parent && !byId(list, parent)) return list;
  if (parent === id || subtreeIds(list, id).has(parent)) return list;

  const others = childrenOf(list, parent).filter((c) => c.id !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, others.length));
  const ordered = [...others.slice(0, at), cat, ...others.slice(at)];

  const moved = new Map(ordered.map((c, i) => [c.id, i]));
  return (list || []).map((c) => {
    if (!c || !c.id) return c;
    if (c.id === id) return { ...c, parentId: parent, sort: moved.get(id) };
    if (moved.has(c.id)) return { ...c, sort: moved.get(c.id) };
    return c;
  });
}

// Move one product within a category's own order and store the whole order on
// the category. The list is written in full rather than as an index, because a
// product added or deleted elsewhere must not silently shift every other row.
export function moveProductInCategory(list, catId, productId, toIndex, current) {
  const ordered = (current || []).filter((pid) => pid !== productId);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, ordered.length));
  ordered.splice(at, 0, productId);
  return (list || []).map((c) => (c && c.id === catId ? { ...c, productOrder: ordered } : c));
}

// ── The order of the products NO heading carries ("More items") ──────────────
//
// A category's order lives on the category (`productOrder`, above). The unfiled
// products have no such record to hold theirs, so it lives on each product as
// `sort` — still a stored FIELD rather than the array position, for the reason
// the file header gives: sync carries whole records keyed by id, so a row's
// position in state.products never travels between her phones.
//
// A product she has never dragged has no `sort` and keeps the order it was
// stored in, which is exactly how this list was drawn before it could be
// dragged — so nothing moves under her on the day this arrives.
export function tailOrder(products) {
  const list = Array.isArray(products) ? products : [];
  const rank = (p) => (p && Number.isFinite(Number(p.sort)) ? Number(p.sort) : Number.MAX_SAFE_INTEGER);
  if (!list.some((p) => rank(p) !== Number.MAX_SAFE_INTEGER)) return list.slice();
  // Ties keep the order they arrived in: Array.sort is stable, so the rows she
  // has not dragged stay where they were rather than shuffling among themselves.
  return list.slice().sort((a, b) => rank(a) - rank(b));
}

// Move one product to `toIndex` among the products no heading carries, writing
// the whole order onto the products themselves. Written in full rather than as
// an index, for the same reason a category's order is: a product added, filed or
// deleted elsewhere must not silently shift every other row.
export function moveInTail(products, id, toIndex, current) {
  const ordered = (current || []).filter((pid) => pid !== id);
  const at = Math.max(0, Math.min(Number(toIndex) || 0, ordered.length));
  ordered.splice(at, 0, id);
  const rank = new Map(ordered.map((pid, i) => [pid, i]));
  return (products || []).map((p) => (p && rank.has(p.id) ? { ...p, sort: rank.get(p.id) } : p));
}

// The index a drop lands at, counted in the FULL order rather than in the list
// on screen. The two differ, and that is the whole reason this exists: the
// Products screen draws one state's products at a time (On the shop, or Draft,
// or Hidden) while the order it writes covers every product in that same place,
// whatever state it is in. A slot counted on screen would land in the wrong row
// among the products it cannot see — it could even push them all to the end.
//
// The anchor is therefore named by ID and looked up in the full list. `slot` is
// the position among `kinIds` (the rows the bar moved over, in screen order),
// and `slot === kinIds.length` means "past the end of that run".
export function indexForDrop(fullIds, kinIds, slot) {
  const full = Array.isArray(fullIds) ? fullIds : [];
  const kin = Array.isArray(kinIds) ? kinIds : [];
  const at = Math.max(0, Math.min(Number(slot) || 0, kin.length));
  const before = kin[at] || null;
  if (before) {
    const i = full.indexOf(before);
    return i < 0 ? full.length : i;
  }
  const after = kin.length ? kin[kin.length - 1] : null;
  if (after) {
    const i = full.indexOf(after);
    return i < 0 ? full.length : i + 1;
  }
  return 0;
}

// One category's products put into the order you set: her own
// productOrder when she has dragged one, and otherwise the order they arrive in
// — which is the list's own order, so a freshly filed product lands where she
// expects rather than somewhere arbitrary.
//
// Split out from productsInCategory so a caller that has ALREADY chosen its
// list reads the same ordering rule instead of writing a second copy of it. The
// Products screen needs exactly that: it groups three state lists of its own
// (On the shop, Draft, Hidden), and each one must still come out in the order
// the shop would have shown it.
export function orderedByCategory(cat, products) {
  const list = Array.isArray(products) ? products : [];
  const order = cat && Array.isArray(cat.productOrder) ? cat.productOrder : null;
  if (!order) return list;
  const rank = new Map(order.map((pid, i) => [pid, i]));
  return list.slice().sort((a, b) => {
    const ra = rank.has(a.id) ? rank.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rb = rank.has(b.id) ? rank.get(b.id) : Number.MAX_SAFE_INTEGER;
    return ra - rb;
  });
}

// The products filed in one category, in the order you set. Products that
// no longer exist are skipped, so a deleted product never leaves a hole.
export function productsInCategory(state, catId) {
  const products = (state && Array.isArray(state.products) ? state.products : [])
    .filter((p) => p && p.id && Array.isArray(p.categories) && p.categories.includes(catId));
  return orderedByCategory(byId(state && state.productCategories, catId), products);
}

// A list of products arranged the way the SHOP arranges its menu: her headings
// in her order, depth-first, each carrying the products whose FIRST tick is that
// heading (the same rule primaryCategoryId gives the shop), and anything unfiled
// collected at the end under `cat: null`.
//
// It takes the products rather than reading state.products, because the caller
// has already chosen them — the Products screen runs this once per state list,
// so her drafts and her hidden products are arranged the same way her live ones
// are, each within its own list.
//
// A heading is left out when it holds nothing IN THIS LIST, so the On-the-shop
// section does not grow a row of headings she has no live products under, and
// the unfiled entry is left out when everything is filed. An empty return
// therefore means the list itself was empty.
export function groupByCategory(state, products) {
  const list = Array.isArray(products) ? products : [];
  const cats = state && state.productCategories;
  const out = [];
  const placed = new Set();
  for (const { cat, depth } of flattenTree(cats)) {
    const held = orderedByCategory(cat,
      list.filter((p) => p && primaryCategoryId(cats, p) === cat.id));
    if (!held.length) continue;
    out.push({ cat, depth, products: held });
    for (const p of held) placed.add(p);
  }
  // The tail is ordered by the products' OWN `sort` (tailOrder), because there
  // is no heading record to hold its order — so it must not be left in the
  // array's order, which is device-local and never travels between her phones.
  const unfiled = tailOrder(list.filter((p) => p && !placed.has(p)));
  if (unfiled.length) out.push({ cat: null, depth: 0, products: unfiled });
  return out;
}

// How many products are TICKED here, in any position — the number a delete
// refuses over and nothing else. It counts drafts and taken-down products too,
// because a delete has to answer for everything her record points at, not just
// what a customer would see.
export function productCount(state, catId) {
  return (state && Array.isArray(state.products) ? state.products : [])
    .filter((p) => p && Array.isArray(p.categories) && p.categories.includes(catId)).length;
}

// How many products this heading CARRIES — the products whose first tick is this
// category, so the ones the shop draws under it. This is the number the screen's
// row prints, because it is the one she can go and count on the customer page.
//
// It is deliberately not productCount: ticking a second category is how she
// changes which heading a product is listed under, so the heading it left keeps
// the tick and would otherwise claim a product the shop no longer draws there.
// The two answering different questions is the point — the row says what this
// heading carries, the delete guard says what her record holds.
//
// A draft or taken-down product still counts: it belongs to this heading, it is
// simply not drawn yet, which is how drafts read everywhere else in the app.
export function listedCount(state, catId) {
  return (state && Array.isArray(state.products) ? state.products : [])
    .filter((p) => p && primaryCategoryId(state && state.productCategories, p) === catId).length;
}

// The ONE heading a product is listed under: the first category she ticked on
// it. Not every category it is filed in — the tick order IS the ranking, so the
// first tick decides the heading and the rest are for her own sorting later.
//
// "A product in the 1st category is grouped first" reads as one heading per
// product, so a product filed under two never appears twice on her shop: a
// customer browsing the second heading does not find it there, and a shop that
// repeated it would show the same cake in two places with two baskets' worth of
// steppers and no obvious reason.
//
// An id whose category no longer exists is skipped rather than returned, so a
// category deleted on her other phone cannot leave a product listed under a
// heading that is not there — it falls to the next ticked one, or to the end of
// the shop under "More items", which is where unfiled products already go.
export function primaryCategoryId(list, product) {
  const filed = (product && Array.isArray(product.categories) ? product.categories : [])
    .filter((id) => !!byId(list, id));
  return filed.length ? filed[0] : "";
}
