// views/customers.js — who ordered what, when, and how to reach them.
// Each row is one customer across their whole history: 💬 opens a WhatsApp chat
// with them, tapping the row shows their full order history in a pop-up, and
// "Pick who to message" turns the list into checkboxes so the baker can copy
// their numbers or a note that starts with each person's name. WhatsApp can't
// send one note to many at once, so the copies are there to paste per chat.

import { navigate } from "../app.js";
import { customerList, ordersForCustomer, phoneDigits } from "../customers.js";
import { attachProfiles, customerMatches, customerRowName, mergeCustomers, profileFor, removeProfile, upsertProfile } from "../profiles.js";
import { readPhoto } from "../photo.js";
import { el, button, select, emptyState, showPopup, copyText, toast, confirmDialog } from "../ui.js";
import { byId, fmtRM, orderLineName, save, waNumber } from "../state.js";
import { longDate, todayISO, weekdayName } from "../dates.js";
import { maybeSync } from "../supabase.js";
import {
  ROLE_LABEL, schemeOf, referralLink, shareMessage, followupMessage, creditRows,
  markCreditUsed, setCreditExpiry, removeCredit, addManualCredit,
  rewardStanding, giveReward, removeRewardGrant,
} from "../referrals.js";

const SORTS = [
  { value: "recent", label: "Most recent" },
  { value: "name", label: "Name A–Z" },
  { value: "orders", label: "Most orders" },
  { value: "units", label: "Most units" },
];
const WHOS = [
  { value: "all", label: "Everyone" },
  { value: "phone", label: "Has a WhatsApp number" },
  { value: "recent30", label: "Ordered in the last 30 days" },
  { value: "gone30", label: "Has WhatsApp, not in 30 days" },
];
const STATUS_LABEL = {
  new: "New", confirmed: "Confirmed", paid: "Paid",
  baking: "Preparing", ready: "Packed", delivered: "Delivered",
};

// Picked-for-messaging set and the compose text live for this screen so a
// filter change or a re-render never drops a selection mid-compose.
let picked = new Set();
let messageBody = "";
// Which language the copied "follow-up" is written in this session (English
// unless the baker switches it before copying).
let followupLang = "en";

const short = (iso) => (iso ? `${weekdayName(iso)} ${iso.slice(8)}` : "");
const dateLine = (iso) => (iso ? `${weekdayName(iso)}, ${longDate(iso)}` : "");
const money = (state, n) => fmtRM(n, state.settings?.currency || "RM");
// What they bought, named as it was sold (the order's own record), so a later
// rename doesn't rewrite their history.
const productName = (state, o) => orderLineName(state, o);
// The product object from their most recent order (name + servingTip), so the
// follow-up can ask about it AND recommend how to serve it. No history → null.
const recentProduct = (state, blocks) => {
  const first = blocks && blocks[0];
  const line = first && first.lines && first.lines[0];
  return line ? byId(state.products || [], line.productId) || null : null;
};

function openChat(r) {
  const w = waNumber(r.whatsapp);
  if (!w) return;
  const name = customerRowName(r);
  const text = name && name !== "(no name)" ? `Hi ${name}!` : "Hi!";
  window.open(`https://wa.me/${w}?text=${encodeURIComponent(text)}`, "_blank");
}

export function renderCustomers(root, state, params) {
  const sortRaw = params.get("sort");
  const whoRaw = params.get("who");
  const sort = SORTS.some((s) => s.value === sortRaw) ? sortRaw : "recent";
  const who = WHOS.some((w) => w.value === whoRaw) ? whoRaw : "all";
  const pick = params.get("pick") === "1";
  const today = todayISO();

  const shown = customerList(state, sort, who, today);
  const all = who === "all" ? shown : customerList(state, sort, "all", today);
  const phoneShown = shown.filter((r) => r.whatsapp).length;
  // How many of the people on screen she added herself (v290) — named in the count above, so the
  // total cannot read as "everyone here has ordered from me".
  const addedCount = shown.filter((r) => r.manual).length;

  // Re-renders via the selects keep every setting (sort, who, pick) in the URL.
  const nav = (p) => navigate(`#/customers?sort=${sortSel.value}&who=${whoSel.value}${p ? "&pick=1" : ""}`);
  const sortSel = select(SORTS, sort, () => nav(pick), "");
  const whoSel = select(WHOS, who, () => nav(pick), "");

  // Finder: like "find an order" — 2+ characters narrows the list live across
  // name, number, dog name, likes/avoid/notes and favourite product.
  let query = "";
  const finder = el("input", {
    class: "input", type: "search", autocomplete: "off",
    placeholder: "Find a customer — name, number, pet, likes…",
    oninput: () => { query = finder.value; drawList(); },
  });
  const finderCount = el("p", { class: "card-sub", style: "margin:6px 0 0" });

  const msgCard = el("div", { class: "card" });
  const listBox = el("div");

  root.replaceChildren(
    el("div", { class: "card" },
      el("h2", { style: "margin:0 0 2px" }, "Customer list"),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        // "in your history" stopped being true the moment a person could be added by hand (v290):
        // a partner she recruited has no history at all. The count says what it counts.
        who === "all"
          ? `${shown.length} customer${shown.length === 1 ? "" : "s"}${addedCount ? `, ${addedCount} added by hand` : ""} · ${phoneShown} with a WhatsApp number.`
          : `${shown.length} of ${all.length} customer${all.length === 1 ? "" : "s"} match — tap a name to see their history.`),
      el("div", { class: "two-col" },
        el("div", { class: "field" }, el("label", {}, "Who to look at"), whoSel),
        el("div", { class: "field" }, el("label", {}, "Sort by"), sortSel)),
      finder,
      finderCount),
    // SOMEONE SHE ADDS HERSELF (v290). Until this, a person existed only by ordering — so a
    // partner recruited to hand labels out had nowhere to live, and could not be named as a promo
    // code's owner. It opens the SAME editor the profile card uses, in its creating shape.
    el("div", { class: "card" },
      el("h2", { style: "margin:0 0 2px" }, "New customer"),
      el("p", { class: "card-sub", style: "margin:0 0 10px" },
        "Someone who has not ordered yet — a partner who hands your labels out, or a friend who sends people your way. They join this same list under “Added by hand”, they can be given a reward and a code, and the moment they order they move up into the list proper. A name or a number is enough to start."),
      button("＋ Add a customer", () => editProfilePopup(
        state,
        { _key: "", name: "", whatsapp: "", profile: null },
        drawList,
        { newCustomer: true },
      ), "soft")),
    msgCard,
    el("h2", { class: "section" },
      who === "gone30" ? "Quiet customers — no order in 30 days"
        : who === "recent30" ? "Recent customers — ordered in 30 days"
        : who === "phone" ? "Customers with a WhatsApp number"
        : "Customers"),
    listBox);

  // The list is re-derived on every draw, never off the `shown` snapshot taken
  // above: a rename re-keys the customer, so their old row no longer joins to
  // the profile that carries the new name, and the row would go stale.
  function visibleRows(snapshot) {
    const rows = attachProfiles(state, snapshot);
    const q = String(query).trim();
    return q.length < 2 ? rows : rows.filter((r) => customerMatches(r, q));
  }

  function drawList() {
    const now = customerList(state, sort, who, today);
    const rows = visibleRows(now);
    const q = String(query).trim();
    if (!now.length) {
      finderCount.textContent = "";
      listBox.replaceChildren(emptyState(
        who === "all" ? "No customers yet" : "Nobody matches",
        who === "all"
          ? "Orders you add in the Orders tab appear here, keeping their WhatsApp numbers for follow-ups."
          : who === "phone"
          ? "No one here has a WhatsApp number yet — add phone numbers when you take an order (Edit on the order)."
          : "Change the Who filter above to see everyone."));
      return;
    }
    if (!rows.length) {
      finderCount.textContent = "";
      listBox.replaceChildren(emptyState("Nothing found", `No customer matches “${query}” — try their name, number or their pet's name.`));
      return;
    }
    finderCount.textContent = q.length >= 2 ? `${rows.length} of ${now.length} match “${q}”` : "";
    // THE HEADING SHE ASKED FOR (v290). It is a GROUPING, not a second list: the hand-added people
    // are in the same book, counted, exportable, messageable and offered by the order form's own
    // name suggestions — they are only drawn apart, so the list never reads as though they had
    // ordered. Grouped under EVERY sort (under `name` they would otherwise be interleaved), and
    // they are zero under `orders`/`units`/`recent` so the top of the list is unchanged.
    const ordered = rows.filter((r) => !r.manual);
    const added = rows.filter((r) => r.manual);
    const nodes = ordered.map(rowEl);
    if (added.length) {
      nodes.push(el("h3", { class: "section" }, `Added by hand — no orders yet (${added.length})`));
      nodes.push(...added.map(rowEl));
    }
    listBox.replaceChildren(...nodes);
  }

  function rowEl(r) {
    const on = picked.has(r._key);
    const mark = el("span", { class: `pick-mark${on ? " on" : ""}` }, on ? "✓" : "");
    const row = el("div", { class: `list-item tappable${on ? " picked" : ""}${pick ? " picking" : ""}` });
    const setVisual = () => {
      const now = picked.has(r._key);
      row.classList.toggle("picked", now);
      mark.classList.toggle("on", now);
      mark.textContent = now ? "✓" : "";
      refreshMsg();
    };
    row.onclick = pick
      ? () => { picked.has(r._key) ? picked.delete(r._key) : picked.add(r._key); setVisual(); }
      : () => openHistory(state, r, drawList);

    const subs = [
      r.whatsapp ? `📱 ${r.whatsapp}` : "No number saved",
      // SOMEONE SHE ADDED BY HAND HAS NO ORDERS (v290), and "0 orders · 0 units · about RM 0.00"
      // is the shape this app uses for a broken screen, not for a fact. It says what is true.
      r.manual
        ? "Added by hand — no orders yet"
        : `${r.orders} order${r.orders === 1 ? "" : "s"} · ${r.units} unit${r.units === 1 ? "" : "s"} · ${r.totalSpend > 0 ? `about ${money(state, r.totalSpend)}` : "no prices set"}${r.fav ? ` · likes ${r.fav}` : ""}`,
    ];
    if (r.lastOrdered) {
      subs.push(`last ${short(r.lastOrdered)}${r.last && r.last !== r.lastOrdered ? ` · delivered ${short(r.last)}` : ""}`);
    }
    // A saved profile adds a small line under the row — the dog, why they stand out, and HER OWN
    // NOTE (v290). `notes` has to be in the GUARD as well as in the line below: until this, a
    // customer whose only saved detail was a note drew nothing at all.
    if (r.profile && (r.profile.dogName || r.profile.likes || r.profile.avoid || r.profile.notes)) {
      const bits = [];
      if (r.profile.dogName) bits.push(`🐾 ${r.profile.dogName}`);
      if (r.profile.likes) bits.push(`likes ${r.profile.likes}`);
      if (r.profile.avoid) bits.push(`avoids ${r.profile.avoid}`);
      if (bits.length) subs.push(bits.join(" · "));
      // THE REMARK, on a line of its own and clamped to one (see .li-note in app.css): a note is
      // free text and "Anything to remember" can be a whole sentence. The row must not grow to
      // four lines and bury the list — the whole note is one tap away in the profile card.
      if (r.profile.notes) subs.push(el("div", { class: "li-sub li-note" }, r.profile.notes));
    }

    row.append(
      el("div", { class: "li-main" },
        el("div", { class: "li-title" }, avatarEl(r.profile, "sm"), el("span", {}, customerRowName(r))),
        // A sub-line is a string, which gets the plain wrapper — except the note, which arrives
        // already wrapped so it can carry a class of its own.
        ...subs.map((s) => (s && s.nodeType ? s : el("div", { class: "li-sub" }, s)))),
      el("div", { class: "li-right" },
        r.whatsapp ? button("💬 Chat", (ev) => { ev.stopPropagation(); openChat(r); }, "ghost small") : null,
        mark));
    return row;
  }

  const statusEl = el("p", { class: "card-sub", style: "margin:0 0 8px" });
  const bodyInput = el("input", { class: "input", value: messageBody,
    placeholder: "Your message, e.g. “your order is ready to collect!”",
    oninput: () => { messageBody = bodyInput.value; refreshMsg(); } });
  const previewEl = el("div", { class: "msg-preview" });
  const numBtn = button("", () => copyList(rowsPicked()), "soft");
  const greetBtn = button("", () => copyGreetings(rowsPicked()), "primary");

  function drawMsgCard() {
    if (!pick) {
      msgCard.replaceChildren(
        el("h2", { style: "margin:0 0 2px" }, "Message customers"),
        el("p", { class: "card-sub", style: "margin:0 0 10px" },
          "💬 on a row opens WhatsApp for that person. To reach several people at once, pick who you want, then copy their numbers or a note that starts with their name."),
        el("div", { class: "btn-row" },
          button("☑ Pick who to message", () => nav(true), "primary"),
          button(phoneShown ? `Copy numbers (${phoneShown})` : "Copy numbers", () => copyList(shown), "soft"),
          button("⤓ CSV", () => downloadCsv(shown), "ghost")));
      return;
    }
    msgCard.replaceChildren(
      el("h2", { style: "margin:0 0 2px" }, "Pick who to message"),
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        "Tap names to select them. WhatsApp can't send one note to many at once, so copy what's below and paste it into each chat."),
      statusEl,
      el("label", {}, "Your message"),
      bodyInput,
      previewEl,
      el("div", { class: "btn-row" }, greetBtn, numBtn),
      el("div", { class: "btn-row" },
        button("Done", () => nav(false), "ghost"),
        button("Pick all shown", () => { shown.forEach((r) => picked.add(r._key)); drawList(); refreshMsg(); }, "ghost"),
        button("Clear picked", () => { picked.clear(); drawList(); refreshMsg(); }, "ghost")));
    refreshMsg();
  }

  function rowsPicked() {
    return shown.filter((r) => picked.has(r._key));
  }

  function refreshMsg() {
    const ph = rowsPicked().filter((r) => r.whatsapp);
    const b = String(messageBody).trim();
    const first = ph[0];
    numBtn.textContent = ph.length ? `Copy numbers (${ph.length})` : "Copy numbers";
    numBtn.disabled = !ph.length;
    greetBtn.textContent = ph.length ? `Copy greeting ×${ph.length}` : "Copy greeting";
    greetBtn.disabled = !(ph.length && b);
    statusEl.textContent = `${rowsPicked().length} of ${shown.length} picked · ${ph.length} with a number`;
    previewEl.replaceChildren(
      !ph.length
        ? el("p", { class: "muted" }, b ? "Pick someone with a WhatsApp number to preview." : "Pick someone first — then the greeting shows here.")
        : !b
          ? el("p", { class: "muted" }, "Type your message above to preview the greeting.")
          : el("p", {}, el("span", { class: "muted" }, `First chat (${first.name}): `),
              el("span", { class: "preview-text" }, `Hi ${first.name}, ${b}`)));
  }

  drawList();
  drawMsgCard();
}

// ---- shared copy / export helpers (respect the list that's on screen) ----

function copyList(list) {
  const ph = (list || []).filter((r) => r.whatsapp);
  if (!ph.length) return toast("No WhatsApp numbers in this list");
  // phoneDigits, not a bare digit-strip: the links use the 0 → 60 form, so the
  // copied number must be the same one the chat opens with.
  const nums = ph.map((r) => phoneDigits(r.whatsapp) || String(r.whatsapp).trim()).join("\n");
  copyText(nums, `${ph.length} number${ph.length === 1 ? "" : "s"} copied — paste into WhatsApp`);
}

function copyGreetings(list) {
  const ph = (list || []).filter((r) => r.whatsapp);
  if (!ph.length) return toast("No WhatsApp numbers in this list");
  const b = String(messageBody).trim();
  if (!b) return toast("Type your message first");
  const msgs = ph.map((r) => `Hi ${r.name}, ${b}`).join("\n");
  copyText(msgs, `${ph.length} personalised message${ph.length === 1 ? "" : "s"} copied — paste into each WhatsApp chat`);
}

function downloadCsv(list) {
  const esc = (s) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const lines = [
    ["Name", "WhatsApp", "Last ordered", "Last delivery", "Orders", "Units", "Approx spend", "Favourite"].join(","),
    ...(list || []).map((r) =>
      [esc(r.name), esc(r.whatsapp), esc(r.lastOrdered), esc(r.last),
        r.orders, r.units, r.totalSpend, esc(r.fav || "")].join(",")),
  ];
  const blob = new Blob([lines.join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = el("a", { href: url, download: `munchies-furkidz-customers-${todayISO()}.csv` });
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---- customer profiles (what we know about a person) ----

// The person's photo (or a paw mark when we know their dog but no photo yet) as
// a round thumb. `size` ∈ "sm" (row) | "" (profile card).
function avatarEl(profile, size) {
  const cls = `customer-avatar${size ? ` ${size}` : ""}`;
  if (profile && profile.dogPhoto) return el("img", { class: cls, src: profile.dogPhoto, alt: "" });
  if (profile && (profile.dogName || profile.likes)) return el("span", { class: cls }, "🐾");
  return null;
}

// A profile belongs to a person we can re-find: anonymous rows (keyed only by a
// random order id, no name or number ever on an order) have nothing stable to
// save a profile under, so Edit is hidden for them.
function editablePerson(r) {
  const name = String(r.name || "").replace(/^\(no name\)$/, "").trim();
  return !!(name || (r.whatsapp || "").trim());
}

// The profile block inside a customer's history pop-up — shows what's saved and
// opens the edit form. An empty profile still shows, inviting the first entry.
function profileBlockEl(state, r, refresh, onSaved) {
  const p = profileFor(state, r._key) || {};
  const facts = [
    p.dogName ? el("p", { class: "card-sub", style: "margin:2px 0 0" }, `🐾 ${p.dogName}`) : null,
    p.likes ? el("p", { class: "card-sub", style: "margin:2px 0 0" }, `Likes ${p.likes}`) : null,
    p.avoid ? el("p", { class: "card-sub", style: "margin:2px 0 0" }, `Avoids ${p.avoid}`) : null,
    p.notes ? el("p", { class: "card-sub", style: "margin:2px 0 0" }, p.notes) : null,
  ];
  const empty = !p.name && !p.dogName && !p.likes && !p.avoid && !p.notes && !p.reward && !p.rewardEvery;

  return el("div", { class: "profile-card" },
    el("div", { class: "profile-top" },
      avatarEl(p, ""),
      el("div", { class: "profile-who" },
        el("div", { class: "profile-name" }, p.name || r.name || "This customer"),
        ...(empty
          ? [el("p", { class: "card-sub", style: "margin:2px 0 0" },
              "Get to know this customer — their pet's name, what they like, what to avoid.")]
          : facts)),
      el("div", { class: "profile-edit" },
        editablePerson(r)
          ? button(empty ? "✎ Add details" : "✎ Edit",
              () => editProfilePopup(state, r, () => { refresh(); if (onSaved) onSaved(); }), "ghost small")
          : null,
        // ★★ FORGET SOMEONE SHE ADDED BY HAND (v325). Her ask: __"i need a button to delete a
        // customer as well, i found there is few stray customer"__.
        //
        // ⚠️⚠️ **IT IS OFFERED ON A HAND-ADDED ROW ONLY, AND THAT IS NOT A LIMITATION — IT IS THE
        // DIFFERENCE BETWEEN A PROFILE AND A CUSTOMER.** The book is built from her ORDERS: someone
        // she typed in has no orders, so **their row IS this record** and removing it removes them.
        // **A customer who has ordered cannot be deleted from here at all** — their row is their
        // sales history, and removing the profile would leave the row standing while quietly
        // throwing away their reward, their note and their dog's name. **A button that did half of
        // what it says would be worse than no button**, which is her own rule about dead controls:
        // two rows that look alike must behave alike, and a press that cannot do what it says must
        // say why rather than sit there looking available.
        r.manual
          ? button("🗑 Forget", () => {
              confirmDialog(
                `Forget ${r.name || "this person"}? They are in your list because you added them, and they have never ordered — so this removes the name, the number, any reward and any note. Nothing else in your book is touched, and you can add them again any time.`,
                () => {
                  removeProfile(state, r._key);
                  save(state);
                  toast("Removed from your list");
                  refresh();
                  if (onSaved) onSaved();
                }, { danger: true, yesLabel: "Forget" });
            }, "ghost small")
          : null)),
    // WHAT THIS ADVOCATE GETS AND WHAT THEY HAVE HAD (v291). It sits UNDER the profile top rather
    // than inside `.profile-who`, because it carries a press and the who-column is a flex child
    // beside the avatar. It was a bare sentence from v289 until she asked how to EXERCISE the
    // reward — see rewardBlockEl.
    rewardBlockEl(state, r, p, refresh, onSaved));
}

// The reward, made exercisable (v291).
//
// Her words say WHAT they get; the number on the profile says how often; this
// counts what they brought in against it and remembers what she has handed over.
//
// EVERY PRESS HERE IS OFFERED WHETHER OR NOT THE ARITHMETIC SAYS ONE IS DUE. She
// may settle a favour early, or hand over a reward for reasons the app cannot
// see — and a press refused because the app disagrees with her is a press that
// lies to her. The count is information, never a gate.
//
// A hand-out is a RECORD pushed onto state.rewards, not a number incremented on
// the profile. A number would be one value under the sync layer's last-write-wins
// and the phone that saved last would silently discard the other's grant; records
// cannot lose an update. Same reasoning as the credit ledger, and the same
// Undo-a-mistake courtesy the credit rows already offer.
function rewardBlockEl(state, r, p, refresh, onSaved) {
  // No saved record, no reward to exercise: a reward lives ON the profile, and
  // this person has none yet. Their row's own "✎ Add details" is the way in.
  if (!p.id) return null;
  const st = rewardStanding(state, p, { whatsapp: r.whatsapp });
  if (!p.reward && !st.every && !st.came && !st.given) return null;

  const counts = [`${st.came} brought in`];
  if (st.every > 0) {
    counts.push(`every ${st.every}`);
    counts.push(st.due > 0 ? `${st.due} due` : "nothing due");
  }
  const saveSync = () => { save(state); maybeSync(state); };
  const last = st.grants[0];

  return el("div", { class: "reward-block" },
    p.reward ? el("p", { class: "reward-line" }, `🎁 ${p.reward}`) : null,
    el("p", { class: "card-sub", style: "margin:2px 0 0" }, counts.join(" · ")),
    el("div", { class: "li-row", style: "align-items:center;gap:6px;flex-wrap:wrap;margin:8px 0 0" },
      button("🎁 Given",
        () => {
          const rec = giveReward(state, {
            profileId: p.id,
            holder: r.whatsapp,
            holderName: customerRowName(r),
            what: p.reward,
            came: st.came,
          });
          if (!rec) return toast("Save this customer first, then record their reward");
          saveSync();
          toast(p.reward ? `Reward recorded — ${p.reward}` : "Reward recorded");
          refresh();
          if (onSaved) onSaved();
        }, "soft small"),
      st.given ? el("span", { class: "card-sub", style: "margin:0" }, `${st.given} given`) : null,
      last
        ? button("Undo last", () => {
            confirmDialog(
              `Take back the most recent reward${last.what ? ` (${last.what})` : ""}?`,
              () => {
                removeRewardGrant(state, last.id);
                saveSync();
                toast("Reward taken back");
                refresh();
                if (onSaved) onSaved();
              }, { danger: true, yesLabel: "Take back" });
          }, "ghost small")
        : null),
    // The record's own trace. A list of hand-outs that showed nothing but a count
    // would be indistinguishable from the counter this deliberately is not.
    last
      ? el("p", { class: "card-sub", style: "margin:6px 0 0" },
          `Last given ${longDate(String(last.at || "").slice(0, 10))}`
          + (last.came ? `, after they had brought in ${last.came}.` : "."))
      : null);
}

// The editable profile form (a pop-up over the history). Fields: name, WhatsApp,
// dog's name, a photo, what they like, what to avoid, and a note. Photo is
// shrunken to a thumb (photo.js) before it's saved; Remove clears it. Saved
// profiles ride the synced customers collection, so both phones see them.
// `opts.newCustomer` is the ONLY difference between adding someone and editing someone (v290):
// with an empty `_key` and no profile, `upsertProfile` already creates rather than updates, so the
// card only has to change its words. A SECOND FORM was the tempting alternative and the wrong one —
// it would be a fifth place a profile field can be dropped from, the same trap v289 documented.
function editProfilePopup(state, r, afterSave, opts = {}) {
  const isNew = opts.newCustomer === true;
  const p = profileFor(state, r._key) || {};
  let close = () => {};
  let photo = String(p.dogPhoto || "");

  const name = el("input", { class: "input", value: p.name != null ? p.name : (r.name && r.name !== "(no name)" ? r.name : "") });
  const whatsapp = el("input", { class: "input", type: "tel", value: p.whatsapp != null ? p.whatsapp : (r.whatsapp || "") });
  const dogName = el("input", { class: "input", value: p.dogName || "" });
  const likes = el("input", { class: "input", value: p.likes || "", placeholder: "e.g. chicken, fish, sweet potato", "data-suggest": "chicken, fish, sweet potato" });
  const avoid = el("input", { class: "input", value: p.avoid || "", placeholder: "e.g. onion, grapes — not safe", "data-suggest": "onion, grapes — not safe" });
  const notes = el("input", { class: "input", value: p.notes || "", placeholder: "Anything to remember" });
  // What this person gets for bringing you custom (v289). Free text on purpose: her words are
  // "not just as plain as rm3", and a partner may be owed a free loaf, a favour, or an
  // arrangement of their own.
  const reward = el("input", { class: "input", value: p.reward || "", placeholder: "e.g. a free loaf for every five friends" });
  // The NUMBER beside those words (v291), in its own box. Her sentence is never
  // read for it: a parser that misread "every five friends" would promise a
  // partner a loaf she never agreed to.
  const rewardEvery = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0", step: "1",
    value: p.rewardEvery ? String(p.rewardEvery) : "", placeholder: "e.g. 5", style: "max-width:120px" });

  const file = el("input", { type: "file", accept: "image/*", style: "display:none" });
  const preview = el("div", { style: "display:flex;align-items:center;gap:10px;flex-wrap:wrap" });
  const draw = () => {
    preview.replaceChildren(
      photo
        ? el("img", { class: "customer-avatar", src: photo, alt: "" })
        : el("span", { class: "customer-avatar" }, "🐾"),
      photo
        ? el("span", { class: "btn-row", style: "margin:0" },
            button("Remove photo", () => { photo = ""; draw(); }, "ghost small"),
            button("Choose different", () => file.click(), "soft small"))
        : button("Choose a pet photo", () => file.click(), "soft small"),
      el("span", { class: "card-sub", style: "margin:0" }, "Picked photos are shrunk to a small thumb for storage."));
  };

  file.addEventListener("change", () => {
    const f = file.files && file.files[0];
    if (!f) return;
    readPhoto(f, (dataUrl) => {
      if (dataUrl) { photo = dataUrl; draw(); toast("Photo added"); }
      else toast("That file couldn't be read as a photo");
    });
  });

  const saveProfile = () => {
    const prof = upsertProfile(state, {
      id: p.id || "",
      name: name.value,
      // Stored in the digits form every link and label uses — a "+" or a space
      // kept here would split this person into a second record in the list.
      whatsapp: phoneDigits(whatsapp.value) || whatsapp.value,
      dogName: dogName.value,
      dogPhoto: photo,
      likes: likes.value,
      avoid: avoid.value,
      notes: notes.value,
      reward: reward.value,
      rewardEvery: rewardEvery.value,
    }, r._key); // the person this pop-up was opened from
    if (!prof) return toast("Enter a name or WhatsApp number first");
    save(state);
    maybeSync(state);
    close();
    toast(isNew ? "Customer added" : "Profile saved");
    afterSave();
  };

  showPopup(isNew ? "New customer" : `Profile — ${(p.dogName || r.name || "this customer")}`, (refresh, closeFn) => {
    close = closeFn;
    draw();
    return el("div", {},
      el("div", { class: "two-col" },
        el("div", { class: "field" }, el("label", {}, "Name"), name),
        el("div", { class: "field" }, el("label", {}, "WhatsApp"), whatsapp)),
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        "Their name and number are kept here and used on every one of their orders — fix them once and the labels, messages and customer list all follow. Leave a box empty to keep what is already there."),
      el("div", { class: "field" }, el("label", {}, "🐾 Pet's name"), dogName),
      el("div", { class: "field" }, el("label", {}, "Photo"), file, preview),
      el("div", { class: "field" }, el("label", {}, "What they like"), likes),
      el("div", { class: "field" }, el("label", {}, "What to avoid"), avoid),
      el("div", { class: "field" }, el("label", {}, "Note"), notes),
      el("div", { class: "field" }, el("label", {}, "🎁 Their reward"), reward),
      el("div", { class: "field" }, el("label", {}, "🎁 Given every … customers brought in"), rewardEvery,
        el("p", { class: "hint" },
          "What they get for bringing you custom — a free loaf for every five friends, RM5 off each order, or whatever you have agreed. Write the reward in your own words, then put its number here: a free loaf every 5 customers brought in. Leave the number blank if it is not a set figure — the app still counts what they brought in, it just never calls one due. Their card shows the count and a Given button, so you can see at a glance what is owed and record what you have handed over.")),
      el("div", { class: "btn-row" }, button(isNew ? "Add customer" : "Save profile", saveProfile, "primary"), button("Cancel", close, "ghost")));
  });
}

// ---- joining two records that are one person ----
// You open the row you want to KEEP and pick the duplicate to absorb, so there
// is never a "which one wins?" question. The absorbed person's orders move under
// the kept name and number — that is the point, and it cannot be undone from
// inside the app, so the confirm names both people before it acts.
function joinCustomerPopup(state, keep, afterMerge) {
  showPopup(`Join ${customerRowName(keep)} with…`, (refresh, closeFn) => {
    const q = el("input", { class: "input", placeholder: "Search name or number" });
    const results = el("div", { class: "list" });
    const others = attachProfiles(state, customerList(state, "name", "all", todayISO()))
      .filter((x) => x._key !== keep._key);

    const draw = () => {
      const query = String(q.value || "").trim();
      const rows = others.filter((x) => customerMatches(x, query)).slice(0, 40);
      results.replaceChildren(
        !rows.length
          ? el("p", { class: "muted" }, query ? "No one matches that." : "No other customers yet.")
          : el("div", {}, ...rows.map((x) =>
              el("button", { class: "list-item tappable", type: "button",
                onclick: () => { closeFn(); confirmJoin(state, keep, x, afterMerge); } },
                el("div", { class: "li-main" },
                  el("div", { class: "li-title" }, customerRowName(x)),
                  el("div", { class: "li-sub" },
                    `${x.whatsapp || "No number saved"} · ${x.orders} order${x.orders === 1 ? "" : "s"}`))))));
    };
    q.addEventListener("input", draw);
    draw();
    return el("div", {},
      el("p", { class: "card-sub", style: "margin:0 0 8px" },
        `Pick the duplicate to fold into ${customerRowName(keep)}. Their orders will show under this name and number, and the duplicate entry goes.`),
      el("div", { class: "field" }, q),
      results);
  }, { wide: true });
}

function confirmJoin(state, keep, absorb, afterMerge) {
  const keepName = customerRowName(keep);
  const absorbName = customerRowName(absorb);
  const n = absorb.orders;
  confirmDialog(
    `Join "${absorbName}" into "${keepName}"? Their ${n} order${n === 1 ? "" : "s"} will show under ${keepName}, and the duplicate entry goes. This cannot be undone here — your cloud backup is the way back.`,
    () => {
      mergeCustomers(state, keep._key, absorb._key);
      maybeSync(state);
      toast(`${absorbName} joined into ${keepName}`);
      afterMerge();
    },
    { danger: true, yesLabel: "Join them" });
}

// ---- history pop-up for one customer ----

function openHistory(state, r, onSaved) {
  const blocks = ordersForCustomer(state, r);
  const ui = { editingCredit: null, addingCredit: false }; // survives refresh()
  showPopup(customerRowName(r), (refresh, close) =>
    el("div", {},
      r.whatsapp ? el("div", { class: "li-row", style: "margin:0 0 8px" },
        el("p", { class: "card-sub", style: "margin:0" }, `📱 ${r.whatsapp}`),
        button("💬 Chat", () => { close(); openChat(r); }, "primary small")) : null,
      // Only when there is someone to join to — a lone customer has no duplicate.
      customerList(state).length > 1
        ? el("div", { class: "btn-row", style: "margin:0 0 8px" },
            button("Join with another customer", () => { close(); joinCustomerPopup(state, r, onSaved); }, "soft small"))
        : null,
      el("div", { class: "chip-row" },
        el("span", { class: "qty-chip" }, `${r.orders} order${r.orders === 1 ? "" : "s"}`),
        el("span", { class: "qty-chip" }, `${r.units} unit${r.units === 1 ? "" : "s"}`),
        r.totalSpend > 0
          ? el("span", { class: "qty-chip", style: "background:var(--brown-soft)" }, `about ${money(state, r.totalSpend)}`)
          : null),
      r.fav ? el("p", { class: "card-sub", style: "margin:8px 0 0" }, `⭐ Favourite: ${r.fav}`) : null,
      profileBlockEl(state, r, refresh, onSaved),
      referralSection(state, r, ui, refresh, recentProduct(state, blocks)),
      !blocks.length
        // TWO DIFFERENT EMPTIES, and telling them apart matters (v290). Someone she added by hand
        // has never had an order, so "orders were removed" is simply untrue of them — and reads as
        // a fault in her data rather than as a person she typed in on purpose.
        ? (r.manual
            ? emptyState("Added by hand", "They have not ordered yet. Their name is in your list, so you can set their reward, give them a code, or find them the moment they do.")
            : emptyState("No order history", "This customer's orders were removed."))
        : el("div", {},
            el("p", { class: "card-sub", style: "margin:12px 0 2px" }, "Order history — newest first"),
            ...blocks.map((b) => historyBlock(state, b)))),
    { wide: true });
}

// ---- bring-a-friend (one customer: their share message + credit list) ----
// Only when referrals are switched on AND the customer has a WhatsApp number to
// send the link to. The owner copies the share message or the bare link; credit
// rows are the ledger behind "one coupon per new friend", and she can nudge any
// of them by hand (mark used, change/clear expiry, remove, add).

function referralSection(state, r, ui, refresh, product) {
  const scheme = schemeOf(state);
  if (!scheme.enabled || !r.whatsapp) return null;
  const digits = waNumber(r.whatsapp);
  if (!digits) return null;
  const cur = (state.settings && state.settings.currency) || "RM";
  const pname = product && typeof product === "object" && product.name
    ? product.name
    : String(product || "").trim();
  const origin = (typeof location !== "undefined" && location.origin) || "";
  const link = referralLink(origin, digits);
  const name = r.name && r.name !== "(no name)" ? r.name : digits;
  const credits = creditRows(state, digits);
  const ready = credits.filter((c) => c.status === "valid").length;

  const validTxt = scheme.validDays === "" || scheme.validDays == null
    ? "Coupons never expire."
    : `Each coupon is valid ${scheme.validDays} days.`;

  const parts = [
    el("div", { style: "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:2px" },
      el("span", { style: "font-weight:700" }, "🎁 Bring-a-friend"),
      el("span", { class: "st-chip valid" }, `${ready} ready`)),
    el("p", { class: "card-sub", style: "margin:0 0 8px" },
      `New friends who order through ${name}'s personal link get ${fmtRM(scheme.friendRM, cur)} off their first order, and ${name} earns a ${fmtRM(scheme.referrerRM, cur)} coupon for each one. ${validTxt}`),
    el("div", { class: "li-row", style: "align-items:center;gap:6px;margin:0 0 8px" },
      el("span", { class: "card-sub", style: "margin:0" }, "Follow-up language:"),
      [["en", "EN"], ["zh", "中文"], ["ms", "BM"]].map(([code, label]) =>
        button(label, () => { followupLang = code; refresh(); },
          followupLang === code ? "soft small" : "ghost small"))),
    el("div", { class: "btn-row" },
      button("📋 Copy share message",
        () => copyText(shareMessage(state, r, origin), "Share message copied — paste it in WhatsApp"),
        "primary small"),
      button("🎉 Copy follow-up",
        () => copyText(followupMessage(state, r, product, origin, followupLang), "Follow-up copied — send it after they collect"),
        "soft small"),
      button("🔗 Copy link", () => copyText(link, "Link copied"), "ghost small")),
    el("p", { class: "card-sub", style: "margin:6px 0 0" },
      `The follow-up is a warm check-in${pname ? ` ("how did the ${pname} go?")` : ""} that slides the referral in after a delivery — send it instead of a plain "how was it?" message. The copy above is in ${followupLang === "en" ? "English" : followupLang === "zh" ? "Chinese (中文)" : "Bahasa Malaysia"}.`),
    linkEl(link),
  ];

  // ★ ★ HOW MANY, NOT HOW MUCH (v314). This line used to read "unused = you still
  // owe RM 3.00 off an order" and took that figure from the FIRST valid credit
  // only — so a customer sitting on two RM3 credits read "2 ready" in the chip
  // above and "RM 3.00" here, and there was nothing on the screen that said how
  // much to take off. Her words: __"if we state only credit of ringgit, there
  // might be confusion of how much credit to apply, but we can state, only one
  // coupon apply for each purchase."__ She is right on both halves — the figure
  // was ambiguous AND it disagreed with the count — so the money is gone from
  // this line entirely and her rule is stated where she acts.
  //
  // ⚠️ **THE COUNT IS THE TRUTH.** A coupon is a thing, not a balance: each one is
  // worth its own amount, and ONE is spent per order.
  const readyCount = credits.filter((c) => c.status === "valid").length;
  const credTitle = el("div", { class: "li-row", style: "align-items:center;gap:6px;margin-top:10px" },
    el("span", { style: "font-weight:700" }, "Coupons"),
    el("span", { class: "card-sub", style: "margin:0" },
      !credits.length ? "none yet — they appear when a new friend orders"
        : readyCount === 0 ? "none ready — every coupon here is used or has run out"
          : `${readyCount} ready — one per order`),
    button(ui.addingCredit ? "Close" : "＋ Add coupon",
      () => { ui.addingCredit = !ui.addingCredit; ui.editingCredit = null; refresh(); }, "ghost small"));

  parts.push(credTitle);
  if (ui.addingCredit) parts.push(addCreditRow(state, r, ui, refresh));
  parts.push(...(credits.length ? credits.map((c) => creditRowEl(state, c, ui, refresh))
    : [el("p", { class: "card-sub", style: "margin:6px 0 0" },
        "When a NEW friend orders through this customer's link, the Give coupon button on that order adds two coupons here.")]));

  return el("div", { class: "ref-block", style: "margin:10px 0 2px;padding:10px 12px" }, ...parts);
}

function linkEl(link) {
  if (!link) return el("p", { class: "card-sub", style: "margin:6px 0 0" },
    "No personal link yet — the link appears once this customer has a WhatsApp number on an order.");
  return el("div", { class: "li-row", style: "margin:4px 0 0;align-items:center;gap:6px;flex-wrap:wrap" },
    el("span", { class: "card-sub", style: "margin:0;word-break:break-all" }, "Personal link: "),
    el("span", { style: "font-size:12px;word-break:break-all" }, link));
}

function creditRowEl(state, c, ui, refresh) {
  const cur = (state.settings && state.settings.currency) || "RM";
  const roleTxt = (ROLE_LABEL[c.role] || "Coupon").toLowerCase();
  const status = c.status;
  const when = status === "used"
    ? (c.usedAt ? `Used ${longDate(String(c.usedAt).slice(0, 10))}` : "Used")
    : status === "expired" ? `Expired ${longDate(c.expiresAt)}`
    : c.expiresAt ? `Valid until ${longDate(c.expiresAt)}`
    : "Never expires";

  const saveSync = () => { save(state); maybeSync(state); };

  const btns = el("div", { class: "btn-row", style: "margin:0" });
  if (status === "valid") {
    btns.append(button("Mark used",
      () => { markCreditUsed(state, c.id); saveSync(); toast(`${fmtRM(c.amountRM, cur)} coupon marked used — taken off an order`); refresh(); },
      "soft small"));
  }
  btns.append(button(status === "used" ? "Remove" : (ui.editingCredit === c.id ? "Done" : "Expiry"),
    () => {
      if (status === "used") {
        confirmDialog(`Remove this ${fmtRM(c.amountRM, cur)} ${roleTxt}?`, () => {
          removeCredit(state, c.id); saveSync(); toast("Coupon removed"); refresh();
        }, { danger: true, yesLabel: "Remove" });
        return;
      }
      ui.editingCredit = ui.editingCredit === c.id ? null : c.id;
      ui.addingCredit = false;
      refresh();
    }, "ghost small"));

  return el("div", { class: "credit-row" },
    el("div", { class: "li-main" },
      el("div", { class: "li-title", style: "font-size:14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap" },
        el("span", {}, `${fmtRM(c.amountRM, cur)} ${roleTxt}`),
        el("span", { class: `st-chip ${status}` }, status)),
      el("div", { class: "card-sub", style: "margin:2px 0 0" }, when),
      c.note ? el("div", { class: "card-sub", style: "margin:0" }, c.note) : null),
    btns,
    ui.editingCredit === c.id ? expiryEditorRow(state, c, refresh) : null);
}

function expiryEditorRow(state, c, refresh) {
  const cur = (state.settings && state.settings.currency) || "RM";
  const input = el("input", { class: "input", type: "date", value: c.expiresAt || todayISO() });
  const saveSync = () => { save(state); maybeSync(state); };
  const done = (val, msg) => {
    setCreditExpiry(state, c.id, val);
    saveSync();
    toast(msg);
    refresh();
  };
  return el("div", { style: "flex:1 1 100%;display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0;margin-top:4px" },
    el("span", { class: "card-sub", style: "margin:0" }, `Expiry for ${fmtRM(c.amountRM, cur)}:`),
    input,
    button("Save", () => done(input.value, input.value ? `Expiry ${longDate(input.value)}` : "No expiry — never expires"), "small primary"),
    button("Never expires", () => done("", "No expiry — never expires"), "ghost small"));
}

function addCreditRow(state, r, ui, refresh) {
  const scheme = schemeOf(state);
  const cur = (state.settings && state.settings.currency) || "RM";
  const amountIn = el("input", { class: "input", type: "number", inputmode: "decimal", step: "1",
    value: String(scheme.referrerRM), style: "max-width:110px" });
  const daysIn = el("input", { class: "input", type: "number", inputmode: "numeric", min: "0",
    placeholder: "days, blank = never", value: scheme.validDays === "" ? "" : String(scheme.validDays),
    style: "max-width:150px" });
  const noteIn = el("input", { class: "input", placeholder: "why (optional) — e.g. offline friend" });
  const saveCredit = () => {
    const amountRM = Number(amountIn.value);
    if (!(amountRM > 0)) return toast("Enter the amount first");
    const credit = addManualCredit(state, {
      whatsapp: r.whatsapp, name: r.name, amountRM,
      validDays: String(daysIn.value).trim(), note: noteIn.value.trim(), today: todayISO(),
    });
    save(state);
    maybeSync(state);
    ui.addingCredit = false;
    toast(credit ? `${fmtRM(credit.amountRM, cur)} coupon added` : "Couldn't add coupon");
    refresh();
  };
  return el("div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin-top:4px;width:100%" },
    el("div", { class: "field", style: "margin:0" }, el("label", {}, "Amount"), amountIn),
    el("div", { class: "field", style: "margin:0" }, el("label", {}, "Valid for"), daysIn),
    el("div", { class: "field", style: "flex:1 1 100%;margin:0" }, el("label", {}, "Note"), noteIn),
    button("Add coupon", saveCredit, "primary small"));
}

function historyBlock(state, b) {
  const placed = dateLine(b.orderDate);
  const del = dateLine(b.deliveryDate);
  const when = !placed && !del ? ""
    : b.deliveryDate ? (placed === del
        ? `${b.fulfillment === "courier" ? "Post" : "Collect"} ${del}`
        : `Placed ${placed} · ${b.fulfillment === "courier" ? "post" : "collect"} ${del}`)
    : `Ordered ${placed}`;
  const courier = b.fulfillment === "courier";
  return el("div", { class: "hist-ord" },
    el("div", { class: "li-row" },
      el("span", { class: "hist-code" }, `#${b.code}`),
      el("span", { class: `fulfill-tag${courier ? " courier" : ""}` }, courier ? "Post (nationwide)" : "Collect (local)"),
      el("span", { class: "qty-chip" }, STATUS_LABEL[b.status] || b.status)),
    when ? el("p", { class: "card-sub", style: "margin:2px 0 6px" }, when) : null,
    ...b.lines.map((o) => el("div", { class: "hist-line" }, `${productName(state, o)} ×${o.qty}`)));
}
