// views/reviews.js — moderate the reviews customers leave on the homepage.
// New reviews land here "Waiting for you"; Publish shows one on the homepage,
// Take down hides it again, Delete removes it for good.

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
      "Reviews customers leave on the homepage land here first, unpublished. Tap Publish to show one on the homepage, or Delete to remove it. Customers can write in English, Mandarin or Bahasa Malaysia, and may attach a photo."));

  const wrap = el("div", {});
  root.replaceChildren(intro, wrap);

  async function fill() {
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
      children.push(el("h2", { class: "section" }, `Waiting for you (${waiting.length})`));
      children.push(...waiting.map((row) => reviewCard(state, row, {
        label: "Publish",
        cls: "primary",
        onAction: () => publish(row, true),
      }, fill)));
    } else {
      children.push(
        el("h2", { class: "section" }, "Waiting for you"),
        emptyState("Nothing waiting", "New homepage reviews will appear here for you to approve."));
    }
    if (live.length) {
      children.push(el("h2", { class: "section" }, `On the homepage (${live.length})`));
      children.push(...live.map((row) => reviewCard(state, row, {
        label: "Take down",
        cls: "soft",
        onAction: () => publish(row, false),
      }, fill)));
    } else {
      children.push(
        el("h2", { class: "section" }, "On the homepage"),
        emptyState("Nothing published", "Publish a review above and it will show on the homepage."));
    }
    wrap.replaceChildren(...children);
  }

  async function publish(row, value) {
    const r = await setReviewPublished(state, row.id, value);
    if (!r.ok) return toast(String(r.reason || "Update failed"));
    toast(value ? "Published — it's on the homepage now." : "Taken down — hidden from the homepage.");
    fill();
  }

  fill();
  return () => { dead = true; };
}

function removeReview(state, row, reload) {
  confirmDialog(`Delete ${row.name ? `"${row.name}'s"` : "this"} review? This can't be undone.`,
    async () => {
      const r = await deleteReview(state, row.id);
      if (!r.ok) return toast(String(r.reason || "Delete failed"));
      toast("Review deleted.");
      reload();
    }, { danger: true, yesLabel: "Delete" });
}

function reviewCard(state, row, action, reload) {
  const bits = [];
  if (row.photo) {
    bits.push(el("img", {
      src: String(row.photo),
      alt: "",
      // Show the whole photo at a tidy "photo in a post" size — it is never
      // cropped or stretched; a tall picture just shrinks to fit and centres.
      style: "display:block;max-width:100%;max-height:340px;height:auto;width:auto;margin:0 auto 12px;border-radius:10px",
    }));
  }
  const when = fmtDate(row.created_at);
  const metaBits = [langLabel(row.lang)];
  if (when) metaBits.push(when);
  return el("div", { class: "card" },
    ...bits,
    el("p", { class: "card-title", style: "margin:0 0 2px" }, String(row.name || "Anonymous")),
    el("p", { style: "margin:0 0 2px;color:#d9a62e;font-size:18px;letter-spacing:2px" }, starsText(row.stars)),
    el("p", { class: "card-sub", style: "white-space:pre-wrap" }, String(row.message || "")),
    el("p", { class: "card-sub", style: "margin-top:6px" }, metaBits.join(" · ")),
    el("div", { class: "btn-row", style: "margin-top:12px" },
      button(action.label, action.onAction, action.cls),
      button("Delete", () => removeReview(state, row, reload), "ghost")));
}
