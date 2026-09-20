// courier.js — the courier charge on an order (19 Sep 2026; localized 20 Sep 2026).
//
// Posting an order costs money, and either the customer pays that or you do. Which of
// the two is the whole design, because they behave completely differently to your books:
//
//   • The customer bears it — the money arrives and leaves your purse in the same
//     breath, so your books never see either side of it. It is added to what the
//     customer owes and named where they can see it (their messages, their track
//     card), so a total that jumped by RM8 explains itself.
//   • You bear it — a real cost. It is written as an ORDINARY expense row under
//     "Delivery & fuel", the same way a shopping run writes one, so it reaches the
//     Money screen, every journal and the profit statement through machinery that
//     already exists.
//
// That split is yours, in so many words: "off profit only if I paid it". It is also
// why groupValue (money.js) counts product lines only and is NOT extended by this
// feature — a customer's charge that both comes in and goes out is not profit, and
// putting it in one side without the other would break your reconciliation.
//
// A customer-borne charge then splits again, because it is not always paid the same
// way: "courier charges can be collect, that means customer pay courier upon collect".
// So it is either
//
//   • with the order — inside the total they are asked for, exactly as before, or
//   • COD — handed to the courier at the door, so it must stay OUT of that total or
//     the same RM8 is asked for twice, once by you and once by the courier.
//
// COD is your word for it, and Malaysia's: it is what EasyParcel, ABX, GDEX and DHL all
// call a parcel the receiver pays for. The key is written only when the CUSTOMER bears
// the charge — a charge you paid has nothing for anyone to collect at the door.
//
// ---- ONE DELIVERY CHARGE PER ORDER (20 Sep 2026) ----
//
// This app already had a delivery charge before the courier box arrived: the flat
// nationwide postage fee (Settings → Storefront → Postage), quoted on every POSTED
// order. The two answer the same question — "what does sending cost them?" — so they
// must never both appear. The owner settled it in these words: a recorded charge
// REPLACES the postage on that order.
//
//   • A charge recorded, customer bears it → that is what they owe for delivery, and
//     the flat postage is not added on top.
//   • A charge recorded, you bear it → it becomes a Delivery & fuel expense and the
//     customer owes no delivery charge at all: this is how a goodwill order absorbs
//     the postage. Yes, that means the flat fee goes too — the charge stands in for it
//     whether you or the customer ends up paying it, which is what "replaces" means.
//   • No charge recorded → a posted order owes the flat postage, exactly as it did
//     before this feature existed, and every message is word for word what it was.
//
// customerTotal() is the single place all of that is decided, which is what keeps the
// confirmation, the payment reminder, the posted message, the customer's track card
// and the Money screen from ever quoting different figures.
//
// Pure — no DOM, no fetch — so it runs under Node for tests.

import { newId, orderCode, orderLinePrice, fmtRM, groupOrders } from "./state.js";
import { todayISO } from "./dates.js";
import { methodLabel } from "./accounts.js";

// From your own chart of accounts, in your words: "delivery charges". The label IS
// the stored value, so it must match DEFAULT_CATEGORIES exactly.
export const COURIER_CATEGORY = "Delivery & fuel";

// The charge in ringgit, or 0. Absent is the house convention for "not recorded",
// and 0 is read as not recorded too, so a clears-the-box save needs no special case.
export function courierFeeOf(first) {
  const n = Number(first && first.courierFee);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

// Who bore the charge: "me", "customer", or "" for not recorded.
export function courierPayerOf(first) {
  const who = String((first && first.courierPaidBy) || "");
  return who === "customer" || who === "me" ? who : "";
}

// Is this charge COD — handed to the courier at the door rather than paid with the
// order?
//
// The whole charge is required, not just the flag: a lone courierCod on an order with
// no payer or no amount says nothing about who owes what, and reading it as COD would
// take a charge out of a total that never had one. Absent means "with the order" — the
// behaviour every charge recorded before this existed already had, so nothing changes
// meaning.
export function courierCodOf(first) {
  return courierPayerOf(first) === "customer" && courierFeeOf(first) > 0
    && !!(first && first.courierCod === true);
}

// What the customer owes on top of the items. Nothing unless they bear it — a
// charge you pay is your own cost and must never turn up on their total.
export function customerCourierFee(first) {
  return courierPayerOf(first) === "customer" ? courierFeeOf(first) : 0;
}

// This app's flat nationwide postage, as it has been quoted since the fee existed: a
// POSTED order carries it, a collect order does not. Read here rather than in each
// message builder so the figure has one source — and so that confirm.js, messages.js
// and supabase.js cannot drift apart on it.
export function flatPostage(state, first) {
  if (!first || first.fulfillment !== "courier") return 0;
  const sf = (state.settings && state.settings.storefront) || {};
  return Math.max(0, Number(sf.postageRM) || 0);
}

// The customer's total, in its parts, so that everyone who shows it can show the
// addition instead of a figure that appears from nowhere. One source for the number
// the messages, the track card and the app all quote, which is what makes them agree.
//
// Four parts: `items` is what they were sold, `courier` is the charge they bear and pay
// with the order, `cod` is the part the courier collects at the door, and `postage` is
// the flat nationwide fee — which applies only when this order has no charge of its own
// (see the header). `total` — what they are asked for now — is items + courier +
// postage; a COD charge is deliberately never inside it.
//
// "Has a charge of its own" means a recorded amount AND a named payer, and it is read
// that way on purpose. A charge SHE bore still counts as recorded: the whole point of
// that mode is a goodwill order that absorbs the postage, so the customer owes nothing
// for delivery at all. Keying this on the CUSTOMER's share instead (as this did until
// 20 Sep 2026) let the flat postage back in on exactly that order — one message quoting
// a postage fee on a parcel she had just absorbed. Meanwhile a half-filled box — an
// amount typed with the payer left at "Not recorded" — is not a charge yet, so the flat
// postage stands exactly as it always did; an incomplete record can never silently take
// the delivery line off an order.
//
// The items are counted at the price each line was SOLD at (orderLinePrice), exactly
// as groupValue counts your takings — the two differ only by the customer's delivery
// charge.
export function customerTotal(state, group) {
  const orders = (group && group.orders) || [];
  const first = orders[0] || {};
  const items = orders.reduce((sum, o) => {
    const price = orderLinePrice(state, o);
    return sum + (Number(o.qty) || 0) * (price == null ? 0 : price);
  }, 0);
  const charge = customerCourierFee(first);
  const cod = courierCodOf(first) ? charge : 0;
  const courier = charge - cod;
  const recorded = courierFeeOf(first) > 0 && courierPayerOf(first) !== "";
  const postage = recorded ? 0 : flatPostage(state, first);
  return { items, courier, cod, postage, total: items + courier + postage };
}

// The delivery line (or two) a message prints under the items figure, in ONE place so
// the confirmation, the payment reminder and the posted message cannot word them
// differently. Empty when this order carries no delivery line at all — a collect order,
// or one you absorbed the courier charge on (which absorbs the postage with it) — and
// then those messages are exactly what they were before the courier box existed.
//
// This app's shape, unchanged: the items figure is printed as "Total", then the
// delivery line, then "To pay" — the sum the customer is asked for. A COD charge prints
// its own line and NO "To pay", because the courier collects it at the door: inside
// "To pay" the same money would be asked for twice.
export function courierAddUp(state, parts) {
  const cur = state.settings.currency;
  if (parts.postage > 0) {
    return [`Postage (nationwide): ${fmtRM(parts.postage, cur)}`,
      `To pay: ${fmtRM(parts.total, cur)}`];
  }
  if (parts.cod > 0) {
    return [`Courier charge: ${fmtRM(parts.cod, cur)} - COD, pay the courier when your order reaches you`];
  }
  if (parts.courier > 0) {
    return [`Courier charge: ${fmtRM(parts.courier, cur)}`,
      `To pay: ${fmtRM(parts.total, cur)}`];
  }
  return [];
}

// Record the charge on the books. Called on save from the Note / tracking pop-up,
// idempotently keyed on the order code so saving twice updates the same row rather
// than writing a second one, and so flipping the payer (or clearing the amount)
// takes the row back out.
//
// Returns what happened — "created" | "updated" | "removed" | "none" — which is
// what the tests assert on, and what keeps this honest about touching state.
export function applyCourierCharge(state, group, fee, paidBy, method) {
  const first = group && group.orders && group.orders[0];
  const code = first ? orderCode(first) : "";
  const amount = Number(fee) || 0;
  const expenses = state.expenses || (state.expenses = []);
  const at = expenses.findIndex((e) => e && e.courierFor && e.courierFor === code);
  const owed = !!code && paidBy === "me" && amount > 0;
  if (!owed) {
    if (at < 0) return "none";
    expenses.splice(at, 1);
    return "removed";
  }
  const kept = at < 0 ? null : expenses[at];
  const row = {
    id: kept ? kept.id : newId("exp"),
    // The day the money left, not the day you last corrected it — a charge edited
    // a week later still belongs to the week it was spent in.
    date: kept ? kept.date : todayISO(),
    amount,
    category: COURIER_CATEGORY,
    // The Money screen buckets every spend by how it moved, so this has to be a real
    // method from your list or the money would sit in no column at all.
    method: methodLabel(method) || "Cash",
    courierFor: code,
    note: "",
  };
  if (kept) expenses[at] = row;
  else expenses.push(row);
  return kept ? "updated" : "created";
}

// Take a charge off the order it belongs to, found by its order code — the way back
// from the Money screen, where the expense row is all you can see of a charge you paid
// yourself.
//
// A charge you paid is ONE thing with two halves: the Delivery & fuel row in your books
// and the charge on the order. Deleting the row used to take only the books half, so the
// order still wore the tag and its box still showed the charge — and the next Save in
// that box quietly wrote the expense straight back. Now the row and the order go
// together, which is what makes the delete mean one thing.
//
// Returns the group it cleared, so the caller can republish that customer's track card
// (the card quotes the customer's total, which moves whenever a charge does), or null
// when no order carries that code.
export function clearCourierCharge(state, code) {
  const want = String(code || "");
  if (!want) return null;
  const group = groupOrders(state.orders || [])
    .find((g) => g.orders[0] && orderCode(g.orders[0]) === want);
  if (!group) return null;
  for (const o of group.orders) {
    delete o.courierFee;
    delete o.courierPaidBy;
    // COD goes with the other two: it is a flag on a charge, so it cannot outlive one.
    delete o.courierCod;
  }
  return group;
}
