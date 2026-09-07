// gauge.js — a car-style "how full is this delivery day" needle dial for Home.
// The dial reads like a fuel gauge: red zone near empty, then orange, then
// green at full, and a needle points at how booked the day is.
// gaugeState is pure (Node-testable); gauge() builds the SVG in the real DOM,
// falling back to just the numbers label under a DOM shim so view smoke tests
// don't need an SVG namespace.

import { el } from "./ui.js";

const NS = "http://www.w3.org/2000/svg";

// ratio of orders booked vs capacity, plus a status for the label/needle:
// over capacity (red), empty (muted), otherwise neutral ink.
export function gaugeState(total, capacity) {
  const n = Number(total) || 0;
  const cap = Number(capacity) || 0;
  if (cap <= 0) return { pct: 0, status: n > 0 ? "over" : "empty" };
  if (n <= 0) return { pct: 0, status: "empty" };
  const pct = Math.min(1, n / cap);
  const status = n > cap ? "over" : "open";
  return { pct, status };
}

function svgEl(tag, attrs = {}) {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k === "style" && typeof v === "object") Object.assign(node.style, v);
    else node.setAttribute(k, v);
  }
  return node;
}

// Semicircle centred at (CX, CY), radius R. ratio 0 = left (empty), 1 = right
// (full); the sweep runs over the top like a fuel gauge needle.
function drawSvg(pct, needleColor) {
  const CX = 60, CY = 62, R = 50;
  const point = (r, radius) => {
    const t = Math.PI - r * Math.PI;
    return [CX + radius * Math.cos(t), CY - radius * Math.sin(t)];
  };
  // A small top arc between two ratios (same sweep as the full band).
  const zoneArc = (fromR, toR) => {
    const [x0, y0] = point(fromR, R);
    const [x1, y1] = point(toR, R);
    return `M ${x0},${y0} A ${R},${R} 0 0 1 ${x1},${y1}`;
  };

  const svg = svgEl("svg", { viewBox: "0 0 120 66", class: "gauge-svg" });

  // The static dial: red near empty, orange mid, green toward full.
  const ZONES = [
    [0, 1 / 3, "var(--red)"],
    [1 / 3, 2 / 3, "var(--amber)"],
    [2 / 3, 1, "var(--green)"],
  ];
  for (const [from, to, color] of ZONES) {
    svg.appendChild(svgEl("path", {
      d: zoneArc(from, to),
      style: { stroke: color, strokeWidth: 9, fill: "none", strokeLinecap: "round" },
    }));
  }

  // The needle points at how full the day is, reaching the inner edge of the
  // colour band so it reads against the scale.
  const [tipX, tipY] = point(pct, R - 5);
  svg.appendChild(svgEl("line", {
    x1: CX, y1: CY, x2: tipX, y2: tipY,
    style: { stroke: needleColor, strokeWidth: 3, strokeLinecap: "round" },
  }));
  svg.appendChild(svgEl("circle", {
    cx: CX, cy: CY, r: 4,
    style: { fill: "var(--surface)", stroke: needleColor, strokeWidth: 2 },
  }));

  return svg;
}

export function gauge(total, capacity) {
  const n = Number(total) || 0;
  const cap = Number(capacity) || 0;
  const { pct, status } = gaugeState(n, cap);

  const labelColor = status === "over" ? "var(--red)" : status === "empty" ? "var(--muted)" : "var(--ink)";
  const needleColor = status === "over" ? "var(--red)" : "var(--ink)";

  const wrap = el("div", { class: `gauge gauge-${status}` });
  if (typeof document !== "undefined" && typeof document.createElementNS === "function") {
    wrap.appendChild(drawSvg(pct, needleColor));
  }
  wrap.appendChild(el("span", { class: "gauge-label", style: `color:${labelColor}` },
    `${n}${cap > 0 ? `/${cap}` : ""}`));
  return wrap;
}
