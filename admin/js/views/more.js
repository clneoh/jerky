// views/more.js — menu for the secondary screens.

import { el } from "../ui.js";
import { ENGINE_VERSION } from "../version.js";

export function renderMore(root, state) {
  const stats = [
    `${state.products.filter((p) => p.active !== false).length} products`,
    `${state.ingredients.filter((x) => x.active !== false).length} ingredients`,
    `${state.orders.length} orders`,
    `${state.purchaseOrders.length} purchase orders`,
  ].join(" · ");

  const menu = el("div", { class: "card", style: "padding:4px 14px" },
    menuItem("#/guide", "📖 Guide", "How this app works — plain English"),
    menuItem("#/customers", "📇 Customers", "Delivery history + WhatsApp marketing list"),
    menuItem("#/suppliers", "🏪 Suppliers", "Who you buy from, with their WhatsApp"),
    menuItem("#/deliveries", "📅 Delivery dates", "Set and manage delivery dates"),
    menuItem("#/ingredients", "🧂 Ingredients", "Cooking units + supplier prices for the PO"),
    menuItem("#/history", "🧾 PO history", "Saved purchase orders"),
    menuItem("#/units", "📐 Units", "g, kg, L — how packs compare"),
    menuItem("#/settings", "⚙️ Settings", "Defaults, backup, transfer"));

  root.replaceChildren(
    el("div", { class: "card" },
      el("h2", { style: "margin:0" }, "Munchies Furkidz"),
      el("p", { class: "card-sub", style: "margin:6px 0 0" }, stats),
      el("p", { class: "card-sub", style: "margin:6px 0 0" },
        el("span", { class: "muted" }, `Engine v${ENGINE_VERSION}`))),
    el("h2", { class: "section" }, "Manage"),
    menu);
}

function menuItem(href, title, sub) {
  return el("a", { class: "menu-item", href },
    el("div", {},
      el("div", {}, title),
      el("div", { class: "card-sub", style: "font-weight:400" }, sub)),
    el("span", { class: "chev" }, "›"));
}
