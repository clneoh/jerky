// supabase/functions/parcel/easyparcel.ts
//
// EasyParcel's own shape, and nothing but. Every request this app can send and every reply
// it has to read, in one file, with no fetch in it — so the Node suite can load this file
// and hold it against the vendor's own document (see test/parcel-provider.test.js).
//
// ⚠️ READ FROM EASYPARCEL'S OWN API DOCUMENT, NOT FROM GUESSWORK. "Individual API Document
// 1.4.0.0 (Malaysia)", 55 pages. It is a LEGACY REST-in-PHP API: one POST, the action in
// the QUERY STRING, and the parameters form-encoded with PHP's nested-array spelling —
// `bulk[0][pick_code]=10050`, not JSON. A body sent as JSON is silently unread, and the
// reply then looks like "the courier has nothing for you" rather than a mistake in here.
//
// ⚠️ EVERY STATE IS A THREE-LETTER LOWER-CASE CODE — `png` for Penang, `sgr`, `jhr` —
// from the document's own Appendix III, NOT the spelling on an address. Appendix III is
// the only place that mapping is written down, which is why `stateCode` is here and is
// deliberately NOT a guess: a state it does not recognise answers "" and the caller says
// so, rather than sending "Penang" and being told there is no rate.
//
// ⚠️ WHAT IS IN THE WALLET IS THE WHOLE BUSINESS. EasyParcel is PREPAID: booking pays from
// a credit balance, and the failure is named in its own words — "Insufficient Credit".
// So `balance` is not a nicety, it is the call that stops a booking failing at the counter.

export const EASYPARCEL_KEY = "easyparcel";

// The two hosts the document gives, verbatim. Demo is for testing and takes no real money.
export const EASYPARCEL_HOSTS: Record<string, string> = {
  demo: "http://demo.connect.easyparcel.my/",
  live: "https://connect.easyparcel.my/",
};

export function hostFor(env: string): string {
  return EASYPARCEL_HOSTS[String(env || "").trim().toLowerCase()] || EASYPARCEL_HOSTS.demo;
}

// The action names, exactly as the document spells them.
export const ACTION = {
  balance: "EPCheckCreditBalance",
  rates: "EPRateCheckingBulk",
  // ⚠️ V3, AND IT IS NOT AN OPTION: "This endpoint is designed to direct create order +
  // payment at EasyParcel" — one call, one wallet charge. The older EPSubmitOrderBulk only
  // creates a DRAFT that then has to be paid by EPPayOrderBulk, and a draft nobody paid is
  // a parcel nobody is coming for.
  book: "EPSubmitOrderBulkV3",
  orderStatus: "EPOrderStatusBulk",
  track: "EPTrackingBulk",
  label: "AWBLabel",
  categories: "EPGetParcelCategory",
};

// PHP's own spelling of a nested array, which is what this API's PHP reads.
//
// { api: "k", bulk: [{ pick_code: "10050" }] }  ->  api=k&bulk%5B0%5D%5Bpick_code%5D=10050
//
// Every key is percent-encoded INCLUDING THE BRACKETS, which is what PHP's urldecode expects
// and what `http_build_query` produces. Values are encoded too, so a shop name with an `&`
// in it cannot split one parameter into two.
export function phpForm(value: unknown, prefix = "", out: string[] = []): string[] {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    value.forEach((v, i) => phpForm(v, `${prefix}[${i}]`, out));
    return out;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      phpForm(v, prefix ? `${prefix}[${k}]` : k, out);
    }
    return out;
  }
  // Booleans go as 1/0: the document asks for `sms` and `dropoff` that way.
  const v = typeof value === "boolean" ? (value ? "1" : "0") : String(value);
  out.push(`${encodeURIComponent(prefix)}=${encodeURIComponent(v)}`);
  return out;
}

export function bodyFor(params: unknown): string {
  return phpForm(params).join("&");
}

// A parcel, as a rate check or an order wants it. `box` is in centimetres and kilograms —
// the document asks for `weight` in kg and the three sides in cm.
export type Box = { weightKg: number; lengthCm?: number; widthCm?: number; heightCm?: number };

// One rate-check row. The document's Request L2, exactly: the sender's postcode/state/country,
// the receiver's, the weight, and the sides — the sides are OPTIONAL to them but they are what
// a rate is really made of, because dry bread is bulky and light. Sending 0 for all three, as
// the document's own sample does, prices the parcel as if it were a brick.
export function rateRow(
  pick: { code: string; state: string },
  send: { code: string; state: string },
  box: Box,
  dateColl = "",
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    pick_code: String(pick.code || "").trim(),
    pick_state: String(pick.state || "").trim().toLowerCase(),
    pick_country: "MY",
    send_code: String(send.code || "").trim(),
    send_state: String(send.state || "").trim().toLowerCase(),
    send_country: "MY",
    weight: round2(box.weightKg),
  };
  // Only sent when she has measured it. A zero side is a lie in the same direction as a
  // missing one, and the document's own sample uses 0 to mean "not given".
  if (box.widthCm > 0) row.width = round2(box.widthCm);
  if (box.lengthCm > 0) row.length = round2(box.lengthCm);
  if (box.heightCm > 0) row.height = round2(box.heightCm);
  if (dateColl) row.date_coll = String(dateColl).slice(0, 10);
  return row;
}

// ⚠️ THE EXCLUDE LIST IS WHY THIS APP'S RATE REPLY IS SMALL ENOUGH TO SEND TO A PHONE.
// Without it every courier's entire drop-off point network comes back with every price —
// scores of rows per courier that this app has no use for. The document names the three
// fields it will drop, and these are two of them.
export const RATE_EXCLUDE = ["rates.*.dropoff_point", "rates.*.pickup_point", "pgeon_point"];

// One order row. The document's Request L2 for EPSubmitOrderBulkV3, minus the parts that
// need something this app does not have.
//
// ⚠️ `referrence` IS SPELLED THAT WAY IN THE DOCUMENT — two r's and an e — and it is the
// ONLY way to tie EasyParcel's reply back to her order. Mapping on the customer's name would
// put the wrong tracking number on the wrong order the first time two people share a name,
// so the order's own code goes in here and the same string comes back.
export function orderRow(input: {
  reference: string;
  content: string;
  valueRM: number;
  weightKg: number;
  pick: Party;
  send: Party;
  collectDate?: string;
}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    referrence: String(input.reference || "").slice(0, 40),
    weight: round2(input.weightKg),
    content: String(input.content || "").slice(0, 35),
    value: round2(input.valueRM),
    ...partyFields("pick", input.pick),
    ...partyFields("send", input.send),
  };
  if (input.collectDate) row.collect_date = String(input.collectDate).slice(0, 10);
  // The receiver's email is required by the document. An order taken over WhatsApp often
  // has none, and an invented address would send a courier's notifications to a stranger —
  // so the placeholder is a domain that cannot receive mail, said plainly in the code.
  row.send_email = String(input.send.email || "").trim() || "no-email@easyparcel.invalid";
  return row;
}

export type Party = {
  name: string; company?: string; contact: string; mobile?: string;
  addr1: string; addr2?: string; addr3?: string; addr4?: string;
  city: string; state: string; code: string; email?: string;
};

function partyFields(prefix: "pick" | "send", p: Party): Record<string, unknown> {
  const out: Record<string, unknown> = {
    [`${prefix}_name`]: String(p.name || "").slice(0, 35),
    [`${prefix}_contact`]: String(p.contact || "").slice(0, 16),
    [`${prefix}_addr1`]: String(p.addr1 || "").slice(0, 35),
    [`${prefix}_city`]: String(p.city || "").slice(0, 35),
    [`${prefix}_state`]: String(p.state || "").trim().toLowerCase(),
    [`${prefix}_code`]: String(p.code || "").trim(),
    [`${prefix}_country`]: "MY",
  };
  for (const k of ["company", "mobile", "addr2", "addr3", "addr4", "email"] as const) {
    const key = `${prefix}_${k}`;
    const v = String((p as Record<string, unknown>)[k] || "").trim();
    if (v) out[key] = v;
  }
  return out;
}

const round2 = (n: unknown) => Math.round((Number(n) || 0) * 100) / 100;

// ⚠️ APPENDIX III, COPIED WHOLE — THE ONLY PLACE THIS MAPPING IS WRITTEN DOWN. Thirteen
// states and three federal territories, and every one of them is a three-letter code that is
// NOT the spelling on an address: Pulau Pinang is `png`, Kuala Lumpur is `kul`, Putrajaya is
// `pjy`. Sending "Penang" gets a reply with no rates in it, which reads as "nobody delivers
// there" rather than as a spelling mistake in here.
//
// Keyed by the names that appear on Malaysian addresses, so an address that says either
// "Pulau Pinang" or "Penang" resolves to the same code.
const STATE_CODES: Record<string, string> = {
  johor: "jhr", johor: "jhr", "johor bahru": "jhr",
  kedah: "kdh", "kuala muda": "kdh",
  kelantan: "ktn", kota: "ktn",
  melaka: "mlk", malacca: "mlk",
  "negeri sembilan": "nsn", seremban: "nsn",
  pahang: "phg", kuantan: "phg",
  perak: "prk", ipoh: "prk",
  perlis: "pls", kangar: "pls",
  "pulau pinang": "png", penang: "png", "p. pinang": "png", pinang: "png",
  selangor: "sgr", "kuala selangor": "sgr",
  terengganu: "trg", kuala: "trg",
  "kuala lumpur": "kul", kl: "kul", "w.p. kuala lumpur": "kul", "wp kuala lumpur": "kul",
  putrajaya: "pjy", "putra jaya": "pjy", "w.p. putrajaya": "pjy",
  sarawak: "srw", kuching: "srw",
  sabah: "sbh", "kota kinabalu": "sbh", kinabalu: "sbh",
  labuan: "lbn", "w.p. labuan": "lbn",
};

// The code for a state she has typed, or the code itself when she has already used one.
// "" when it is not a state they deliver to — and the caller says so rather than sending it.
export function stateCode(state: string): string {
  const raw = String(state || "").trim().toLowerCase().replace(/\./g, "");
  if (!raw) return "";
  // Already one of theirs.
  if (Object.values(STATE_CODES).includes(raw)) return raw;
  return STATE_CODES[raw] || "";
}

// ── reading their replies ────────────────────────────────────────────────────
//
// EVERY REPLY IS SHAPED THE SAME WAY, and it is the PHP habit: `api_status` is "Success" or
// "Error", `error_code`/`error_remark` carry a setup fault, and the payload is under
// `result`. A business refusal is NOT an error — an empty wallet comes back as a Success
// whose message says "Insufficient Credit" — so `reasonIn` reads both and the caller never
// has to know which kind it got.

type Reply = Record<string, unknown>;

// "" when the reply is fine, or the sentence to show her. `fallback` is used when the
// vendor said nothing, because a blank reason on screen is a dead screen.
export function reasonIn(json: unknown, fallback = "EasyParcel did not say why."): string {
  const r = (json || {}) as Reply;
  const status = String(r.api_status || "").trim();
  if (status && status.toLowerCase() !== "success") {
    return String(r.error_remark || "").trim() || fallback;
  }
  // ⚠️ AN EMPTY WALLET IS A SUCCESS WITH A MESSAGE, and it is the one refusal this app can
  // actually help her fix. The document's own failure sample is exactly this string.
  const msg = String(r.error_remark || "").trim();
  return msg;
}

// The wallet, in ringgit. `result` is a STRING in the document's own sample ("99999755.99"),
// so it is read as a number rather than trusted to arrive as one.
export function readBalance(json: unknown): { ok: true; balanceRM: number } | { ok: false; reason: string } {
  const why = reasonIn(json, "The EasyParcel balance could not be read.");
  if (why) return { ok: false, reason: why };
  const r = (json || {}) as Reply;
  const n = Number(r.result);
  if (!Number.isFinite(n)) return { ok: false, reason: "EasyParcel did not send a balance." };
  return { ok: true, balanceRM: round2(n) };
}

export type Rate = {
  courierName: string; serviceName: string; priceRM: number;
  delivery: string; serviceId: string; rateId: string;
  courierId: string;
  dropoff: boolean; pickup: boolean;
};

// ⚠️ EVERY COURIER THEY CARRY, IN ONE CALL, ALREADY PRICED — which is the comparison this
// app was asked for, done per parcel instead of guessed at from a blog post.
//
// The cheapest is NOT chosen here. Their order of rows is their own and this app sorts by
// price so the screen reads top-down, but WHICH one to book is hers: the cheapest courier is
// not always the one a customer wants, and the point of showing several is that she can see
// the difference.
export function readRates(json: unknown): { ok: true; rates: Rate[] } | { ok: false; reason: string } {
  const why = reasonIn(json, "EasyParcel did not return a price.");
  if (why) return { ok: false, reason: why };
  const r = (json || {}) as Reply;
  const first = Array.isArray(r.result) ? (r.result[0] as Reply) : null;
  if (!first) return { ok: false, reason: "EasyParcel did not return a price for that parcel." };
  const blocked = String(first.remarks || "").trim();
  const rows = Array.isArray(first.rates) ? first.rates : [];
  const rates = rows.map((row): Rate => {
    const x = (row || {}) as Reply;
    const detail = String(x.service_detail || "").trim().toLowerCase();
    return {
      courierName: String(x.courier_name || "").trim(),
      serviceName: String(x.service_name || "").trim(),
      priceRM: round2(x.price),
      delivery: String(x.delivery || "").trim(),
      serviceId: String(x.service_id || "").trim(),
      rateId: String(x.rate_id || "").trim(),
      courierId: String(x.courier_id || "").trim(),
      dropoff: detail.indexOf("dropoff") >= 0,
      pickup: detail.indexOf("pickup") >= 0,
    };
  }).filter((x) => x.courierName && x.priceRM > 0)
    .sort((a, b) => a.priceRM - b.priceRM);
  if (!rates.length) {
    // "No rate" and "this parcel is not allowed" both arrive here, and they are different
    // sentences to her. Their own words win when they sent any.
    return { ok: false, reason: blocked || "No courier offered a price for that parcel." };
  }
  return { ok: true, rates };
}

// ⚠️⚠️ THE RATE REPLY AND THE BOOKING CALL NAME A COURIER DIFFERENTLY, AND THAT IS THE WHOLE FAULT (v562).
//
// ⭐ `EPRateCheckingBulk` answers with a DISPLAY name — their own sample says **"POSLAJU NATIONAL
// COURIER"**, **"CJ Century Logistics Sdn Bhd"** — while `EPSubmitOrderBulkV3` accepts only the ten
// names its Request L1 lists: 'Pgeon Prime', 'Pgeon Delivery', 'Poslaju', 'Skynet', 'ABX',
// 'DHL eCommerce', 'Aramex', 'CJ Century', 'UTS', 'ULTIMATE CONSOLIDATORS'.
// ⚠️ **So the app was sending "POSLAJU NATIONAL COURIER" to an endpoint that documents "Poslaju"** —
// a name it may answer with a fallback courier or a refusal, and neither is the parcel she priced.
//
// ⭐ THE JOIN IS `courier_id`, WHICH BOTH REPLIES CARRY. Appendix IV gives the codes for insurance
// (EP-CR0A Pos Laju, EP-CR05 Skynet, EP-CR0C DHLeC, EP-CR03 Aramex, EP-CR01 UTS) and the rate
// sample gives EP-CR0Z for CJ Century. ⭐ A code that is not one of those falls back to a NAME
// match, because the ten names are plain words and a display name contains one.
//
// ⚠️ A COURIER THAT CANNOT BE MATCHED IS REFUSED, NOT GUESSED. Sending a name their booking list
// does not carry can book a DIFFERENT courier through their fallback rule, at a different price.
export const BOOKABLE_COURIERS = [
  "Pgeon Prime", "Pgeon Delivery", "Poslaju", "Skynet", "ABX",
  "DHL eCommerce", "Aramex", "CJ Century", "UTS", "ULTIMATE CONSOLIDATORS",
];

const COURIER_BY_ID: Record<string, string> = {
  "EP-CR0A": "Poslaju",
  "EP-CR05": "Skynet",
  "EP-CR0C": "DHL eCommerce",
  "EP-CR03": "Aramex",
  "EP-CR01": "UTS",
  "EP-CR0Z": "CJ Century",
};

// Their names are words, so the match is on the words: lower case, punctuation gone, spaces run
// together. ⚠️ Only a name that CONTAINS the booked name is accepted, and the longest booked name
// wins so "Pgeon Prime" is never read as "Pgeon Delivery".
export function bookableCourierName(courierName: unknown, courierId?: unknown): string {
  const id = String(courierId || "").trim().toUpperCase();
  if (COURIER_BY_ID[id]) return COURIER_BY_ID[id];
  const said = String(courierName || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!said) return "";
  let best = "";
  for (const name of BOOKABLE_COURIERS) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (said === key || said.indexOf(key) >= 0) {
      if (key.length > best.length) best = name;
    }
  }
  return best;
}

export type Booked = {
  reference: string; orderNumber: string; awb: string; trackingUrl: string;
  // ⭐ What EasyParcel actually charged, read from the reply rather than assumed from the quote.
  priceRM: number; taxRM: number; addonRM: number; courierName: string;
};

// What came back from the booking. ⚠️ THIS ONE CALL BOTH CREATES THE ORDER AND TAKES THE
// MONEY OUT OF THE WALLET, so a partial failure is a real thing that has to be reported per
// parcel rather than swallowed: `booked` is what went through, `failed` is what did not and
// why. Anything in `failed` was NOT charged.
export function readOrder(json: unknown): { ok: true; booked: Booked[]; failed: { orderNumber: string; reason: string }[] } | { ok: false; reason: string; unknown?: boolean } {
  const why = reasonIn(json, "EasyParcel did not accept the order.");
  if (why) return { ok: false, reason: why };
  const r = (json || {}) as Reply;
  const result = Array.isArray(r.result) ? (r.result[0] as Reply) : null;
  // ⚠️⚠️ NO ORDER ROW IN A READABLE ANSWER IS UNKNOWN, NOT A REFUSAL (v598). ⚠️ The call both creates and charges,
  // so an empty `result` says nothing about whether it happened — ⚠️ **the Book press stayed live.**
  if (!result) return { ok: false, unknown: true, reason: "EasyParcel did not answer with an order." };

  const booked: Booked[] = [];
  const failed: { orderNumber: string; reason: string }[] = [];
  // Successes and failures are read through ONE loop because they are the same shape — a row
  // that came back with an AWB is an order, and a row that came back with a message is a
  // refusal — and reading them through two loops is how one of the two gets forgotten.
  const rows: unknown[] = [
    ...(Array.isArray(result.success) ? result.success : []),
    ...(Array.isArray(result.fail) ? result.fail : []),
  ];
  for (const row of rows) {
    const x = (row || {}) as Reply;
    const parcel = Array.isArray(x.parcel) ? ((x.parcel[0] || {}) as Reply) : ({} as Reply);
    const awb = String(parcel.awb || parcel.tracking_no || "").trim();
    if (awb) {
      booked.push({
        // ⚠️ THEIR SPELLING, BOTH WAYS. The document spells the field `referrence` in the
        // REQUEST and in its own success sample — so that is the one to read first — and the
        // correctly-spelled key is kept as a fallback in case they ever fix the typo rather
        // than break every integration that copied it.
        reference: String(x.referrence || x.reference || parcel.referrence || parcel.reference || "").trim(),
        // ⚠️ BOTH SPELLINGS: the V3 reply uses `order_number`, the older samples use `orderno`.
        orderNumber: String(x.order_number || x.orderno || "").trim(),
        awb,
        trackingUrl: String(parcel.tracking_url || "").trim(),
        // ⭐ THE FIGURES THAT WERE ACTUALLY TAKEN. `price` is the total (shipping + tax + addon),
        // `tax` and `addon_price` are the parts of it. Read as numbers so the screen can compare
        // them with what she was quoted.
        priceRM: round2(x.price),
        taxRM: round2(x.tax),
        addonRM: round2(x.addon_price),
        courierName: String(x.courier || x.courier_short || "").trim(),
      });
      continue;
    }
    // Their own words, and the one that matters most is "Insufficient Credit" — a wallet
    // problem she can fix in a minute, said as a wallet problem rather than as a failure.
    // ⚠️ `remarks` IS THE FIELD THEIR OWN FAIL SAMPLE USES (Response L5: referrence, status,
    // remarks), and it was not read (v562) — so a refusal written that way arrived with no reason.
    const said = String(x.messagenow || x.message || x.remarks || parcel.messagenow || "").trim();
    if (said || x.orderno) {
      failed.push({
        orderNumber: String(x.orderno || "").trim(),
        reason: said || "EasyParcel did not say why this one failed.",
      });
    }
  }
  if (!booked.length && !failed.length) {
    // ⚠️⚠️ AND A ROW WITH NEITHER A NUMBER NOR A REASON IS UNKNOWN TOO (v599) — a truncated gateway answer to a
    // call that both creates and charges must not leave the Book press live.
    return { ok: false, unknown: true, reason: "EasyParcel accepted the call but sent back no order." };
  }
  return { ok: true, booked, failed };
}

export type TrackEvent = { status: string; at: string };

// The parcel's journey, newest first as they send it. `latest_status`/`latest_update` sit
// beside `status_list`, so they are used as a one-event fallback for a parcel whose history
// they have not built yet.
export function readTracking(json: unknown): { ok: true; events: TrackEvent[] } | { ok: false; reason: string } {
  const why = reasonIn(json, "EasyParcel could not track that parcel.");
  if (why) return { ok: false, reason: why };
  const r = (json || {}) as Reply;
  const first = Array.isArray(r.result) ? (r.result[0] as Reply) : null;
  if (!first) return { ok: false, reason: "EasyParcel did not answer with a parcel." };
  // ⚠️⚠️ `status_list` IS AN OBJECT IN THEIR OWN SAMPLE, NOT AN ARRAY (v562). Their Response L3 table
  // calls it an array, and their success sample on the next page sends `{"0": {...}, "1": {...},
  // "status": "", "sender": "...", "receiver": "..."}` — ⭐ so `Array.isArray` found nothing and the
  // whole history was thrown away, leaving only the latest line. Both shapes are read now, the
  // numbered keys in order and their three bookkeeping keys ignored.
  const list: unknown[] = Array.isArray(first.status_list)
    ? first.status_list
    : (first.status_list && typeof first.status_list === "object"
      ? Object.entries(first.status_list as Record<string, unknown>)
        .filter(([k]) => /^\d+$/.test(k))
        .sort((a, b) => Number(a[0]) - Number(b[0]))
        .map(([, v]) => v)
      : []);
  const events = list.map((e): TrackEvent => {
    const x = (e || {}) as Reply;
    // ⚠️ AND THE TIME IS `event_date` + `event_time` (Response L4) — `update`/`datetime` are not fields
    // their sample sends, so every event used to arrive with no time at all.
    const at = String(x.update || x.datetime
      || [x.event_date, x.event_time].map((v) => String(v || "").trim()).filter(Boolean).join(" ")
      || "").trim();
    return { status: String(x.status || "").trim(), at };
  }).filter((e) => e.status);
  if (!events.length) {
    const latest = String(first.latest_status || "").trim();
    if (latest) events.push({ status: latest, at: String(first.latest_update || "").trim() });
  }
  if (!events.length) return { ok: false, reason: "EasyParcel has no progress for that parcel yet." };
  return { ok: true, events };
}

// ⚠️ THE COURIER LIST THAT CAN BE BOOKED IS *NOT* WRITTEN INTO THIS APP. The document's
// order endpoint lists a sample of couriers, and a list copied from a document is a list
// that goes stale the week EasyParcel adds one — or, worse, silently omits one she can
// actually see in their own website. So the app books from the RATE it was given: she picks
// a priced row.
//
// ⚠️⚠️ AND THE SERVICE CANNOT BE PINNED, WHICH IS NOW A FACT AND NOT A GUESS (v562).
// ⭐ The rate row carries `serviceId`/`rateId`, and the booking row has **no field for either**:
// `EPSubmitOrderBulkV3`'s Request L2 (page 33 of their 1.4.0.0 document) lists `referrence`, `weight`,
// `content`, `value`, the pick/send party, `collect_date`, `send_email` and `sms` — and nothing else.
// ⚠️ The ONLY way to name a service is the older `EPSubmitOrderBulk`, whose row takes `service_id` —
// **and that endpoint does not take the money**; it leaves a draft that has to be paid by a second
// call. ⭐ One call that creates AND pays is the safer of the two, so this app keeps V3 and says on
// screen that the price is a quote for that courier, with the charged amount read back from the
// reply (`readOrder` below) rather than the quote repeated as if it were the bill.
//
// The `courier` array is their fallback order for "if the first is not available" — one
// name, because she chose ONE price and a silent substitution to a different courier at a
// different price is not a thing to do behind her back.
export function bookRequest(input: { courier: string; dropoff: boolean; orders: Record<string, unknown>[] }): Record<string, unknown> {
  return {
    courier: [String(input.courier || "").trim()],
    dropoff: input.dropoff ? 1 : 0,
    bulk: input.orders,
  };
}

export function notSetUpReason(): string {
  return "EasyParcel is not set up yet — its key has not been saved on the server.";
}
