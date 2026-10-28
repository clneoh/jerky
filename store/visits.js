// store/visits.js — one look per page load, counted in her own Supabase (v674).
//
// ⭐ Her question: __"how many people looked and did not buy"__. ⚠️⚠️ **IT COUNTS LOOKS, NOT PEOPLE** — no cookie,
// no fingerprint, no address is kept, so three looks by one person are three looks and a link preview can be one
// with nobody behind it. ⭐ That is enough for the question she asked (*did anyone come, and did they order?*) and
// it cannot answer "how many customers"; a figure that claimed to would be invented.
//
// ⭐ A module of its own so it can be tested without the shop: importing `app.js` runs the whole page.

// ⚠️ ONE LOOK PER PAGE LOAD. The latch is here, at module scope, for the same reason the label count's is: the
// shop re-renders on every 30-second poll, and a latch that reset with a render would count the same look again
// and again until the tab closed.
export function shopLookCounter(doPost) {
  let counted = false;
  return (page, cfg) => {
    if (counted) return false;
    // ⚠️ A page with no cloud configured must not burn its one count: the config arrives AFTER the first paint,
    // and a look lost here would be a look nobody ever counted.
    if (!cfg || !cfg.url || !cfg.anonKey) return false;
    counted = true;
    doPost(page, cfg);
    return true;
  };
}

// The POST itself. Exported so its address, its headers and its payload can be read in a test.
export function postShopLook(page, cfg) {
  const base = String(cfg.url).replace(/\/+$/, "");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  return fetch(`${base}/rest/v1/shop_visits`, {
    method: "POST",
    headers: {
      apikey: cfg.anonKey,
      "Content-Type": "application/json",
      // INSERT-only RLS: asking for the row back would be a read, and reading is not granted.
      Prefer: "return=minimal",
    },
    body: JSON.stringify([{ page }]),
    signal: controller.signal,
  }).catch(() => {}).finally(() => clearTimeout(timer));
}
