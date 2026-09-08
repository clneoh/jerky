import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_LANGS, langName, stars, fmtDate, reviewOk, photoOk, loadApproved, submitReview, uploadPhoto } from "../reviews.js";

const realFetch = globalThis.fetch;

const BASE = "https://ircwozniiyywsowamixy.supabase.co";
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY3dvem5paXl5d3Nvd2FtaXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Njc2MDQsImV4cCI6MjEwNDM0MzYwNH0.N3T87IOj2nnvKnHXeFM4DN9WR2js2N2R66Dc15edxIg";

// reviews.js guards its DOM wiring on `document` existing, so importing the pure
// helpers under Node never touches the homepage.

test("REVIEW_LANGS lists exactly the three welcome languages", () => {
  assert.deepEqual(REVIEW_LANGS.map((l) => l.code), ["en", "zh", "ms"]);
  assert.equal(REVIEW_LANGS.find((l) => l.code === "ms").label, "Bahasa Malaysia");
});

test("langName maps the three codes and falls back to English", () => {
  assert.equal(langName("en"), "English");
  assert.equal(langName("zh"), "中文");
  assert.equal(langName("ms"), "Bahasa Malaysia");
  assert.equal(langName("fr"), "English");
  assert.equal(langName(""), "English");
});

test("stars paints five glyphs, filled then hollow", () => {
  assert.equal(stars(5), "★★★★★");
  assert.equal(stars(3), "★★★☆☆");
  assert.equal(stars(1), "★☆☆☆☆");
  assert.equal(stars(0), "☆☆☆☆☆");
  assert.equal(stars(9), "★★★★★"); // clamped
  assert.equal(stars(-2), "☆☆☆☆☆");
  assert.equal(stars(null), "☆☆☆☆☆");
  assert.equal(stars(3.4), "★★★☆☆"); // rounds
  assert.equal(stars("2"), "★★☆☆☆");
});

test("fmtDate turns an ISO timestamp into 'd Mon yyyy' and blanks bad input", () => {
  assert.equal(fmtDate("2026-09-08T14:30:00Z"), "8 Sep 2026");
  assert.equal(fmtDate("2026-01-05T00:00:00Z"), "5 Jan 2026");
  assert.equal(fmtDate(""), "");
  assert.equal(fmtDate("not-a-date"), "");
  assert.equal(fmtDate(undefined), "");
});

test("reviewOk requires a name, integer 1-5 stars and a 1-400 char message", () => {
  assert.equal(reviewOk("Ain", 5, "So good!"), true);
  assert.equal(reviewOk(" Ain ", 3, "  Tasty  "), true); // trims
  assert.equal(reviewOk("", 5, "So good!"), false); // blank name
  assert.equal(reviewOk("   ", 5, "So good!"), false);
  assert.equal(reviewOk("Ain", 0, "So good!"), false); // below range
  assert.equal(reviewOk("Ain", 6, "So good!"), false); // above range
  assert.equal(reviewOk("Ain", 2.5, "So good!"), false); // must be whole
  assert.equal(reviewOk("Ain", "3", "So good!"), true); // numeric string ok
  assert.equal(reviewOk("Ain", 5, ""), false); // blank message
  assert.equal(reviewOk("Ain", 5, "  "), false);
  assert.equal(reviewOk("Ain", 5, "x".repeat(400)), true); // boundary
  assert.equal(reviewOk("Ain", 5, "x".repeat(401)), false); // too long
});

test("photoOk accepts a small image and rejects the rest", () => {
  const img = (bytes) => ({ type: "image/jpeg", size: bytes });
  assert.equal(photoOk(img(1024)), true);
  assert.equal(photoOk({ type: "image/png", size: 5 * 1024 * 1024 }), true); // exactly 5 MB
  assert.equal(photoOk(img(5 * 1024 * 1024 + 1)), false); // over 5 MB
  assert.equal(photoOk({ type: "text/plain", size: 10 }), false); // not an image
  assert.equal(photoOk(null), false);
  assert.equal(photoOk(undefined), false);
});

test("loadApproved fetches published reviews newest first with the anon key", async () => {
  const rows = [{ name: "Ain", stars: 5, message: "Yum", lang: "en", photo: "", created_at: "2026-09-08T00:00:00Z" }];
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => rows };
  };
  try {
    const got = await loadApproved();
    assert.deepEqual(got, rows);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].opts.method, undefined); // plain GET
    assert.equal(calls[0].opts.headers.apikey, ANON);
    assert.ok(calls[0].url.startsWith(`${BASE}/rest/v1/reviews?`));
    assert.ok(calls[0].url.includes("published=eq.true"));
    assert.ok(calls[0].url.includes("order=created_at.desc"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("loadApproved quietly returns [] on an error or a bad body", async () => {
  globalThis.fetch = async () => ({ ok: false, json: async () => [] });
  try { assert.deepEqual(await loadApproved(), []); } finally { globalThis.fetch = realFetch; }

  globalThis.fetch = async () => ({ ok: true, json: async () => ({ not: "an array" }) });
  try { assert.deepEqual(await loadApproved(), []); } finally { globalThis.fetch = realFetch; }

  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.deepEqual(await loadApproved(), []); } finally { globalThis.fetch = realFetch; }
});

test("submitReview posts one trimmed review to /rest/v1/reviews", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => [] };
  };
  try {
    const r = await submitReview({ name: "  Ain  ", stars: 4, message: "  Lovely  ", lang: "ms", photo: "" });
    assert.deepEqual(r, { ok: true });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${BASE}/rest/v1/reviews`);
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.apikey, ANON);
    assert.equal(calls[0].opts.headers["Content-Type"], "application/json");
    assert.equal(calls[0].opts.headers.Prefer, "return=minimal");
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body.length, 1);
    assert.deepEqual(body[0], { name: "Ain", stars: 4, message: "Lovely", lang: "ms", photo: "" });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("submitReview coerces a bad language to en and reports a failed post", async () => {
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => [] };
  };
  try {
    await submitReview({ name: "Ain", stars: 5, message: "Hi", lang: "de", photo: "http://img" });
    const body = JSON.parse(calls[0].opts.body);
    assert.equal(body[0].lang, "en");
  } finally {
    globalThis.fetch = realFetch;
  }

  globalThis.fetch = async () => ({ ok: false, json: async () => [] });
  try { assert.deepEqual(await submitReview({ name: "Ain", stars: 5, message: "Hi" }), { ok: false }); } finally { globalThis.fetch = realFetch; }

  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.deepEqual(await submitReview({ name: "Ain", stars: 5, message: "Hi" }), { ok: false }); } finally { globalThis.fetch = realFetch; }
});

test("uploadPhoto uploads to the review-photos bucket and returns the public URL", async () => {
  const file = { type: "image/jpeg", size: 2048 };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };
  try {
    const url = await uploadPhoto(file);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith(`${BASE}/storage/v1/object/review-photos/`));
    assert.ok(calls[0].url.endsWith(".jpg"));
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.apikey, ANON);
    assert.equal(calls[0].opts.headers["Content-Type"], "image/jpeg");
    assert.equal(calls[0].opts.headers["x-upsert"], "false");
    assert.equal(calls[0].opts.body, file);
    assert.ok(url.startsWith(`${BASE}/storage/v1/object/public/review-photos/`));
    assert.ok(url.endsWith(".jpg"));
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("uploadPhoto returns '' for an invalid file or a failed upload", async () => {
  assert.equal(await uploadPhoto(null), "");
  assert.equal(await uploadPhoto({ type: "text/plain", size: 10 }), "");

  globalThis.fetch = async () => ({ ok: false });
  try { assert.equal(await uploadPhoto({ type: "image/png", size: 10 }), ""); } finally { globalThis.fetch = realFetch; }

  globalThis.fetch = async () => { throw new Error("offline"); };
  try { assert.equal(await uploadPhoto({ type: "image/webp", size: 10 }), ""); } finally { globalThis.fetch = realFetch; }
});
