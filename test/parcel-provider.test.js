// test/parcel-provider.test.js — EasyParcel's own shape, held against EasyParcel's own
// document ("Individual API Document 1.4.0.0 (Malaysia)", 55 pages).
//
// ⚠️ THIS FILE IS THE ONLY THING STANDING BETWEEN THIS APP AND A SILENT MISUNDERSTANDING OF
// SOMEBODY ELSE'S API. Nothing here can call EasyParcel — there is no key, and there will be
// no key in this repository — so the wire format is the thing that has to be right on the day
// she first presses a button. Every assertion below is copied from the document, not invented:
// the form encoding, the parameter names (including `referrence`, which really is spelled that
// way), the five-character postcode, the three-letter state codes of Appendix III, and the
// reply shapes of the success AND failure samples the document prints.
//
// The provider file is plain TypeScript with no `jsr:` import, which is exactly why Node can
// load it — the same reason test/courier-provider.test.js can load its counterpart.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  ACTION, EASYPARCEL_KEY, bodyFor, bookRequest, hostFor, orderRow, phpForm, rateRow, readBalance,
  readOrder, readRates, readTracking, reasonIn, stateCode, RATE_EXCLUDE,
} = await import("../supabase/functions/parcel/easyparcel.ts");

// ── the wire ─────────────────────────────────────────────────────────────────

test("the body is PHP's own nested-array spelling, which is what their PHP reads (v307)", () => {
  // Their sample builds this with `http_build_query` over a nested array, so the brackets are
  // part of the name and are percent-encoded. A JSON body would be silently unread, and the
  // reply would then look like "the courier has no price for you" rather than like a mistake.
  const body = bodyFor({ api: "KEY", bulk: [{ pick_code: "10050", weight: "5" }] });
  assert.equal(body, "api=KEY&bulk%5B0%5D%5Bpick_code%5D=10050&bulk%5B0%5D%5Bweight%5D=5");
});

test("a value with an ampersand in it cannot split one parameter into two (v307)", () => {
  // A shop name like "Ah Seng & Sons" is an ordinary thing to type. Unencoded it would end the
  // parameter and start a bogus one, which the API would read as a missing field.
  const body = bodyFor({ send_name: "Ah Seng & Sons" });
  assert.equal(body, "send_name=Ah%20Seng%20%26%20Sons");
});

test("the two hosts are theirs, and an unset environment is never LIVE (v307)", () => {
  // ⚠️ THE DEFAULT IS DEMO AND THAT IS THE SAFE DIRECTION. A booking made against the live
  // host spends real money, so a missing or misspelled EASYPARCEL_ENV must not quietly become
  // a live one.
  assert.equal(hostFor("live"), "https://connect.easyparcel.my/");
  assert.equal(hostFor("demo"), "http://demo.connect.easyparcel.my/");
  assert.equal(hostFor(""), hostFor("demo"));
  assert.equal(hostFor("LIVE"), hostFor("live"), "and it is not case-sensitive");
  assert.equal(hostFor("production"), hostFor("demo"), "an unknown name is demo, never live");
});

test("the action names are the document's own, including the V3 booking one (v307)", () => {
  assert.equal(ACTION.rates, "EPRateCheckingBulk");
  assert.equal(ACTION.balance, "EPCheckCreditBalance");
  // ⚠️ V3 creates the order AND pays for it in one call. The non-V3 one leaves a draft that
  // nobody paid for, which is a parcel no courier is coming to collect.
  assert.equal(ACTION.book, "EPSubmitOrderBulkV3");
  assert.equal(ACTION.track, "EPTrackingBulk");
});

// ── Appendix III, the state codes ────────────────────────────────────────────

test("every state in Appendix III maps to its own three-letter code (v307)", () => {
  assert.equal(stateCode("Pulau Pinang"), "png");
  assert.equal(stateCode("Penang"), "png", "the name on the address and their name are different words");
  assert.equal(stateCode("Kuala Lumpur"), "kul");
  assert.equal(stateCode("Selangor"), "sgr");
  assert.equal(stateCode("Sarawak"), "srw");
  assert.equal(stateCode("Sabah"), "sbh");
  assert.equal(stateCode("Putrajaya"), "pjy");
  assert.equal(stateCode("Labuan"), "lbn");
  assert.equal(stateCode("Negeri Sembilan"), "nsn");
  assert.equal(stateCode("Johor"), "jhr");
  assert.equal(stateCode("Melaka"), "mlk");
  assert.equal(stateCode("Malacca"), "mlk", "the other spelling of the same state");
  // A code she (or a saved record) already holds is passed straight through.
  assert.equal(stateCode("png"), "png");
});

test("a state they do not serve is EMPTY, never guessed at (v307)", () => {
  // ⚠️ The whole point. Sending "Penang Island" or "Singapore" as a state would come back as a
  // rate-less success, which reads to her as "nobody delivers there" rather than as "this app
  // did not understand the address".
  assert.equal(stateCode("Singapore"), "");
  assert.equal(stateCode("Penang Island"), "");
  assert.equal(stateCode(""), "");
  assert.equal(stateCode(null), "");
});

// ── a parcel, as the two calls want it ───────────────────────────────────────

const PICK = { code: "11600", state: "png" };
const SEND = { code: "81100", state: "jhr" };

test("a rate row names both ends and the postcodes the document asks for (v307)", () => {
  const row = rateRow(PICK, SEND, { weightKg: 5 }, "2026-10-06");
  assert.equal(row.pick_code, "11600");
  assert.equal(row.pick_state, "png");
  assert.equal(row.pick_country, "MY");
  assert.equal(row.send_code, "81100");
  assert.equal(row.send_state, "jhr");
  assert.equal(row.weight, 5);
  assert.equal(row.date_coll, "2026-10-06");
});

test("a parcel with no measured sides sends NONE, rather than sending zeroes (v307)", () => {
  // ⚠️ The document's own sample sends `width: 0, length: 0, height: 0` — and a zero side is
  // not "no measurement", it is a claim that the box has no size. Omitted, they price the
  // weight; sent as zero, they price a parcel that does not exist. Dry bread is bulky and
  // light, so this is the field pair most likely to move a price.
  const bare = rateRow(PICK, SEND, { weightKg: 2 });
  assert.equal("width" in bare, false);
  assert.equal("length" in bare, false);
  assert.equal("height" in bare, false);
  const measured = rateRow(PICK, SEND, { weightKg: 2, lengthCm: 40, widthCm: 30, heightCm: 20 });
  assert.equal(measured.length, 40);
  assert.equal(measured.width, 30);
  assert.equal(measured.height, 20);
});

test("their drop-off networks are excluded from the reply, because a phone cannot carry them (v307)", () => {
  // Every courier's whole drop-off point list comes back with every price otherwise — dozens
  // of rows per courier, of no use to this app. The document names the fields it will drop.
  assert.deepEqual(RATE_EXCLUDE, ["rates.*.dropoff_point", "rates.*.pickup_point", "pgeon_point"]);
});

test("an order row carries the fields the document requires, `referrence` spelled their way (v307)", () => {
  const row = orderRow({
    reference: "A3F9C2", content: "Focaccia", valueRM: 36, weightKg: 1.4,
    pick: { name: "Jien Luv 2 Bake", contact: "0169601268", addr1: "12 Jalan Bunga", city: "Pulau Pinang", state: "png", code: "11600" },
    send: { name: "Ain", contact: "60111111111", addr1: "9 Jalan B", city: "Kulai", state: "jhr", code: "81100" },
  });
  // ⚠️ TWO R's AND AN E. It is the only thing tying their reply back to her order, and a
  // corrected spelling here would silently break that tie for every parcel.
  assert.equal(row.referrence, "A3F9C2");
  assert.equal("reference" in row, false);
  assert.equal(row.weight, 1.4);
  assert.equal(row.content, "Focaccia");
  assert.equal(row.value, 36);
  assert.equal(row.pick_name, "Jien Luv 2 Bake");
  assert.equal(row.pick_state, "png");
  assert.equal(row.send_state, "jhr");
  assert.equal(row.send_code, "81100");
});

test("an order row ALWAYS carries an email, and never an invented real one (v307)", () => {
  // The document requires it. An order taken over WhatsApp often has none, and inventing a
  // plausible address would send a courier's notifications to a stranger — so the stand-in is
  // a domain that cannot receive mail.
  const base = {
    reference: "X", content: "Focaccia", valueRM: 10, weightKg: 1,
    pick: { name: "P", contact: "1", addr1: "a", city: "c", state: "png", code: "11600" },
    send: { name: "S", contact: "2", addr1: "b", city: "c", state: "jhr", code: "81100" },
  };
  assert.match(orderRow(base).send_email, /@easyparcel\.invalid$/);
  assert.equal(orderRow({ ...base, send: { ...base.send, email: "ain@example.com" } }).send_email, "ain@example.com");
});

test("booking names ONE courier, and never a silent substitution (v307)", () => {
  // ⚠️ Their `courier` array is a FALLBACK ORDER: "if the first courier is not available, it
  // will select the next". One name, because she chose ONE price — being moved to a different
  // courier at a different price without being told is not a thing to do behind her back.
  const req = bookRequest({ courier: "Ninjavan", dropoff: false, orders: [{ referrence: "X" }] });
  assert.deepEqual(req.courier, ["Ninjavan"]);
  assert.equal(req.dropoff, 0);
  assert.equal(req.bulk.length, 1);
  assert.equal(bookRequest({ courier: "Ninjavan", dropoff: true, orders: [] }).dropoff, 1);
});

// ── reading their replies ────────────────────────────────────────────────────

test("the wallet is read as money, from the string they actually send (v307)", () => {
  // Their own success sample: `"result": "99999755.99"` — a STRING.
  assert.deepEqual(readBalance({ result: "99999755.99", api_status: "Success", error_code: "0", error_remark: "" }),
    { ok: true, balanceRM: 99999755.99 });
  assert.deepEqual(readBalance({ result: "12.5", api_status: "Success" }), { ok: true, balanceRM: 12.5 });
});

test("a setup fault reads as THEIR words, not as a generic failure (v307)", () => {
  // Their failure sample: {"api_status":"Error","error_code":"3","error_remark":"Required api key"}.
  const out = readBalance({ api_status: "Error", error_code: "3", error_remark: "Required api key" });
  assert.equal(out.ok, false);
  assert.equal(out.reason, "Required api key");
  assert.equal(reasonIn({ api_status: "Success" }), "", "a good reply has no reason");
});

test("every courier they carry comes back priced, cheapest first (v307)", () => {
  // ⚠️ The comparison this app was built for, taken from the shape of their own success
  // sample rather than from a blog post: one call, every courier, THIS parcel to THIS postcode.
  const out = readRates({
    api_status: "Success",
    result: [{ status: "Success", rates: [
      { courier_name: "POSLAJU NATIONAL COURIER", service_name: "Poslaju Same Day Pick up", price: "8.00", delivery: "3-5 working day(s)", service_id: "EP-CS0CH", rate_id: "EP-RR0M2NL", service_detail: "dropoff/pickup" },
      { courier_name: "CJ Century Logistics Sdn Bhd", service_name: "CJ Century", price: "7.80", delivery: "3-5 working day(s)", service_id: "EP-CS0KS", rate_id: "EP-RR0MCOV", service_detail: "pickup" },
    ] }],
  });
  assert.equal(out.ok, true);
  assert.equal(out.rates.length, 2);
  assert.equal(out.rates[0].courierName, "CJ Century Logistics Sdn Bhd", "cheapest first");
  assert.equal(out.rates[0].priceRM, 7.8);
  assert.equal(out.rates[0].pickup, true);
  assert.equal(out.rates[1].dropoff, true, "a dropoff/pickup service is both");
  // The ids are what a booking is made from, so they have to survive the read.
  assert.equal(out.rates[1].serviceId, "EP-CS0CH");
  assert.equal(out.rates[1].rateId, "EP-RR0M2NL");
});

test("a rate-less success is a sentence, not an empty list (v307)", () => {
  // Their own words when they have something to say about it ("this parcel is not allowed"),
  // and a plain sentence when they do not. An empty list on screen would read as a broken
  // screen rather than as an answer.
  const blocked = readRates({ api_status: "Success", result: [{ status: "Fail", remarks: "Parcel is too heavy", rates: [] }] });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "Parcel is too heavy");
  const empty = readRates({ api_status: "Success", result: [{ status: "Success", rates: [] }] });
  assert.equal(empty.ok, false);
  assert.match(empty.reason, /No courier offered a price/);
});

test("a price of zero is not a courier (v307)", () => {
  // A row with no price would be a tappable row that books nothing.
  const out = readRates({ api_status: "Success", result: [{ rates: [
    { courier_name: "Ghost", price: "0.00" },
    { courier_name: "Real", price: "9.00" },
  ] }] });
  assert.equal(out.rates.length, 1);
  assert.equal(out.rates[0].courierName, "Real");
});

test("a booking reports what went through AND what did not, with their own words (v307)", () => {
  // ⚠️ THIS ONE CALL TAKES THE MONEY, so a partial answer is a real state. Anything in
  // `failed` was not charged, and it is said per parcel rather than swallowed.
  const out = readOrder({ api_status: "Success", result: [{
    summary: {},
    success: [{ referrence: "A3F9C2", orderno: "EI-5UFAI", parcel: [{ awb: "238770015234", tracking_url: "https://easyparcel.com/my/en/track" }] }],
    fail: [{ orderno: "EI-5UFAJ", messagenow: "Insufficient Credit", parcel: [{}] }],
  }] });
  assert.equal(out.ok, true);
  assert.equal(out.booked.length, 1);
  assert.equal(out.booked[0].awb, "238770015234");
  assert.equal(out.booked[0].reference, "A3F9C2", "tied back by the order's own code");
  assert.equal(out.failed.length, 1);
  assert.equal(out.failed[0].reason, "Insufficient Credit", "the wallet, named as the wallet");
});

test("a booking that answered with nothing at all is a reason, not a silent success (v307)", () => {
  const out = readOrder({ api_status: "Success", result: [{ summary: {}, success: [], fail: [] }] });
  assert.equal(out.ok, false);
  assert.match(out.reason, /no order/);
});

test("a parcel's progress is read from their list, with a one-line fallback (v307)", () => {
  const withList = readTracking({ api_status: "Success", result: [{
    status_list: [{ status: "Delivered", update: "2026-10-08 14:20:00" }, { status: "In transit", update: "2026-10-07 09:00:00" }],
  }] });
  assert.equal(withList.ok, true);
  assert.equal(withList.events.length, 2);
  assert.equal(withList.events[0].status, "Delivered");
  // Their latest_* pair sits beside the list, and is all there is for a parcel whose history
  // they have not built yet.
  const latest = readTracking({ api_status: "Success", result: [{ latest_status: "Pending pickup", latest_update: "2026-10-06 08:00:00" }] });
  assert.deepEqual(latest.events, [{ status: "Pending pickup", at: "2026-10-06 08:00:00" }]);
  assert.equal(readTracking({ api_status: "Success", result: [{}] }).ok, false);
});

test("the provider names itself, so a second aggregator can sit beside it (v307)", () => {
  assert.equal(EASYPARCEL_KEY, "easyparcel");
});
