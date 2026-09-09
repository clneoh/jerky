// views/products.js — products + recipe (BOM) editor. New products go in the
// always-visible card at the top; tapping Edit opens the same form in a pop-up
// over the screen, exactly like editing an order.

import { el, button, select, emptyState, confirmDialog, showPopup, toast } from "../ui.js";
import { byId, productUnitOptions, fmtRM, round2, newId, save } from "../state.js";
import { costOf, recipeLineCosts, validateRecipeNoCycle } from "../bom.js";
import { maybeSyncStorefront } from "../supabase.js";
import { isLive, isDraft, isHidden, newDraftRow } from "../productState.js";
import { translateAllowed, autoTranslateProduct, translateTo, LANG_OF, SRC_OF } from "../translate.js";

const ALL_VARIANTS = ["nameZh", "descZh", "unitZh", "servingZh", "nameMs", "descMs", "unitMs", "servingMs"];
const LANG_VARIANTS = { zh: ["nameZh", "descZh", "unitZh", "servingZh"], ms: ["nameMs", "descMs", "unitMs", "servingMs"] };
const LANG_LABEL = { zh: "Chinese (中文)", ms: "Bahasa Malaysia" };
const FIELD_LABEL = { name: "Name", description: "Description", unit: "Selling unit", servingTip: "Feeding tip" };

export function renderProducts(root, state) {
  renderAll(root, state);
}

function renderAll(root, state) {
  const live = state.products.filter(isLive);
  const drafts = state.products.filter(isDraft);
  const hidden = state.products.filter(isHidden);

  const form = newProductCard(state, root);

  if (!state.products.length) {
    root.replaceChildren(form,
      el("h2", { class: "section" }, "Products"),
      emptyState("No products yet",
        "Add a product and its recipe (ingredients per unit). It starts as a draft — Publish it to put it on the shop."));
    return;
  }

  const group = (title, list, hint) => {
    const rows = list.map((p) => productCard(state, p, root));
    return [
      el("h2", { class: "section" }, `${title} (${list.length})`),
      ...(rows.length ? rows : [el("p", { class: "card-sub muted", style: "margin:0 0 6px" }, hint)]),
    ];
  };

  root.replaceChildren(
    form,
    ...group("On the shop", live, "Nothing on the shop yet — publish a draft below to start selling it."),
    ...group("Draft — not on the shop yet", drafts, "New products start here as drafts. Publish one to put it on the shop."),
    ...group("Hidden — taken down", hidden, "Hidden products keep their history and recipe; nothing here is shown to customers."));
}

// Builds the fields + recipe lines once and hands back the nodes plus `collect()`
// (reads the current values). `product` is null for a new product, or the real
// object when editing — so the add card and the Edit pop-up share one builder.
function buildEditor(state, product) {
  const recipeDraft = (product && product.recipe ? product.recipe : []).map((l) => ({ ...l }));

  const name = el("input", { class: "input", placeholder: "e.g. Chicken Jerky", value: product?.name || "" });
  const unitChoices = productUnitOptions(state, product);
  const unit = select(unitChoices.options, unitChoices.value, null, "Pick a unit…");
  const price = el("input", { class: "input", type: "number", inputmode: "decimal", step: "0.01",
    placeholder: "sell price (RM, optional)", value: product?.price ?? "" });
  const limit = el("input", { class: "input", type: "number", inputmode: "numeric", min: "1",
    placeholder: "e.g. 12", value: product?.limit ?? "",
    title: "Max pouches of this product per batch/posting day. Limits are added together for the day's availability (e.g. 12 chicken + 12 duck = 24). Leave blank for no limit." });

  // Optional per-product date rules — customers can't order this product for a
  // delivery date it isn't open for. Orders close N days before delivery, and /
  // or a fixed from–to window of delivery dates. Both optional and per product:
  // blank means the product sells on any open date.
  const closeDays = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0",
    placeholder: "e.g. 14", value: product?.closeDays ?? "",
    title: "Customers must pick a delivery date at least this many days away. Blank = any open day. 0 = no early close." });
  const validFrom = el("input", { class: "input", type: "date", value: product?.validFrom || "" });
  const validTo = el("input", { class: "input", type: "date", value: product?.validTo || "" });

  // A sentence or two customers read on the shop page to know what this is.
  // Optional — blank shows nothing. Kept on the product and published with the
  // storefront menu, so it is written once here, not on the shop.
  const desc = el("textarea", { class: "input", rows: 2,
    placeholder: "e.g. Chicken jerky — soft, chewy strips, no additives",
    value: product?.description || "" });

  // A quick how-to-serve line the owner sends with the bring-a-friend follow-up
  // ("how did the {product} go?"). Admin-only — never published to the shop.
  // Optional — blank keeps the follow-up message to the referral ask only.
  const serving = el("textarea", { class: "input", rows: 2,
    placeholder: "e.g. Tear into small pieces, store sealed in a cool, dry place",
    value: product?.servingTip || "" });

  // ── Auto-translated 中文 / Bahasa Malaysia text ───────────────────────────
  // English is written once above; these lines are machine-filled from it when
  // the product is saved or published online. The "auto" tag marks machine text;
  // typing in any box makes that line hers (never overwritten again), and the ↻
  // buttons fill a single line now. Good translations are simply left alone.
  const manualSet = new Set(); // boxes the baker decided by typing or clearing
  const regen = new Set();     // boxes machine-filled during THIS edit
  const regenSrc = {};         // variant → the English each regen box was made from

  const isText = (src) => src === "description" || src === "servingTip";
  const boxes = {};
  const tags = {};
  const tagFor = (variant) => {
    const tag = el("span", { class: "trans-tag", dataset: { variant } });
    tags[variant] = tag;
    return tag;
  };
  for (const variant of ALL_VARIANTS) {
    const src = SRC_OF[variant];
    const node = el(isText(src) ? "textarea" : "input", {
      class: "input",
      rows: isText(src) ? 2 : undefined,
      placeholder: `Auto-translated ${LANG_LABEL[LANG_OF[variant]]} — blank keeps English`,
      dataset: { variant },
      value: product ? String(product[variant] ?? "") : "",
    });
    node.addEventListener("input", () => { manualSet.add(variant); refreshTags(); });
    boxes[variant] = node;
  }
  if (product) {
    for (const variant of ALL_VARIANTS) {
      if (Array.isArray(product.trOverride) && product.trOverride.includes(variant)) { manualSet.add(variant); continue; }
      const val = String(product[variant] ?? "").trim();
      if (val && !(product.trSrc && product.trSrc[variant])) manualSet.add(variant); // legacy hand-typed (v64)
    }
  }

  // The live English text a variant would be translated from ("" when blank).
  function englishSource(variant) {
    const src = SRC_OF[variant];
    if (src === "name") return name.value.trim();
    if (src === "description") return desc.value.trim();
    if (src === "servingTip") return serving.value.trim();
    if (src === "unit") { const u = byId(state.uoms, unit.value); return (u ? u.name : unit.value).trim(); }
    return "";
  }

  function machineNow(variant) {
    return !manualSet.has(variant) && String(boxes[variant].value ?? "").trim() !== ""
      && (regen.has(variant) || !!(product && product.trSrc && product.trSrc[variant]));
  }
  function refreshTags() {
    for (const variant of ALL_VARIANTS) {
      const tag = tags[variant];
      if (!tag) continue;
      tag.textContent = machineNow(variant) ? "auto" : "";
    }
  }

  async function fillLanguage(lang) {
    if (!translateAllowed()) { toast("No connection — translations fill when you're back online"); return; }
    let filled = 0;
    for (const variant of LANG_VARIANTS[lang]) {
      if (manualSet.has(variant)) continue;
      const src = englishSource(variant);
      const node = boxes[variant];
      if (!src) {
        if (String(node.value ?? "").trim()) node.value = ""; // English removed → drop a stale line
        continue;
      }
      const t = await translateTo(fetch, src, lang);
      if (t) { node.value = t; regen.add(variant); regenSrc[variant] = src; filled++; }
    }
    refreshTags();
    if (filled) toast(`Filled ${filled} ${LANG_LABEL[lang]} line${filled === 1 ? "" : "s"} — tap Update to keep them`);
  }

  async function fillOne(variant) {
    if (manualSet.has(variant)) { toast("You typed this one — your words stay"); return; }
    if (!translateAllowed()) { toast("No connection — translations fill when you're back online"); return; }
    const src = englishSource(variant);
    const node = boxes[variant];
    if (!src) {
      if (String(node.value ?? "").trim()) node.value = "";
      toast("Type the English for it above first, then tap ↻");
      return;
    }
    const t = await translateTo(fetch, src, LANG_OF[variant]);
    if (t) {
      node.value = t; regen.add(variant); regenSrc[variant] = src; refreshTags();
      toast("Translated — tap Update to keep it");
    } else {
      toast("Couldn't translate just now — try again in a moment");
    }
  }

  function oneRow(variant) {
    const field = FIELD_LABEL[SRC_OF[variant]];
    const lang = LANG_OF[variant];
    return el("div", { class: "field", style: "margin-bottom:8px", dataset: { variant } },
      el("label", {}, `${field} — ${LANG_LABEL[lang]}`),
      boxes[variant],
      el("div", { class: "btn-row", style: "margin:5px 0 0" },
        tagFor(variant),
        button("↻ Translate this one", () => fillOne(variant), "ghost small")));
  }

  function langSection(lang) {
    return el("div", { style: "margin-top:10px" },
      el("p", { style: "margin:0 0 2px;font-weight:700;font-size:13px;color:var(--brown-dark)" }, LANG_LABEL[lang]),
      ...LANG_VARIANTS[lang].map(oneRow));
  }

  const translations = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Product text for your customers"),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "These 中文 and Bahasa Malaysia lines are filled automatically from the English above the first time you save or publish. The \"auto\" tag marks a machine translation; type over any box to make that line yours — it is never overwritten again. Tap a button to fill every line of one language now."),
    el("div", { class: "btn-row", style: "margin:0 0 4px" },
      button("Fill all 中文", () => fillLanguage("zh"), "soft small"),
      button("Fill all Bahasa Malaysia", () => fillLanguage("ms"), "soft small")),
    langSection("zh"),
    langSection("ms"));

  refreshTags();

  const costEl = el("p", { class: "card-sub", style: "margin:0 0 10px" });
  const sumEl = el("div"); // "How it adds up:" breakdown under the lines, empty until a line is filled
  const recipeCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Recipe (per unit)"),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      "Type the ingredients… or pick another product to make a bundle (e.g. 3 × Chicken Jerky pouch) — its own recipe is used automatically. Under each line is how its cost is counted (amount × price); the list below adds the lines up and shows each one's share of the total. Each ingredient line can also carry a short private note about itself for this product alone (e.g. which cut or brand of meat) — for your eyes only, never shown to customers."),
    costEl,
    el("div", { id: "recipe-lines" }),
    sumEl,
    el("div", { class: "btn-row" },
      button("＋ Add ingredient", () => {
        recipeDraft.push({ ingredientId: "", qty: "", unit: "" });
        renderRecipeLines();
      }, "soft"),
      button("＋ Add product", () => {
        recipeDraft.push({ productId: "", qty: "", unit: "" });
        renderRecipeLines();
      }, "soft")));

  function renderRecipeLines() {
    const costs = recipeLineCosts(state, { id: product && product.id, recipe: recipeDraft });
    // Round each line to its display cents first so the lines the owner sees
    // always add up exactly to the total shown (a raw-sum rounding could differ
    // from her + list by a cent when a line cost has more than 2 decimals).
    const shown = costs.map(round2);
    costEl.textContent = `Est. ingredient cost / unit: ${fmtRM(shown.reduce((s, v) => s + v, 0), state.settings.currency)}`;
    const box = recipeCard.querySelector("#recipe-lines");
    box.replaceChildren(...recipeDraft.map((line, i) =>
      recipeLine(state, line, i, recipeDraft, renderRecipeLines, product && product.id, costs[i])));
    sumEl.replaceChildren(...addUpBreakdown(state, recipeDraft, shown));
  }

  // What to keep of the translated boxes when the form saves: which are hers
  // (override), which are machine and from what English (src), and which stored
  // values must be dropped because their English went blank or was cleared.
  function trCollect() {
    const vals = {};
    const override = [];
    const src = {};
    const drop = [];
    for (const variant of ALL_VARIANTS) {
      const raw = String(boxes[variant].value ?? "").trim();
      const es = englishSource(variant);
      const manual = manualSet.has(variant);
      if (manual) {
        override.push(variant);
        if (raw) vals[variant] = raw;
        else if (product && Object.prototype.hasOwnProperty.call(product, variant)) drop.push(variant);
        continue;
      }
      if (!raw) continue;
      if (!es) {
        if (product && Object.prototype.hasOwnProperty.call(product, variant)) drop.push(variant);
        continue;
      }
      if (regen.has(variant)) { src[variant] = regenSrc[variant] || es; vals[variant] = raw; continue; }
      vals[variant] = raw; // machine text from an earlier save — kickoff reconciles it against English
    }
    return { vals, override, src, drop };
  }

  // Reads the form; returns { error } or { values, tr } ready to save.
  function collect() {
    const pname = name.value.trim();
    if (!pname) return { error: "Product needs a name" };
    const unitVal = unit.value.trim();
    if (!unitVal) {
      return { error: "Pick the selling unit — customers see it after the price. Add new ones under More → Units first." };
    }
    const chosenUom = byId(state.uoms, unitVal);
    const recipe = [];
    for (const l of recipeDraft) {
      const qty = Number(l.qty) || 0;
      if (!(qty > 0)) continue; // empty rows and 0-qty rows are dropped, like ingredients before
      if (l.productId && !l.ingredientId) {
        recipe.push({ productId: l.productId, qty, unit: (l.unit || "").trim() });
      } else if (l.ingredientId) {
        const rec = { ingredientId: l.ingredientId, qty, unit: (l.unit || "g").trim() };
        const desc = String(l.description || "").trim();
        if (desc) rec.description = desc;
        recipe.push(rec);
      }
    }
    const cycle = validateRecipeNoCycle(state, { id: product && product.id, name: pname, recipe });
    if (cycle) return { error: cycle };
    const limitVal = limit.value === "" ? undefined : Math.max(1, Number(limit.value));
    let closeVal;
    if (closeDays.value !== "") {
      const raw = Number(closeDays.value);
      if (!Number.isFinite(raw)) return { error: "Closes days must be a number" };
      closeVal = Math.floor(raw);
      if (closeVal < 0) return { error: "Closes days must be 0 or more" };
    }
    const vf = validFrom.value || undefined;
    const vt = validTo.value || undefined;
    if (vf && vt && vf > vt) return { error: "The \"from\" date is after the \"to\" date — swap them" };
    const descVal = desc.value.trim();
    const servingVal = serving.value.trim();
    return {
      values: {
        name: pname,
        unit: chosenUom ? chosenUom.name : unitVal,
        uomId: chosenUom ? chosenUom.id : undefined,
        price: price.value === "" ? undefined : Number(price.value),
        limit: limitVal,
        closeDays: closeVal,
        validFrom: vf,
        validTo: vt,
        description: descVal || undefined,
        servingTip: servingVal || undefined,
        recipe,
      },
      tr: trCollect(),
    };
  }

  return { name, unit, price, limit, closeDays, validFrom, validTo, desc, serving, translations, recipeCard, renderRecipeLines, collect };
}

// Fold the translated boxes + their provenance onto a saved product row.
// `tr` is what collect() returned: the override list is the FULL set of boxes
// the baker owns (so an old machine entry she now types over stops being auto),
// `src`/`drop` are the ones to record or forget.
function applyTrMeta(p, tr) {
  if (!tr) return;
  for (const k of tr.drop) delete p[k];
  const src = { ...(p.trSrc || {}) };
  for (const k of tr.override) delete src[k];
  for (const k of tr.drop) delete src[k];
  for (const [k, v] of Object.entries(tr.src)) src[k] = v;
  if (tr.override.length) p.trOverride = tr.override;
  else delete p.trOverride;
  const keys = Object.keys(src);
  if (keys.length) p.trSrc = src;
  else delete p.trSrc;
  for (const [k, v] of Object.entries(tr.vals)) {
    if (v === undefined) delete p[k];
    else p[k] = v;
  }
}

// After a save/publish, quietly finish the job online: fill any box that still
// needs a translation (or drop one whose English went away), then persist and
// push the finished text to the shop if the product is live. Never touches a box
// the baker typed. Offline or offline-midway → leave as is; the next save or
// Publish simply tries again.
async function kickoffAutoTranslate(state, product) {
  if (!translateAllowed() || !product) return;
  try {
    const changed = await autoTranslateProduct(product, (url) => fetch(url));
    if (!changed.length) return;
    save(state);
    if (isLive(product)) maybeSyncStorefront(state);
  } catch {
    /* transient blip — the next save or Publish retries */
  }
}

// Move a product between Draft / On the shop / Hidden. Live → hidden takes it
// off the menu (history kept); hidden/draft → live puts it back. Publishing
// re-runs auto-translate so a draft built offline reads correctly the moment
// it can go up.
function setProductState(state, p, target, root) {
  const wasDraft = isDraft(p);
  if (target === "live") {
    p.active = true;
    delete p.draft;
    save(state);
    maybeSyncStorefront(state);
    toast(wasDraft ? `"${p.name}" is on the shop now` : `"${p.name}" back on the menu`);
    renderAll(root, state);
    if (wasDraft) kickoffAutoTranslate(state, p);
  } else {
    p.active = false;
    delete p.draft;
    save(state);
    maybeSyncStorefront(state);
    toast(`"${p.name}" hidden — history kept`);
    renderAll(root, state);
  }
}

// The common field layout under whichever shell (card or pop-up) hosts it.
function editorFields(state, editor) {
  return el("div", {},
    el("div", { class: "form-grid" },
      el("div", {}, el("label", {}, "Name"), editor.name),
      el("div", {}, el("label", {}, "Unit"), editor.unit)),
    el("div", { class: "field" }, el("label", {}, "Description (customers read it on your shop)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "A sentence or two about what this is — e.g. chicken jerky, soft, chewy strips. Blank shows nothing."),
      editor.desc),
    el("div", { class: "field" }, el("label", {}, "Feeding tip (sent in your follow-up message)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "A short way-to-feed line — e.g. “Tear into small pieces.” Blank keeps the follow-up simple."),
      editor.serving),
    editor.translations,
    el("div", { class: "field" }, el("label", {}, "Sell price"), editor.price),
    el("div", { class: "field" }, el("label", {}, "Daily limit (optional)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "Max pouches per batch/posting day. Limits add up for availability — 12 chicken + 12 duck = 24 left."),
      editor.limit),
    el("div", { class: "field" }, el("label", {}, "Orders close (days before delivery)"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "Customers must pick a delivery date at least this many days away. Blank or 0 = any open day."),
      editor.closeDays),
    el("div", { class: "field" }, el("label", {}, "Available for delivery dates"),
      el("p", { class: "card-sub", style: "margin:0 0 5px" },
        "Only sell this product on delivery dates inside this range (e.g. a seasonal item). Leave both empty for every open day."),
      el("div", { class: "form-grid" },
        el("div", {}, el("label", {}, "From"), editor.validFrom),
        el("div", {}, el("label", {}, "To"), editor.validTo))),
    editor.recipeCard);
}

// The always-visible "New product" card at the top (the add form stays put even
// while an Edit pop-up is open, like "+ New order" does under the order pop-up).
function newProductCard(state, root) {
  const editor = buildEditor(state, null);
  const card = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 10px" }, "New product"),
    editorFields(state, editor),
    button("Add product", () => {
      const { error, values, tr } = editor.collect();
      if (error) return toast(error);
      // New products start as a draft — fully built but not on the shop (and not
      // orderable) until the owner publishes it. active:false keeps it out of
      // every "for sale" list automatically; draft:true marks its state.
      const row = { id: newId("prd"), ...values, ...newDraftRow() };
      applyTrMeta(row, tr);
      state.products.push(row);
      toast("Saved as a draft — Publish it when it's ready to sell");
      save(state);
      renderAll(root, state);
      kickoffAutoTranslate(state, row); // fill the 中文/BM boxes online, if any
    }, "block primary"));

  editor.renderRecipeLines();
  return card;
}

// Tap "Edit" on a product: the same form opens over the screen, saves in place,
// then closes. Mirrors how Orders edits a row.
function openEditProductPopup(state, product, root) {
  const editor = buildEditor(state, product);
  showPopup(el("div", { class: "popup-title-row" }, "Edit product"), (refresh, close) => {
    const body = el("div", {},
      editorFields(state, editor),
      el("div", { class: "popup-actions" },
        button("Cancel", close, "ghost"),
        button("Update product", () => {
          const { error, values, tr } = editor.collect();
          if (error) return toast(error);
          const wasLive = isLive(product);
          Object.assign(product, values);
          applyTrMeta(product, tr);
          toast("Product updated");
          save(state);
          if (wasLive) maybeSyncStorefront(state); // live text changed → shop gets it
          close();
          renderAll(root, state);
          kickoffAutoTranslate(state, product); // fill / refresh translations online
        }, "primary")));
    editor.renderRecipeLines();
    return body;
  }, { wide: true });
}

// Under a FILLED recipe row: how that line's cost is counted, e.g. an
// ingredient line "100 g × RM 0.01 = RM 1.00" or a set line "2 × RM 1.00 =
// RM 2.00" (qty × the set's per-unit cost). A filled row whose
// ingredient/product has no cost typed yet reads "no cost set" honestly.
// Blank and 0-qty rows show nothing.
function captionForLine(state, line, cost) {
  if (!(line.ingredientId || line.productId)) return null;
  const qty = Number(line.qty) || 0;
  if (!(qty > 0)) return null;
  const cur = state.settings.currency;
  let text = "no cost set";
  if (cost > 0) {
    // The rate shown is the line's own cost ÷ qty — the amount actually applied
    // (an ingredient priced per pack, e.g. "500 g box RM 4.00", reads back as
    // its worked-out per-unit price), so "amount × price = this line's RM" is
    // always exact and the working can't drift from the number above it.
    const rate = cost / qty;
    const ing = byId(state.ingredients, line.ingredientId);
    if (line.productId && !line.ingredientId) {
      text = `${trimNum(qty)} × RM ${fmtCpu(rate)} = ${fmtRM(cost, cur)}`;
    } else {
      const unit = String(line.unit || "").trim() || (ing && ing.unit) || "";
      text = `${trimNum(qty)}${unit ? ` ${unit}` : ""} × RM ${fmtCpu(rate)} = ${fmtRM(cost, cur)}`;
    }
  }
  return el("span", { class: "line-cost" }, text);
}

// A small "How it adds up:" table under the recipe lines, one row per FILLED
// line (+ its RM), ending in the total — so the owner can read the sum top to
// bottom and watch it land on the header number. Rows with no cost yet say so.
// Returns [] when nothing is filled, so no empty table shows.
function addUpBreakdown(state, draft, shown) {
  const cur = state.settings.currency;
  const rows = [];
  for (let i = 0; i < draft.length; i++) {
    const line = draft[i];
    const q = Number(line.qty) || 0;
    if (!(q > 0)) continue;
    let name = null;
    if (line.productId && !line.ingredientId) {
      const p = byId(state.products, line.productId);
      name = p ? p.name : "(deleted)";
    } else if (line.ingredientId) {
      const g = byId(state.ingredients, line.ingredientId);
      name = g ? g.name : "(deleted ingredient)";
    }
    if (name == null) continue; // row not filled yet
    rows.push({ name, val: shown[i], zero: shown[i] === 0 });
  }
  if (!rows.length) return [];

  const grid = el("div", { class: "cost-grid" });
  const total = rows.reduce((s, r) => s + r.val, 0);
  // Each line also shows its own share of the total, so the owner can see which
  // ingredient drives the cost. Meaningless when nothing has a cost yet (total 0).
  // Every line sits on its own soft strip (rounded, with the name and its % on
  // the same band) so a % far to the right still clearly belongs to its line.
  const showPct = total > 0;
  rows.forEach((r, k) => {
    const pct = showPct ? `${Math.round((r.val / total) * 100)}%` : "";
    grid.append(el("div", { class: "cost-row" },
      el("div", { class: "cost-op" }, k === 0 ? "·" : "+"),
      el("div", { class: "cost-val" }, fmtRM(r.val, cur)),
      el("div", { class: "cost-name" }, r.name + (r.zero ? "  (no cost set)" : "")),
      ...(showPct ? [el("div", { class: "cost-pct" }, pct)] : [])));
  });
  grid.append(el("div", { class: "cost-row cost-total-row" },
    el("div", { class: "cost-op" }, "="),
    el("div", { class: "cost-val cost-total-val" }, fmtRM(total, cur)),
    ...(showPct ? [el("div", { class: "cost-pct" }, "100%")] : [])));
  return [el("div", { class: "cost-sum" },
    el("p", { class: "cost-sum-title" }, "How it adds up:"),
    grid)];
}

// Number display for recipe working: whole amounts plain ("100"), fractions
// trimmed (no trailing zeros, so 0.5 stays "0.5", 2.50 reads "2.5").
function trimNum(n) {
  const v = Number(n) || 0;
  if (Number.isInteger(v)) return String(v);
  return String(Math.round(v * 10000) / 10000);
}

// A per-unit cost in RM: plain 2 decimals when it's exact ("0.01", "12.00"),
// more only when the typed price needs them ("0.005").
function fmtCpu(n) {
  const v = Number(n) || 0;
  const r = round2(v);
  return v === r ? r.toFixed(2) : String(Math.round(v * 10000) / 10000);
}

function recipeLine(state, line, i, draft, refresh, selfId, cost) {
  // A line is a component (another product, i.e. a set) when it carries a
  // productId field (even before one is chosen). Ingredient and product rows
  // are different drop-downs.
  const isProductRow = Object.prototype.hasOwnProperty.call(line, "productId") && !line.ingredientId;
  if (isProductRow) {
    return productRecipeLine(state, line, i, draft, refresh, selfId, cost);
  }

  const ing = byId(state.ingredients, line.ingredientId);
  const mismatch = ing && line.unit && ing.unit && line.unit !== ing.unit;

  let ingOpts = state.ingredients.filter((x) => x.active !== false)
    .map((x) => ({ value: x.id, label: x.name }));
  if (line.ingredientId && !ingOpts.some((o) => o.value === line.ingredientId)) {
    const hidden = byId(state.ingredients, line.ingredientId);
    if (hidden) ingOpts = [...ingOpts, { value: hidden.id, label: `${hidden.name} (hidden)` }];
  }
  const ingSel = select(ingOpts, line.ingredientId,
    () => {
      line.ingredientId = ingSel.value;
      const chosen = byId(state.ingredients, line.ingredientId);
      if (chosen && !line.unit) line.unit = chosen.unit;
      refresh();
    }, "Ingredient…");

  const qty = el("input", { class: "input", type: "number", inputmode: "decimal", step: "any",
    value: line.qty, style: "min-height:38px",
    onchange: () => { line.qty = Number(qty.value); refresh(); } });
  const unitInp = el("input", { class: "input", placeholder: "unit", value: line.unit,
    style: "min-height:38px", onchange: () => { line.unit = unitInp.value.trim(); refresh(); } });
  // A private per-product note under the ingredient line — "which cut / brand is
  // this?" Written separately for each product, so the same ingredient can read
  // differently here and there. Never published (the storefront drops recipes)
  // and never on a label.
  const note = el("input", { class: "input line-note",
    placeholder: "Describe this ingredient in this product (for your eyes only) — optional",
    value: line.description || "",
    onchange: () => { line.description = note.value.trim() || undefined; refresh(); } });

  return el("div", { class: "ing-row" },
    ingSel,
    qty,
    el("span", { class: "unit" }, unitInp),
    button("✕", () => { draft.splice(i, 1); refresh(); }, "ghost small"),
    mismatch ? el("div", { class: "warn", style: "grid-column:1/-1;margin:0" },
      `Unit "${line.unit}" differs from ${ing.name}'s unit (${ing.unit}) — check this line.`) : null,
    captionForLine(state, line, cost),
    line.ingredientId ? note : null);
}

function productRecipeLine(state, line, i, draft, refresh, selfId, cost) {
  // Drop-down of every other product (hidden ones stay selectable so old sets
  // keep working). The product being edited is excluded — a set can't hold
  // itself, and validateRecipeNoCycle is the backstop.
  let prodOpts = state.products
    .filter((p) => p.id !== selfId && p.draft !== true && p.active !== false)
    .map((p) => ({ value: p.id, label: p.name }));
  if (line.productId && !prodOpts.some((o) => o.value === line.productId)) {
    const hidden = byId(state.products, line.productId);
    if (hidden) prodOpts = [...prodOpts, { value: hidden.id, label: `${hidden.name} (hidden)` }];
  }
  const prodSel = select(prodOpts, line.productId,
    () => {
      line.productId = prodSel.value;
      const chosen = byId(state.products, line.productId);
      line.unit = chosen ? (chosen.unit || "") : "";
      refresh();
    }, "Product…");

  const qty = el("input", { class: "input", type: "number", inputmode: "numeric", step: "any", min: "1",
    value: line.qty, style: "min-height:38px",
    onchange: () => { line.qty = Number(qty.value); refresh(); } });
  // The unit comes from the chosen product and is read-only — a set counts
  // whole copies of the component, and its recipe defines the rest.
  const unitInp = el("input", { class: "input", placeholder: "unit", value: line.unit,
    style: "min-height:38px", readonly: true, title: "Selling unit of the chosen product" });

  return el("div", { class: "ing-row" },
    prodSel,
    qty,
    el("span", { class: "unit" }, unitInp),
    button("✕", () => { draft.splice(i, 1); refresh(); }, "ghost small"),
    captionForLine(state, line, cost));
}

function productCard(state, p, root) {
  const cost = costOf(state, p);
  const usedBy = state.orders.some((o) => o.productId === p.id);
  const usedInSets = state.products
    .filter((q) => q !== p && (q.recipe || []).some((l) => l.productId === p.id))
    .map((q) => q.name);
  const protect = usedBy || usedInSets.length > 0;
  const desc = String(p.description || "").trim();

  const subParts = [p.unit, p.limit ? `${p.limit}/day` : null,
    p.price != null ? `${fmtRM(p.price, state.settings.currency)} sell` : null,
    `${fmtRM(cost, state.settings.currency)} / unit`].filter(Boolean);
  const lines = (p.recipe || []).map((l) => {
    if (l.productId && !l.ingredientId) {
      const comp = byId(state.products, l.productId);
      return `${l.qty} × ${comp ? comp.name : "(deleted)"}`;
    }
    const ing = byId(state.ingredients, l.ingredientId);
    return `${l.qty}${l.unit} ${ing ? ing.name : "(deleted)"}`;
  });

  const actions = [button("Edit", () => openEditProductPopup(state, p, root), "ghost small")];
  if (isDraft(p)) {
    actions.push(button("Publish", () => setProductState(state, p, "live", root), "soft small"));
    actions.push(button("Delete", () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  } else if (isHidden(p)) {
    actions.push(button("Unhide", () => setProductState(state, p, "live", root), "ghost small"));
    if (!protect) actions.push(button("Delete", () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  } else {
    // Live: Hide when it has history/use (keeps PO + sets working), Delete when clean.
    actions.push(button(protect ? "Hide" : "Delete",
      () => deleteProduct(state, p, usedBy, usedInSets, root), "ghost small"));
  }

  return el("div", { class: "card" },
    el("div", { class: "card-row" },
      el("div", { style: "min-width:0" },
        el("p", { class: "card-title" }, p.name),
        el("p", { class: "card-sub" }, subParts.join(" · ")),
        desc ? el("p", { class: "product-desc" }, desc) : null,
        usedInSets.length
          ? el("p", { class: "po-breakdown" }, `Used in: ${usedInSets.map((n) => `"${n}"`).join(", ")}`)
          : null),
      el("div", { class: "li-right" }, ...actions)),
    lines.length ? el("p", { class: "po-breakdown" }, lines.join("  ·  ")) : null);
}

function deleteProduct(state, p, usedBy, usedInSets, root) {
  const protect = usedBy || usedInSets.length > 0;
  const msg = usedBy
    ? `"${p.name}" has orders on it, so it can't be deleted. Hide it instead — history is kept and the PO still lists it.`
    : usedInSets.length
      ? `"${p.name}" is used to make ${usedInSets.map((n) => `"${n}"`).join(" and ")}. Hide it instead — the sets and PO will still use it.`
      : `Delete "${p.name}"? Its recipe will be removed.`;
  confirmDialog(msg, () => {
    if (protect) {
      p.active = false;
      delete p.draft;
      toast("Product hidden");
    } else {
      state.products = state.products.filter((x) => x.id !== p.id);
      toast("Product deleted");
    }
    save(state);
    maybeSyncStorefront(state); // keep the storefront menu in sync
    renderAll(root, state);
  }, protect ? { yesLabel: "Hide it" } : { danger: true, yesLabel: "Delete" });
}
