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

import { newId, orderCode, orderLinePrice, fmtRM, groupOrders, round2 } from "./state.js";
import { todayISO } from "./dates.js";
import { methodLabel } from "./accounts.js";
import { awardOf, codesOf, findCode, minimumOf, normCode, shortfallOf } from "./promo.js";
import { couponOn } from "./referrals.js";

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

// Is this order going by courier at all? (1 Oct 2026.)
//
// A charge only ever means something on an order a courier is carrying, and this is
// the ONE fact the three charge keys cannot supply on their own. Switching an order to
// self collect does NOT clear them — deliberately: she may switch back, and re-typing a
// fee is not something an app should ask of her — so the stored keys outlive the
// fulfilment they were recorded for.
//
// Every reader of the customer's money therefore asks this first. Without it a
// self-collect order still tagged its own row "Courier RM8.00 · customer" AND still
// added the charge to what the customer was asked for, in the confirmation, every
// WhatsApp message and the track card. Two of those were her reports on the same
// morning: "when i schange the courier delivery to self pickup, the courier chages tag
// still there" and "confirmation message still include courier charges".
//
// Strict, and that is the point: it reads the same way the row's own fulfilment tag has
// always read it (`first.fulfillment === "courier"`), so a charge and the tag beside it
// can never disagree about what the order is.
export function isCourierOrder(first) {
  return !!(first && first.fulfillment === "courier");
}

// Is this charge COD — handed to the courier at the door rather than paid with the
// order?
//
// The whole charge is required, not just the flag: a lone courierCod on an order with
// no payer or no amount says nothing about who owes what, and reading it as COD would
// take a charge out of a total that never had one. Absent means "with the order" — the
// behaviour every charge recorded before this existed already had, so nothing changes
// meaning.
// It deliberately does NOT ask isCourierOrder, and that is the one place the two differ.
// This answers "is this charge settled at the door", which is a fact about the charge and
// stays true however the order leaves — while `customerCourierFee` below is the only
// reader that turns it into money, and that one does ask. Gating here instead would make
// the Edit form's COD box read OFF on a self-collect order, so the next Save would delete
// the tick as though she had unticked it, and switching the order back to a courier would
// not bring it back. The money is identical either way; only her record would differ.
export function courierCodOf(first) {
  return courierPayerOf(first) === "customer" && courierFeeOf(first) > 0
    && !!(first && first.courierCod === true);
}

// What the customer owes on top of the items. Nothing unless they bear it — a
// charge you pay is your own cost and must never turn up on their total. And nothing at
// all on an order that is not going by courier — see isCourierOrder.
export function customerCourierFee(first) {
  return !isCourierOrder(first) ? 0
    : courierPayerOf(first) === "customer" ? courierFeeOf(first) : 0;
}

// The promo code a group carries, and what it is worth ON THAT ORDER. Answers
// { code, money } — { code:"", money:0 } for an order that carried none, or one
// whose code she has since deleted.
//
// Deliberately NOT judged by stoppedBy: whether a code has since been paused, ended
// or used up says nothing about an order already placed. Re-judging it here would
// rewrite history and quietly un-discount an order she has already promised — the
// same reason ending a code keeps what it already gave (see promo.js).
//
// The code's SMALLEST BASKET is judged here, and it is the one term that is. It is not
// a fact about the code's life like its dates are; it is a fact about this one order,
// and an order's own basket never changes. A code that asks for RM100 of goods and sits
// on an RM16 order gives nothing — the customer was never entitled to the discount, and
// taking RM10 off anyway is you paying for a discount that was never earned.
//
// The terms come from the code AS THE APP HOLDS IT NOW, because an order remembers
// the code's NAME and not its terms — the honest limitation promo-usage.js also
// documents. Editing a code's value re-values its past orders too.
export function promoValue(state, codeName, items, deliveryFee = 0) {
  return awardOf(findCode(codesOf(state), codeName), Number(items) || 0, Number(deliveryFee) || 0);
}

// What a group's goods come to — the basket every promo question is asked against.
// One helper, because the code's award and its shortfall must be judged on the same
// number, and that number must be the one the customer's own total was built from.
function basketItems(state, orders) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, o) => {
    const price = orderLinePrice(state, o);
    return sum + (Number(o.qty) || 0) * (price == null ? 0 : price);
  }, 0);
}

// The same, read off a saved order group rather than a figure handed in — what every
// screen showing a SAVED order asks, so none of them works the basket out itself.
export function promoOn(state, orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const first = rows[0];
  if (!first) return { code: "", money: 0 };
  return promoValue(state, first.promo, basketItems(state, rows), customerCourierFee(first));
}

// A code the order CARRIED that gave nothing, and why — the customer typed it into the
// shop, the shop told her what it still needed, and the order went through without it.
// Answers { code, short, minimum } or null.
//
// Named only while the code still EXISTS. A code she has since deleted is not something
// to explain on an old order: there is no offer left to point at, and the honest reading
// of that order is simply that it carried no discount. Same rule as promoValue's — the
// order is read, the code's life is not.
export function codeNotApplied(state, orders) {
  const rows = Array.isArray(orders) ? orders : [];
  const first = rows[0];
  return codeMissed(state, first && first.promo, basketItems(state, rows));
}

// The same question asked against a basket handed in rather than read off a saved
// order — what the Edit form needs, because it prices the lines she is typing and not
// the lines on the order (v276).
export function codeMissed(state, codeName, items) {
  const name = normCode(codeName);
  if (!name) return null;
  const c = findCode(codesOf(state), name);
  if (!c) return null;
  const short = shortfallOf(c, Number(items) || 0);
  return short > 0 ? { code: c.code, short, minimum: minimumOf(c) } : null;
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
// postage, less whatever a promo code took off; a COD charge is deliberately never
// inside it.
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
// The promo comes off HERE, once, rather than at each of the four places that quote
// this total (26 Sep 2026). A discount applied in the message but not on the track
// card would be the same class of fault as a charge in one and not the other: the
// customer reads two different figures for one order and cannot tell which to pay.
//
// The items are counted at the price each line was SOLD at (orderLinePrice), exactly
// as groupValue counts your takings — the two differ only by the customer's delivery
// charge.
// `promo` is the ringgit taken off, and `promoCode` names it; both are 0/"" when no
// code applied, so every caller's existing reading of this object still holds.
// ★★ THE FRIEND'S DISCOUNT, PRICED AGAINST A BASKET (v330). **The ONE rule for how much of
// a bring-a-friend coupon comes off**, so a caller pricing a DRAFT and `customerTotal`
// pricing a SAVED order cannot disagree about it — and, before this existed, the two
// pop-ups simply left the coupon out altogether.
//
// Her report, and it was about the total itself and not only the line: __"the discount dnt
// show in the total adding in edit, probably other place?"__ The Edit card worked its own
// total out from the lines she was typing, so **the Total she read while editing was the
// total before the discount** — a figure she would have quoted to a customer.
//
// ⚠️ AND IT NEVER TAKES OFF MORE THAN THERE IS. Capped here rather than on the total alone,
// because the coupon's own figure is what the row, the customer's message, their tracking
// card and the published row all quote.
export function couponAgainst(state, orders, takeable) {
  const hit = couponOn(state, orders);
  if (!(hit.amount > 0)) return { amount: 0, id: "", code: "" };
  return { ...hit, amount: Math.min(hit.amount, Math.max(0, round2(takeable || 0))) };
}

export function customerTotal(state, group) {
  const orders = (group && group.orders) || [];
  const first = orders[0] || {};
  const items = basketItems(state, orders);
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
  const promo = promoOn(state, orders);
  // A code the order carried that paid out nothing (v276). Asked only when the code DID
  // pay nothing, so an order with a working code never carries both facts at once, and
  // an order with no code at all carries neither.
  const missed = promo.money > 0 ? null : codeNotApplied(state, orders);
  // ★★ THE FRIEND'S FIRST-ORDER DISCOUNT (v322). Until this existed, the coupon was
  // recorded and **nothing took it off** — the customer was never actually given the RM3 the
  // message promised. See `couponOn` for the whole story.
  //
  // ⚠️ **ONE COUPON PER ORDER, WHICH IS HER OWN RULE (v314)** — and if a customer typed a
  // CODE, THE CODE WINS. That is not arbitrary: the code is what they typed and can see, it
  // is named on their own tracking page, and it is the one they will ask about. The friend's
  // coupon is NOT spent when that happens (it is written unused — see `giveCredits`), so it
  // is still theirs to use on the next order.
  const coupon = promo.money > 0
    ? { amount: 0, id: "", code: "" }
    : couponAgainst(state, orders, items + courier - promo.money);
  // Floored at nothing: a discount larger than the order (a free-delivery code on a
  // collect order has no fee to waive, but a hand-edited code could still overshoot)
  // must never leave her asking for a negative amount.
  const total = Math.max(0, round2(items + courier + postage - promo.money - coupon.amount));
  return {
    items, courier, cod, postage, quoted,
    promo: promo.money, promoCode: promo.code,
    notApplied: missed ? missed.code : "", promoMinimum: missed ? missed.minimum : 0,
    coupon: coupon.amount, couponId: coupon.id, couponCode: coupon.code,
    total,
  };
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
  // "To pay" is printed LAST, after any promo line, so the customer can check it by
  // adding the lines above it — a discount that arrived under the total it reduced
  // would read as a second, separate charge.
  let toPay = false;
  if (parts.postage > 0) {
    out.push(`Postage (nationwide): ${fmtRM(parts.postage, cur)}`);
    toPay = true;
  } else if (parts.cod > 0) {
    out.push(`Courier charge: ${fmtRM(parts.cod, cur)} - COD, pay the courier when your order reaches you`);
  } else if (parts.courier > 0) {
    out.push(`Courier charge: ${fmtRM(parts.courier, cur)}`);
    toPay = true;
  } else if (parts.quoted) {
    out.push("Postage: quoted separately - we'll message you the exact amount");
  }
  // The code, and what it took off, between the workings and the total — so the
  // figure below can be checked by adding the lines above it, which is the whole
  // reason these lines are named rather than handed over as one figure (19 Sep 2026).
  // Named by the code itself because which code it was is what tells her whether it is
  // RM10 or RM5.
  if (parts.promo > 0) {
    out.push(`Promo${parts.promoCode ? ` ${parts.promoCode}` : ""}: -${fmtRM(parts.promo, cur)}`);
    // A discount moves the figure the customer is asked for, so the closing line is
    // owed even on an order with no charge on it at all — without it the message
    // would say "Total: RM30" above a discount of RM10 and never state the RM20.
    toPay = true;
  }
  // A code that gave nothing, named once and plainly (v276). She typed it into the shop
  // and was told what it still needed, so the order going through without it is not a
  // surprise — but the confirmation is where she looks for the discount, and silence
  // there reads as a code that was forgotten rather than one that never applied.
  else if (parts.notApplied) {
    out.push(`Code ${parts.notApplied} not applied: basket below ${fmtRM(parts.promoMinimum, cur)}`);
  }
  // ★ THE FRIEND'S FIRST-ORDER DISCOUNT, NAMED LIKE THE CODE ABOVE IT (v322). It is a line
  // rather than a quieter total because the whole complaint that produced it was that the
  // customer was promised RM3 off and never saw it taken. **A discount the customer cannot
  // find in the message is a discount they will ask about**, and the lines above it have to
  // add up to the Total below — that is the rule this whole function exists for.
  if (parts.coupon > 0) {
    out.push(`Bring-a-friend you were sent: -${fmtRM(parts.coupon, cur)}`);
  }
  if (toPay) out.push(`To pay: ${fmtRM(parts.total, cur)}`);
  return out;
}

// The same money as a RECEIPT for her own screens (v276): one row per fact, the words
// on the left and the figure on the right, and the Total last — the shape she picked
// over the run-on sentence that used to sit here ("The customer owes RM24.00 — items
// total RM16.00 + courier charge RM8.00 ..."), which she had to unpick to read.
//
// Pure data, and shared by the two screens that show an order's money, so the Edit
// form and the Note / tracking card cannot list the same sum differently. The
// customer's message states the same facts in its own one-line-per-fact way
// (moneyLines), because a chat message and a printed card are different things — but
// both read one `parts`, so the figures can never disagree.
//
// `total: true` marks the row the rule is drawn above. `note` is a rider on the row,
// used only by a COD charge, which has to say where the money goes.
export function receiptRows(state, parts) {
  const cur = state.settings.currency;
  const rows = [{ label: "Items total", value: fmtRM(parts.items, cur) }];
  // The flat nationwide postage, on a row of its own (this shop only — the bakery has no
  // such fee). Without it a posted order's receipt reads "Items total RM30" and then
  // "Total RM38" with nothing between, so the sum on her own screen does not add up. It
  // and the courier charge are never both present: a recorded charge is exactly what
  // takes the flat fee off (see customerTotal).
  if (parts.postage > 0) {
    rows.push({ label: "Postage (nationwide)", value: fmtRM(parts.postage, cur) });
  } else if (parts.cod) {
    rows.push({ label: "Courier charge", value: fmtRM(parts.cod, cur),
      note: "COD, pay the courier when your order reaches you" });
  } else if (parts.courier) {
    rows.push({ label: "Courier charge", value: fmtRM(parts.courier, cur) });
  } else if (parts.quoted) {
    // The delivery cost is not settled yet. Named so the receipt does not read as the
    // whole of what the customer owes, and carrying no figure because there is not one.
    rows.push({ label: "Postage", value: "quoted separately" });
  }
  if (parts.promo > 0) {
    rows.push({ label: `Promo${parts.promoCode ? ` ${parts.promoCode}` : ""}`,
      value: `-${fmtRM(parts.promo, cur)}` });
  } else if (parts.notApplied) {
    // Shown as a row of its own reading nothing, rather than left out: a code the
    // customer typed is a fact about this order, and a receipt that simply omits it
    // cannot be told apart from one for an order she never used a code on.
    rows.push({ label: `Promo ${parts.notApplied}`, value: fmtRM(0, cur) });
  }
  // ★★ THE FRIEND'S FIRST-ORDER DISCOUNT, IN THE SAME SUM (v330). Her report: __"the
  // discount dnt show in the total adding in edit, probably other place?"__ — and she was
  // right about both halves. v322 took the coupon off the Total and named it on the
  // customer's message, and left it out HERE and on the invoice, so her own receipt read
  // "Items total RM 30.00" straight down to "Total RM 27.00" with **nothing between them**.
  //
  // ⚠️⚠️ THE RULE THIS FUNCTION EXISTS FOR IS THAT THE LINES ABOVE THE RULE ADD UP TO THE
  // TOTAL BELOW IT. A discount that moves the Total and is not listed breaks that rule as
  // surely as a wrong figure does — and it is worse, because a wrong figure is at least
  // visible. **Whatever comes off the total gets a row here.**
  if (parts.coupon > 0) {
    rows.push({ label: "Bring-a-friend discount", value: `-${fmtRM(parts.coupon, cur)}` });
  }
  rows.push({ label: "Total", value: fmtRM(parts.total, cur), total: true });
  return rows;
}

// The line under the receipt that says WHY a code gave nothing, in her words. Empty
// for every order that is not carrying a code it never earned, so a plain order draws
// nothing extra at all.
//
// It ends by handing the decision back to her, because the smallest basket is a GUIDE
// and not a gate (2 Oct 2026): "sometime when situation allow, baker will handle promo
// flexibly, say order is 80 and customer ask for 10 discount, baker discretion sometimes
// will allow too, but if customer only order 16 and ask for 10 discount then baker will
// turn down the offer ... it is a guide, not the gate." So the note states the code's own
// rule and then says, plainly, that the rule is not the last word — she is. This line is
// on HER screens only; the customer's message states the rule without it.
export function receiptNote(state, parts) {
  if (!parts.notApplied) return "";
  const cur = state.settings.currency;
  return `${parts.notApplied} needs a basket of ${fmtRM(parts.promoMinimum, cur)} — this one was ${fmtRM(parts.items, cur)}, so the code gave nothing. The rule is a guide, not a gate: you can still take something off by hand.`;
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

// WHAT THE TRIP ACTUALLY COST, AGAINST THE CHARGE SHE PUT ON THE ORDER (v235, 29 Sep 2026).
//
// A charge is a price she DECIDED; a booked trip is what the journey really cost. They are
// two numbers about the same thing, and when they disagree the difference is hers — carried
// by her if the trip cost more, kept by her if it cost less. She asked to see both directions
// rather than only the alarming one: "it is good to see it. Real costing make aware, good for
// future promotion room if possible, i can even opt not to collect delivery."
//
// The Delivery run screen already makes this comparison BEFORE booking (see delivery_run.js's
// chargeSentence); this is its after-the-fact twin for a trip booked from one order, and it is
// worded in the same family so the two screens cannot say the same thing two ways.
//
// The arithmetic is the same whoever bears the charge, so it is worked out once here; only the
// MEANING of a difference depends on the payer, and that is the sentence's business (below).
//
// `orders` is every order riding this trip — a value set is one charge over several rows — so
// the charges are summed rather than read off the first. Returns null — rather than zeros —
// when there is no readable price to compare against: a card cannot report on a number the
// trip never gave, and a line about nothing is worse than no line.
//
// The price must be ABOVE zero, not merely finite. `Number(null)`, `Number("")` and
// `Number([])` are all 0 rather than NaN, so a `>= 0` guard would read a job with no amount
// at all as a trip that cost nothing — and print "the trip cost RM 0.00" as a fact about her
// money. A booked trip never costs nothing, so demanding a positive price is the honest test.
export function feeGapOf(orders, job) {
  const list = (Array.isArray(orders) ? orders : [orders]).filter(Boolean);
  if (!list.length) return null;
  const cost = Number(job && job.amount);
  if (!Number.isFinite(cost) || !(cost > 0)) return null;
  const cent = (n) => Math.round(n * 100) / 100;
  // Only a COURIER order's charge counts (v268). Switching an order back to Self collect
  // deliberately keeps its three charge keys so she can switch again without retyping —
  // so this sum has to ask which orders are actually being sent, exactly as the charge
  // cards and the customer's own total do. Without the gate the trip card read "The
  // customer is charged RM 8.00" about money nobody is paying.
  const charged = cent(list.reduce((sum, o) => sum + (isCourierOrder(o) ? courierFeeOf(o) : 0), 0));
  return { charged, cost: cent(cost), diff: cent(charged - cost), payer: courierPayerOf(list[0]) };
}

// The one line the booked-trip card draws about that difference, or "" when there is nothing
// worth saying — the two figures agree, or there is no price. Her screen only: a difference
// between what a trip cost and what she charged is hers to absorb or learn from, and is never
// put in front of a customer (see the standing rule, 29 Sep 2026).
//
// What a difference MEANS depends on whether the money was ever coming in, so there are three
// readings behind the five sentences:
//
//   • no charge at all — the whole trip is her cost, which is exactly the free-delivery case
//     she named, so it is worth stating rather than staying silent;
//   • the customer bears it — money in, money out, so a shortfall comes out of her own purse
//     and a surplus stays with her;
//   • she bears it (or a charge with no payer, which the app refuses to save but older data
//     may carry) — it was always her cost, so the difference is only against what she allowed.
export function feeGapLine(orders, job, cur) {
  const gap = feeGapOf(orders, job);
  if (!gap) return "";
  const { charged, cost, diff, payer } = gap;
  const money = (n) => fmtRM(n, cur);
  if (!charged) {
    return `No courier charge is on the order, so the whole ${money(cost)} of this trip is your own cost.`;
  }
  if (diff === 0) return "";
  if (payer === "customer") {
    return diff < 0
      ? `The customer is charged ${money(charged)} and the trip cost ${money(cost)} — ${money(-diff)} short, so that much came out of your own pocket.`
      : `The customer is charged ${money(charged)} and the trip cost ${money(cost)} — ${money(diff)} under, and that difference stayed with you.`;
  }
  return diff < 0
    ? `You recorded ${money(charged)} as your own cost, and the trip cost ${money(cost)} — ${money(-diff)} more than you had allowed for.`
    : `You recorded ${money(charged)} as your own cost, and the trip cost ${money(cost)} — ${money(diff)} less than you had allowed for.`;
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
