// views/settings.js — defaults, export/import backup, clear data.

import { el, button, confirmDialog, toast } from "../ui.js";
import { LS_KEY, newId, save } from "../state.js";
import { hashPin, isPin, hasStoredPin } from "../pin.js";
import { parseImport } from "../validate.js";
import { generateUpcomingDates, todayISO } from "../dates.js";
import { syncAvailability, cachedToken, signOut, syncStorefront, maybeSyncStorefront } from "../supabase.js";
import * as backups from "../backups.js";
import * as sync from "../sync.js";
import { refreshShareWarn } from "../sharewarn.js";
import { openSnapshotView } from "./snapshot.js";
import { CONFIG } from "../../../store/config.js";

export function renderSettings(root, state) {
  const dayNames = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const cur = state.settings;
  let dead = false; // the cloud-copies fill never touches the DOM after a re-render
  seedStorefront(state); // prefill the editor from store/config.js once, then stay editable

  const capInput = el("input", { class: "input", type: "number", inputmode: "numeric", min: 1,
    value: cur.defaultCapacity,
    onchange: () => { cur.defaultCapacity = Math.max(1, Number(capInput.value) || 12); save(state); maybeSyncStorefront(state); toast("Saved"); } });

  const cutoffInput = el("input", { class: "input", type: "time", value: cur.cutoff,
    onchange: () => { cur.cutoff = cutoffInput.value || "18:00"; save(state); maybeSyncStorefront(state); toast("Saved"); } });

  const dayChecks = [1, 2, 3, 4, 5, 6, 0].map((n) => {
    const box = el("input", { type: "checkbox", checked: cur.deliveryDays.includes(n),
      onchange: () => {
        if (box.checked && !cur.deliveryDays.includes(n)) cur.deliveryDays.push(n);
        if (!box.checked) cur.deliveryDays = cur.deliveryDays.filter((x) => x !== n);
        if (!cur.deliveryDays.length) { cur.deliveryDays = [n]; box.checked = true; } // never allow zero
        save(state); maybeSyncStorefront(state); toast("Saved");
      } });
    return el("label", { class: "daycheck" }, box, " ", dayNames[n]);
  });

  const daysCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Delivery settings"),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {},
        el("label", {}, "Capacity / day"),
        capInput,
        el("p", { class: "card-sub", style: "margin:4px 0 0" },
          "Only used when products have no daily limit — otherwise product limits are added together.")),
      el("div", {}, el("label", {}, "Order cut-off (day before)"), cutoffInput)),
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "Delivery days"),
      el("div", { class: "daychecks" }, ...dayChecks)));

  // ── App password (device-local lock) ────────────────────────────────────
  // A 4-digit PIN that gates the app on the next open of THIS phone only. The
  // password is stored as a SHA-256 fingerprint under settings.lock, which the
  // sync engine never touches — the sister's phone is unaffected.
  const lk = cur.lock ??= {};
  const lkInput = el("input", { class: "input", type: "password", inputmode: "numeric", maxlength: "4",
    autocomplete: "off", autocapitalize: "off", autocorrect: "off", spellcheck: "false",
    placeholder: "4 digits" });
  const lkStatus = el("p", { class: "card-sub", style: "margin:10px 0 0" });
  const updateLockStatus = () => {
    lkStatus.textContent = hasStoredPin(cur)
      ? "Password is set."
      : "No password set yet — set one before turning the lock on.";
  };
  updateLockStatus();
  const lkBtn = button("Save password", async () => {
    if (!isPin(lkInput.value)) { toast("Enter exactly 4 digits"); return; }
    lkBtn.disabled = true;
    lkBtn.textContent = "Saving…";
    try {
      lk.pinHash = await hashPin(lkInput.value);
      save(state);
      toast("Password set");
      lkInput.value = "";
      updateLockStatus();
    } finally {
      lkBtn.disabled = false;
      lkBtn.textContent = "Save password";
    }
  }, "soft");
  const lkOn = el("input", { type: "checkbox", checked: !!lk.enabled,
    onchange: () => {
      if (lkOn.checked && !hasStoredPin(cur)) {
        lkOn.checked = false;
        toast("Set a 4-digit password first");
        return;
      }
      lk.enabled = lkOn.checked;
      save(state);
      toast(lk.enabled ? "Password lock on — from next open" : "Password lock off");
    } });
  const lockCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "App password"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Locks only this phone — turn it on separately on the other phone. It asks for the password the next time you open the app."),
    el("div", { class: "field" },
      el("label", {}, "Password (4 digits)"),
      lkInput),
    el("div", { class: "btn-row", style: "margin-top:4px" }, lkBtn),
    el("label", { class: "daycheck", style: "margin-top:12px;display:inline-flex" },
      lkOn, " ", "Lock the app with a password"),
    lkStatus);

  // ── Storefront (customer page) ──────────────────────────────────────────
  // What customers see on store/. Edits here publish to Supabase; the store
  // page picks them up automatically (no redeploy). Prefilled once from
  // store/config.js so the current menu isn't re-typed.
  const sf = cur.storefront;
  const sfName = el("input", { class: "input", value: sf.name, placeholder: "Munchies Furkidz",
    onchange: () => { sf.name = sfName.value.trim(); save(state); maybeSyncStorefront(state); } });
  const sfWhatsapp = el("input", { class: "input", type: "tel", inputmode: "tel", value: sf.whatsapp,
    placeholder: "e.g. 60123456789",
    onchange: () => { sf.whatsapp = sfWhatsapp.value.trim(); save(state); maybeSyncStorefront(state); } });
  const sfTagline = el("input", { class: "input", value: sf.tagline, placeholder: "Handmade dehydrated pet treats",
    onchange: () => { sf.tagline = sfTagline.value.trim(); save(state); maybeSyncStorefront(state); } });
  const sfInsta = el("input", { class: "input", value: sf.instagram, placeholder: "e.g. munchiesfurkidz",
    onchange: () => { sf.instagram = sfInsta.value.trim(); save(state); maybeSyncStorefront(state); } });
  const sfFacebook = el("input", { class: "input", value: sf.facebook, placeholder: "e.g. munchiesfurkidz",
    onchange: () => { sf.facebook = sfFacebook.value.trim(); save(state); maybeSyncStorefront(state); } });
  const sfTngQr = el("input", { class: "input", type: "text", inputmode: "url", value: sf.tngQr,
    placeholder: "https://…/tng-qr.png",
    onchange: () => { sf.tngQr = sfTngQr.value.trim(); save(state); maybeSyncStorefront(state); } });

  // If another phone has published a storefront config, use it as the editor's
  // starting point instead of this phone's older local copy — so the WhatsApp
  // number shown here matches what customers actually see. Read-only (anon
  // key), no login needed; a missing row / offline just keeps the local copy.
  const scb = cur.supabase || {};
  if (scb.url && scb.anonKey) {
    fetch(`${String(scb.url).replace(/\/+$/, "")}/rest/v1/storefront_config?select=data&id=eq.default&limit=1`,
      { headers: { apikey: scb.anonKey } })
      .then((res) => (res.ok ? res.json() : []))
      .then((rows) => {
        const row = Array.isArray(rows) && rows[0];
        if (!row || typeof row.data !== "string") return;
        let remote;
        try { remote = JSON.parse(row.data); } catch { return; }
        if (!remote || typeof remote !== "object") return;
        if (!remote.name) return;
        sf.whatsapp = typeof remote.whatsapp === "string" ? remote.whatsapp : sf.whatsapp;
        sf.name = typeof remote.name === "string" ? remote.name : sf.name;
        sf.tagline = typeof remote.tagline === "string" ? remote.tagline : sf.tagline;
        sf.instagram = typeof remote.instagram === "string" ? remote.instagram : sf.instagram;
        sf.facebook = typeof remote.facebook === "string" ? remote.facebook : sf.facebook;
        sf.tngQr = typeof remote.tngQr === "string" ? remote.tngQr : sf.tngQr;
        save(state);
        sfName.value = sf.name;
        sfWhatsapp.value = sf.whatsapp;
        sfTagline.value = sf.tagline;
        sfInsta.value = sf.instagram;
        sfFacebook.value = sf.facebook;
        sfTngQr.value = sf.tngQr;
      })
      .catch(() => {});
  }

  const sfStatus = el("p", { class: "card-sub", style: "margin:10px 0 0" }, "Not published yet.");
  const sfBtn = button("Publish now", async () => {
    sfBtn.disabled = true;
    sfBtn.textContent = "Publishing…";
    const r = await syncStorefront(state);
    sfStatus.textContent = r.ok
      ? `Published at ${new Date(r.at).toLocaleTimeString()} — customers see it now.`
      : `Publish failed: ${r.reason}`;
    sfBtn.disabled = false;
    sfBtn.textContent = "Publish now";
  }, "primary");

  const storefrontCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Storefront (customer page)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "What customers see when they open the order page. Changes publish automatically; no redeploy needed."),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "Business name"), sfName),
      el("div", {}, el("label", {}, "WhatsApp number"), sfWhatsapp)),
    el("div", { class: "field", style: "margin-top:10px" }, el("label", {}, "Tagline"), sfTagline),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "Instagram handle"), sfInsta),
      el("div", {}, el("label", {}, "Facebook page"), sfFacebook)),
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "TNG QR code (image URL)"),
      sfTngQr,
      el("p", { class: "card-sub", style: "margin:4px 0 0" },
        "Shown on the customer's track page so they can pay by TNG. Paste a hosted image URL (e.g. an imgur / Google Drive link to a photo of your QR).")),
    el("h4", { style: "margin:14px 0 0" }, "Menu"),
    el("p", { class: "card-sub", style: "margin:4px 0 0" },
      "Your menu comes from More → Products — add or hide a product there and it updates here after you publish. WhatsApp is digits only with country code — 012-345 6789 → 60123456789."),
    el("div", { class: "btn-row", style: "margin-top:10px" }, sfBtn),
    sfStatus);

  // ── Mailing labels (post) ───────────────────────────────────────────────
  // The FROM block on the Mailing packing label. Kept in the phone's settings,
  // not published with the storefront — fill it on each phone that prints labels.
  const mailAddr = cur.mailingAddress ??= "";
  const mailBox = el("textarea", { class: "input", rows: 5, value: mailAddr,
    placeholder: "Munchies Furkidz\nYour house number, street, area\nTown, postcode, state\n012-345 6789",
    onchange: () => { cur.mailingAddress = mailBox.value.trim(); save(state); toast("Saved"); } });
  const mailingCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Mailing labels (post)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Printed as the FROM block on the Mailing label (shown on posted orders). One line per row — first line your business name, then the address, your phone last."),
    mailBox,
    el("p", { class: "card-sub", style: "margin:6px 0 0" },
      "A Mailing label prints FROM = this address, TO = the customer's name, phone and postal address, and ORDER = the code, date and items. Type it on each phone you print labels from."));

  const fileInput = el("input", { class: "input", type: "file", accept: "application/json,.json", style: "display:none",
    onchange: (e) => doImport(e) });

  // ── Nationwide postage (private sync, like shared business settings) ──────
  // The flat fee quoted on posted orders. It rides the PRIVATE shared-data row
  // (never the public storefront publish) so whichever phone set it last quotes
  // the same figure on both. postageSet marks "the owner has actually chosen a
  // value here", so a phone still at the default 8 cannot overwrite it.
  const sfPostage = el("input", { class: "input", type: "number", inputmode: "decimal", min: 0, step: "0.5",
    value: sf.postageRM == null ? "" : String(sf.postageRM),
    onchange: () => {
      sf.postageRM = Math.max(0, Number(sfPostage.value) || 0);
      sf.postageSet = true;
      save(state); toast("Saved");
    } });
  const postageCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Postage (nationwide posting)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "The flat posting fee added to the To-pay line on your WhatsApp confirmations for posted orders. Blank or 0 = no postage line. Shared with your other phones (last one you set wins) so they quote the same — never shown to customers."),
    el("div", { class: "field" },
      el("label", {}, "Flat postage per posted order (RM)"),
      sfPostage));

  const sb = (cur.supabase ??= {});
  const sbUrl = el("input", { class: "input", type: "text", inputmode: "url",
    placeholder: "https://xxxx.supabase.co", value: sb.url || "",
    onchange: () => { sb.url = sbUrl.value.trim(); save(state); toast("Saved"); } });
  const sbKey = el("input", { class: "input", type: "text",
    placeholder: "anon public key (eyJ…)", value: sb.anonKey || "",
    onchange: () => { sb.anonKey = sbKey.value.trim(); save(state); toast("Saved"); } });
  const sbEmail = el("input", { class: "input", type: "email", autocomplete: "off",
    placeholder: "you@example.com", value: sb.email || "",
    onchange: () => { sb.email = sbEmail.value.trim(); save(state); toast("Saved"); } });
  const sbPass = el("input", { class: "input", type: "password", autocomplete: "off",
    placeholder: "app login password", value: sb.password || "",
    onchange: () => { sb.password = sbPass.value; save(state); toast("Saved"); } });
  const sbOn = el("input", { type: "checkbox", checked: !!sb.enabled,
    onchange: () => {
      sb.enabled = sbOn.checked;
      save(state);
      toast(sb.enabled ? "Live availability on" : "Live availability off");
      if (sb.enabled) maybeSyncStorefront(state); // publish the seeded config right away
    } });
  const sbStatus = el("p", { class: "card-sub", style: "margin:10px 0 0" }, "Not synced yet.");
  const sbBtn = button("Sync now", async () => {
    sbBtn.disabled = true;
    sbBtn.textContent = "Syncing…";
    const r = await syncAvailability(state);
    sbStatus.textContent = r.ok
      ? `Synced ${r.pushed} upcoming date(s) at ${new Date(r.at).toLocaleTimeString()}.`
      : `Sync failed: ${r.reason}`;
    sbBtn.disabled = false;
    sbBtn.textContent = "Sync now";
  }, "primary");

  const supabaseCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Live availability (Supabase)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Publishes how many slots are left per delivery day to the storefront (\"4 left\" / \"Sold out\"). Updates automatically as orders are added. Setup steps are in the README → Live availability."),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "Supabase URL"), sbUrl),
      el("div", {}, el("label", {}, "Anon public key"), sbKey)),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "App login email"), sbEmail),
      el("div", {}, el("label", {}, "App login password"), sbPass)),
    el("label", { class: "daycheck", style: "margin-top:12px;display:inline-flex" },
      sbOn, " ", "Enable live availability"),
    el("div", { class: "btn-row", style: "margin-top:10px" }, sbBtn),
    sbStatus);

  const cld = (cur.cloud ??= {});
  const signedIn = !!cachedToken();
  const cldOn = el("input", { type: "checkbox", checked: !!cld.enabled,
    onchange: () => {
      cld.enabled = cldOn.checked;
      save(state);
      if (cld.enabled) {
        toast("Shared data on — restarting to sign in");
        location.reload();
      } else {
        toast("Shared data off — this phone now works alone");
        // No reload on disable, so refresh the amber strip in place: this phone
        // is exactly the "not sharing" state the banner exists to make visible.
        refreshShareWarn(state);
      }
    } });
  const cldStatus = el("p", { class: "card-sub", style: "margin:10px 0 0" }, "Not synced yet.");
  const cldBtn = button("Sync now", async () => {
    cldBtn.disabled = true;
    cldBtn.textContent = "Syncing…";
    const r = await sync.refresh(state);
    cldStatus.textContent = r.ok
      ? (r.changed
          ? "Synced — new data from the other phone loaded."
          : "Synced — everything is up to date.")
      : `Sync failed: ${r.reason}`;
    cldBtn.disabled = false;
    cldBtn.textContent = "Sync now";
  }, "primary");
  const cldSignBtn = signedIn
    ? button("Sign out", () => {
        confirmDialog("Sign out of shared data? Live availability publishing pauses until you sign in again on this phone.",
          () => {
            sb.password = ""; // don't auto-login on next open
            signOut();
            save(state);
            location.reload();
          }, { danger: true, yesLabel: "Sign out" });
      }, "soft")
    : button("Sign in", () => location.reload(), "soft");

  const sharedCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Shared data (cloud)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Keeps the same orders, products, ingredients and delivery dates on every phone that signs in. Every change syncs automatically (no need to press anything); the other phone catches up within ~30 seconds. Works offline — edits queue up and push when the connection returns. Uses the Supabase login above."),
    el("label", { class: "daycheck", style: "display:inline-flex" },
      cldOn, " ", "Enable shared data"),
    el("div", { class: "btn-row", style: "margin-top:10px" },
      cldBtn,
      cldSignBtn),
    el("p", { class: "card-sub", style: "margin:8px 0 0" },
      signedIn ? `Signed in with ${sb.email || "your Supabase login"}.` : "Not signed in."),
    cldStatus);

  const bkZone = el("div", { style: "margin-top:14px;border-top:1px solid var(--line);padding-top:4px" });
  const backupCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Backup & safety"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "Every day you open the app, a Daily copy of your data saves to your Supabase cloud — a Weekly copy on Mondays, a Monthly copy on the 1st. It keeps the newest 7 daily, 4 weekly and 3 monthly, and Manual copies stay until you delete them. Restore steps your phone (and the shared cloud) back to that copy."),
    el("div", { class: "btn-row" },
      button("⬇ Export backup", () => exportState(state), "primary"),
      button("⬆ Import backup", () => fileInput.click(), "soft")),
    fileInput,
    bkZone);

  const dangerCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Danger zone"),
    el("div", { class: "btn-row" },
      button("Delete all data", () => clearAll(), "danger")));

  // ── Referrals (bring-a-friend) ──────────────────────────────────────────
  // Scheme numbers behind the "one coupon per NEW friend" offer. Stored in
  // settings (synced across phones); the Customers screen and the Give credit
  // buttons on Orders read them from here.
  const ref = cur.referrals ??= {};
  const refOn = el("input", { type: "checkbox", checked: ref.enabled === true,
    onchange: () => {
      ref.enabled = refOn.checked;
      save(state);
      toast(ref.enabled ? "Bring-a-friend on — share buttons appear on Customers" : "Bring-a-friend off");
    } });
  const refFriend = el("input", { class: "input", type: "number", inputmode: "decimal", min: 0, step: "1",
    value: (Number(ref.friendRM) || 3), style: "max-width:110px",
    onchange: () => {
      const v = Number(refFriend.value);
      ref.friendRM = Number.isFinite(v) && v > 0 ? v : 3;
      refFriend.value = ref.friendRM;
      save(state); toast("Saved");
    } });
  const refReferrer = el("input", { class: "input", type: "number", inputmode: "decimal", min: 0, step: "1",
    value: (Number(ref.referrerRM) || 3), style: "max-width:110px",
    onchange: () => {
      const v = Number(refReferrer.value);
      ref.referrerRM = Number.isFinite(v) && v > 0 ? v : 3;
      refReferrer.value = ref.referrerRM;
      save(state); toast("Saved");
    } });
  const refDays = el("input", { class: "input", type: "number", inputmode: "numeric", min: 0,
    placeholder: "90", value: ref.validDays === "" || ref.validDays == null ? "" : String(ref.validDays),
    style: "max-width:110px",
    onchange: () => {
      const raw = String(refDays.value).trim();
      if (raw === "") { ref.validDays = ""; }
      else {
        const v = Math.floor(Number(raw));
        ref.validDays = Number.isFinite(v) && v > 0 ? v : "";
      }
      refDays.value = ref.validDays === "" ? "" : String(ref.validDays);
      save(state); toast("Saved");
    } });
  const referralsCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Referrals (bring-a-friend)"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      "The deal: a friend who is NEW to you gets money off their first order when they order through a customer's link, and that customer earns a credit. You apply the actual discount yourself when you confirm on WhatsApp."),
    el("label", { class: "daycheck", style: "display:inline-flex" },
      refOn, " ", "Show bring-a-friend on Customers & new referred orders"),
    el("div", { class: "form-grid", style: "margin-top:10px" },
      el("div", {}, el("label", {}, "Friend's first-order discount (RM)"), refFriend),
      el("div", {}, el("label", {}, "Referrer's credit (RM)"), refReferrer)),
    el("div", { class: "field", style: "margin-top:10px" },
      el("label", {}, "Credit valid for … days (blank = never)"),
      refDays,
      el("p", { class: "card-sub", style: "margin:4px 0 0" },
        "Customer share messages live on More → Customers — open a customer to copy theirs. Give credit appears on a referred order in Orders.")));

  const sampleCard = (!state.products.length && !state.ingredients.length)
    ? el("div", { class: "card" },
        el("h3", { style: "margin:0 0 4px" }, "Try sample data"),
        el("p", { class: "card-sub", style: "margin:0 0 10px" },
          "Nothing here yet. Load a demo — chicken jerky + duck jerky with a few orders — to see how the app works, then replace it with real data."),
        el("div", { class: "btn-row" },
          button("Load sample data", () => loadSample(state), "soft")))
    : null;

  root.replaceChildren(daysCard, lockCard, storefrontCard, postageCard, referralsCard, mailingCard, supabaseCard, sharedCard, backupCard, dangerCard, sampleCard);

  function doImport(e) {
    const file = e.target.files && e.target.files[0];
    e.target.value = "";
    if (!file) return;
    file.text().then((text) => {
      let data;
      try { data = parseImport(text); }
      catch (err) { toast(err.message); return; }
      const counts = `${data.products.length} products · ${data.ingredients.length} ingredients · ${data.orders.length} orders`;
      confirmDialog(`Replace ALL current data with this backup? (${counts})`,
        () => {
          localStorage.setItem(LS_KEY, JSON.stringify(data));
          location.reload();
        }, { danger: true, yesLabel: "Replace" });
    }).catch(() => toast("Couldn't read that file"));
  }

  function clearAll() {
    confirmDialog("Delete ALL data (products, ingredients, orders, history)? This cannot be undone.",
      () => {
        confirmDialog("Really sure? Export a backup first if you're not.",
          () => {
            localStorage.removeItem(LS_KEY);
            location.reload();
          }, { danger: true, yesLabel: "Delete everything" });
      }, { danger: true, yesLabel: "Continue" });
  }

  // ── Cloud copies (Backup & safety card) ─────────────────────────────────
  // The cloud section loads after the card renders, so the list fetch never
  // blocks the settings screen. `dead` stops a fill that outlives a re-render
  // (app.js treats a returned function as route cleanup, like Reviews does).
  function rowEl(row) {
    const meta = [];
    if (row.summary) meta.push(row.summary);
    if (row.engine) meta.push(`Engine ${row.engine}`);
    return el("div", { style: "margin-top:10px;border:1px solid var(--line);border-radius:10px;padding:10px 12px" },
      el("p", { class: "card-title", style: "margin:0 0 2px" },
        String(row.label || row.kind || "Backup")),
      el("p", { class: "card-sub", style: "margin:0 0 8px" }, meta.join(" · ")),
      el("div", { class: "btn-row", style: "margin:0" },
        button("View", () => viewOne(row), "soft"),
        button("Restore", () => restoreOne(row), "primary"),
        button("Download", () => downloadOne(row), "ghost"),
        button("Delete", () => deleteOne(row), "ghost")));
  }

  function viewOne(row) {
    // Read-only: opens the copy in a window, changes nothing (no localStorage,
    // no markDirty, no reload) — a safe way to check an old detail.
    openSnapshotView(state, row);
  }

  function restoreOne(row) {
    confirmDialog(
      `Rewind to "${row.label || "this backup"}"? Everything added after it — orders, products, edits — is removed from this phone AND your shared cloud, and from your other phone when it next syncs. A "Before restore" copy is saved first, so you can undo this.`,
      async () => {
        const r = await backups.restoreSnapshot(state, row);
        if (!r.ok) return toast(String(r.reason || "Restore failed"));
        toast("Restored — reloading…");
        location.reload();
      }, { danger: true, yesLabel: "Restore" });
  }

  function downloadOne(row) {
    backups.getBackup(state, row.id).then((g) => {
      if (!g.ok) return toast(String(g.reason || "Couldn't load that copy"));
      const when = backups.dateKey(g.row.created_at);
      downloadJSON(backups.backupFileName(when, g.row.kind), JSON.stringify(backups.exportEnvelope(g.row), null, 2));
      toast("Downloaded — look in your phone's downloads.");
    });
  }

  function deleteOne(row) {
    confirmDialog(`Delete the "${row.label || "backup"}" copy? This can't be undone.`,
      async () => {
        const r = await backups.deleteSnapshots(state, [row.id]);
        if (!r.ok) return toast(String(r.reason || "Delete failed"));
        toast("Copy deleted.");
        fillBackups();
      }, { danger: true, yesLabel: "Delete" });
  }

  async function fillBackups() {
    const show = (...nodes) => { if (!dead) bkZone.replaceChildren(...nodes); };
    const line = (text) => el("p", { class: "card-sub", style: "margin:8px 0 0" }, text);
    if (!backups.ready(state)) {
      show(line("Cloud copies turn on with Shared data — when it's on and you're signed in, opening the app saves a Daily copy on its own. You can still Export a file anytime."));
      return;
    }
    const list = await backups.listBackups(state);
    if (dead) return;
    if (!list.ok) {
      show(line(String(list.reason || "Cloud copies couldn't load. Check you're online and try again.")));
      return;
    }
    const rows = list.rows;
    const today = todayISO();
    const daily = rows.find((r) => r.kind === "daily" && backups.dateKey(r.created_at) === today);
    const when = rows[0] ? backups.localWhen(rows[0].created_at) : "";
    const status = daily ? "Daily copy saved today."
      : when ? `Last cloud copy ${when}.`
      : "No cloud copies yet — the first saves on its own the next time you open the app.";
    const btn = button("Back up to cloud now", async () => {
      btn.disabled = true;
      btn.textContent = "Saving…";
      const r = await backups.backupNow(state);
      btn.disabled = false;
      btn.textContent = "Back up to cloud now";
      if (!r.ok) return toast(String(r.reason || "Backup failed"));
      toast(`Saved a manual copy at ${backups.localWhen(r.at)}.`);
      fillBackups();
    }, "soft");
    const kids = [line(status), el("div", { class: "btn-row", style: "margin-top:8px" }, btn)];
    if (rows.length) {
      kids.push(el("p", { class: "card-sub", style: "margin:12px 0 4px" }, "Recent copies (newest first)"));
      kids.push(...rows.map(rowEl));
    }
    show(...kids);
  }

  fillBackups();
  return () => { dead = true; };
}

function loadSample(state) {
  const ingredients = [
    { id: newId("ing"), name: "Chicken breast", unit: "g", costPerUnit: 0.013, purchaseNote: "RM13 / kg, wet market", active: true },
    { id: newId("ing"), name: "Duck breast", unit: "g", costPerUnit: 0.026, purchaseNote: "RM26 / kg, online", active: true },
    { id: newId("ing"), name: "Sweet potato", unit: "g", costPerUnit: 0.008, purchaseNote: "RM8 / kg, pasar", active: true },
    { id: newId("ing"), name: "Fine salt", unit: "g", costPerUnit: 0.004, active: true },
  ];
  const [chicken, duck, sweetpotato, salt] = ingredients;
  const products = [
    { id: newId("prd"), name: "Chicken Jerky", unit: "pouch", price: 22, active: true, recipe: [
      { ingredientId: chicken.id, qty: 160, unit: "g" },
      { ingredientId: salt.id, qty: 2, unit: "g" } ] },
    { id: newId("prd"), name: "Duck Jerky", unit: "pouch", price: 24, active: true, recipe: [
      { ingredientId: duck.id, qty: 160, unit: "g" },
      { ingredientId: salt.id, qty: 2, unit: "g" } ] },
    { id: newId("prd"), name: "Sweet Potato Chews", unit: "pouch", price: 15, active: true, recipe: [
      { ingredientId: sweetpotato.id, qty: 200, unit: "g" } ] },
  ];
  const deliveryDates = generateUpcomingDates(state.settings, 3, [])
    .map((date) => ({ id: newId("del"), date, notes: "" }));
  const orders = [];
  if (deliveryDates[0]) {
    orders.push(
      { id: newId("ord"), deliveryDateId: deliveryDates[0].id, productId: products[0].id, qty: 3,
        customerName: "Aunty Bee", note: "extra soft for a senior dog", createdAt: new Date().toISOString() },
      { id: newId("ord"), deliveryDateId: deliveryDates[0].id, productId: products[2].id, qty: 2,
        customerName: "Mr Lim", note: "", createdAt: new Date().toISOString() });
  }
  Object.assign(state, { ingredients, products, deliveryDates, orders, purchaseOrders: [] });
  save(state);
  toast("Sample data loaded");
  renderSettings(document.getElementById("view"), state);
}

// One-time prefill of the storefront text fields from store/config.js, so the
// bakery name/tagline/links aren't re-typed by hand. Runs on first visit to
// Settings; from then on the editor is the source of truth and this is a no-op.
// Does NOT publish: on a multi-phone setup a fresh phone's config.js fallback
// must not overwrite what another phone already published — the live pull in
// renderSettings replaces these values when a published config exists. The
// storefront menu is not seeded here — it comes from More → Products.
function seedStorefront(state) {
  const sf = state.settings.storefront;
  if (sf.name) return;
  Object.assign(sf, {
    whatsapp: CONFIG.whatsapp || "",
    name: CONFIG.name || "",
    tagline: CONFIG.tagline || "",
    instagram: CONFIG.instagram || "",
    facebook: CONFIG.facebook || "",
    tngQr: CONFIG.tngQr || "",
  });
  save(state);
}

function exportState(state) {
  const payload = {
    app: "furkidz",
    formatVersion: 1,
    exportedAt: new Date().toISOString(),
    data: state,
  };
  downloadJSON(`furkidz-backup-${todayISO()}.json`, JSON.stringify(payload, null, 2));
}

// Save a text file under a chosen name. Shared by Export (local, keeps the
// connection details so a new phone is preconfigured) and by downloading a
// cloud copy (backups.js, wrapped in the same envelope, so it re-imports too).
function downloadJSON(name, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
