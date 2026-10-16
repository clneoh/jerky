// app.js — bootstrap, hash router, bottom-nav wiring, shared-data sync gate.

import { byId, loadState, save, setSaveHook, stampOrderLine, updateOrderBadge, ensureSupabase } from "./state.js";
import { costOf } from "./bom.js";
import { el, button } from "./ui.js";
import * as sync from "./sync.js";
import { maybeAutoBackup } from "./backups.js";
import { cachedToken, maybeSync, pullIncoming, refreshStorefront } from "./supabase.js";
import { canonicaliseCustomers, reconcileContacts } from "./profiles.js";
import { todayISO } from "./dates.js";

import { renderDashboard } from "./views/dashboard.js";
import { renderDeliveries } from "./views/deliveries.js";
import { renderUnits } from "./views/units.js";
import { renderSuppliers } from "./views/suppliers.js";
import { renderProductCategories } from "./views/productCategories.js";
import { renderParcelCouriers } from "./views/parcelCouriers.js";
import { renderPoints } from "./views/points.js";
import { renderPointAreas } from "./views/pointAreas.js";
import { renderDeliveryRoutes } from "./views/deliveryRoutes.js";
import { renderPromoCodes } from "./views/promo.js";
import { renderReferrals } from "./views/referrals.js";
import { renderSendVan } from "./views/send_van.js";
import { renderMessageStyle } from "./views/message_style.js";
import { renderOrders } from "./views/orders.js";
import { renderProducts } from "./views/products.js";
import { renderIngredients } from "./views/ingredients.js";
import { renderPO } from "./views/po.js";
import { renderHistory } from "./views/history.js";
import { renderCustomers } from "./views/customers.js";
import { renderSettings } from "./views/settings.js";
import { renderReviews } from "./views/reviews.js";
import { renderMore } from "./views/more.js";
import { renderHealth } from "./views/health.js";
import { renderMoney } from "./views/money.js";
import { renderProfit } from "./views/profit.js";
import { renderGuide } from "./views/guide.js";
import { renderReceiptRegister } from "./views/receipt_register.js";
import { renderConsolidated } from "./views/consolidated.js";
import { renderProduction } from "./views/production.js";
import { renderDeliveryRun } from "./views/delivery_run.js";
import { renderScenario } from "./views/scenario.js";
import { renderLogin } from "./views/login.js";
import { renderLock } from "./views/lock.js";
import { refreshShareWarn } from "./sharewarn.js";
import { lockEnabled } from "./pin.js";
import { installSuggestionAccept } from "./suggest.js";
import { ENGINE_VERSION } from "./version.js";
import { maybeReloadForUpdate, startFreshnessWatch } from "./freshness.js";

const state = loadState();

// An empty field showing a greyed suggestion takes it on → (or on a tap of the
// arrow the app draws at its right edge, for a phone with no arrow key). Bound
// to the document because pop-ups and dialogs live outside #view.
installSuggestionAccept();

const routes = {
  "/dashboard": { title: "Munchies Furkidz", tab: "dashboard", render: renderDashboard },
  "/orders":    { title: "Orders",    tab: "orders",    render: renderOrders },
  "/products":  { title: "Products",  tab: "products",  render: renderProducts },
  "/ingredients":{ title: "Ingredients", tab: "more",   render: renderIngredients },
  "/po":        { title: "Purchase Order", tab: "more", render: renderPO },
  "/history":   { title: "PO History", tab: "more",     render: renderHistory },
  "/customers": { title: "Customers", tab: "customers", render: renderCustomers },
  "/deliveries":{ title: "Delivery Dates", tab: "more", render: renderDeliveries },
  "/parcel-couriers":{ title: "Parcel couriers", tab: "more", render: renderParcelCouriers },
  "/points":    { title: "Self collection Points", tab: "more", render: renderPoints },
  // ⚠️ THE AREAS ARE THE HEADINGS AND THE POINTS ARE THE PLACES — two screens, because they are
  // two jobs, and because the Points screen had to keep its shape (its own tests drive its first
  // child as the New-Point card). It is the Categories screen's twin, which is what she asked for.
  "/point-areas": { title: "Collection areas", tab: "more", render: renderPointAreas },
  // ★★ THE VAN ROUTES (v419). Her words: __"now i need few delivery routes, for one day delivery run
  // day"__. ⚠️ THE PATH AND THE TITLE BOTH SAY "DELIVERY", and that is not decoration: **"route" is
  // already this app's word for a hash route** — the table this line sits in is `const routes` — so a
  // bare `#/routes` would name two different things and a search would answer both.
  "/delivery-routes": { title: "Delivery routes", tab: "more", render: renderDeliveryRoutes },
  "/promo":     { title: "Promo codes", tab: "more",    render: renderPromoCodes },
  "/bring-a-friend": { title: "Bring a friend", tab: "more", render: renderReferrals },
  // ★ THE NAME IS HERS (v402). Her words: __"instead of send a van, change the term to Location pin for
  // Kitchen"__. ⚠️ **THE PATH IS DELIBERATELY UNCHANGED** — `#/send-van` is an address she may have
  // bookmarked or reached from another screen, and the app has never moved an address when it renamed
  // something. Only the words she reads change.
  "/send-van":  { title: "Location pin for Kitchen", tab: "more",    render: renderSendVan },
  "/message-style": { title: "Message style", tab: "more", render: renderMessageStyle },
  "/run":       { title: "Delivery run", tab: "more", render: renderDeliveryRun },
  "/money":     { title: "Money",      tab: "more",      render: renderMoney },
  "/profit":    { title: "Profit",     tab: "more",      render: renderProfit },
  "/receipts":  { title: "Receipt register", tab: "more", render: renderReceiptRegister },
  "/consolidated": { title: "Consolidated invoice", tab: "more", render: renderConsolidated },
  "/production":{ title: "Production line", tab: "more", render: renderProduction },
  "/scenario":  { title: "Scenario planner", tab: "more", render: renderScenario },
  "/units":     { title: "Units",      tab: "more",      render: renderUnits },
  "/reviews":   { title: "Reviews",    tab: "more",      render: renderReviews },
  "/suppliers": { title: "Suppliers",  tab: "more",      render: renderSuppliers },
  "/product-categories": { title: "Categories", tab: "more", render: renderProductCategories },
  "/settings":  { title: "Settings",  tab: "more",      render: renderSettings },
  "/more":      { title: "More",      tab: "more",      render: renderMore },
  "/guide":     { title: "Guide",     tab: "more",      render: renderGuide },
  "/health":    { title: "System check", tab: "more",   render: renderHealth },
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

// One-time catch-up (v68). Until now a customer's saved name and number were
// ignored by their orders, so anyone renamed before this version still has the
// old name on every order it belongs to — and that is what the labels and
// WhatsApp messages print. Bring those orders into line with the saved record
// once, then never again. Runs after the save hook so the corrected orders sync.
if (!state.settings.migratedV68) {
  reconcileContacts(state);
  state.settings.migratedV68 = true;
  save(state);
}

// One-time catch-up (v70). Orders taken before this version carry no record of
// the price or the name they were sold at, so they still move when the menu is
// repriced or renamed. Stamp them with today's values — which is exactly what
// they are showing right now — so they stop moving from here on. A line whose
// product is gone, or has no price, is left as it is rather than guessed at.
if (!state.settings.migratedV70) {
  for (const o of state.orders || []) stampOrderLine(o, byId(state.products || [], o.productId));
  state.settings.migratedV70 = true;
  save(state);
}

// ★★ One-time catch-up (v380) — the same shape as the v70 block above, for the
// COST. Her words: "when i change the ingredient cost, for age orders, will its
// COS change?" It did, because the books re-derived every line's cost from
// today's ingredient prices on every read. An order taken from this version on
// freezes its cost at the moment it is made; this stamps the orders she has
// ALREADY taken so they stop moving too.
//
// ⚠️⚠️ THIS CHANGES NO FIGURE ON ANY SCREEN. What it writes is exactly what each
// order is costing right now, because the live recipe is where the books were
// reading it from a moment ago. What it changes is that the number stops moving
// from here on.
//
// ⚠️⚠️ AND IT IS HONEST ABOUT WHAT IT IS NOT: the figure it locks on an order
// from March is TODAY'S recipe cost, not what that order cost her in March. The
// app never recorded one — `costLog` does not exist and the ingredient price log
// is never replayed — so there is nothing truer to write, and inventing a
// back-dated figure would be worse than freezing today's. The changelog says so
// in plain words.
//
// ⚠️ `o.unitCost != null` IS THE REAL GUARD, not the flag beside it: a restored
// backup, or a re-run after a lost setting, must never clobber a cost she has
// adjusted by hand. And `stampOrderLine` itself refuses a zero, so a product
// whose recipe prices to nothing yet is left following the live recipe rather
// than having 0 locked onto it for ever.
if (!state.settings.migratedV380) {
  for (const o of state.orders || []) {
    if (o.unitCost != null) continue;
    const p = byId(state.products || [], o.productId);
    if (p) stampOrderLine(o, p, costOf(state, p));
  }
  state.settings.migratedV380 = true;
  save(state);
}

// One-time catch-up (v120). A person used to be identified by their number's
// exact spelling, so a record saved as "+60123456789" and one saved as
// "60123456789" were two people — the Customers list showed the same customer
// twice. Bring the whole book onto the digits rule once (see
// canonicaliseCustomers), then never again. Runs after the v70 block and before
// the first render, so the duplicate is gone before anything is drawn.
if (!state.settings.migratedV120) {
  canonicaliseCustomers(state);
  state.settings.migratedV120 = true;
  save(state);
}

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
        "This screen couldn't load. Tap below to try again — if it keeps happening, tell the developer this message: " +
        String((err && err.message) || err)),
      button("Try again", render, "primary")));
  }
  viewEl.focus({ preventScroll: true });
  // ★★★ WHICH DAY THIS SCREEN WAS DRAWN FOR (v513) — see `dayMoved` beside `onSyncChanged`. ⭐ Written
  // HERE and nowhere else, so it can never claim a repaint that did not happen: ⚠️ the day check above
  // leaves it alone when it could not repaint (mid-edit, locked), so the next look tries again.
  drawnDay = todayISO();
  // Amber "Not sharing right now" strip — lives above the route, refreshed on
  // every render so it appears/disappears the moment the sharing state changes.
  refreshShareWarn(state);
}

// Start the periodic + event-driven pull (every ~30s, and on online/focus/
// visibility) and run an immediate refresh. Re-renders only when a pull
// changed data and no input is focused, so a remote edit can't clobber a form
// mid-edit. Safe to call again after a login lands — the loop registers once,
// but the immediate refresh re-runs so fresh data shows up right away.
function onSyncChanged() {
  if (!loggedOut && !lockedNow() && !isEditing()) render();
}

// ★★★ THE DAY THE SCREEN WAS LAST DRAWN FOR (v513).
//
// ⚠️⚠️ HER REPORT: __"it is the 1st time that i saw the app date not updated until i reload? Why?"__
// ⭐ **The app drew its date when the SCREEN was drawn and never looked at the clock again.** The Home
// hero reads `weekdayName(today), longDate(today)` off a `todayISO()` taken at render time — and **the
// only things that render are a navigation, a reload, and `onSyncChanged` when pulled data actually
// changed.** ⚠️ So an app left open (or resumed from the background) across midnight **kept yesterday's
// date until she reloaded** — and with shared data OFF the 30-second timer does nothing at all
// (`tick` returns at `if (!sync.pageActive()) return`), so nothing could ever repaint it.
//
// ⭐⭐ THE SHOP HAS SOLVED THIS SINCE v330-SOMETHING AND THE APP HAD NOT. The storefront's own 30-second
// poll **recomputes today every beat** — `upcomingDates(CONFIG)` and `isOpen(…, dateKey(new Date()))` —
// and redraws when the set of orderable days shifts, with a comment saying so in as many words: *"a day
// can cross its cut-off with no data change — drop closed days from the row even when the payload is
// otherwise identical."* ⚠️ **This is the same fault the run has had three times (v494, v507, v511): a
// question answered in one place and not the other.**
//
// ⭐ AND IT ASKS THE CLOCK WHEN SOMEONE LOOKS AT THE PAGE, which is v497's lesson arriving here: **a
// timer in a hidden page does not run, and the phone is put down overnight.** So the day is checked on
// coming back to the page and on the ordinary 30-second beat, and the repaint only happens if the DAY
// moved — once a day, not fifty times an hour.
//
// ⚠️ AND IT CANNOT MOVE HER: this app's `viewEl.scrollTop = 0` is a **no-op** (`#view` is
// `overflow: visible`; the DOCUMENT scrolls), so a repaint leaves her exactly where she was reading.
let drawnDay = "";
function dayMoved() {
  if (todayISO() === drawnDay) return false;
  if (loggedOut || lockedNow() || isEditing()) return false; // the next check will try again
  render();
  return true;
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
// ★ HOW MANY SHOP ORDERS THE LAST POLL COULD NOT READ (v364), so the screen can repaint when that
// CHANGES — including when it clears. ⚠️ Without this the Orders screen repainted only when
// something was IMPORTED, so the notice would have failed to appear when an order got stuck and,
// worse, failed to go when it came in — a warning that cannot clear is worse than none.
let lastStuckCount = -1;
function startIntake() {
  if (intakeStarted) return;
  intakeStarted = true;
  const tick = async () => {
    if (!sync.pageActive()) return;
    try {
      const r = await pullIncoming(state);
      const stuckNow = (r.stuck && r.stuck.length) || 0;
      if (r.imported && r.imported.length) {
        lastStuckCount = stuckNow;
        maybeSync(state); // new orders change slots-left → refresh availability
        onSyncChanged();
      } else if (stuckNow !== lastStuckCount) {
        lastStuckCount = stuckNow;
        // ⚠️ NOTHING OF HERS CHANGED — only what the intake could read — so this repaints the
        // notice and publishes nothing.
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
      maybeAutoBackup(state).catch(() => {});
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
  // ★★ AND A PHONE THAT IS BEHIND RE-LOADS ITSELF HERE, BEFORE THE LOCK (v383).
  //
  // Her report: __"some app user after keying in pin, but login to an old version app"__. The cause
  // was that the warning below was being painted UNDER the lock screen — a full-screen opaque panel
  // at layer 80 against the strip's layer 25 — so the one message that says "this phone is behind"
  // was never once visible to the person typing the PIN. Proved on a real screen: a tap at the
  // centre of that warning lands on the Unlock button.
  //
  // ⚠️⚠️ WHY IT RELOADS BEFORE THE LOCK RATHER THAN AFTER THE PIN. The app locks on EVERY open, so a
  // reload after a correct PIN would bring the lock back and make everyone type it twice, every
  // time — and the only way round that is to remember the unlock across a reload, which weakens the
  // gate. Doing it first costs nothing and **leaves the lock exactly as it was**: she keys the PIN
  // once and is already in the current build.
  //
  // ⚠️ It fires ONCE per build and then gives up (`maybeReloadForUpdate`), because a phone reloading
  // into the same stale file — a wedged deploy, a proxy serving an old copy — would otherwise loop
  // for ever and never reach a lock screen again. When it does give up, the strip below is what says
  // so, which is why that strip must be readable at the gate.
  if (await maybeReloadForUpdate({ running: ENGINE_VERSION })) return;
  // Before the gates, so a phone sitting on the lock or sign-in screen still
  // learns it is behind. GitHub Pages caches the app's code for ten minutes
  // with no build number in any URL, so a fix can be pushed and not arrive;
  // this is what makes that visible instead of silent.
  startFreshnessWatch({ running: ENGINE_VERSION });
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
      sync.login(state).then(() => { startSync(); maybeAutoBackup(state); }).catch(() => showLogin());
    } else {
      showLogin();
      return;
    }
  }
  render();
  startSync();
  startIntake();
  // A quiet daily/weekly/monthly cloud backup when it's due — fire-and-forget,
  // silent on any failure, at most one attempt per day.
  maybeAutoBackup(state).catch(() => {});
  // Adopt the latest published storefront (name/WhatsApp/tagline/QR) so this
  // phone shows whatever the most recent backoffice user set, not a baked copy.
  refreshStorefront(state);
  registerSW();
}

window.addEventListener("hashchange", render);

// ★★★ AND THE DAY IS ASKED WHENEVER THE PAGE IS COME BACK TO (v513) — registered HERE, beside the
// router's own listener, and **deliberately NOT inside `startSync()`**.
//
// ⚠️⚠️ THAT IS THE WHOLE BUG, AND IT IS WHY SHE SAW IT. The app's other visibility, focus and timer
// listeners live in **`startIntake()`** — and that, like `startSync()`, is only reached from `bootApp()`
// **after a sign-in**. ⚠️ **"Use without cloud sync" calls NEITHER**: its `onOffline` sets
// `loggedOut = false`, shows the tab bar and renders, and nothing else. ⭐ **So with shared data OFF —
// which is exactly the state she was in, her own screen read "Not sharing right now" — the app
// registered NO visibility, focus or timer listener whatsoever**, and nothing could ever have
// repainted the date but a navigation or a reload.
// ⚠️⚠️ **MY FIRST ATTEMPT PUT THIS CHECK IN `startIntake()`'s OWN `go()`, on the reasoning that "the
// timer is already there". MEASURED ON THE REAL APP, it did nothing: the clock said Sat 17 Oct, the
// hero still said Fri 16 Oct, and firing both `visibilitychange` and `focus` changed neither.**
// ⭐ **A fix placed on a code path the reporter's own state never reaches is not a fix** — and it read
// as correct. ⚠️ **I also wrote `startSync()` in the first draft of this very comment, which is the
// same mistake in miniature: the two functions are both "the loop that runs after sign-in", and the
// one thing that matters is the thing they have in common — she never gets there.**
//
// ⭐ The router's listeners run for EVERY session, sharing or not — which is exactly what a question
// about "which day is on screen" needs.
const checkDay = () => { if (dayMoved()) return; };
if (typeof window !== "undefined" && typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkDay(); });
  window.addEventListener("focus", checkDay);
  // ⚠️⚠️ AND THIS TIMER MUST NOT BE THE REASON A TEST FILE IS KEPT ALIVE. In a browser `setInterval`
  // hands back a number with no `unref`; **in Node it hands back a Timeout that HOLDS THE PROCESS OPEN.**
  // ⭐ MEASURED: registering this plainly made `test/customer-history-door.test.js` and
  // `test/customer-payment-truth.test.js` **hang for the full 20-second test timeout and report as
  // failures** — every test inside them passed, and the FILE was `not ok`. ⚠️ **That is exactly the
  // fault the shop's own `shopTimer` was written for, and it is written here for the same reason.**
  const dayTimer = setInterval(checkDay, 30000);
  if (dayTimer && typeof dayTimer.unref === "function") dayTimer.unref();
}

// Expose save/state to views that import from app.js without a cycle.
export { state, save };

boot();
