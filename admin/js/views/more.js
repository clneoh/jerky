// views/more.js — menu for the secondary screens, plus the software wish list.

import { el, button, confirmDialog, toast } from "../ui.js";
import { ENGINE_VERSION } from "../version.js";
import {
  addWish, removeWish, renameWish, toggleWish, wishList,
} from "../wishlist.js";
import { developerEmails, developerName, buildWishMail, sendWishMail, devWaHref } from "../devmail.js";
import { pendingReviewCount } from "../supabase.js";

export function renderMore(root, state) {
  let dead = false; // set once this view unmounts, so async fills never paint
  const stats = [
    `${state.products.filter((p) => p.active !== false).length} products`,
    `${state.ingredients.filter((x) => x.active !== false).length} ingredients`,
    `${state.orders.length} orders`,
    `${state.purchaseOrders.length} purchase orders`,
  ].join(" · ");

  const menu = el("div", { class: "card", style: "padding:4px 14px" },
    menuItem("#/guide", "📖 Guide", "How this app works — plain English"),
    menuItem("#/po", "🧾 Purchase Order", "Top up what to post or make"),
    menuItem("#/suppliers", "🏪 Suppliers", "Who you buy from, with their WhatsApp"),
    menuItem("#/deliveries", "📅 Delivery dates", "Set and manage delivery dates"),
    menuItem("#/ingredients", "🧂 Ingredients", "Pouch units + supplier prices for the PO"),
    menuItem("#/history", "📚 PO history", "Saved purchase orders"),
    menuItem("#/units", "📐 Units", "g, kg, L — how packs compare"),
    menuItem("#/reviews", "⭐ Reviews", "Approve & remove homepage reviews"),
    menuItem("#/settings", "⚙️ Settings", "Defaults, backup, transfer"));

  const wish = wishCard(state);
  // Developer contact rows — WhatsApp first when she set a number (it opens a
  // chat with a ready "Hi!"), the ✉ email row kept underneath. Shown only once
  // she set a name and at least one way to reach the developer in Settings.
  const devMail = developerEmails(state);
  const devWa = devWaHref(state); // null when no usable WhatsApp number is set
  const devBy = developerName(state) ? `Website by ${developerName(state)}` : "";
  const about = el("div", {},
    el("h2", { class: "section" }, "About"),
    el("div", { class: "card", style: "padding:4px 14px" },
      linkRow("../changelog.pdf", "📄 Full change history",
        "Every version from v54, as a PDF"),
      ...(devWa ? [linkRow(devWa, "💬 WhatsApp the developer",
        `Opens WhatsApp with a ready “Hi!”${devBy ? ` · ${devBy}` : ""}`)] : []),
      ...(devMail.length ? [linkRow(`mailto:${devMail.join(",")}`, "✉ Email the developer",
        `${devBy ? `${devBy} · ` : ""}${devMail.join(", ")}`)] : [])));

  root.replaceChildren(
    el("div", { class: "card" },
      el("h2", { style: "margin:0" }, "Munchies Furkidz"),
      el("p", { class: "card-sub", style: "margin:6px 0 0" }, stats),
      el("p", { class: "card-sub", style: "margin:8px 0 0" },
        el("span", { class: "engine-pill" }, `Engine v${ENGINE_VERSION}`))),
    el("h2", { class: "section" }, "Manage"),
    menu,
    wish,
    about);

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

// A tappable row in the "About" card — plain <a> so it opens in a new tab and
// is never confused with an app route.
function linkRow(href, title, sub) {
  return el("a", { class: "menu-item", href, target: "_blank", rel: "noopener" },
    el("div", {},
      el("div", {}, title),
      el("div", { class: "card-sub", style: "font-weight:400" }, sub)),
    el("span", { class: "chev" }, "›"));
}

function menuItem(href, title, sub) {
  return el("a", { class: "menu-item", href },
    el("div", {},
      el("div", {}, title),
      el("div", { class: "card-sub", style: "font-weight:400" }, sub)),
    // The chev sits in a right-hand group so an async count pill (e.g. the
    // "N waiting" on Reviews) can be tucked in beside it before the chev.
    el("span", { class: "menu-right" },
      el("span", { class: "chev" }, "›")));
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
