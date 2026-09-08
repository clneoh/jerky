// reviews.js — the "What customers say" section of the homepage (index.html).
// Loads approved reviews from Supabase and runs the "Leave a review" form.
//
// Anyone can post (public anon insert), but every review starts unpublished and
// only appears here after the owner taps Publish in the admin app
// (More → Reviews). The form states reviews are welcome in English, Mandarin
// (Chinese) or Bahasa Malaysia; a customer may attach one photo, stored in the
// "review-photos" bucket.
//
// This page has no build step, so the public project address + anon key are
// written here directly — same values ship in store/config.js and the admin
// Settings. The anon key is public by design (it only gates which Supabase
// project to talk to; the SQL policies do the real security).
//
// Everything above the DOM section is a pure helper so it runs under Node for
// tests; the DOM work only starts when this file loads in a browser that has
// the #reviews section.

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

const MAX_PHOTO_BYTES = 5 * 1024 * 1024; // 5 MB
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
    && Number(file.size) <= MAX_PHOTO_BYTES;
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

// ─────────────────────────────────────────────────────────────
// DOM — only runs on the homepage, never under Node.
// ─────────────────────────────────────────────────────────────
const hasDOM = typeof document !== "undefined";

function byId(id) {
  return hasDOM ? document.getElementById(id) : null;
}

export async function refreshReviews() {
  const grid = byId("review-grid");
  if (!grid) return;
  const rows = await loadApproved();
  grid.replaceChildren();
  if (!rows.length) {
    grid.appendChild(emptyNote("No reviews yet — be the first!"));
    return;
  }
  for (const row of rows) grid.appendChild(reviewCard(row));
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

function initReviews() {
  const form = byId("review-form");
  const grid = byId("review-grid");
  if (!form || !grid) return;

  const nameInput = byId("rv-name");
  const message = byId("rv-message");
  const starsWrap = form.querySelector(".rv-stars");
  const photoInput = byId("rv-photo");
  const photoBtn = byId("rv-photo-btn");
  const preview = byId("rv-photo-preview");
  const error = byId("rv-error");
  const thanks = byId("review-thanks");
  const submitBtn = byId("rv-submit");
  const langBtns = Array.from(form.querySelectorAll(".rv-lang"));

  let rating = 5;
  let lang = "en";

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

  if (photoBtn && photoInput) photoBtn.addEventListener("click", () => photoInput.click());
  photoInput.addEventListener("change", () => {
    preview.replaceChildren();
    const file = photoInput.files && photoInput.files[0];
    if (!file) return;
    if (!photoOk(file)) {
      setError("That photo is too large — please use a picture under 5 MB.");
      photoInput.value = "";
      return;
    }
    const img = document.createElement("img");
    img.src = URL.createObjectURL(file);
    img.className = "rv-preview-img";
    img.alt = "Your photo";
    preview.appendChild(img);
    setError("");
  });

  function setError(text) {
    if (error) error.textContent = text;
  }

  function showThanks() {
    if (!thanks) return;
    thanks.hidden = false;
    if (form) form.hidden = true;
    if (grid) grid.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const name = (nameInput && nameInput.value) || "";
    if (!reviewOk(name, rating, message.value)) {
      setError("Please add your name, a star rating (1–5) and a short review (up to 400 characters).");
      return;
    }
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Sending…";
    }
    setError("");
    const file = photoInput && photoInput.files && photoInput.files[0];
    const photo = file ? await uploadPhoto(file) : "";
    const res = await submitReview({ name, stars: rating, message: message.value, lang, photo });
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send review";
    }
    if (!res.ok) {
      setError("Something went wrong sending your review. Please check your connection and try again.");
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
    if (photoInput) photoInput.value = "";
    showThanks();
  });

  paintStars();
  refreshReviews();
}

if (hasDOM) initReviews();
