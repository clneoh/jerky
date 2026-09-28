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
// UNLESS she has switched delivery to quoting by courier (postageMode, 28 Sep 2026). Then
// there is no flat fee to stand in for: a posted order with nothing recorded yet is told
// its postage is quoted separately, and the figure arrives when she records what the
// courier asked for it — which is the same charge box, and the same replace-the-postage
// rule, as every other charge. The switch does not add a second kind of charge; it takes
// the flat fee away and lets the recorded one be the only one.
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

// Which way this app prices delivery: "flat" (the fee below on every posted order that
// carries no charge of its own) or "quote" (nothing up front — the delivery is priced per
// order from what the courier actually asks for it). Her switch, 28 Sep 2026: "add a
// switch whether a flat postage or quote by courier". Anything that is not the explicit
// "quote" reads as "flat", which is how this app quoted postage before the switch existed
// — so an older save, or one written on a phone that has never touched it, behaves
// exactly as it always did.
export function postageMode(state) {
  const sf = (state.settings && state.settings.storefront) || {};
  return sf.postageMode === "quote" ? "quote" : "flat";
}

// This app's flat nationwide postage, as it has been quoted since the fee existed: a
// POSTED order carries it, a collect order does not. Read here rather than in each
// message builder so the figure has one source — and so that confirm.js, messages.js
// and supabase.js cannot drift apart on it.
//
// Zero in quote mode, which is what makes the switch a ONE-LINE change everywhere else:
// customerTotal, moneyLines and the Money screen all read the fee through here, so with
// it at zero they already do the right thing with no postage to add and nothing to name.
export function flatPostage(state, first) {
  if (!first || first.fulfillment !== "courier") return 0;
  if (postageMode(state) === "quote") return 0;
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
  // "The delivery cost is not known yet" — a POSTED order, in quote mode, with no charge
  // recorded on it. It is a separate fact from postage being 0, because the two read
  // completely differently to the customer: a collect order or an absorbed charge owes
  // nothing for delivery and should say so by saying nothing, while this one has a
  // delivery charge coming and must not look settled. What the messages and the card do
  // with it is below.
  const quoted = !recorded && postage === 0
    && !!first && first.fulfillment === "courier" && postageMode(state) === "quote";
  return { items, courier, cod, postage, quoted, total: items + courier + postage };
}

// The money part of every message, in ONE place so the confirmation, the payment
// reminder and the posted message cannot word the sum differently. The caller prints
// each line on its own row; nothing here is tied to a screen. The customer's track card
// carries the same lines, worded in the storefront's own three languages, so the two can
// be read side by side.
//
// This app's own shape, kept: the items figure is printed as "Total", then the delivery
// line, then "To pay" — the sum the customer is asked for. A flat nationwide postage and
// a recorded courier charge never both apply (a recorded charge replaces the flat fee),
// and a COD charge prints its own line and NO "To pay", because the courier collects it
// at the door: inside "To pay" the same money would be asked for twice. An order with no
// delivery line at all (a collect order, or one you absorbed the charge on) prints the
// figure alone, exactly as those messages always did.
//
// One more line, in quote mode, on a posted order with no charge recorded yet: the
// delivery cost is not settled, and the customer has to be told so rather than reading
// "To pay" as the whole of what this costs them. It is worded as a NOTE and carries no
// figure, and deliberately prints NO "To pay" — there is nothing extra to pay yet, and
// the figure they are asked for now IS the total line above. The moment she records what
// the courier charged, this becomes the ordinary "Courier charge: …" + "To pay: …" pair
// and the note disappears on its own.
export function moneyLines(state, parts) {
  const cur = state.settings.currency;
  const out = [`Total: ${fmtRM(parts.items, cur)}`];
  if (parts.postage > 0) {
    out.push(`Postage (nationwide): ${fmtRM(parts.postage, cur)}`);
    out.push(`To pay: ${fmtRM(parts.total, cur)}`);
  } else if (parts.cod > 0) {
    out.push(`Courier charge: ${fmtRM(parts.cod, cur)} - COD, pay the courier when your order reaches you`);
  } else if (parts.courier > 0) {
    out.push(`Courier charge: ${fmtRM(parts.courier, cur)}`);
    out.push(`To pay: ${fmtRM(parts.total, cur)}`);
  } else if (parts.quoted) {
    out.push("Postage: quoted separately - we'll message you the exact amount");
  }
  return out;
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

// Put a charge onto the orders that carry it AND onto her books, in one call.
//
// The amount, the payer and COD settle TOGETHER. The payer is what decides what a charge
// does — to her books and to the customer — so an amount with no payer is not half a
// charge, it is a charge nobody has assigned, and leaving the amount behind is how a row
// ends up tagged "Courier RM8.00 · customer" with nothing able to remove the tag. That
// was her report on 19 Sep 2026. All three keys therefore go together, as a set.
//
// Extracted at v191 from the two doors that already wrote it by hand — the Note /
// tracking box and the full Edit form, whose own comments name this exact risk. The
// Delivery run is the third, and three hands writing one charge on one order is three
// chances for the order and her books to end up disagreeing about it.
//
// `rows` is passed rather than taken from the group, because the Edit form writes the
// charge onto the rows rebuilt for the destination day, which are not the group's own
// rows until the move happens.
export function writeCourierCharge(state, rows, group, answers) {
  const a = answers || {};
  const fee = Number(a.fee) || 0;
  const who = String(a.who || "");
  const collect = !!a.collect;
  for (const o of (Array.isArray(rows) ? rows : []).filter(Boolean)) {
    if (fee > 0) o.courierFee = fee;
    else delete o.courierFee;
    if (who) o.courierPaidBy = who;
    else delete o.courierPaidBy;
    if (collect) o.courierCod = true;
    else delete o.courierCod;
  }
  return applyCourierCharge(state, group, fee, who, a.method);
}

// One fee, split evenly over the customers on a run — worked out in CENTS, with the odd
// cents on the LAST order (v191).
//
// Cents, because the parts have to sum EXACTLY to the fee. RM 14.00 over three orders is
// 4.66 + 4.66 + 4.68; rounding each part on its own gives 4.67 three times, which is
// 14.01 — a cent that appears in the bakery's books and in no customer's charge box. The
// last order takes the remainder, so the parts add up to the whole by construction rather
// than by hope.
//
// A count of zero is an empty list rather than an error: nothing to split over is not a
// failure, it is nothing to do.
export function splitEven(total, count) {
  const n = Math.floor(Number(count) || 0);
  if (!(n > 0)) return [];
  const cents = Math.round((Number(total) || 0) * 100);
  const each = Math.trunc(cents / n);
  const out = new Array(n).fill(each);
  out[n - 1] = cents - each * (n - 1);
  return out.map((c) => c / 100);
}

// What each order on a run is charged, decided by WHO bears it (v192, 25 Sep 2026).
//
// Her rule, in her own words: "the benefit of consolidated charges, should go to merchant,
// not the customer. And if the courier charges were reveal to them, it will shown as the
// original cost." So the one-trip fee is NEVER split between the customers. A customer who
// bears the charge pays what their own doorstep would have cost sent ALONE — the original,
// un-consolidated price — and the difference between that and the one trip is hers. The
// delivery run asks the courier for those separate prices; choosing WHICH set of amounts
// each order carries is this function's job, and it is pure so it can be proved.
//
//   "customer" — the customers' own costs, one each. A list of the wrong length is NO
//     CHARGE rather than a guess: half a list of originals cannot be completed, and a
//     customer charged a figure nobody asked the courier for is worse than one charged
//     nothing at all.
//   "me" — the run's fee is HER cost, so it reaches her books apportioned across the
//     orders by splitEven, summing to the fee exactly. The customer is charged nothing
//     either way (customerCourierFee returns 0 for "me"), so this number is about her books
//     and never about what they are told.
//   anything else — no charge at all: no payer means no charge, the v127 rule.
export function runChargeAmounts(who, fee, originals, count) {
  const n = Math.floor(Number(count) || 0);
  if (!(n > 0)) return [];
  if (who === "customer") {
    const list = Array.isArray(originals) ? originals : [];
    if (list.length !== n) return [];
    return list.map((x) => Number(x) || 0);
  }
  if (who === "me") return splitEven(fee, n);
  return [];
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
