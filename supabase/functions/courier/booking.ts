// supabase/functions/courier/booking.ts — what a booking request has to be
// (25 Sep 2026).
//
// The last line of defence between a press in the app and somebody's money: a
// booking names real doors and puts a real vehicle on the road, and this is the only
// place that checks the request BEFORE it is signed and sent.
//
// WHY THIS IS ITS OWN FILE. It was two functions inside index.ts, and index.ts cannot
// be imported by the Node suite — it calls Deno.serve at the top of the module and
// imports a jsr: URL, so a test that reached it would have to stand in for both. A
// check that cannot be tested is a check that is only believed, and this one carries a
// courier's own words and a courier's own ceiling; it went wrong exactly once already,
// with a hand-written courier name in the cap sentence, and the only reason it was
// noticed is that a different rule happened to be looking. So it lives here, where the
// suite can reach it, and index.ts keeps the key, the signature and the wall it had.
//
// NOTHING HERE NAMES A COURIER, and nothing here knows what format a courier wants a
// phone number in. `carrier` arrives as a string from the provider's own label, and
// the format belongs to the provider's own file, for the same reason: a second
// provider adds a file and edits neither of these.

// One person at one door: the courier's own handle for that door, a name for the
// driver to ask for, and a number to ring.
export type Party = { stopId: string; name: string; phone: string };

// One end of the booking, or null. Every field is required and an empty string is
// not a value: the stop id is the courier's handle for a door, and an empty one is a
// booking at a door nobody chose — a van at the wrong house, which is the exact
// failure the whole trip module exists to prevent.
export function partyOf(p: unknown): Party | null {
  const o = (p && typeof p === "object") ? p as Record<string, unknown> : null;
  if (!o) return null;
  const stopId = String(o.stopId ?? "").trim();
  const name = String(o.name ?? "").trim();
  const phone = String(o.phone ?? "").trim();
  if (!stopId || !name || !phone) return null;
  return { stopId, name, phone };
}

export type Booking = { quotationId: string; sender: Party; recipients: Party[] };

// The ceiling Lalamove documents for one trip: one pickup and fifteen drops at the
// very most. A provider with a different ceiling passes its own number rather than
// this file guessing one for it.
export const MAX_DROPS = 15;

// The booking a request describes, or the sentence to refuse it with.
//
// These sentences are deliberately plain rather than friendly, because this is the
// LAST line of defence and it should never speak: the app refuses every one of these
// in words she can act on before a byte leaves her phone, and this only fires if
// something above it is broken. What it must never do is stay quiet and let a
// half-built booking through, because a booking with no quotation is a booking at
// whatever price the courier feels like rather than the one she was shown.
//
// `carrier` is the courier's name as ITS OWN file gives it — used in the one sentence
// about that courier's own ceiling, and nowhere else.
export function orderArgs(
  args: Record<string, unknown>,
  carrier: string,
  maxDrops: number = MAX_DROPS,
): { error: string; value: Booking } {
  const empty: Booking = { quotationId: "", sender: { stopId: "", name: "", phone: "" }, recipients: [] };
  const a = (args && typeof args === "object") ? args : {};
  const quotationId = String(a.quotationId ?? "").trim();
  if (!quotationId) return { error: "A booking needs the price it was quoted at.", value: empty };

  const sender = partyOf(a.sender);
  if (!sender) {
    return { error: "The booking has no sender with a stop id, a name and a number.", value: empty };
  }

  const asked = Array.isArray(a.recipients) ? a.recipients as unknown[] : [];
  const recipients = asked.map(partyOf);
  if (!recipients.length) return { error: "The booking has nowhere to deliver to.", value: empty };
  // The ceiling comes BEFORE the door-by-door check, and the order is deliberate: a
  // count is a property of the whole request, and no single doorstep can be edited to
  // fix it — the answer is to split the run. Checking the doors first would answer a
  // too-long booking with "one of your doors has no number", which she could fix and
  // then be refused again for the count. Whenever the load is too big, that is the
  // sentence, whatever else is also wrong with it.
  if (recipients.length > maxDrops) {
    return {
      error: `${String(carrier || "This courier").trim()} carries one pickup and ${maxDrops} drops at most on one trip — this one has ${recipients.length}.`,
      value: empty,
    };
  }
  if (recipients.some((r) => r === null)) {
    return { error: "A doorstep on this booking is missing its stop id, its name or its number.", value: empty };
  }
  return { error: "", value: { quotationId, sender, recipients: recipients as Party[] } };
}
