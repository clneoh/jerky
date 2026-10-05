// views/send_van.js — the courier's own screen (v315).
//
// ⚠️ THIS CARD USED TO BE ONE OF ELEVEN IN SETTINGS, and it was the wrong shelf
// for it: Settings holds "defaults, backup, transfer", while this is one of the
// ways an order LEAVES the kitchen. Her instruction: __"move the
// Courier(Lalamove) ... to Logistic"__. The card below is the same card, moved
// whole — nothing about the courier changed.
//
// ⚠️ **THE SCREEN IS CALLED "Send a van", NOT "Lalamove", AND THAT IS DELIBERATE.**
// v309 gave the two kinds of courier her own words — **Post a parcel** (dry goods,
// nation-wide) and **Send a van** (today, inside Penang) — and the order cards say
// them. Naming this screen after the van keeps one word for one idea. The card
// INSIDE still names Lalamove, and it still asks the registry rather than knowing:
// **this screen does not know its courier's name**, which is what "ready for
// another courier" means at this end of the app.

import { el, button, toast, menuRow } from "../ui.js";
import { save } from "../state.js";
import { openPlacePicker } from "../place_map.js";
import * as place from "../courier_place.js";
import { callCourier } from "../couriers/api.js";
import { activeCourier, courierLabel } from "../couriers.js";

export function renderSendVan(root, state) {
  let dead = false; // set once this view unmounts, so the async answer never paints
  const cur = state.settings ??= {};

  // Two facts and no settings. A courier is not given a street address, it is given a
  // POINT, so this card's whole job is to hold the one point every trip starts from —
  // the bakery's own door — and to say which courier it is talking to. There is no
  // API key, no secret and no account login on this card, and there never will be:
  // those live in the function on the server, because anything shipped to this page
  // can be read by anyone who opens the page.
  const who = courierLabel();
  const courierKey = (activeCourier() || {}).key || "";
  const pickupLine = el("p", { class: "card-sub", style: "margin:8px 0 0" },
    "Not pinned yet — every price needs a door to collect from.");
  const envLine = el("p", { class: "card-sub", style: "margin:10px 0 0" },
    `Checking which ${who || "courier"} this phone can reach…`);

  function paintPickup() {
    const p = place.validPlace(cur.pickupPlace);
    pickupLine.textContent = p
      ? `Pickup pin: ${place.fmtPlace(p)}  ·  ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`
      : "Not pinned yet — every price needs a door to collect from.";
  }
  paintPickup();

  const pinBtn = button("Put the pickup pin on the map", () => {
    openPlacePicker({
      state,
      title: "Your pickup pin",
      hint: "This is the door the driver collects from. Pin it once — it is kept with your settings and travels to your other phone.",
      address: String(cur.mailingAddress || "").trim(),
      start: cur.pickupPlace,
      onPick: (spot) => {
        place.setPickupPlace(state, spot);
        paintPickup();
        toast("Pickup pin saved");
      },
    });
  }, "primary");

  // Which environment is live is a SECRET on the server, not a build — sandbox and
  // production are separate hosts with separate keys and separate wallets — so the
  // honest thing this card can do is ask the server and say the answer. It never sees
  // the key, and neither does this page.
  (async () => {
    const out = await callCourier(state, { action: "account", provider: courierKey });
    if (dead) return;
    if (!out.ok) {
      envLine.textContent = `${who || "The courier"} could not be asked: ${out.reason}`;
      return;
    }
    envLine.textContent = out.env === "production"
      ? `${who}: LIVE account (production). Bookings here are real and cost real money.`
      : `${who}: sandbox. Test bookings only — no real driver is sent and no money is spent.`;
  })();

  const courierCard = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, who ? `Courier (${who})` : "Courier"),
    el("p", { class: "card-sub", style: "margin:0 0 10px" },
      `Prices and bookings come from ${who || "your courier"} through your own account. This card holds the one thing a courier cannot work without: the pickup point, which is the bakery's exact door rather than its address — a driver is routed to a point, and an address he cannot find is a trip nobody can book.`),
    pickupLine,
    el("div", { class: "btn-row", style: "margin-top:12px" }, pinBtn),
    el("p", { class: "card-sub", style: "margin:10px 0 0" },
      "The API key and secret are kept on the server and are never typed here, never on this page, and never in a message. Each customer's own door gets a pin the first time you quote or book for them, and it is remembered against their number."),
    envLine);

  // ★ THE ONE THING THIS SCREEN CANNOT SET (v315). The FROM block on a parcel label
  // and on an invoice is `settings.mailingAddress`, and it stays in Settings — her
  // decision: __"Rename it, keep it in Settings"__, because it is one address typed
  // once that four things read, not a courier setting. But a driver going to the
  // wrong place is what sends her looking, so the way to it is HERE, named as a
  // pointer rather than copied as a second box.
  root.replaceChildren(
    el("h2", { class: "section" }, "Send a van"),
    courierCard,
    el("h2", { class: "section" }, "The address the labels print"),
    el("div", { class: "card", style: "padding:4px 14px" },
      menuRow("#/settings", "🏠 Your address",
        "The FROM on your parcel labels and your invoices — it lives in Settings, and one line tells you what it goes on")));

  return () => { dead = true; };
}
