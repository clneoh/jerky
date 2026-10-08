import { test } from "node:test";
import assert from "node:assert/strict";
import { REVIEW_LANGS, langName, stars, fmtDate, reviewOk, photoOk, loadApproved, submitReview, uploadPhoto, MAX_INPUT_BYTES } from "../reviews.js";

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

test("photoOk accepts an image up to the 25 MB cap (it is shrunk before upload)", () => {
  const img = (bytes) => ({ type: "image/jpeg", size: bytes });
  assert.equal(photoOk(img(1024)), true);
  assert.equal(photoOk({ type: "image/png", size: 8 * 1024 * 1024 }), true); // a big phone photo is now fine
  assert.equal(photoOk(img(MAX_INPUT_BYTES)), true); // exactly at the cap
  assert.equal(photoOk(img(MAX_INPUT_BYTES + 1)), false); // over the cap
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

test("★★⚠️ uploadPhoto goes to the PRIVATE bucket and returns a PATH, never a public URL", async () => {
  // ⚠️⚠️ THIS TEST SAID THE OPPOSITE UNTIL v384, AND IT WAS RIGHT AT THE TIME. Her words: __"plan the
  // photo fix too"__. The upload used to land in the PUBLIC bucket and hand back a public address, so
  // a picture was reachable by its link the moment it uploaded — **before she had approved the
  // review**. It now lands somewhere nobody anonymous can read, and the value handed to
  // `submitReview` is a bare path rather than an address.
  const file = { type: "image/jpeg", size: 2048 };
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true };
  };
  try {
    const path = await uploadPhoto(file);
    assert.equal(calls.length, 1);
    assert.ok(calls[0].url.startsWith(`${BASE}/storage/v1/object/review-photos-pending/`),
      "the upload did not go to the private pending bucket");
    assert.ok(calls[0].url.endsWith(".jpg"));
    assert.equal(calls[0].opts.method, "POST");
    assert.equal(calls[0].opts.headers.apikey, ANON);
    assert.equal(calls[0].opts.headers.Authorization, `Bearer ${ANON}`); // storage requires the bearer
    assert.equal(calls[0].opts.headers["Content-Type"], "image/jpeg");
    assert.equal(calls[0].opts.headers["x-upsert"], "false");
    assert.equal(calls[0].opts.body, file);

    // ⚠️⚠️ THE RETURN VALUE IS THE WHOLE POINT: a bare path, not a URL.
    assert.equal(/^https?:\/\//.test(path), false,
      `the upload returned an address, so the picture is public before it is approved: ${path}`);
    assert.equal(path.includes("/"), false, "the path should be the object's name alone");
    assert.ok(path.endsWith(".jpg"));
    assert.equal(calls[0].url.endsWith(path), true, "the returned path is not the name it uploaded to");
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

// ── ★★ a review cannot arrive already PUBLISHED (v383) ────────────────────────
// Her words: __"run the reviews sql and build it properly"__ — after the 2026-09-25 report of ~16,000
// Supabase databases left publicly readable, I audited this app's own policies and found one real gap:
// **an anonymous visitor could publish their own review**, skipping her moderation. These two tests
// are a pair on purpose — the first is the rule the database must keep, the second is the promise that
// tightening it cannot break the real form.
//
// ⚠️ A TEXT GUARD, AND SAID PLAINLY: it cannot prove how the live database behaves — only SQL run
// against the project can (there is a query for that in the changelog entry). What it CAN do is stop
// this exact clause being loosened back to `true` by a future edit, which is how it got there.

const { readFileSync } = await import("node:fs");
// ⚠️ SQL COMMENTS COME OUT FIRST, and that is not tidiness. The file explains itself in `--` lines, and
// one of those lines contained a semicolon — which ended the "policy" the first version of this guard
// captured, so it read half a clause and failed over a policy that was correct. A `;` inside a comment
// must never be able to break a check on the CODE.
const reviewsSql = readFileSync(new URL("../supabase/reviews.sql", import.meta.url), "utf8")
  .split("\n").map((l) => l.replace(/--.*$/, "")).join("\n");

test("★★ the anon insert policy pins `published` to false", () => {
  const policy = /create policy "customer leaves a review"[\s\S]*?;/.exec(reviewsSql);
  assert.ok(policy, "the customer's insert policy is gone from supabase/reviews.sql");
  assert.match(policy[0], /for insert to anon/, "the policy no longer names the anonymous role it guards");
  assert.match(policy[0], /with check \(published = false\)/,
    "⚠️⚠️ the anon insert is unchecked again — anyone could publish their own review, unmoderated");
  assert.doesNotMatch(policy[0], /with check \(true\)/,
    "⚠️⚠️ `with check (true)` lets a visitor set published:true themselves");
});

test("★ and the real form never sends `published`, so the tighter rule cannot break it", () => {
  // ⚠️ THIS IS WHAT MAKES THE SQL SAFE TO RUN. The homepage's own submit sends five fields and no
  // more, so the column default (false) applies and every genuine review still lands unpublished.
  // If a future edit started sending `published`, the tighter policy would reject the whole insert
  // and the form would break silently on her homepage — which is exactly what this pins.
  const src = readFileSync(new URL("../reviews.js", import.meta.url), "utf8");
  const body = /submitReview\(data\)[\s\S]*?body: JSON\.stringify\(\[([\s\S]*?)\]\s*\)/.exec(src);
  assert.ok(body, "submitReview's insert body could not be read — has it been restructured?");
  const fields = [...body[1].matchAll(/^\s*([a-z_]+):/gm)].map((m) => m[1]).sort();
  assert.deepEqual(fields, ["lang", "message", "name", "photo", "stars"],
    `the homepage now posts: ${fields.join(", ")} — a field outside the policy's reach would be refused`);
  assert.doesNotMatch(body[1], /published/,
    "⚠️⚠️ the form sends `published`, which the tightened policy refuses — the homepage would break");
});

// ── ★★ the picture is private until she publishes (v384) ──────────────────────
// Her words: __"plan the photo fix too"__, then __"Gate it properly, and harden."__

test("★★ the pending bucket is PRIVATE, and BOTH buckets are limited", () => {
  const buckets = reviewsSql.match(/insert into storage\.buckets[\s\S]*?;/g) || [];
  assert.equal(buckets.length, 2, `expected two buckets, found ${buckets.length}`);
  const pending = buckets.find((b) => b.includes("'review-photos-pending'"));
  const live = buckets.find((b) => /values \('review-photos'/.test(b));
  assert.ok(pending, "the private pending bucket is not created");
  assert.ok(live, "the public bucket is not created");

  assert.match(pending, /values \('review-photos-pending', 'review-photos-pending', false/,
    "⚠️⚠️ the pending bucket is not private — a waiting picture would be readable by anyone with its link");
  // ⚠️ The public bucket already exists on her project, so `do nothing` would leave it exactly as it
  // was — with no limit at all, which is half of what is being fixed.
  assert.match(live, /on conflict \(id\) do update/,
    "⚠️ the existing public bucket would keep NO size limit, because `do nothing` changes nothing");
  // ⚠️⚠️ THE VALUES, NOT THE COLUMN NAMES. The first version of this guard matched
  // `/allowed_mime_types/`, which still appears in the column list and in the `set` clause — so it
  // passed even when the value was `null`. **A bite walked straight through it.** What matters is
  // what is actually in the values clause.
  for (const [who, b] of [["the pending bucket", pending], ["the public bucket", live]]) {
    const values = /values \(([\s\S]*?)\)\s*on conflict/.exec(b);
    assert.ok(values, `${who}: could not read its values clause`);
    assert.match(values[1], /\b\d{4,}\b/,
      `⚠️ ${who} has no size limit — anyone could push any file of any size into it`);
    assert.match(values[1], /image\/jpeg/,
      `⚠️ ${who} accepts any file type, not only pictures`);
  }
});

test("★★⚠️ the PUBLIC bucket accepts no anonymous upload at all", () => {
  // ⚠️⚠️ THIS IS THE LOAD-BEARING RULE, AND IT IS AN ABSENCE — which is exactly why it needs a test.
  // It is the only thing standing between her homepage and a picture nobody has approved.
  const policies = reviewsSql.match(/create policy[^;]+;/g) || [];
  const anonUploads = policies.filter((p) => /on storage\.objects/.test(p) && /for insert to anon/.test(p));
  assert.equal(anonUploads.length, 1, `expected one anonymous upload policy, found ${anonUploads.length}`);
  assert.match(anonUploads[0], /bucket_id = 'review-photos-pending'/,
    "⚠️⚠️ the anonymous upload does not name the PRIVATE bucket");
  assert.doesNotMatch(anonUploads[0], /'review-photos'/,
    "⚠️⚠️ the PUBLIC bucket is named in the anonymous upload policy — an unapproved picture could land in it");
});

test("★ the homepage still reads approved pictures, and only her app may touch the private ones", () => {
  const policies = reviewsSql.match(/create policy[^;]+;/g) || [];
  const anonReads = policies.filter((p) => /on storage\.objects/.test(p) && /for select to anon/.test(p));
  assert.equal(anonReads.length, 1, "the homepage needs exactly one read policy");
  assert.match(anonReads[0], /bucket_id = 'review-photos'/,
    "the public read does not name the public bucket");
  assert.doesNotMatch(anonReads[0], /pending/,
    "⚠️⚠️ the public can read the PRIVATE bucket — a waiting picture would be exposed");

  const baker = policies.find((p) => /for all to authenticated/.test(p) && /on storage\.objects/.test(p));
  assert.ok(baker, "her app has no policy to read, copy or delete a picture — the card could not show it");
  assert.match(baker, /review-photos-pending/, "her app cannot reach the private bucket");
  assert.match(baker, /review-photos/, "her app cannot publish into the public bucket");
});
