// test/courier-sign.test.js — the Lalamove request signature (v188, 25 Sep 2026).
//
// This is the least forgiving code in the whole courier feature, and the reason is
// worth stating before the tests: a signature that is wrong by ONE CHARACTER is not
// a wrong answer she can read. It is a 401 with no useful words, on every call, for
// every trip, and the only way to find the character is to bisect a string by hand.
// So the tests below do not check that the signature "looks right". They check it
// against an INDEPENDENT implementation — node:crypto's own HMAC — and they check
// the exact bytes of the string being signed, CRLFs included.
//
// The four things that are easy to get wrong, each pinned by name:
//
//   • the timestamp is MILLISECONDS, not seconds
//   • the four parts are joined with CRLF, and there are TWO of them between the
//     path and the body, because a GET's body is the empty string
//   • the verb is UPPERCASE
//   • the signed path carries no query string
//
// The file under test is supabase/functions/courier/sign.mjs — a plain ES module
// with no Deno API in it, precisely so that this test can import the SAME FILE the
// edge function runs rather than a copy of it. WebCrypto is the only crypto used,
// and Node and Deno both have it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

const {
  nowMs, signatureBase, hmacHex, authHeader, signRequest, timingSafeEqual,
} = await import("../supabase/functions/courier/sign.mjs");

const SECRET = "sk_test_abcdef0123456789";
const KEY = "pk_test_abcdef0123456789";
const T = 1758758400000; // 2025-09-25T00:00:00.000Z, a fixed instant

// ── the string that gets signed, byte for byte ────────────────────────────

test("a GET signs the timestamp, the verb, the path, and an empty body", () => {
  assert.equal(
    signatureBase(T, "GET", "/v3/cities"),
    `${T}\r\nGET\r\n/v3/cities\r\n\r\n`,
  );
});

test("a POST signs its body after the same two CRLFs", () => {
  assert.equal(
    signatureBase(T, "POST", "/v3/quotations", '{"a":1}'),
    `${T}\r\nPOST\r\n/v3/quotations\r\n\r\n{"a":1}`,
  );
});

test("the separators are CARRIAGE RETURNS, not line feeds", () => {
  // The single most likely character to be wrong, so it is asserted on its own
  // rather than left to a whole-string comparison to notice.
  const base = signatureBase(T, "GET", "/v3/cities");
  assert.equal(base.split("\r\n").length, 5, "four separators, so five pieces");
  assert.equal(base.includes("\r\n\r\n"), true, "and the two between path and body are a pair");
  assert.equal(base.split("\r\n\r\n").length, 2, "one pair, not two — a doubled pair is a different signature");
  assert.equal(base.includes("\n\n"), false, "a bare LF pair would mean the CRs went missing");
  assert.equal(/[^\r]\n/.test(base), false, "no bare LF anywhere");
});

test("the verb is uppercased, whatever it was given", () => {
  assert.equal(signatureBase(T, "get", "/v3/cities"), `${T}\r\nGET\r\n/v3/cities\r\n\r\n`);
  assert.equal(signatureBase(T, "Post", "/v3/orders", "{}"), `${T}\r\nPOST\r\n/v3/orders\r\n\r\n{}`);
});

test("the path is signed as given — including the /v3 the URL carries", () => {
  // Lalamove verifies the path it received, and the host it received it on is not
  // part of it. A signature built from "/quotations" instead of "/v3/quotations"
  // is a 401 with nothing on screen to explain it.
  assert.equal(signatureBase(T, "POST", "/v3/quotations", ""), `${T}\r\nPOST\r\n/v3/quotations\r\n\r\n`);
});

test("no query string is ever part of the signed path", () => {
  // The caller sends `?market=MY` in the URL and must sign the bare path. This test
  // exists to make that a decision rather than an accident: the function below
  // signs what it is handed, and llmRequest hands it a path with no query on it.
  assert.equal(signatureBase(T, "GET", "/v3/cities"), `${T}\r\nGET\r\n/v3/cities\r\n\r\n`);
});

test("a missing body and an empty body sign the same string", () => {
  assert.equal(signatureBase(T, "GET", "/v3/cities"), signatureBase(T, "GET", "/v3/cities", ""));
  assert.equal(signatureBase(T, "GET", "/v3/cities"), signatureBase(T, "GET", "/v3/cities", null));
});

// ── the HMAC, checked against an independent implementation ───────────────

test("the signature is the lowercase-hex HMAC-SHA-256 of that exact string", async () => {
  const base = signatureBase(T, "POST", "/v3/quotations", '{"serviceType":"MOTORCYCLE"}');
  const mine = await hmacHex(SECRET, base);
  // Independently computed, by a different implementation of the same standard.
  const theirs = createHmac("sha256", SECRET).update(base).digest("hex");
  assert.equal(mine, theirs);
  assert.equal(mine.length, 64, "SHA-256 is 32 bytes, so 64 hex characters");
  assert.equal(mine, mine.toLowerCase(), "lowercase hex — an uppercase digest is a 401");
});

test("a secret of the right shape but the wrong value gives a different signature", async () => {
  const base = signatureBase(T, "GET", "/v3/cities");
  assert.notEqual(await hmacHex(SECRET, base), await hmacHex("sk_test_abcdef0123456780", base));
});

test("one character different in the base gives a different signature", async () => {
  // Which is exactly why the CRLF tests above are separate from this one: this
  // test would pass just as well with the wrong separator.
  const a = await hmacHex(SECRET, signatureBase(T, "GET", "/v3/cities"));
  const b = await hmacHex(SECRET, signatureBase(T, "GET", "/v3/citieS"));
  assert.notEqual(a, b);
});

// ── the header ────────────────────────────────────────────────────────────

test("the header is hmac KEY:TIMESTAMP:SIGNATURE", () => {
  assert.equal(authHeader(KEY, T, "deadbeef"), `hmac ${KEY}:${T}:deadbeef`);
});

test("the timestamp in the header is the SAME one that was signed", async () => {
  // The two are produced together for this reason. A header carrying seconds while
  // the base carried milliseconds is a 401 that looks, from the outside, exactly
  // like a wrong secret.
  const out = await signRequest({ key: KEY, secret: SECRET, method: "GET", path: "/v3/cities", timestampMs: T });
  assert.equal(out.timestamp, T);
  assert.match(out.authorization, new RegExp(`^hmac ${KEY}:${T}:`));
  assert.equal(out.authorization, `hmac ${KEY}:${T}:${out.signature}`);
  assert.equal(out.signature, await hmacHex(SECRET, out.base));
});

test("signRequest reports what it signed, so a failure can be logged honestly", async () => {
  const out = await signRequest({ key: KEY, secret: SECRET, method: "post", path: "/v3/orders", body: "{}", timestampMs: T });
  assert.equal(out.base, `${T}\r\nPOST\r\n/v3/orders\r\n\r\n{}`);
  assert.equal(out.timestamp, T);
});

test("the secret is never returned", async () => {
  // It is read from the function's environment and must not come back out of a call
  // that might end up in a log line.
  const out = await signRequest({ key: KEY, secret: SECRET, method: "GET", path: "/v3/cities", timestampMs: T });
  assert.equal(JSON.stringify(out).includes(SECRET), false);
});

// ── the clock ─────────────────────────────────────────────────────────────

test("the timestamp is milliseconds, and it is the real clock when none is given", async () => {
  const before = Date.now();
  const t = nowMs();
  const after = Date.now();
  assert.ok(t >= before && t <= after);
  assert.equal(String(t).length, 13, "seconds would be 10 digits — this is the single most common mistake");
});

test("two calls a second apart sign differently, so a replay is not accepted", async () => {
  const a = await signRequest({ key: KEY, secret: SECRET, method: "GET", path: "/v3/cities", timestampMs: T });
  const b = await signRequest({ key: KEY, secret: SECRET, method: "GET", path: "/v3/cities", timestampMs: T + 1000 });
  assert.notEqual(a.signature, b.signature);
});

// ── comparing two signatures without leaking one ──────────────────────────

test("equal signatures compare equal, and differ by one character do not", () => {
  assert.equal(timingSafeEqual("abc123", "abc123"), true);
  assert.equal(timingSafeEqual("abc123", "abc124"), false);
  assert.equal(timingSafeEqual("abc123", "abc12"), false, "a prefix is not a match");
  assert.equal(timingSafeEqual("", ""), true);
});

test("an empty or missing signature never matches a real one", () => {
  const real = "a".repeat(64);
  assert.equal(timingSafeEqual("", real), false);
  assert.equal(timingSafeEqual(null, real), false);
  assert.equal(timingSafeEqual(undefined, real), false);
  assert.equal(timingSafeEqual(real, null), false);
});
