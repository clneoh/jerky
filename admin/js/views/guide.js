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
        "Orders, products, your “On hand” stock, the postage fee you set and more sync between YOUR phones through your OWN online cabinet (Supabase). Customers never see any of it.",
        "A notebook in the sky — but each business has its OWN notebook. This app never touches your bakery's records."],
      ["Your postage fee",
        "The RM8 posting fee is quoted only by you, on your WhatsApp confirmations. It syncs between your phones — whatever you set last wins — so both quote the same figure. It is never published to the storefront: customers only hear the exact amount from you.",
        "The private price list you and your other till share — not the menu hanging in the window."],
      ["On this phone only",
        "A few things really do stay on the phone you're using: your app PIN and the cloud-login email & password you type in. Your “On hand” stock is NOT one of these, and neither is the postage fee — both sync like the rest of your records.",
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
      el("p", { class: "card-title" }, "Cloud backups you can step back to (Engine v61)"),
      el("p", { class: "card-sub" },
        "Every day you open the app signed in, a full copy of your records quietly saves to your own cloud — a Daily copy the first time the app opens each day, a Weekly copy on Mondays, a Monthly copy on the 1st. It keeps the newest 7 daily, 4 weekly and 3 monthly copies. In Settings → Backup & safety you can Restore your phone back to any copy (a “Before restore” copy is saved first, so you can undo it), Download one as a file, or Delete it. Automatic copies tidy themselves up; Manual ones stay until you delete them."),
      el("p", { class: "hint" },
        "Your cloud copies sit behind the same private login as your shared records — customers never see them. Restore rewinds your phone AND the shared cloud to that copy.")),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "Homepage reviews you approve first (Engine v60)"),
      el("p", { class: "card-sub" },
        "Your homepage can now show a “What customers say” section. Visitors leave a review — a star rating, a few words in English / 中文 / Bahasa Malaysia, and an optional photo — but nothing appears publicly until YOU tap Publish on it, in More → Reviews. New ones sit under Waiting for you; Publish puts it on the homepage, Take down hides it again, Delete removes it for good."),
      el("p", { class: "hint" },
        "Customers post into your own cloud and only your tap makes it public — the same trust step as confirming a storefront order before accepting it.")),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "Tick a whole occasion group at once (Engine v59)"),
      el("p", { class: "card-sub" },
        "On the Delivery calendar → Mark an occasion, the import list groups the ready-made occasions — pet days, people & kindness days, and more — so you can tick a whole group in one tap, then untick any you don't want before adding them all to your calendar. A “My own day” box lets you type any occasion the list doesn't have, e.g. “Pet-treat promo day”."),
      el("p", { class: "hint" },
        "Whole-group ticking saves taps when you want most of a group; the group's master checkbox shows a dash when only some of its days are ticked.")),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "A catalogue of occasions to add (Engine v58)"),
      el("p", { class: "card-sub" },
        "Behind “＋ Add occasion” on the calendar is now a curated list of ready-made special days — Malaysian public holidays plus fun days for pets and people (World Animal Day, National Pet Day, International Cat & Dog Day and similar) — colour-coded red for public holidays, orange for the rest, so the calendar stays easy to read."),
      el("p", { class: "hint" },
        "These are suggestions to import, never automatic — you choose which ones land on your calendar.")),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "A note on each ingredient line (Engine v57)"),
      el("p", { class: "card-sub" },
        "In a product's recipe, every ingredient line can now carry its own short note about that ingredient for this product only — e.g. which cut or brand of chicken, or which variety of sweet potato. It's for your eyes alone: it never appears on the shop, a label, or the product cards. Because it rides on the product like the recipe does, both your phones see it."),
      el("p", { class: "hint" },
        "Sits under the “amount × price” line — the same ingredient can read differently in different products (e.g. chicken in one recipe, duck in another).")),
    el("div", { class: "card" },
      el("p", { class: "card-title" }, "“Keep at least” reserve stock (Engine v56)"),
      el("p", { class: "card-sub" },
        "On the Ingredients screen, next to “On hand” there's now “Keep at least”. That's your floor — how much you want left on the shelf after a busy posting day. Your shopping list tops an ingredient back up to that level automatically, so you're never caught short. Set it once per ingredient; it syncs with the ingredient, so both your phones see the same number."),
      el("p", { class: "hint" },
        "Runs on top of the “On hand” stock number (Engine v54) — if you track what you have, the app can tell you what to re-buy.")));
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
