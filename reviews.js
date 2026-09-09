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
// Shrink target: the longest side after downscaling. Crisp on the homepage and
// app cards, light enough that uploads and storage stay small.
const PHOTO_MAX_SIDE = 1600;
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
export function reviewOk(name, n, message) {
  const s = Number(n);
  const m = String(message || "").trim();
  return String(name || "").trim().length > 0
    && Number.isInteger(s) && s >= 1 && s <= 5
    && m.length >= 1 && m.length <= 400;
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

// Approved reviews for the homepage grid, newest first. Any failure quietly
// returns [] so an offline page never shows an error — just the empty state.
export async function loadApproved() {
  try {
    const res = await fetch(
      `${BASE}/rest/v1/reviews?select=name,stars,message,lang,photo,created_at&published=eq.true&order=created_at.desc`,
      { headers: { apikey: SUPABASE.anonKey } });
    if (!res.ok) return [];
    const rows = await res.json().catch(() => []);
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
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

// Upload the customer's photo to the review-photos bucket and return its public
// URL, or "" when there is no photo / it can't upload. A failed upload never
// blocks the review — it just posts without a picture.
export async function uploadPhoto(file) {
  if (!photoOk(file)) return "";
  const ext = PHOTO_EXT[file.type] || "jpg";
  const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const path = `${nonce}.${ext}`;
  try {
    const res = await fetch(`${BASE}/storage/v1/object/review-photos/${path}`, {
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
    return `${BASE}/storage/v1/object/public/review-photos/${path}`;
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

function drawGrid() {
  const grid = byId("review-grid");
  if (!grid) return;
  if (stopCarousel) { stopCarousel(); stopCarousel = null; }
  grid.replaceChildren();
  const rows = rowsCache || [];
  if (!rows.length) {
    grid.appendChild(emptyNote(tHome("rvEmpty")));
    return;
  }
  if (rows.length === 1) {
    grid.appendChild(reviewCard(rows[0]));
    return;
  }
  const ctl = buildCarousel(rows);
  grid.appendChild(ctl.el);
  stopCarousel = ctl.stop;
}

function emptyNote(text) {
  const p = document.createElement("p");
  p.className = "review-none";
  p.textContent = text;
  return p;
}

function reviewCard(row) {
  const card = document.createElement("div");
  card.className = "review-card";
  if (row.photo) {
    const img = document.createElement("img");
    img.src = String(row.photo);
    img.alt = "";
    img.className = "review-card-photo";
    img.addEventListener("error", () => img.remove()); // broken link never leaves a hole
    card.appendChild(img);
  }
  const starsEl = document.createElement("div");
  starsEl.className = "review-card-stars";
  starsEl.setAttribute("aria-label", `${Number(row.stars) || 0} out of 5 stars`);
  starsEl.textContent = stars(row.stars);
  card.appendChild(starsEl);

  const msg = document.createElement("p");
  msg.className = "review-card-msg";
  msg.textContent = String(row.message || "");
  card.appendChild(msg);

  const nameEl = document.createElement("div");
  nameEl.className = "review-card-name";
  nameEl.textContent = String(row.name || "Anonymous");
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
function buildCarousel(rows) {
  const n = rows.length;
  const holder = document.createElement("div");
  holder.className = "r-slider";

  const stage = document.createElement("div");
  stage.className = "r-stage";
  const track = document.createElement("div");
  track.className = "r-track";
  rows.forEach((row) => {
    const slide = document.createElement("div");
    slide.className = "r-slide";
    slide.setAttribute("aria-roledescription", "slide");
    slide.appendChild(reviewCard(row));
    track.appendChild(slide);
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

  let i = 0;
  let timer = null;
  let downX = null;
  let hovered = false;

  function move() {
    track.style.transform = `translateX(-${i * 100}%)`;
    dotEls.forEach((d, j) => d.classList.toggle("is-on", j === i));
    live.textContent = `${i + 1} / ${n}`;
  }
  function go(target) {
    i = carouselStep(n, i, target - i);
    move();
  }
  function clearTimer() {
    if (timer) { clearInterval(timer); timer = null; }
  }
  function restart() {
    clearTimer();
    if (document.hidden || hovered) return;
    timer = setInterval(() => { i = carouselStep(n, i, 1); move(); }, 6000);
  }
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

  let rating = 5;
  let lang = "en";
  let chosenFile = null;

  function paintStars() {
    if (!starsWrap) return;
    const buttons = Array.from(starsWrap.querySelectorAll("button"));
    buttons.forEach((b) => {
      const on = Number(b.dataset.val) <= rating;
      b.classList.toggle("is-on", on);
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
      langBtns.forEach((x) => x.classList.toggle("is-on", x === b));
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

  function showThanks(critical) {
    if (!thanks) return;
    const parts = [tHome("rvThanksMain")];
    if (critical) parts.push(tHome("rvThanksHonest"));
    thanks.textContent = parts.join(" ");
    thanks.hidden = false;
    if (form) form.hidden = true;
    if (grid) grid.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = (nameInput && nameInput.value) || "";
    if (!reviewOk(name, rating, message.value)) {
      setError(tHome("rvErrFields"));
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = tHome("rvSending");
    }
    setError("");
    const critical = rating <= 3;
    let photo = "";
    if (chosenFile) {
      // Shrink first so any phone photo is a small upload; an unreadable file
      // just means the review goes out without a picture.
      const ready = await shrinkReviewPhoto(chosenFile);
      if (ready) photo = await uploadPhoto(ready);
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
    form.reset();
    if (nameInput) nameInput.value = "";
    if (message) message.value = "";
    rating = 5;
    paintStars();
    lang = "en";
    langBtns.forEach((x) => x.classList.toggle("is-on", x.dataset.lang === "en"));
    if (preview) preview.replaceChildren();
    clearPicked();
    showThanks(critical);
  });

  paintStars();
  refreshReviews();
}

if (hasDOM) {
  // Re-draw the reviews section in the new language (home.js persists the
  // choice and fires this event); the data is cached, so no re-fetch.
  window.addEventListener("i18nchange", () => {
    if (rowsCache) drawGrid();
  });
  initReviews();
}
