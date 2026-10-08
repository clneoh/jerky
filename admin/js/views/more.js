// views/more.js — menu for the secondary screens, plus the software wish list.

import { el, button, confirmDialog, toast, menuRow } from "../ui.js";
import { ENGINE_VERSION } from "../version.js";
import {
  addWish, removeWish, renameWish, toggleWish, wishList,
} from "../wishlist.js";
import { developerEmails, developerName, buildWishMail, sendWishMail, devWaHref } from "../devmail.js";
import { pendingReviewCount } from "../supabase.js";

// ── ★ THE MENU IS GROUPED BY THE WORK, NOT BY THE SCREEN (v312) ────────────
//
// Seventeen screens used to sit in ONE flat list under a single heading called
// "Manage", in roughly the order they were built. Her report: __"when i work on
// Products, i have to alway go into Others to find, ingredient, unit, category"__
// — and __"Everything about delivery should be group under logistic."__
//
// ⚠️ **A ROW DROPPED IN A REGROUP IS SILENT.** The screen still exists and its
// address still works; it is simply unreachable from the menu, and nothing goes
// red. `test/more-menu.test.js` walks the app's own route table against this
// menu, so the next forgotten row fails by name instead of disappearing.
//
// ⚠️ **AND THE ADDRESSES MUST NOT CHANGE.** Tapping through from an old
// bookmarked `#/points` has to keep working, so a regroup is a change of
// HEADING only — never of `href`.
const MENU_GROUPS = [
  // Her word, twice: "Everything about delivery should be group under logistic."
  // Four screens that were at rows 7-10, mixed in among the money screens.
  ["Logistic", [
    ["#/run", "🚚 Delivery run", "Several orders, one trip — and what it saves"],
    // ⚠️ **DELIVERY DATES MOVED TO "The shop" (v339), on her word:** *"i think the bake days should not
    // be at logistic, it should be in the Shop."* She is right, and the reason is worth keeping: which
    // days you post is not a way an order LEAVES the kitchen — it is the day the shop OFFERS, the one a
    // customer picks on the storefront's calendar. Logistic keeps the four ways an order leaves.
    // ⚠️ **"SEND A VAN", NOT "LALAMOVE" (v315).** ⚠️ AND NOT "COURIER" EITHER —
    // **📦 Parcel couriers** is the row directly above and means the parcels she
    // POSTS. v309 gave the two kinds her own words, and the order cards say them:
    // **Post a parcel** / **Send a van**. The screen inside names Lalamove, and
    // asks the registry rather than knowing, so a second courier needs no change here.
    ["#/send-van", "🚚 Send a van", "Your own door for the driver, and the van service that collects from it"],
    ["#/points", "📍 Self collection Points", "The places your customers collect from instead of your kitchen"],
    ["#/parcel-couriers", "📦 Parcel couriers", "Posting dry goods yourself — J&T, Ninja Van, Line Clear"],
  ]],
  // The three she named, together, under the name of the screen they belong to.
  // Products is a tab; these are everything else it needs.
  ["Products & ingredients", [
    ["#/product-categories", "🗂 Categories", "The headings your shop lists products under"],
    ["#/units", "📐 Units", "g, kg, L — how packs compare"],
    ["#/ingredients", "🧂 Ingredients", "Your pantry, with what each supplier charges"],
  ]],
  ["Buying", [
    ["#/po", "🧾 Purchase Order", "What to top up — what to make, what to buy"],
    ["#/history", "🧾 PO history", "Your saved shopping lists"],
    ["#/suppliers", "🏪 Suppliers", "Who you buy from, with their WhatsApp"],
  ]],
  ["Money", [
    ["#/money", "💰 Money", "What came in — cash, TNG, still to collect"],
    ["#/profit", "📈 Profit", "Sales, ingredient cost, what the month left"],
    // ★ THE RECEIPT RUN (v366). It belongs with the books rather than with the app's own
    // settings, because it is the one page here that answers a question from outside — the
    // serially numbered receipts a business above RM150,000 must be able to show.
    ["#/receipts", "🧾 Receipt register", "Every receipt number issued — and any that is missing"],
  ]],
  ["The kitchen", [
    ["#/production", "🏭 Production line", "Where the line slows down, and the best use of your hands"],
    ["#/scenario", "🧱 Scenario planner", "Build the line from modules, and climb to the day you want"],
  ]],
  ["The shop", [
    // ★ **DELIVERY DATES, FIRST (v339).** Her word: *"i think the bake days should not be at logistic, it
    // should be in the Shop."* It belongs here because the days you post are something the CUSTOMER meets —
    // the storefront's own calendar offers those days and only those — while Logistic is the four ways
    // an order leaves the kitchen. It leads the group because which days the shop is open comes before
    // what it is advertising.
    ["#/deliveries", "📅 Delivery dates", "Which days you post, and who is on each"],
    ["#/promo", "🎟 Promo codes", "Codes your customers type in the shop"],
    // ⚠️ MOVED OUT OF SETTINGS IN v314. It is a customer offer, not a default,
    // so it lives with the two it belongs beside. Her words: "can be brought to
    // The Shop, rather than in Settings."
    ["#/bring-a-friend", "🔗 Bring a friend", "A customer's own link, and what both of them get"],
    // ⚠️ MOVED OUT OF SETTINGS IN v315 — how her words reach a customer is the same
    // subject as the offers and the reviews. Her instruction: "move Message Style to
    // the shop".
    ["#/message-style", "💬 Message style", "How the four WhatsApp messages to a customer open"],
    ["#/reviews", "⭐ Reviews", "Approve and remove homepage reviews"],
  ]],
];

export function renderMore(root, state) {
  let dead = false; // set once this view unmounts, so async fills never paint
  const stats = [
    `${state.products.filter((p) => p.active !== false).length} products`,
    `${state.ingredients.filter((x) => x.active !== false).length} ingredients`,
    `${state.orders.length} orders`,
    `${state.purchaseOrders.length} purchase orders`,
  ].join(" · ");

  const wish = wishCard(state);

  // ── The last group: the app itself. Settings used to be the final row of the
  // seventeen and the change history sat in a separate "About" section below —
  // two headings for one subject. They are one card now.
  //
  // Developer contact rows — WhatsApp first when she set a number (it opens a
  // chat with a ready "Hi!"), the ✉ email row kept underneath. Shown only once
  // she set a name and at least one way to reach the developer in Settings.
  const devMail = developerEmails(state);
  const devWa = devWaHref(state); // null when no usable WhatsApp number is set
  const devBy = developerName(state) ? `Website by ${developerName(state)}` : "";
  const thisApp = [
    menuItem("#/guide", "📖 Guide", "How this app works — plain English"),
    menuItem("#/settings", "⚙️ Settings", "Defaults, backup, transfer"),
    linkRow("../changelog.pdf", "📄 Full change history", "Every version from v54, as a PDF"),
    ...(devWa ? [linkRow(devWa, "💬 WhatsApp the developer",
      `Opens WhatsApp with a ready “Hi!”${devBy ? ` · ${devBy}` : ""}`)] : []),
    ...(devMail.length ? [linkRow(`mailto:${devMail.join(",")}`, "✉ Email the developer",
      `${devBy ? `${devBy} · ` : ""}${devMail.join(", ")}`)] : []),
  ];

  root.replaceChildren(
    el("div", { class: "card" },
      el("h2", { style: "margin:0" }, "Munchies Furkidz"),
      el("p", { class: "card-sub", style: "margin:6px 0 0" }, stats),
      el("p", { class: "card-sub", style: "margin:8px 0 0" },
        el("span", { class: "engine-pill" }, `Engine v${ENGINE_VERSION}`))),
    ...MENU_GROUPS.map(menuGroup),
    menuGroup(["Settings & this app", thisApp]),
    wish);

  // "N waiting" pill on the ⭐ Reviews row — reviews live in the cloud, so the
  // count is fetched after render and only shown when reviews are waiting.
  const revRow = root.querySelector('a.menu-item[href="#/reviews"]');
  if (revRow) {
    pendingReviewCount(state).then((n) => {
      if (dead || !n || !revRow.isConnected) return;
      const right = revRow.querySelector(".menu-right");
      if (right) right.prepend(el("span", { class: "badge badge-open" }, `${n} waiting`));
    }).catch(() => {});
  }

  return () => { dead = true; };
}

// One heading and its card of rows. Every group wears the app's own
// h2.section — the heading Products, Ingredients and Promo codes already draw —
// so the regroup introduces no new shape to learn.
//
// ⚠️ **A ROW MAY ARRIVE TWO WAYS, AND BOTH ARE REAL.** The six groups above are
// `[href, title, sub]` TRIPLES, because they are one shape written once and read
// by nothing else. The last group is built already — its developer rows appear
// only once Settings holds a name and a way to reach them — so it hands over
// NODES. Passing a triple straight into `el()` would stringify the array into a
// text node: the heading would draw, the rows would not, and the menu would be
// silently empty. `test/more-menu.test.js` catches exactly that.
const asRow = (r) => (Array.isArray(r) ? menuItem(r[0], r[1], r[2]) : r);

function menuGroup([name, rows]) {
  return el("div", {},
    el("h2", { class: "section" }, name),
    el("div", { class: "card", style: "padding:4px 14px" }, ...rows.map(asRow)));
}

// A row that leaves the app — plain <a> opening in a new tab, so it is never
// confused with an app route. Drawn by the one shared builder in ui.js.
function linkRow(href, title, sub) {
  return menuRow(href, title, sub, { newTab: true });
}

function menuItem(href, title, sub) {
  return menuRow(href, title, sub);
}

// ── Software wish list — a to-do that never resets ─────────────────────────
// Wishes live in settings.wishList as [{id,label,done}]; a tick stays ticked
// until she untoggles it (unlike the weekly routine, which resets each Sunday).

// The add-your-own input row. `redo` re-renders the card after a change.
function wishAddRow(card, state, redo) {
  const input = el("input", {
    class: "check-input", type: "text", placeholder: "A feature you wish the app had…", autocomplete: "off",
  });
  const submit = () => {
    if (!addWish(state, input.value)) return input.focus();
    redo();
    // Best-effort email to the developer with the FULL list. Quiet on success;
    // on failure one unobtrusive toast points to the always-works ✉ row below.
    if (developerEmails(state).length) {
      sendWishMail(state).then((m) => {
        if (!m.ok) {
          toast("Wish saved — the email didn't send. Tap “✉ Email the full list” to send it yourself.");
        }
      });
    }
  };
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  return el("div", { class: "check-add" },
    input,
    el("button", { class: "btn soft small", type: "button", onclick: submit }, "Add"));
}

// The mailto that carries the whole wish list to every developer email, or null
// before any developer email is set in Settings (then nothing renders).
function wishMailtoHref(state) {
  const emails = developerEmails(state);
  if (!emails.length) return null;
  const { subject, body } = buildWishMail(state);
  return `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function removeWishIt(card, state, item, redo) {
  confirmDialog(`Remove “${item.label}” from your wish list?`, () => {
    removeWish(state, item.id);
    redo();
  }, { danger: true, yesLabel: "Remove" });
}

function wishRow(card, state, item, redo) {
  const row = el("div", { class: "check-row" },
    el("button", {
      class: "check-toggle", type: "button",
      onclick: () => { toggleWish(state, item.id); redo(); },
    },
      el("span", { class: `check-dot${item.done ? " done" : ""}` }, item.done ? "✓" : ""),
      el("span", { class: `check-label${item.done ? " done" : ""}` }, item.label)),
    el("span", { class: "check-acts" },
      el("button", {
        class: "act-btn", type: "button", title: "Edit wish",
        onclick: () => {
          const input = el("input", {
            class: "check-input", type: "text", value: item.label, autocomplete: "off",
          });
          const finish = () => {
            const v = input.value.trim();
            if (v && v !== item.label) renameWish(state, item.id, v);
            redo();
          };
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") finish();
            else if (e.key === "Escape") redo();
          });
          row.replaceChildren(el("div", { class: "check-edit" }, input,
            button("Save", finish, "soft small")));
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
        },
      }, "✎"),
      el("button", {
        class: "act-btn", type: "button", title: "Remove wish",
        onclick: () => removeWishIt(card, state, item, redo),
      }, "✕")));
  return row;
}

// Rebuilds the wish list card in place after an edit.
function wishCard(state) {
  const head = el("div", { class: "card-row" });
  const listBox = el("div", { class: "check-list" });
  const card = el("div", { class: "card" }, head, listBox);

  const redo = () => {
    const items = wishList(state);
    const doneCount = items.filter((w) => w.done).length;
    head.replaceChildren(
      el("div", {},
        el("p", { class: "card-title" }, "Software wish list"),
        el("p", { class: "card-sub" }, "Ideas for the app — tick the ones that come true")),
      ...(items.length ? [el("span", { class: "qty-chip" }, `${doneCount}/${items.length}`)] : []));
    const mailHref = wishMailtoHref(state);
    listBox.replaceChildren(
      ...(items.length ? [] : [el("p", { class: "muted", style: "padding:2px 0 0" },
        "No wishes yet — add one below.")]),
      ...items.map((w) => wishRow(card, state, w, redo)),
      wishAddRow(card, state, redo),
      ...(mailHref ? [el("div", { class: "check-mail" },
        el("a", { href: mailHref }, "✉ Email the full wish list to the developer"),
        el("p", { class: "card-sub", style: "margin:0" },
          "Opens your mail app with every wish above — handy if the automatic email hasn't reached the developer yet."))] : []));
  };
  redo();
  return card;
}
