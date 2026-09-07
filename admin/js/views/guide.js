// views/guide.js — a plain-English guide to the shared engine, for THIS app
// only (the bakery doesn't get it). Explains, in everyday words, that munchies
// and the bakery run the same engine, which step maps to which name, and what
// lives where. Content master kept in Claude's memory; refresh here whenever an
// engine sync lands so new-version notes stay current.

import { el, button } from "../ui.js";
import { ENGINE_VERSION } from "../version.js";

// Navigate by hash so app.js isn't needed at import time.
const navigate = (hash) => { location.hash = hash; };

export function renderGuide(root, state) {
  root.replaceChildren(
    el("div", { class: "btn-row", style: "margin-bottom:10px" },
      button("← Back", () => navigate("#/more"), "ghost")),

    introCard(),

    el("h2", { class: "section" }, "One engine, two shops"),
    ...analogyRows([
      ["The engine",
        "The shared software underneath BOTH your businesses. It decides how every screen, button, order and sync works.",
        "Like the same car engine fitted under two different shop signs — one for your bakery, one for Munchies Furkidz."],
      ["Engine updates (syncing)",
        "New engine improvements are built on your bakery app first, then copied into this one, so the two always work the same way.",
        "Like perfecting a new kitchen gadget in one kitchen, then installing the same gadget in the other."],
      ["Engine version",
        "A numbered batch of improvements. Right now both apps run Engine v" + ENGINE_VERSION + ".",
        "A version sticker on the machine — check this More screen and your bakery's More screen; they should match."],
      ["Your words vs the engine's",
        "The engine keeps ONE internal name for every step. Each of your shops shows its own word on screen.",
        "One kitchen timer, two different labels stuck on it."],
    ]),

    el("h2", { class: "section" }, "Same step, different name"),
    ...analogyRows([
      ["Preparing (this app)",
        "The step where an order is being made. The bakery calls this same step “Baked” — it's the identical engine step, just named for pet treats.",
        "Two shop signs, same room behind them."],
      ["Posting day (this app)",
        "Your production days — Monday / Wednesday / Friday. The bakery says “bake day”; yours is a “posting day” because your treats are posted nationwide.",
        "Same schedule on the calendar, different name in each shop."],
      ["Post vs Collect",
        "How an order reaches the customer: Post (nationwide) with a flat fee, or Collect (local). The bakery uses “Courier / Collect”.",
        "Same two ways to hand something over, your own labels."],
    ]),

    el("h2", { class: "section" }, "What stays yours alone"),
    ...analogyRows([
      ["Your cloud cabinet",
        "Orders, products, your “On hand” stock and more sync between YOUR phones through your OWN online cabinet (Supabase). Customers never see any of it.",
        "A notebook in the sky — but each business has its OWN notebook. This app never touches your bakery's records."],
      ["On this phone only",
        "A few things never leave the phone you're using: your app PIN, the RM8 postage fee, and the cloud-login email & password you type in. Your “On hand” stock is NOT one of these — it syncs like the rest of your records.",
        "A sticky note on the till — not copied into the sky notebook."],
      ["Your branding & prices",
        "Domain munchies.com.my, product names, prices, photos, WhatsApp/Instagram — all yours, per shop.",
        "The sign, the menu and the prices are yours; only the machinery underneath is shared."],
      ["Backup file",
        "“Backup” in Settings makes a full copy of your records to keep safe.",
        "A photocopy of the whole notebook, put away in a drawer."],
    ]),

    el("h2", { class: "section" }, "Newest in the engine"),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "“On hand” stock (Engine v" + ENGINE_VERSION + ")"),
      el("p", { class: "card-sub" },
        "On the Ingredients screen, tap “On hand … Adjust” to type how much of an ingredient you have. Your shopping list then buys whole packs only for what that doesn't cover — and when you mark an order Preparing, its ingredients come off your stock automatically. Because it syncs with the ingredient, both your phones see the same number.")));
}

function introCard() {
  return el("div", { class: "card" },
    el("p", { class: "card-title" }, "Your app, explained"),
    el("p", { class: "card-sub" },
      "Your bakery app and this app are twins under the hood — they share the same engine. This guide explains the engine in everyday words, so the two never feel confusing."),
    el("p", { class: "card-sub" },
      "It lives only here in Munchies Furkidz — your bakery app doesn't need it."));
}

function analogyRows(rows) {
  return rows.map(([term, meaning, analogy]) =>
    el("div", { class: "card" },
      el("p", { class: "card-title" }, term),
      el("p", { class: "card-sub" }, meaning),
      el("p", { class: "hint" }, "Analogy: " + analogy)));
}
