// admin/js/print_site.js — which printer a device's labels are for.
//
// ⭐ TWO SITES, ONE BOOK. A job is printed by the bridge whose own name matches it; ⚠️ **without a name every
// bridge would print every label, twice.** ⭐ The name is DEVICE-LOCAL (localStorage, not synced): the phone at
// the second site prints its labels there while both sites share one set of orders.

const KEY = "bakeadmin.printSite";

export function printSite() {
  try {
    const v = String(localStorage.getItem(KEY) || "").trim();
    return v || "main";
  } catch { return "main"; }
}

export function setPrintSite(name) {
  try {
    const v = String(name || "").trim().slice(0, 40);
    if (v) localStorage.setItem(KEY, v); else localStorage.removeItem(KEY);
    return v || "main";
  } catch { return "main"; }
}
