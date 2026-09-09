// views/reviews.js — moderate the reviews customers leave on the homepage.
// New reviews land here first, unpublished; Publish shows one on the homepage,
// Take down hides it again, Delete removes it for good.
//
// Each review shows one at a time in a carousel exactly like the homepage
// reviews: the waiting-to-publish ones first, then the ones already on the
// homepage. It deliberately does NOT auto-advance (you are deciding, not
// watching) — the ‹ › arrows, the dots, or a swipe move it on. Acting on a
// review (Publish / Take down / Delete) moves you on to the next one.

import { el, button, emptyState, confirmDialog, toast } from "../ui.js";
import { fetchReviews, setReviewPublished, deleteReview } from "../supabase.js";

const LANG_LABEL = { en: "English", zh: "中文", ms: "Bahasa Malaysia" };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function starsText(n) {
  const count = Math.max(0, Math.min(5, Math.round(Number(n) || 0)));
  return "★".repeat(count) + "☆".repeat(5 - count);
}

function fmtDate(iso) {
  const d = new Date(String(iso || ""));
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

function langLabel(code) {
  return LANG_LABEL[code] || LANG_LABEL.en;
}

export function renderReviews(root, state) {
  let dead = false;

  const intro = el("div", { class: "card" },
    el("h3", { style: "margin:0 0 4px" }, "Customer reviews"),
    el("p", { class: "card-sub", style: "margin:0" },
      "Reviews customers leave on the homepage land here first, unpublished. They play one at a time, exactly as they appear on the homepage — the waiting ones come first. Swipe or tap the ‹ › arrows to look through them, then Publish or Delete."));

  const wrap = el("div", {});
  root.replaceChildren(intro, wrap);

  fill();

  return () => { dead = true; };

  async function fill(afterId) {
    const r = await fetchReviews(state);
    if (dead) return;
    if (!r.ok) {
      wrap.replaceChildren(el("div", { class: "card" },
        el("h3", { style: "margin:0 0 6px" }, "Reviews couldn't load"),
        el("p", { class: "card-sub" }, String(r.reason || "Unknown error")),
        el("p", { class: "card-sub", style: "margin-top:8px" },
          "Reviews use the same Supabase login as shared data. If this keeps happening, open Settings and check the Supabase address and key, sign in again, then come back."),
        el("div", { class: "btn-row", style: "margin-top:10px" },
          button("Try again", fill, "primary"))));
      return;
    }
    const waiting = r.reviews.filter((x) => !x.published);
    const live = r.reviews.filter((x) => x.published);
    const children = [];
    if (waiting.length) {
      children.push(el("div", { class: "rev-pending" },
        `⭐ ${waiting.length} review${waiting.length === 1 ? "" : "s"} waiting for you to publish`));
    }
    if (!r.reviews.length) {
      children.push(emptyState("No reviews yet",
        "New homepage reviews will appear here for you to approve."));
      wrap.replaceChildren(...children);
      return;
    }
    children.push(reviewCarousel([...waiting, ...live], afterId, {
      onPublish: (row, nextId) => setPublished(row, true, nextId),
      onTakeDown: (row, nextId) => setPublished(row, false, nextId),
      onDelete: (row, nextId) => askDelete(row, nextId),
    }));
    wrap.replaceChildren(...children);
  }

  async function setPublished(row, value, nextId) {
    const r = await setReviewPublished(state, row.id, value);
    if (dead) return;
    if (!r.ok) return toast(String(r.reason || "Update failed"));
    toast(value ? "Published — it's on the homepage now." : "Taken down — hidden from the homepage.");
    fill(nextId);
  }

  function askDelete(row, nextId) {
    confirmDialog(`Delete ${row.name ? `"${row.name}'s"` : "this"} review? This can't be undone.`,
      async () => {
        const r = await deleteReview(state, row.id);
        if (dead) return;
        if (!r.ok) return toast(String(r.reason || "Delete failed"));
        toast("Review deleted.");
        fill(nextId);
      }, { danger: true, yesLabel: "Delete" });
  }
}

// One review at a time, moved by the ‹ › arrows, the dots, or a swipe — the
// same carousel feel as the homepage reviews, but with NO auto-advance: this
// is the decision screen, so the review in front of you stays put. Acting on a
// card (via `actions`) calls back with the review that follows it, so the
// carousel moves on to the next review after Publish / Take down / Delete.
function reviewCarousel(rows, startId, actions) {
  const holder = el("div", { class: "r-slider" });
  const stage = el("div", { class: "r-stage" });
  const track = el("div", { class: "r-track" });
  rows.forEach((row, idx) => {
    const slide = el("div", { class: "r-slide" });
    slide.setAttribute("aria-roledescription", "slide");
    slide.appendChild(reviewCard(rows, row, idx, actions));
    track.appendChild(slide);
  });
  stage.appendChild(track);

  const navEl = el("div", { class: "r-nav" });
  const prev = el("button", {
    class: "r-btn", type: "button", "aria-label": "Previous review",
    onclick: () => go(cur - 1),
  }, "‹");
  const next = el("button", {
    class: "r-btn", type: "button", "aria-label": "Next review",
    onclick: () => go(cur + 1),
  }, "›");
  const dots = el("div", { class: "r-dots" });
  const dotEls = [];
  rows.forEach((row, idx) => {
    const dot = el("button", {
      class: "r-dot", type: "button", "aria-label": `Review ${idx + 1} of ${rows.length}`,
      onclick: () => go(idx),
    });
    dots.appendChild(dot);
    dotEls.push(dot);
  });
  navEl.append(prev, dots, next);

  const live = el("span", { class: "r-live", role: "status" });
  holder.append(stage, navEl, live);

  let cur = Math.max(0, rows.findIndex((x) => x.id === startId));
  function move() {
    track.style.transform = `translateX(-${cur * 100}%)`;
    dotEls.forEach((d, j) => d.classList.toggle("is-on", j === cur));
    live.textContent = `${cur + 1} / ${rows.length}`;
  }
  function go(target) {
    cur = ((target % rows.length) + rows.length) % rows.length;
    move();
  }

  // Touch swipe — same threshold as the homepage. No autoplay on purpose.
  let downX = null;
  holder.addEventListener("pointerdown", (e) => { downX = e.clientX; });
  const endDrag = (e) => {
    if (downX == null) return;
    const dx = e.clientX - downX;
    downX = null;
    if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
  };
  holder.addEventListener("pointerup", endDrag);
  holder.addEventListener("pointercancel", () => { downX = null; });

  move();
  return holder;
}

// The homepage card replica: photo → stars → message → name → language · date
// (homepage CSS classes in app.css). The moderation buttons ride along at the
// bottom; acting calls the `actions` callbacks with the review that follows.
function reviewCard(rows, row, idx, actions) {
  const bits = [];
  if (row.photo) {
    bits.push(el("img", {
      class: "review-card-photo",
      src: String(row.photo),
      alt: "",
      // A broken link never leaves a hole on the card (same as the homepage).
      onerror: (ev) => ev.currentTarget.remove(),
    }));
  }
  const starsN = Math.max(0, Math.min(5, Math.round(Number(row.stars) || 0)));
  const when = fmtDate(row.created_at);
  const metaBits = [langLabel(row.lang)];
  if (when) metaBits.push(when);
  const nextId = rows[idx + 1] ? rows[idx + 1].id : undefined;
  const published = !!row.published;
  return el("div", { class: "review-card" },
    ...bits,
    el("div", { class: "review-card-stars", "aria-label": `${starsN} out of 5 stars` }, starsText(row.stars)),
    el("p", { class: "review-card-msg" }, String(row.message || "")),
    el("div", { class: "review-card-name" }, String(row.name || "Anonymous")),
    el("div", { class: "review-card-meta" }, metaBits.join(" · ")),
    el("div", { class: "btn-row", style: "margin-top:16px" },
      button(published ? "Take down" : "Publish",
        published ? () => actions.onTakeDown(row, nextId) : () => actions.onPublish(row, nextId),
        published ? "soft" : "primary"),
      button("Delete", () => actions.onDelete(row, nextId), "ghost")));
}
