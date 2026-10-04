// promo-usage.js — what each promo code has ACTUALLY done, counted from her own
// orders.
//
// The shop cannot be trusted to keep the tally. It is a public page with no
// login, it is read by anyone, and the code rides back to her app on the order
// itself — so the ONLY honest number is one derived from the orders that came
// back. This module is that derivation, and it is deliberately a pure recount:
// ask it the same question twice and it answers the same thing, because it keeps
// nothing. Re-importing an order, re-rendering a screen or re-publishing the
// storefront therefore cannot double-count anything, which is the whole reason
// the design chose recounting over an incrementing tally. `referralFlag` in
// referrals.js derives new-versus-existing in exactly this way.
//
// Two rules decide the arithmetic, and both come from the shop's own idea of an
// order:
//
//   · A CART is one order. One storefront cart becomes several order rows sharing
//     a groupId, each stamped with the same code, so counting rows would let a
//     three-item basket eat three of her "first 5 orders". The count is over
//     groups.
//   · What a code GAVE AWAY is what the customer did not pay, so it is counted as
//     items sold at the price they were sold at (orderLinePrice), the same figure
//     customerTotal and her takings use — and a free-delivery code is worth the
//     delivery charge the customer would have paid, not nothing. It is the AWARD
//     (awardOf, which honours the code's smallest basket) and not the bare offer,
//     so an order that carried a code it never qualified for counts RM0 given and
//     cannot eat a ringgit ceiling it never touched. The COUNT still counts that
//     order: the code did ride on it, and that is what "used" means.

import { customerCourierFee } from "./courier.js";
import { awardOf, codesOf, normCode, normalizeCode } from "./promo.js";
import { groupOrders, orderLinePrice, round2 } from "./state.js";

const NONE = () => ({ used: 0, given: 0 });

// What one cart was worth in goods, at the price each line was sold at. A line
// with no price at all counts as nothing rather than as a crash.
function cartItems(state, rows) {
  let items = 0;
  for (const o of rows) {
    const price = orderLinePrice(state, o);
    items += (Number(o.qty) || 0) * (price == null ? 0 : price);
  }
  return items;
}

// Every code's tally at once, keyed by the code's own name — the shape the two
// callers that draw or publish the whole list actually want, and a single pass
// over her orders however many codes she has.
//
// An order carrying a code she has since DELETED is skipped: the code no longer
// exists to be counted against, and her own screen stops showing it the moment it
// is gone. Deleting a code leaves the orders that carry it perfectly readable —
// that is what deleting means here, and this function is careful not to imply
// otherwise by resurrecting a tally for a code nobody has.
export function usageByCode(state) {
  const orders = state && Array.isArray(state.orders) ? state.orders : [];
  const byName = new Map(codesOf(state).map((c) => [c.code, c]));
  const out = new Map();
  for (const group of groupOrders(orders)) {
    const rows = group.orders;
    if (!rows.length) continue;
    const code = byName.get(normCode(rows[0].promo));
    if (!code) continue;
    const before = out.get(code.code) || { used: 0, given: 0 };
    out.set(code.code, {
      used: before.used + 1,
      given: round2(before.given + awardOf(code, cartItems(state, rows), customerCourierFee(rows[0])).money),
    });
  }
  return out;
}

// One code's tally. The named entry point — a code that is not in her list, has
// no name, or has never been used all answer the same honest nothing.
//
// Only the NAME is taken from what is passed in: the terms come from the code as
// her app has it, so two screens asking about the same code cannot get two
// different tallies. That has one consequence worth knowing rather than papering
// over: an order row carries the code's name and not the code's terms, so if she
// EDITS what a code gives, every past order is recounted at the new terms. The
// ringgit figure therefore means "what this code would have given away, at what
// it gives now". That was once the reason a printed code was frozen rather than
// left editable; the freeze went in v287 and this stayed, because it is the
// honest reading either way — say so rather than count a number nobody can check.
export function usageOf(state, code) {
  const c = normalizeCode(code);
  if (!c.code) return NONE();
  return usageByCode(state).get(c.code) || NONE();
}
