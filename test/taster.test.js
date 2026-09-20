// test/taster.test.js — the landing page a printed label opens (/taster/), minus
// the browser: reading the label out of the address bar, carrying it on to the
// shop, what settings can change under it, and the row a visit writes. No DOM,
// no network, no camera.
// Run with: node --test test/

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  copyFor, createView, findCode, localCopy, mergeTaster, offerWords, parseCode,
  parseVia, storeLink, visitPayload,
} from "../taster/app.js";

// ── reading the address bar ───────────────────────────────────────────────

test("a label's code is read off the address bar, however it was typed", () => {
  assert.equal(parseCode("?c=K3X9"), "K3X9");
  // A code is printed in capitals, but a customer may type it lower-case and a
  // QR scanner may hand over the URL exactly as some other tool wrote it.
  assert.equal(parseCode("?c=k3x9"), "K3X9");
  assert.equal(parseCode("?c=%20k3x9%20"), "K3X9", "a stray space is not part of the code");
  assert.equal(parseCode("?c=K3X9&via=60123456789"), "K3X9");
  assert.equal(parseCode(""), "", "a page opened without a code is not an error");
  assert.equal(parseCode("?track=ABC"), "");
});

test("a bring-a-friend label's number travels on, and is never invented", () => {
  assert.equal(parseVia("?c=K3X9&via=60123456789"), "60123456789");
  assert.equal(parseVia("?c=K3X9"), "");
  assert.equal(parseVia(""), "");
  // Deliberately NOT validated into the shape a customer book would use: this is
  // the same `?via=` the referral link already carries, and the shop is the one
  // that decides what a usable number is. A `+` survives when it is encoded the
  // way URLSearchParams encodes it — an unencoded one is a space, which is the
  // query string's rule and not this page's.
  assert.equal(parseVia("?via=%2B60123456789"), "+60123456789");
});

test("the way on to the shop keeps the label — and the friend — attached", () => {
  assert.equal(storeLink("K3X9", ""), "../store/?c=K3X9");
  assert.equal(storeLink("", ""), "../store/", "no label, no query — just the shop");
  // Both stamps have to survive the hop: the code is what the offer and the shop
  // are counted against, and `via` is what pays the introducing customer.
  assert.equal(storeLink("k3x9", "60123456789"), "../store/?c=K3X9&via=60123456789");
  assert.equal(storeLink("", "60123456789"), "../store/?via=60123456789");
});

// ── what the settings can change under the page ───────────────────────────

test("a published setting replaces the page's own copy, and a blank one does not", () => {
  const base = { shop: "Munchies Furkidz", whatsapp: "60189136389", instagram: "munchies_furkidz",
    askPet: true, follow: true };
  const merged = mergeTaster(base, {
    heading: "  A treat for your cat  ", body: "Scan and say hello",
    headingZh: "给你的猫", instagram: "", askPet: false,
  });
  assert.equal(merged.heading, "A treat for your cat", "trimmed on the way in");
  assert.equal(merged.body, "Scan and say hello");
  assert.equal(merged.headingZh, "给你的猫");
  assert.equal(merged.instagram, "munchies_furkidz", "a blank setting never wipes what the page has");
  assert.equal(merged.askPet, false, "the dog-or-cat question can be switched off");
  assert.equal(merged.follow, true, "and the one she did not touch is left alone");
  // A NEW object: the page assigns the result over its own config, so mutating the
  // base here would be the difference between the fix and the bug it was.
  assert.notEqual(merged, base);
  assert.equal(base.heading, undefined, "the base is not written through");
});

test("junk from the settings is ignored rather than painted", () => {
  const merged = mergeTaster({ shop: "Munchies Furkidz" }, null);
  assert.equal(merged.shop, "Munchies Furkidz");
  assert.deepEqual(mergeTaster({ shop: "S" }, "not an object").shop, "S");
  assert.equal(mergeTaster({ shop: "S" }, { heading: 42 }).heading, undefined);
  assert.equal(mergeTaster({ shop: "S" }, { askPet: "yes" }).askPet, undefined,
    "only a real false switches this off — anything else leaves the default");
});

test("a heading with no translation of its own falls back to the English one", () => {
  const cfg = { heading: "A treat for your pet", headingZh: "给你的宠物" };
  assert.equal(copyFor(cfg, "heading", "en"), "A treat for your pet");
  assert.equal(copyFor(cfg, "heading", "zh"), "给你的宠物");
  assert.equal(copyFor(cfg, "heading", "ms"), "A treat for your pet", "not written yet");
  assert.equal(copyFor({ headingZh: "   " }, "heading", "zh"), "", "blank either way is blank");
});

test("the page never lights up for a code she has retired", () => {
  const cfg = { codes: [{ code: "K3X9", kind: "shop" }, { code: "PSHOP", kind: "promo" }] };
  assert.equal(findCode(cfg, "k3x9").code, "K3X9");
  assert.equal(findCode(cfg, "K3X9").kind, "shop");
  assert.equal(findCode(cfg, "NOPE"), null);
  assert.equal(findCode(cfg, ""), null);
  assert.equal(findCode({}, "K3X9"), null, "no published codes at all is not a crash");
});

// ── what the label says ───────────────────────────────────────────────────

const info = (over = {}) => ({
  code: "MILO", kind: "promo", productName: "Chicken Jerky 100g",
  offer: { type: "pct", value: 10, minSpend: 30, to: "2026-09-30", newOnly: true, cur: "RM" },
  ...over,
});

test("an offer is stated in the same words the shop uses", () => {
  const words = offerWords(info(), "en", "2026-09-20").join(" · ");
  assert.match(words, /10% off/);
  assert.match(words, /RM30/);
  assert.match(words, /30 Sep/, "the day it ends is written out, not as a date stamp");
});

test("an offer whose day has passed stops being stated at all", () => {
  // The settings that were published may be days old, and a customer holding an
  // expired label must not be promised something nobody will honour.
  assert.deepEqual(offerWords(info(), "en", "2026-10-01"), []);
  assert.ok(offerWords(info(), "en", "2026-09-30").length, "the last day still counts");
});

test("a shop's label names the shop, and a plain one says nothing", () => {
  const shop = offerWords({ code: "PSHOP", kind: "shop", partnerName: "Paw Shop" }, "en", "2026-09-20");
  assert.deepEqual(shop, ["from Paw Shop"]);
  assert.deepEqual(offerWords({ code: "AAAAA", kind: "plain" }, "en", "2026-09-20"), [],
    "nothing to state, nothing printed");
  assert.deepEqual(offerWords(null, "en", "2026-09-20"), []);
});

test("the offer line reads in the visitor's own language", () => {
  const zh = offerWords(info(), "zh", "2026-09-20").join(" · ");
  assert.match(zh, /10%/);
  assert.match(zh, /9月30日/, "the end date is written the Chinese way");
  assert.ok(!/off/.test(zh), "and not in English");

  const ms = offerWords(info(), "ms", "2026-09-20").join(" · ");
  assert.match(ms, /Diskaun 10%/);
  assert.match(ms, /30 Sep/, "the month is written the Malay way — Sep is the same word");
  assert.ok(!/off|until/.test(ms), "and not in English either");
});

// ── the visit ─────────────────────────────────────────────────────────────

test("a visit records only what the table allows", () => {
  assert.deepEqual(visitPayload({ code: "k3x9", pet: "dog", lang: "zh" }),
    { code: "K3X9", pet: "dog", lang: "zh" });
  assert.deepEqual(visitPayload({ pet: "Cat", lang: "ms" }),
    { code: "", pet: "cat", lang: "ms" }, "a page opened without a label still counts");
  // An answer the buttons cannot give is stored as no answer — the table's own
  // check would reject the row and the visit would be lost with it.
  assert.equal(visitPayload({ pet: "goat" }).pet, "");
  assert.equal(visitPayload({ lang: "fr" }).lang, "en");
  assert.equal(visitPayload().pet, "");
  assert.equal(visitPayload({ code: "  " }).code, "");
});

test("a visit's code cannot outgrow the column it is written to", () => {
  assert.equal(visitPayload({ code: "abcdefghijklmnopqrstuvwxyz" }).code, "ABCDEFGHIJKLMNOP");
});

// ── the page as it opens ──────────────────────────────────────────────────

test("opening a label's link is enough to know what to draw", () => {
  const v = createView({ search: "?c=k3x9&via=60123456789", now: new Date("2026-09-20T10:00:00") });
  assert.equal(v.code, "K3X9");
  assert.equal(v.via, "60123456789");
  assert.equal(v.info, null, "the published codes have not arrived yet");
  assert.equal(v.pet, "", "and nobody has said who the treat is for");
  assert.equal(v.recorded, false);
  assert.equal(v.today, "2026-09-20");
  assert.equal(typeof v.copy.shop, "string", "a first paint from the shop's own settings");
});

test("the page's own copy is what the app says, not a second version of it", () => {
  const local = localCopy({ name: "Munchies Furkidz", whatsapp: " 60189136389 ", instagram: " munchies_furkidz " });
  assert.equal(local.shop, "Munchies Furkidz");
  assert.equal(local.whatsapp, "60189136389", "trimmed — a stray space breaks a link");
  assert.equal(local.instagram, "munchies_furkidz");
  assert.equal(local.askPet, true);
  assert.equal(local.follow, true);
});
