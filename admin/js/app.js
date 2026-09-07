// app.js — bootstrap, hash router, bottom-nav wiring, shared-data sync gate.

import { loadState, save, setSaveHook, updateOrderBadge, ensureSupabase } from "./state.js";
import { el, button } from "./ui.js";
import * as sync from "./sync.js";
import { cachedToken, maybeSync, pullIncoming, refreshStorefront } from "./supabase.js";

import { renderDashboard } from "./views/dashboard.js";
import { renderDeliveries } from "./views/deliveries.js";
import { renderUnits } from "./views/units.js";
import { renderSuppliers } from "./views/suppliers.js";
import { renderOrders } from "./views/orders.js";
import { renderProducts } from "./views/products.js";
import { renderIngredients } from "./views/ingredients.js";
import { renderPO } from "./views/po.js";
import { renderHistory } from "./views/history.js";
import { renderCustomers } from "./views/customers.js";
import { renderSettings } from "./views/settings.js";
import { renderMore } from "./views/more.js";
import { renderLogin } from "./views/login.js";
import { renderLock } from "./views/lock.js";
import { lockEnabled } from "./pin.js";

const state = loadState();

const routes = {
  "/dashboard": { title: "Munchies Furkidz", tab: "dashboard", render: renderDashboard },
  "/orders":    { title: "Orders",    tab: "orders",    render: renderOrders },
  "/products":  { title: "Products",  tab: "products",  render: renderProducts },
  "/ingredients":{ title: "Ingredients", tab: "more",   render: renderIngredients },
  "/po":        { title: "Purchase Order", tab: "po",   render: renderPO },
  "/history":   { title: "PO History", tab: "more",     render: renderHistory },
  "/customers": { title: "Customers", tab: "more",      render: renderCustomers },
  "/deliveries":{ title: "Delivery Dates", tab: "more", render: renderDeliveries },
  "/units":     { title: "Units",      tab: "more",      render: renderUnits },
  "/suppliers": { title: "Suppliers",  tab: "more",      render: renderSuppliers },
  "/settings":  { title: "Settings",  tab: "more",      render: renderSettings },
  "/more":      { title: "More",      tab: "more",      render: renderMore },
};

const viewEl = document.getElementById("view");
const tabbar = document.getElementById("tabbar");
let cleanup = null;
let loggedOut = false; // true while the sign-in gate owns the screen
let unlocked = false; // true once the app password passes for this page load
let syncStarted = false;

function lockedNow() {
  return !unlocked && lockEnabled(state.settings);
}

// Every mutation funnels through save(state). The hook queues changed records
// and schedules a debounced pull-then-flush, so add/edit/remove order (and
// products, ingredients, dates, POs, settings) all sync automatically — no
// manual "Sync now" needed. Skipped entirely when shared data is off.
setSaveHook((s) => {
  if (!s.settings.cloud || !s.settings.cloud.enabled) return;
  const r = sync.markDirty(s);
  if (r.changed) sync.scheduleRefresh(s);
});

function parseHash() {
  const raw = location.hash.replace(/^#/, "") || "/dashboard";
  const [path, queryStr] = raw.split("?");
  const params = new URLSearchParams(queryStr || "");
  return { path: path || "/dashboard", params };
}

export function navigate(href) {
  location.hash = href;
}

function isEditing() {
  const a = document.activeElement;
  return !!(a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT"));
}

function render() {
  if (loggedOut) return; // the sign-in gate owns the screen
  if (lockedNow()) return; // the app-password layer owns the screen
  const { path, params } = parseHash();
  const route = routes[path] || routes["/dashboard"];

  if (cleanup) cleanup();
  cleanup = null;

  document.title = `${route.title} · Munchies Furkidz`;
  document.getElementById("view-title-text").textContent = route.title;
  document.getElementById("view-sub").textContent = "";

  for (const tab of document.querySelectorAll(".tabbar .tab")) {
    tab.classList.toggle("active", tab.dataset.tab === route.tab);
  }

  viewEl.replaceChildren();
  viewEl.scrollTop = 0;
  updateOrderBadge(state);
  try {
    const ret = route.render(viewEl, state, params);
    if (typeof ret === "function") cleanup = ret;
  } catch (err) {
    // The view is already cleared above — without this guard a render crash
    // would show a blank page. Surface the error so the baker can report it.
    console.error(`Render crashed on ${path}`, err);
    viewEl.replaceChildren(el("div", { class: "empty" },
      el("p", { class: "empty-icon" }, "😵"),
      el("h3", {}, "Something went wrong"),
      el("p", { class: "muted" },
        "This screen couldn't load. Tap below to try again — if it keeps happening, tell the baker's helper this message: " +
        String((err && err.message) || err)),
      button("Try again", render, "primary")));
  }
  viewEl.focus({ preventScroll: true });
}

// Start the periodic + event-driven pull (every ~30s, and on online/focus/
// visibility) and run an immediate refresh. Re-renders only when a pull
// changed data and no input is focused, so a remote edit can't clobber a form
// mid-edit. Safe to call again after a login lands — the loop registers once,
// but the immediate refresh re-runs so fresh data shows up right away.
function onSyncChanged() {
  if (!loggedOut && !lockedNow() && !isEditing()) render();
}

function startSync() {
  if (!syncStarted) {
    syncStarted = true;
    sync.startSync(state, onSyncChanged);
  }
  sync.refresh(state).then((r) => {
    if (r && r.changed) onSyncChanged();
    // Re-publish availability slots from the freshest state (shared data just
    // pulled, if enabled) so the storefront can't keep showing stale rows.
    // Unlike the storefront *config*, availability is a derived snapshot of the
    // current plan — re-publishing it on boot is safe and self-healing.
    maybeSync(state);
  }).catch(() => {});
  // Deliberately no storefront *config* publish here: a phone's local editor
  // copy may be stale (older than what another phone published) and would
  // clobber the live config on every boot. Publishing happens only on an
  // explicit edit or "Publish now", and Settings pulls the live copy in when
  // opened.
}

// Poll for customer orders placed on the storefront (~30s) and pull them into
// the order list. Self-gates on Supabase being configured; re-renders only when
// something was imported and no input is focused. Like the shared-data sync,
// the poll runs only while the app is on screen — returning to the app runs it
// right away, so a new order never waits a full 30s behind the gate.
let intakeStarted = false;
function startIntake() {
  if (intakeStarted) return;
  intakeStarted = true;
  const tick = async () => {
    if (!sync.pageActive()) return;
    try {
      const r = await pullIncoming(state);
      if (r.imported && r.imported.length) {
        maybeSync(state); // new orders change slots-left → refresh availability
        onSyncChanged();
      }
    } catch { /* pullIncoming never throws, but stay safe */ }
  };
  const go = () => { tick(); };
  tick();
  setInterval(tick, 30000);
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    window.addEventListener("online", go);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) go(); });
    window.addEventListener("focus", go);
  }
}

function showLogin() {
  loggedOut = true;
  if (cleanup) cleanup();
  cleanup = null;
  document.title = "Sign in · Munchies Furkidz";
  document.getElementById("view-title-text").textContent = "Sign in";
  document.getElementById("view-sub").textContent = "";
  if (tabbar) tabbar.hidden = true;
  viewEl.replaceChildren();
  renderLogin(viewEl, state, {
    onSuccess: () => {
      loggedOut = false;
      if (tabbar) tabbar.hidden = false;
      render();
      startSync();
      startIntake();
      refreshStorefront(state);
    },
    onOffline: () => {
      loggedOut = false;
      if (tabbar) tabbar.hidden = false;
      render();
    },
  });
}

function registerSW() {
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }
}

// The app-password lock, when enabled, is the first gate on load. It is
// device-local and only takes effect from the next open — enabling it in
// Settings never locks the current session. A correct PIN resumes bootApp().
async function boot() {
  // Self-heal: a phone set up before the app shipped preconnected can hold
  // blank cloud boxes forever. Refill the public project address + key so the
  // app always knows where its cloud is — before the gates, so even a sign-in
  // screen shows the connection ready. Email/password are never touched.
  if (ensureSupabase(state)) save(state);
  const layer = document.getElementById("lock-layer");
  if (layer) layer.hidden = true; // hygiene: never a stale visible lock
  if (!(await passLock())) return;
  bootApp();
}

function passLock() {
  // No lock at boot → this page load counts as already open. Without this, the
  // `unlocked` flag stays false and ticking the lock ON later in the same
  // session would make the app think it is locked (navigation goes dead) while
  // no lock screen is shown — the lock is meant to start from the NEXT open.
  if (!lockedNow()) { unlocked = true; return Promise.resolve(true); }
  return new Promise((resolve) => {
    const layer = document.getElementById("lock-layer");
    if (!layer) { unlocked = true; return resolve(true); } // can't lock without the layer
    renderLock(layer, state, { onUnlocked: () => { unlocked = true; resolve(true); } });
  });
}

function bootApp() {
  const c = sync.cloudCfg(state);
  if (c.on) {
    if (cachedToken()) {
      // Session still valid — straight in, start syncing.
    } else if (c.email && c.password) {
      // Stored credentials — silent auto-login (owner's flow stays seamless);
      // the gate only appears if the login actually fails.
      sync.login(state).then(() => startSync()).catch(() => showLogin());
    } else {
      showLogin();
      return;
    }
  }
  render();
  startSync();
  startIntake();
  // Adopt the latest published storefront (name/WhatsApp/tagline/QR) so this
  // phone shows whatever the most recent backoffice user set, not a baked copy.
  refreshStorefront(state);
  registerSW();
}

window.addEventListener("hashchange", render);

// Expose save/state to views that import from app.js without a cycle.
export { state, save };

boot();
