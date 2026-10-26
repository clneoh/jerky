// test/waitlist.test.js — P5: "tell me when this day frees up".
//
// ⚠️⚠️ THE DESIGN IS AN ASYMMETRY, AND BOTH HALVES ARE TESTED:
//   · **the shop may ADD a request and may never READ the list back** — every row is somebody else's number;
//   · **she may read, tick and delete them** — from her own signed-in phones.
// ⭐ And one ask per day per phone, so a second press cannot fill her list.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { waitRow, hasAsked, rememberAsked, askedDays } from "../store/waitlist.js";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const store = (initial = {}) => {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => map.delete(k),
  };
};
// the shop's own number form: local 0… → 60…
const toDigits = (v) => {
  const d = String(v || "").replace(/\D/g, "");
  return d.startsWith("0") ? `60${d.slice(1)}` : d;
};

test("★★★ a request needs a real day and a real number (v648)", () => {
  assert.deepEqual(waitRow({ day: "2026-10-31", name: " Mei ", whatsapp: "012-345 6789" }, toDigits),
    { day: "2026-10-31", name: "Mei", whatsapp: "60123456789" });
  assert.equal(waitRow({ day: "31 Oct", whatsapp: "60123456789" }, toDigits), null, "★ a day that is not a date was accepted");
  assert.equal(waitRow({ day: "2026-10-31", whatsapp: "123" }, toDigits), null, "★ a number too short to reach was accepted");
  assert.equal(waitRow({ day: "2026-10-31", whatsapp: "" }, toDigits), null, "★ a request with no number cannot be answered");
  // a name is optional, and a very long one is cut rather than stored whole
  assert.equal(waitRow({ day: "2026-10-31", whatsapp: "60123456789" }, toDigits).name, "");
  assert.equal(waitRow({ day: "2026-10-31", name: "x".repeat(200), whatsapp: "60123456789" }, toDigits).name.length, 60);
});

test("★★★ one ask per day per phone (v648)", () => {
  const s = store();
  assert.equal(hasAsked(s, "2026-10-31"), false);
  rememberAsked(s, "2026-10-31");
  assert.equal(hasAsked(s, "2026-10-31"), true);
  assert.equal(hasAsked(s, "2026-11-02"), false, "★ asking about one day blocked another");
  // a corrupt latch is no latch — the shop must still be able to take a request
  const bad = store({ "bakeadmin.shop.asked": "{not json" });
  assert.deepEqual(askedDays(bad), []);
  assert.equal(hasAsked(bad, "2026-10-31"), false);
  // and a phone with no storage at all does not throw
  assert.doesNotThrow(() => rememberAsked(null, "2026-10-31"));
});

test("★★★ the shop can ADD but never READ — and she can read (v648)", () => {
  const sql = read("supabase/waitlist.sql");
  assert.match(sql, /grant insert on public\.waitlist to anon;/,
    "★ the shop cannot add a request — the form would silently fail");
  assert.ok(!/grant select[^;]*to anon/i.test(sql),
    "★ the public key can READ the waitlist — every row is somebody else's phone number");
  // ⚠️⚠️ MEASURED on her project (25 Oct): Supabase grants ALL to `anon` on a new table BY DEFAULT, so the
  // read-back said `anon_can_read = true` with no line in the file asking for it. ⭐ **The revoke is not belt
  // and braces — it is the only thing standing between a default grant and every customer's phone number.**
  assert.match(sql, /revoke all on public\.waitlist from anon;/,
    "★ no revoke — Supabase's default grant leaves the public key able to read the list");
  assert.match(sql, /grant select, update, delete on public\.waitlist to authenticated;/, "she cannot read or tick them");
  assert.match(sql, /has_table_privilege\('anon', 'public\.waitlist', 'SELECT'\)\s+as anon_can_read/,
    "the read-back no longer asks the question that matters");
  assert.match(sql, /enable row level security/);
});

test("★★★ the form sits on a full day and posts only a real request (v648)", () => {
  const app = read("store/app.js");
  assert.match(app, /waitForm\(fullIso, day\)/, "★ the full-day card offers no way to ask");
  assert.match(app, /\/rest\/v1\/waitlist/, "★ nothing is sent anywhere");
  assert.match(app, /const row = waitRow\(\{ day: iso, name: name\.value, whatsapp: phone\.value \}, waNumber\)/,
    "★ the request is not validated before it is sent");
  assert.match(app, /if \(!row\) return say\(t\("waitBad"\)\);/, "★ a bad number is accepted in silence");
  assert.match(app, /rememberAsked\(store, iso\);/, "★ the phone can ask again and again about the same day");
  // ⚠️ and it obeys v643's rule: hidden is a property in this file, never an attribute
  assert.match(app, /said\.hidden = true;/, "the confirmation line starts visible");
});

test("★★ she sees who is waiting, and can tick them off (v648)", () => {
  const dash = read("admin/js/views/dashboard.js");
  assert.match(dash, /fetchWaitlist\(state, \{ today \}\)/, "the Home card reads nothing");
  assert.match(dash, /Waiting to be told/, "the card is not on Home");
  assert.match(dash, /markWaitlistDone\(state, \[row\.id\]\)/, "★ a request can never be ticked off");
  assert.match(dash, /btn-row/, "the row offers no presses");
});
