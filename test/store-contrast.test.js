// test/store-contrast.test.js — the pairs the audit measured under the floor (v583).
//
// ⚠️⚠️ MEASURED BEFORE THE FIX: white on the order bar's top stop **3.81:1**, white on the solid terracotta
// **4.48:1** (a hair under 4.5), the review stars **2.08:1**, an unselected review dot **1.65:1**, a sold-out
// title **2.18:1**, and a sold-out stepper's text **1.6:1**. ⭐ The colours were deepened one step — same hue —
// and this file holds the arithmetic so a later palette tweak cannot quietly undo it.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

function lin(c) { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
function L(hex) {
  const h = hex.replace("#", "");
  return 0.2126 * lin(parseInt(h.slice(0, 2), 16)) + 0.7152 * lin(parseInt(h.slice(2, 4), 16))
    + 0.0722 * lin(parseInt(h.slice(4, 6), 16));
}
function ratio(a, b) {
  const la = L(a); const lb = L(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const pick = (src, re, what) => {
  const m = src.match(re);
  assert.ok(m, `the ${what} is no longer where this test looks for it`);
  return m[1];
};

const CSS = read("store/app.css");
const HTML = read("index.html");
// The stars and dots live on the HOMEPAGE, whose paper is its own token; the shop's card surface is
// `--surface`. Both are read from the files that define them.
const HOME_PAPER = pick(HTML, /--paper:\s*(#[0-9a-fA-F]{6})\s*;/i, "homepage's --paper token");
const SURFACE = pick(CSS, /--surface:\s*(#[0-9a-fA-F]{6})\s*;/i, "shop's --surface token");

test("★★★ every pair the audit measured under the floor now clears it (v583)", () => {
  const brown = pick(CSS, /--brown:\s*(#[0-9a-fA-F]{6})\s*;/i, "shop's --brown");
  const brownRatio = ratio(brown, "#ffffff");
  assert.ok(brownRatio >= 4.5,
    `★ white on the solid terracotta is ${brownRatio.toFixed(2)}:1 — under the 4.5 a small white line needs`);

  const barTop = pick(CSS, /linear-gradient\(180deg,\s*(#[0-9a-fA-F]{6}),\s*#b34a28\)/i, "order bar's top stop");
  const barRatio = ratio(barTop, "#ffffff");
  assert.ok(barRatio >= 4.5, `★ white on the order bar's top stop is ${barRatio.toFixed(2)}:1`);

  const soldTitle = pick(CSS, /\.menu-item\.soldout \.card-title\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/i, "sold-out title");
  assert.ok(ratio(soldTitle, SURFACE) >= 4.5, "★ a sold-out title is under 4.5:1 on the card");

  const soldStep = pick(CSS, /\.menu-item\.soldout \.step-btn\s*\{[^}]*color:\s*(#[0-9a-fA-F]{6})/i, "sold-out stepper");
  assert.ok(ratio(soldStep, "#f1e9de") >= 4.5, "★ a sold-out stepper's figure is unreadable");

  const stars = pick(HTML, /\.review-card-stars\{color:(#[0-9a-fA-F]{6});/i, "review stars");
  assert.ok(ratio(stars, HOME_PAPER) >= 4.5,
    `★ the review stars are ${ratio(stars, HOME_PAPER).toFixed(2)}:1 — they carry the rating, not decoration`);

  const dot = pick(HTML, /\.r-dot::after\{[^}]*background:(#[0-9a-fA-F]{6})/i, "unselected review dot");
  assert.ok(ratio(dot, HOME_PAPER) >= 3,
    `★ an unselected review dot is ${ratio(dot, HOME_PAPER).toFixed(2)}:1 — under the 3:1 a control needs`);
});
