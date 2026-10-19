// reviews.js — the "What customers say" section of the homepage (index.html).
// Loads approved reviews from Supabase and runs the "Leave a review" form.
//
// Anyone can post (public anon insert), but every review starts unpublished and
// only appears here after the owner taps Publish in the admin app
// (More → Reviews). The form states reviews are welcome in English, Mandarin
// (Chinese) or Bahasa Malaysia; a customer may attach one photo, stored in the
// "review-photos" bucket. A chosen photo is shrunk to a small JPEG before it is
// uploaded, so a customer's phone picture of any size is accepted.
//
// Published reviews show one at a time in an animated carousel (auto-advance
// every few seconds, with arrows, dots and swipe) once two or more exist. The
// whole page is trilingual — this module reads its own dynamic strings from
// home-lang.js for the visitor's chosen site language.
//
// This page has no build step, so the public project address + anon key are
// written here directly — same values ship in store/config.js and the admin
// Settings. The anon key is public by design (it only gates which Supabase
// project to talk to; the SQL policies do the real security).
//
// Everything above the DOM section is a pure helper so it runs under Node for
// tests; the DOM work only starts when this file loads in a browser that has
// the #reviews section.

import { pick, loadLang } from "./i18n.js";
import { HOME } from "./home-lang.js";

const SUPABASE = {
  url: "https://ircwozniiyywsowamixy.supabase.co",
  anonKey: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlyY3dvem5paXl5d3Nvd2FtaXh5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg3Njc2MDQsImV4cCI6MjEwNDM0MzYwNH0.N3T87IOj2nnvKnHXeFM4DN9WR2js2N2R66Dc15edxIg",
};

const BASE = String(SUPABASE.url).replace(/\/+$/, "");

export const REVIEW_LANGS = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "ms", label: "Bahasa Malaysia" },
];
const LANG_CODES = REVIEW_LANGS.map((l) => l.code);
const LANG_BY_CODE = Object.fromEntries(REVIEW_LANGS.map((l) => [l.code, l.label]));

// A picked photo may be up to this big — it is shrunk before upload (see
// shrinkReviewPhoto), so real phone photos are never turned away on size.
// Only a truly huge file is refused.
export const MAX_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB
// Shrink target: the longest side after downscaling. The homepage card shows a
// photo at most 340px tall and the app's moderator card no bigger, so 1000px
// still has detail to spare at 2x screens — while keeping uploads small on
// mobile data and the public bucket light.
const PHOTO_MAX_SIDE = 1000;
// Photos already this small (and not wider than the target) go up unchanged —
// re-encoding them would only waste the customer's battery and the cloud.
const SMALL_PHOTO_KEEP = 500 * 1024;
const PHOTO_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// "中文" is safe to write here: the homepage file is UTF-8. (Only the guide PDF
// copy must stay latin-1-safe — see marketing/build_guide.py.)
export function langName(code) {
  return LANG_BY_CODE[code] || LANG_BY_CODE.en;
}

// Five characters, filled then hollow: stars(3) → "★★★☆☆".
export function stars(n) {
  const count = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return "★".repeat(count) + "☆".repeat(5 - count);
}

export function fmtDate(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// The slide index that is `step` positions on from `index`, wrapping around the
// carousel. With fewer than two slides there is nothing to step through.
export function carouselStep(total, index, step) {
  const n = Math.floor(Number(total) || 0);
  if (n < 2) return 0;
  const i = ((Math.floor(Number(index) || 0) % n) + n) % n;
  const s = Math.floor(Number(step) || 0);
  return ((i + s) % n + n) % n;
}

// Client-side gate before anything is sent: a name, an integer rating 1–5 and a
// message of 1–400 characters. The database checks the same rules as a backstop.
// ★★★ WHICH ANSWER IS MISSING, ONE BY ONE (v583). ⚠️ The error was one alert with nothing it belonged to, so
// a screen reader announced "fill in every field" with no field named. ⭐ The same rule is read twice: once for
// the yes/no, and once to put the message ON the boxes that need it.
export function reviewProblems(name, n, message) {
  const s = Number(n);
  const m = String(message || "").trim();
  return {
    name: String(name || "").trim().length === 0,
    stars: !(Number.isInteger(s) && s >= 1 && s <= 5),
    message: m.length < 1 || m.length > 400,
  };
}

export function reviewOk(name, n, message) {
  const p = reviewProblems(name, n, message);
  return !p.name && !p.stars && !p.message;
}

export function photoOk(file) {
  return !!file
    && typeof file.type === "string" && file.type.startsWith("image/")
    && Number(file.size) <= MAX_INPUT_BYTES;
}

// Decode a picked image in the browser, honouring the photo's stored
// orientation (so a phone picture isn't sideways), and hand back { el, close }.
// `close` frees the decoded bitmap when it is one. Browser-only.
async function loadImage(file) {
  if (typeof createImageBitmap === "function") {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
      return { el: bmp, close: () => bmp.close() };
    } catch { /* fall through to <img> on older browsers */ }
  }
  if (typeof Image !== "function" || typeof URL === "undefined") return null;
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("decode"));
      img.src = url;
    });
    return { el: img, close: null };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Shrink a picked photo into a small JPEG before upload: a several-megabyte
// phone photo becomes a few hundred kilobytes, so any picture is accepted and
// storage stays light. Returns the small JPEG Blob, or the original file when
// it is already small (keeps PNGs/screenshots crisp), or null when the file
// isn't an image / can't be read — the caller then sends the review without a
// photo. Browser-only; safe to import under Node as long as it isn't called.
export async function shrinkReviewPhoto(file) {
  if (!file || typeof file.type !== "string" || !file.type.startsWith("image/")) return null;
  const loaded = await loadImage(file).catch(() => null);
  if (!loaded) return null;
  const w = loaded.el.width || 0;
  const h = loaded.el.height || 0;
  if (!w || !h) {
    if (loaded.close) loaded.close();
    return null;
  }
  if (Number(file.size) <= SMALL_PHOTO_KEEP && Math.max(w, h) <= PHOTO_MAX_SIDE) {
    if (loaded.close) loaded.close();
    return file;
  }
  const scale = Math.min(1, PHOTO_MAX_SIDE / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * scale));
  const ch = Math.max(1, Math.round(h * scale));
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(loaded.el, 0, 0, cw, ch);
  if (loaded.close) loaded.close();
  const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.82));
  return blob || null;
}

// Approved reviews for the homepage grid, newest first.
//
// ★★★ "COULD NOT LOAD" IS NOT "THERE ARE NONE" (v565). ⚠️⚠️ A failed or offline fetch used to return `[]`,
// and the grid then printed **"No reviews yet — be the first!"** — ⭐ **so a bakery with a page of good
// reviews told every visitor, in airplane mode or after one bad minute, that it had none.** ⭐ This now
// answers `null` for "I could not look", and the grid says that instead. ⚠️ An empty list is still an
// empty list: the customer is told the truth either way, which is the whole difference.
export async function loadApproved() {
  try {
    const res = await fetch(
      // ⚠️⚠️ `id` IS SELECTED (v599). ⚠️ v598's place-keeping compared `r.id`, which the query never asked
      // for — ⚠️ **so `findIndex` was always -1 and every language switch still opened slide 1.** ⭐ The
      // carousel's own `onSlide` already reports it; it just had nothing to report.
      `${BASE}/rest/v1/reviews?select=id,name,stars,message,lang,photo,created_at&published=eq.true&order=created_at.desc`,
      { headers: { apikey: SUPABASE.anonKey } });
    if (!res.ok) return null;
    const rows = await res.json().catch(() => null);
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

// Post one review. Returns {ok:true} or {ok:false} (the section stays friendly
// on failure; the customer can retry).
export async function submitReview(data) {
  try {
    const res = await fetch(`${BASE}/rest/v1/reviews`, {
      method: "POST",
      headers: {
        apikey: SUPABASE.anonKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([{
        name: String(data.name || "").trim(),
        stars: Number(data.stars),
        message: String(data.message || "").trim(),
        lang: LANG_CODES.includes(data.lang) ? data.lang : "en",
        photo: String(data.photo || ""),
      }]),
    });
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

// Upload the customer's photo to the PRIVATE pending bucket and return its PATH,
// or "" when there is no photo / it can't upload. A failed upload never blocks the
// review — it just posts without a picture.
//
// ⚠️⚠️ IT RETURNS A PATH, NOT A URL, AND IT UPLOADS TO A BUCKET NOBODY CAN READ
// (v384). Her words: __"plan the photo fix too"__. A picture used to go straight
// into the PUBLIC bucket, so it was fetchable by anyone who knew its link the
// moment it uploaded — **before she had approved the review** — which is the
// opposite of what this form promises the customer. The file now waits somewhere
// private, and her app moves it across only when she presses Publish.
//
// ⚠️ A bare path is not a URL, and the review's `photo` column holds one or the
// other depending on whether it has been approved — see the note in
// supabase/reviews.sql.
export async function uploadPhoto(file) {
  if (!photoOk(file)) return "";
  const ext = PHOTO_EXT[file.type] || "jpg";
  // ⚠️ A random name, so one customer can never guess another's file. Since v384 the
  // pending bucket is unreadable anyway, but the SAME name is kept when the owner
  // publishes it, and that copy is public by design.
  const nonce = (typeof crypto !== "undefined" && crypto.randomUUID)
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const path = `${nonce}.${ext}`;
  try {
    const res = await fetch(`${BASE}/storage/v1/object/review-photos-pending/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE.anonKey,
        // The storage service needs the bearer token too (the public anon key is
        // itself a JWT) — unlike PostgREST, `apikey` alone is rejected with 400.
        Authorization: `Bearer ${SUPABASE.anonKey}`,
        "Content-Type": file.type,
        "x-upsert": "false",
      },
      body: file,
    });
    if (!res.ok) return "";
    return path;
  } catch {
    return "";
  }
}

// The current visitor's site language (saved by home.js), for dynamic strings.
function tHome(key) {
  return pick(HOME, loadLang(), key);
}

// ─────────────────────────────────────────────────────────────
// DOM — only runs on the homepage, never under Node.
// ─────────────────────────────────────────────────────────────
const hasDOM = typeof document !== "undefined";

function byId(id) {
  return hasDOM ? document.getElementById(id) : null;
}

let rowsCache = null; // last batch of published reviews, so a language switch
                      // can re-draw the section without another network call
let stopCarousel = null; // tear-down for the running carousel, if any

export async function refreshReviews() {
  const grid = byId("review-grid");
  if (!grid) return;
  rowsCache = await loadApproved();
  drawGrid();
}

// ⚠️ WHICH REVIEW IS ON SCREEN (v598) — survives a redraw, so a language switch keeps the reader's place.
let currentReviewId = "";
function onSlide(id) { currentReviewId = String(id || ""); }

function drawGrid() {
  const grid = byId("review-grid");
  if (!grid) return;
  if (stopCarousel) { stopCarousel(); stopCarousel = null; }
  grid.replaceChildren();
  if (rowsCache === null) {
    // ⭐ the fetch failed — say so, rather than claiming the bakery has no reviews.
    grid.appendChild(emptyNote(tHome("rvUnavailable")));
    return;
  }
  const rows = rowsCache || [];
  if (!rows.length) {
    grid.appendChild(emptyNote(tHome("rvEmpty")));
    return;
  }
  if (rows.length === 1) {
    const card = reviewCard(rows[0]);
    loadPhoto(card); // the only review is always on screen, so fetch it now
    grid.appendChild(card);
    return;
  }
  const ctl = buildCarousel(rows, currentReviewId);
  grid.appendChild(ctl.el);
  stopCarousel = ctl.stop;
}

function emptyNote(text) {
  const p = document.createElement("p");
  p.className = "review-none";
  p.textContent = text;
  return p;
}

// Fetch a review photo that has been waiting in data-src. Idempotent: the
// attribute is removed as the real src is set, so a repeat call does nothing.
function loadPhoto(node) {
  const img = node && node.querySelector && node.querySelector("img[data-src]");
  if (!img) return;
  const src = img.dataset.src;
  img.removeAttribute("data-src");
  img.src = src;
}

function reviewCard(row) {
  const card = document.createElement("div");
  card.className = "review-card";
  if (row.photo) {
    const img = document.createElement("img");
    // The carousel shows one review at a time, so the photo is NOT fetched here.
    // The URL waits on data-src until this slide is the one being shown (or the
    // one after it) and loadPhoto promotes it. Fetching every published photo up
    // front downloaded megabytes the visitor never saw, one 6-second slide at a
    // time.
    img.dataset.src = String(row.photo);
    img.alt = "";
    img.className = "review-card-photo";
    img.decoding = "async";
    img.addEventListener("error", () => img.remove()); // broken link never leaves a hole
    card.appendChild(img);
  }
  const starsEl = document.createElement("div");
  starsEl.className = "review-card-stars";
  // ⚠️ THE ONE LABEL A SCREEN READER READS ON EVERY CARD WAS ENGLISH ONLY (v565).
  starsEl.setAttribute("aria-label", tHome("rvStarsOf").replace("{n}", String(Number(row.stars) || 0)));
  starsEl.textContent = stars(row.stars);
  card.appendChild(starsEl);

  const msg = document.createElement("p");
  msg.className = "review-card-msg";
  msg.textContent = String(row.message || "");
  card.appendChild(msg);

  const nameEl = document.createElement("div");
  nameEl.className = "review-card-name";
  nameEl.textContent = String(row.name || tHome("rvAnon"));
  card.appendChild(nameEl);

  const meta = document.createElement("div");
  meta.className = "review-card-meta";
  const bits = [langName(row.lang)];
  const when = fmtDate(row.created_at);
  if (when) bits.push(when);
  meta.textContent = bits.join(" · ");
  card.appendChild(meta);
  return card;
}

// One published review at a time: auto-advances ~every 6 s, pauses on hover,
// touch or a hidden tab, and is fully usable by arrows, dots or a swipe.
function buildCarousel(rows, startId = "") {
  const n = rows.length;
  const holder = document.createElement("div");
  holder.className = "r-slider";

  const stage = document.createElement("div");
  stage.className = "r-stage";
  const track = document.createElement("div");
  track.className = "r-track";
  const slides = [];
  rows.forEach((row) => {
    const slide = document.createElement("div");
    slide.className = "r-slide";
    slide.setAttribute("aria-roledescription", "slide");
    slide.appendChild(reviewCard(row));
    track.appendChild(slide);
    slides.push(slide);
  });
  stage.appendChild(track);

  const navEl = document.createElement("div");
  navEl.className = "r-nav";
  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "r-btn";
  prev.setAttribute("aria-label", tHome("rvPrevAria"));
  prev.textContent = "‹";
  const next = document.createElement("button");
  next.type = "button";
  next.className = "r-btn";
  next.setAttribute("aria-label", tHome("rvNextAria"));
  next.textContent = "›";
  const dots = document.createElement("div");
  dots.className = "r-dots";
  const dotEls = [];
  rows.forEach((row, idx) => {
    const dot = document.createElement("button");
    dot.type = "button";
    dot.className = "r-dot";
    dot.setAttribute("aria-label", `${idx + 1} / ${n}`);
    dot.addEventListener("click", () => { go(idx); restart(); });
    dots.appendChild(dot);
    dotEls.push(dot);
  });
  navEl.append(prev, dots, next);

  const live = document.createElement("span");
  live.className = "r-live";
  live.setAttribute("role", "status");
  live.textContent = `1 / ${n}`;

  holder.append(stage, navEl, live);

  // ⚠️⚠️ A LANGUAGE SWITCH USED TO THROW THE READER TO SLIDE 1 (v598). ⚠️ The grid is rebuilt, and the
  // carousel started at 0 every time — ⚠️ **a customer reading review 5 in English tapped BM and lost their
  // place.** ⭐ The review they were reading is where the rebuilt carousel opens.
  let i = Math.max(0, rows.findIndex((r) => r && r.id === startId));
  let timer = null;
  let downX = null;
  let hovered = false;

  function move() {
    // Stay one photo ahead: fetch the slide being shown and the next one, so a
    // 6 s auto-advance never reveals a blank frame — but the slides after that
    // are not downloaded until their turn comes.
    loadPhoto(slides[i]);
    loadPhoto(slides[carouselStep(n, i, 1)]);
    track.style.transform = `translateX(-${i * 100}%)`;
    // ⚠️⚠️ ONLY THE SLIDE ON SCREEN IS READ (v597). ⚠️ Every review stayed in the accessibility tree, so a
    // screen reader read all eight consecutively and the "1 / 8" line meant nothing.
    slides.forEach((sl, j) => sl.setAttribute("aria-hidden", j === i ? "false" : "true"));
    dotEls.forEach((d, j) => {
      d.classList.toggle("is-on", j === i);
      d.setAttribute("aria-pressed", j === i ? "true" : "false");
    });
    live.textContent = `${i + 1} / ${n}`;
    onSlide(rows[i] && rows[i].id);
  }
  function go(target) {
    i = carouselStep(n, i, target - i);
    move();
  }
  function clearTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  // ★★★ AND IT DOES NOT ADVANCE ITSELF (v565). ⚠️⚠️ It moved every six seconds on a timer, and the only
  // pauses were hover and a momentary touch — ⭐ **on a phone that means a review slides away while it is
  // being read**, and it is against this project's own standing carousel rule. ⭐ Arrows, dots and swipe
  // are the whole of the movement now; nothing changes without the customer's own hand.
  function restart() { clearTimer(); }
  const onVis = () => { if (document.hidden) clearTimer(); else restart(); };

  prev.addEventListener("click", () => { go(i - 1); restart(); });
  next.addEventListener("click", () => { go(i + 1); restart(); });
  holder.addEventListener("pointerenter", () => { hovered = true; clearTimer(); });
  holder.addEventListener("pointerleave", () => { hovered = false; restart(); });
  holder.addEventListener("pointerdown", (e) => { downX = e.clientX; clearTimer(); });
  const endDrag = (e) => {
    if (downX == null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 40) go(i + (dx < 0 ? 1 : -1));
    restart();
  };
  holder.addEventListener("pointerup", endDrag);
  holder.addEventListener("pointercancel", () => { downX = null; restart(); });
  document.addEventListener("visibilitychange", onVis);

  move();

  return {
    el: holder,
    stop() {
      clearTimer();
      document.removeEventListener("visibilitychange", onVis);
    },
  };
}

// Which thank-you the customer reads, from what was actually sent (v581). ⚠️ A review that carried no
// picture must not be thanked for one — `rvThanksMain` is only for a picture that ARRIVED.
export function thanksKeyFor(photoState) {
  if (photoState === "sent") return "rvThanksMain";
  if (photoState === "failed") return "rvThanksNoPhoto";
  return "rvThanksWords";
}

function initReviews() {
  const form = byId("review-form");
  const grid = byId("review-grid");
  if (!form || !grid) return;

  const nameInput = byId("rv-name");
  const message = byId("rv-message");
  const starsWrap = form.querySelector(".rv-stars");
  const cameraInput = byId("rv-photo-camera");
  const galleryInput = byId("rv-photo-gallery");
  const takeBtn = byId("rv-photo-take");
  const chooseBtn = byId("rv-photo-choose");
  const preview = byId("rv-photo-preview");
  const error = byId("rv-error");
  const thanks = byId("review-thanks");
  const submitBtn = byId("rv-submit");
  const langBtns = Array.from(form.querySelectorAll(".rv-lang"));

  // ⚠️⚠️ NO STAR IS PAINTED UNTIL THE CUSTOMER TAPS ONE (v565). ⭐ The rating defaulted to 5 with all five
  // stars already pressed, so **a one-star complaint could be posted as five stars by someone who never
  // touched a star at all.** `reviewOk` already refuses 0, so an untapped rating is asked for, not assumed.
  let rating = 0;
  void 5;
  let lang = "en";
  let chosenFile = null;

  function paintStars() {
    if (!starsWrap) return;
    const buttons = Array.from(starsWrap.querySelectorAll("button"));
    buttons.forEach((b) => {
      const on = Number(b.dataset.val) <= rating;
      b.classList.toggle("is-on", on);
      if (b.setAttribute) b.setAttribute("aria-pressed", String(on));
      b.setAttribute("aria-pressed", String(on));
    });
  }
  if (starsWrap) {
    starsWrap.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-val]");
      if (!b) return;
      rating = Number(b.dataset.val);
      paintStars();
      setError("");
    });
  }

  langBtns.forEach((b) => {
    b.addEventListener("click", () => {
      lang = b.dataset.lang;
      langBtns.forEach((x) => {
      const on = x === b;
      x.classList.toggle("is-on", on);
      if (x.setAttribute) x.setAttribute("aria-pressed", String(on));
    });
    });
  });

  function clearPicked() {
    chosenFile = null;
    if (cameraInput) cameraInput.value = "";
    if (galleryInput) galleryInput.value = "";
  }
  function handlePick(file) {
    if (preview) preview.replaceChildren();
    if (!file) return;
    if (!photoOk(file)) {
      setError(tHome("rvTooBig"));
      clearPicked();
      return;
    }
    chosenFile = file;
    if (preview) {
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.className = "rv-preview-img";
      img.alt = tHome("rvPhotoAlt");
      preview.appendChild(img);
    }
    setError("");
  }
  const wireInput = (input, sibling) => {
    if (!input) return;
    input.addEventListener("change", () => {
      if (sibling) sibling.value = "";
      const file = input.files && input.files[0];
      handlePick(file);
    });
  };
  wireInput(cameraInput, galleryInput);
  wireInput(galleryInput, cameraInput);
  if (takeBtn && cameraInput) takeBtn.addEventListener("click", () => cameraInput.click());
  if (chooseBtn && galleryInput) chooseBtn.addEventListener("click", () => galleryInput.click());

  function setError(text) {
    if (error) error.textContent = text;
  }

  // ⚠️⚠️ THE ERROR NOW BELONGS TO THE BOXES IT IS ABOUT (v583). ⭐ Each field points at the message
  // (`aria-describedby`) and says whether IT is the one that needs an answer (`aria-invalid`), so the alert is
  // announced with the control it concerns rather than on its own.
  function markFields(bad = {}) {
    const pairs = [[nameInput, "name"], [message, "message"], [byId ? byId("rv-stars") : null, "stars"]];
    for (const [node, key] of pairs) {
      if (!node || typeof node.setAttribute !== "function") continue;
      if (error && error.id) node.setAttribute("aria-describedby", error.id);
      node.setAttribute("aria-invalid", bad[key] ? "true" : "false");
    }
  }

  // ⚠️⚠️ A PICTURE THAT DID NOT UPLOAD MUST NOT BE THANKED FOR (v553). ⭐ The review went out with
  // `photo: ""` and the thanks said **"your review and photo reached the baker"** — so the customer believed
  // a picture had arrived that never did, and the moderation card had none. ⭐ The words tell the truth now.
  // ⚠️⚠️ AND A REVIEW SENT WITH NO PICTURE AT ALL IS NOT THANKED FOR ONE (v581). ⭐ v553 taught this
  // sentence the difference between "a picture failed" and "a picture arrived" — but ⚠️ **a customer who
  // chose no picture at all was still told "your review and photo reached the baker".** ⭐ The words now
  // follow what she actually sent: the picture, the failure, or the review alone.
  function showThanks(critical, photoState = "none") {
    if (!thanks) return;
    const parts = [tHome(thanksKeyFor(photoState))];
    if (critical) parts.push(tHome("rvThanksHonest"));
    thanks.textContent = parts.join(" ");
    thanks.hidden = false;
    if (form) form.hidden = true;
    // ⚠️⚠️ AND IT IS HEARD AND FOCUSED (v591). ⚠️ The form's Send button was the focused element and the form
    // is now hidden, so focus fell to `<body>` and a screen reader said NOTHING — ⚠️ **a customer did not know
    // their review had been sent.** ⭐ The thanks is a live region (`role=status` in index.html) and takes
    // focus, so the message is both announced and where the next Tab continues from.
    try { thanks.setAttribute("tabindex", "-1"); thanks.focus({ preventScroll: true }); } catch { /* no focus */ }
    if (grid) grid.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = (nameInput && nameInput.value) || "";
    if (!reviewOk(name, rating, message.value)) {
      markFields(reviewProblems(name, rating, message.value));
      setError(tHome("rvErrFields"));
      return;
    }
    markFields({});
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = tHome("rvSending");
    }
    setError("");
    const critical = rating <= 3;
    let photo = "";
    let photoFailed = false;   // she chose a picture and it did not make it — say so afterwards
    if (chosenFile) {
      // Shrink first so any phone photo is a small upload. ⚠️ An unreadable file, or an upload that comes
      // back empty, means the review goes out WITHOUT a picture — and the thanks no longer pretends
      // otherwise (v553).
      const ready = await shrinkReviewPhoto(chosenFile);
      if (ready) { photo = await uploadPhoto(ready); if (!photo) photoFailed = true; }
      else photoFailed = true;
    }
    const res = await submitReview({ name, stars: rating, message: message.value, lang, photo });
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = tHome("rvSubmit");
    }
    if (!res.ok) {
      setError(tHome("rvErrSend"));
      return;
    }
    // ⚠️⚠️ WHAT TO THANK THEM FOR IS DECIDED BEFORE ANYTHING IS CLEARED (v587). ⚠️ `clearPicked()` below wipes
    // `chosenFile`, and the thanks were worked out AFTER it — ⚠️ **so "the picture did not upload" could never be
    // said: a customer whose photo failed was thanked as if they had sent none.** ⭐ The test checked the
    // wording in isolation and missed the call site; this reads the file before it is emptied.
    const thanksState = photo ? "sent" : (chosenFile ? "failed" : "none");
    form.reset();
    if (nameInput) nameInput.value = "";
    if (message) message.value = "";
    rating = 0;
    paintStars();
    lang = "en";
    langBtns.forEach((x) => {
      const on = x.dataset.lang === "en";
      x.classList.toggle("is-on", on);
      if (x.setAttribute) x.setAttribute("aria-pressed", String(on));
    });
    if (preview) preview.replaceChildren();
    clearPicked();
    showThanks(critical, thanksState);
  });

  paintStars();
  refreshReviews();
}

if (hasDOM) {
  // Re-draw the reviews section in the new language (home.js persists the
  // choice and fires this event); the data is cached, so no re-fetch.
  window.addEventListener("i18nchange", () => {
    // ⚠️⚠️ AND A FAILED LOAD'S NOTE FOLLOWS THE SWITCH TOO (v598). ⚠️ `rowsCache` is null after a failed
    // fetch, so this skipped the redraw and "Reviews can't load right now" stayed English on the Chinese page.
    // ⚠️⚠️ THE NOTE IS REDRAWN IN THE NEW LANGUAGE (v599). ⚠️ The old fallback called `loadApproved()` and
    // threw the answer away, so a failed note stayed in the previous language while the rest of the page
    // switched. ⭐ Draw what is known now; only when nothing is cached is a fresh read started, and it
    // redraws if it lands.
    drawGrid();
    if (!rowsCache) loadApproved().then((rows) => { if (rows) { rowsCache = rows; drawGrid(); } });
  });
  initReviews();
}
