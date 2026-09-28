// test/photo.test.js — the photo reader, and the one thing it can get silently
// wrong: a wrong crop still produces a perfectly valid JPEG, so nothing
// downstream would ever complain. The whole thing is therefore asserted on the
// NUMBERS handed to drawImage — which rectangle of the source was taken, and how
// big the canvas is — rather than on "did it return a data URL", which every
// wrong answer also does.
//
// ONE job now, at two sizes, and both are SQUARE. `readPhoto(f, cb)` is a
// customer's profile photo (200 px) and `readPhoto(f, cb, 360)` is a product
// picture (the shop's standard 120 px window, at 2x-3x for a phone). Both
// centre-crop the photo to a square, so what she picks is what shows. It was the
// other way round for v220-v223, when a product picture kept its own shape and
// the window letterboxed it; see `project_v224` in the memory.
//
// Browser-only module (FileReader, Image, canvas), so the shims below stand in
// for all three. They are deliberately unforgiving: the canvas records its
// drawImage arguments and its own dimensions, and a shim that quietly returned
// the right string would let a wrong crop pass.

import { test } from "node:test";
import assert from "node:assert/strict";

const SRC = "data:image/jpeg;base64,AAAA";

// Install fresh globals for one call and hand back what was recorded. Every case
// builds its own so one test's canvas can never be read as another's.
//
// `urlFor(canvas, n)` is how the byte-budget tests make `toDataURL` return a
// length the test controls — the budget loop's whole job is to re-encode when the
// string is too long, and a shim that always returned the same short string
// would make the loop look like it worked. `n` is the 0-based encode number.
function withShims({ width, height, imageError = false, fileType = "image/jpeg", urlFor = null }, run) {
  const draws = [];
  const canvases = [];
  const readers = [];
  let encodes = 0;

  class FileReader {
    constructor() { readers.push(this); this.result = null; this.onload = null; this.onerror = null; }
    readAsDataURL() { this.result = SRC; if (this.onload) setTimeout(() => this.onload(), 0); }
  }
  class Image {
    constructor() { this.width = width; this.height = height; this.onload = null; this.onerror = null; }
    set src(_v) {
      setTimeout(() => {
        if (imageError) { if (this.onerror) this.onerror(); }
        else if (this.onload) this.onload();
      }, 0);
    }
  }

  const document = {
    createElement(tag) {
      assert.equal(tag, "canvas", "readPhoto must only ever make a canvas");
      const canvas = {
        width: 0,
        height: 0,
        getContext(kind) {
          assert.equal(kind, "2d");
          return { drawImage: (...args) => draws.push(args) };
        },
        toDataURL(kind, q) {
          assert.equal(kind, "image/jpeg");
          assert.equal(q, 0.72, "the compression is part of the file size budget");
          return urlFor ? urlFor(canvas, encodes++) : "data:image/jpeg;base64,OUT";
        },
      };
      canvases.push(canvas);
      return canvas;
    },
  };

  globalThis.FileReader = FileReader;
  globalThis.Image = Image;
  globalThis.document = document;
  return run({ draws, canvases, readers });
}

test("a customer's profile photo is still a SQUARE", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 1000, height: 600 }, ({ draws, canvases }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, draws, canvases }), 200);
    }));
  assert.equal(seen.canvases[0].width, 200);
  assert.equal(seen.canvases[0].height, 200, "one number means a square, as before");
  // side = 600 (the shorter edge), centred horizontally, full height.
  assert.deepEqual(seen.draws[0].slice(1), [200, 0, 600, 600, 0, 0, 200, 200]);
});

test("readPhoto honours an explicit box: 160 x 200 comes back 160 x 200", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 1000, height: 600 }, ({ draws, canvases }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, draws, canvases }), 160, 200);
    }));
  assert.equal(seen.canvases[0].width, 160);
  assert.equal(seen.canvases[0].height, 200, "and taller than it is wide, on both axes");
  assert.equal(seen.canvases[0].height > seen.canvases[0].width, true);
});

test("a WIDE photo is trimmed at the sides, never squashed", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 1000, height: 600 }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (u) => resolve({ u, draws }), 160, 200);
    }));
  // ratio 0.8; source 1.667 is wider, so the full height is kept and the sides
  // go: 600 * 0.8 = 480 wide, centred at (1000-480)/2 = 260.
  assert.deepEqual(seen.draws[0].slice(1), [260, 0, 480, 600, 0, 0, 160, 200]);
});

test("a TALL photo is trimmed at the top and bottom", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 600, height: 1000 }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (u) => resolve({ u, draws }), 160, 200);
    }));
  // The other branch: full width, 600 / 0.8 = 750 tall, centred at 125.
  assert.deepEqual(seen.draws[0].slice(1), [0, 125, 600, 750, 0, 0, 160, 200]);
});

test("a photo that already has the box's shape is not trimmed at all", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 800, height: 1000 }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (u) => resolve({ u, draws }), 160, 200);
    }));
  assert.deepEqual(seen.draws[0].slice(1), [0, 0, 800, 1000, 0, 0, 160, 200]);
});

test("a file that is not an image is refused before any canvas is made", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 100, height: 100 }, ({ canvases, readers }) =>
    new Promise((resolve) => {
      readPhoto({ type: "application/pdf" }, (url) => resolve({ url, canvases, readers }), 160, 200);
    }));
  assert.equal(seen.url, null, "the caller keeps the old photo");
  assert.equal(seen.canvases.length, 0);
  assert.equal(seen.readers.length, 0, "and it never even reads the bytes");
});

test("a photo the browser cannot decode hands back null", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 100, height: 100, imageError: true }, ({ canvases }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, canvases }), 160, 200);
    }));
  assert.equal(seen.url, null);
  assert.equal(seen.canvases.length, 0);
});

test("an image with no dimensions hands back null instead of a broken crop", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({ width: 0, height: 0 }, ({ canvases }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, canvases }), 160, 200);
    }));
  assert.equal(seen.url, null);
  assert.equal(seen.canvases.length, 0);
});

// ── The byte budget: stepping the SIZE down until the picture fits ──────────
//
// These bytes ride in the single ~5 MB localStorage key that every cloud snapshot
// and export carries, AND they are sent to every customer on each shop load, so
// THUMB_MAX (storefront-fields.js) is a hard ceiling — over it the picture is
// DROPPED from the shop rather than published broken, which would look like the
// photo simply never arrived. A busy photo (a full tray, a crumb close-up) can be
// several times heavier than a plain one at the same pixel count, so the reader
// re-encodes smaller rather than trusting one guess.

test("readPhoto re-encodes SMALLER until the data URL fits the byte budget", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  // The first two encodes are over budget, the third is not. Only a shim whose
  // URL length varies can show the loop really runs.
  //
  // The sizes are read from `draws`, not from `canvases`: the reader makes ONE
  // canvas and mutates its dimensions each pass, so every entry in `canvases` is
  // the same object at its final size. The DESTINATION width for pass n is
  // `draws[n][7]` (drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch)), which is the
  // thing under test.
  const lengths = [50000, 40000, 20000];
  const seen = await withShims({
    width: 800, height: 800,
    urlFor: (_canvas, n) => "data:image/jpeg;base64," + "A".repeat(lengths[Math.min(n, lengths.length - 1)]),
  }, ({ canvases, draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, canvases, draws }), 400, 400, 30000);
    }));
  assert.equal(seen.draws.length, 3, "three encodes: two too heavy, one that fits");
  assert.equal(seen.canvases.length, 1, "one canvas, reused — not a new one per pass");
  assert.equal(seen.draws[0][7], 400, "the first pass is the box size");
  assert.equal(seen.draws[1][7], 320, "each step is 0.8 of the last");
  assert.equal(seen.draws[2][7], 256);
  assert.ok(seen.url.length <= 30000, "and it stops as soon as it fits");
});

test("the SOURCE rectangle never moves as the box shrinks — the same part of the photo every pass", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  // A crop that re-centres on each smaller pass would take a different part of
  // the photo, so the picture would shift as it stepped down. Only the
  // destination size may change.
  const lengths = [50000, 40000, 20000];
  const seen = await withShims({
    width: 1000, height: 600,
    urlFor: (_canvas, n) => "data:image/jpeg;base64," + "A".repeat(lengths[Math.min(n, lengths.length - 1)]),
  }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, draws }), 200, 200, 30000);
    }));
  const rect = (d) => d.slice(1, 5);
  assert.ok(seen.draws.length > 1, "this case must exercise more than one pass to mean anything");
  for (const d of seen.draws) {
    assert.deepEqual(rect(d), rect(seen.draws[0]),
      "shrinking the box must not slide the crop — a lower resolution of the SAME picture, not a different one");
  }
});

test("readPhoto stops at a 64px floor rather than shrinking forever", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  // A small box that never fits, so the ONLY thing that can end the loop is the
  // 64px floor: 100 -> 80 -> 64.
  const seen = await withShims({
    width: 80, height: 80,
    urlFor: () => "data:image/jpeg;base64," + "A".repeat(50000),
  }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, draws }), 100, 100, 30000);
    }));
  assert.equal(seen.draws.length, 3, "two steps down, then the floor stops it");
  assert.equal(seen.draws[2][7], 64, "and it never goes below the floor");
});

test("readPhoto is bounded even on a photo that never fits", async () => {
  const { readPhoto } = await import("../admin/js/photo.js");
  const seen = await withShims({
    width: 4000, height: 4000,
    urlFor: () => "data:image/jpeg;base64," + "A".repeat(999999),
  }, ({ draws }) =>
    new Promise((resolve) => {
      readPhoto({ type: "image/jpeg" }, (url) => resolve({ url, draws }), 400, 400, 30000);
    }));
  assert.ok(seen.draws.length <= 6, "the loop is bounded, so one photo cannot hang her app");
  const last = seen.draws[seen.draws.length - 1];
  assert.ok(Math.max(last[7], last[8]) < 400, "and it did come down from the box size");
});

// ── The wiring, and the one thing no DOM test can reach ─────────────────────
//
// The cases above prove the READER is right. They cannot prove which reader each
// screen picks, and they cannot see CSS at all — the DOM shim has no layout, so
// `object-fit: cover` and `object-fit: contain` render identically to it. Both
// gaps are closed the way this repo closes them elsewhere: by asserting on the
// source text, which is the only place the choice actually lives.

import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the product editor uses the SQUARE-cropping reader, at the window's 360 px", () => {
  const src = read("admin/js/views/products.js");
  assert.match(src, /import\s*\{[^}]*readPhoto[^}]*\}\s*from\s*"\.\.\/photo\.js"/,
    "products.js must import readPhoto");
  assert.doesNotMatch(src, /\breadPhotoFit\s*\(/,
    "readPhotoFit is gone — nothing may reach for the ratio-keeping reader again");
  assert.match(src, /readPhoto\(f,[\s\S]*?\},\s*360\s*\)/,
    "and it must ask for the window's 360 px, not the 200 px avatar size");
});

test("a customer's profile photo still uses the SQUARE-cropping reader", () => {
  const src = read("admin/js/views/customers.js");
  assert.match(src, /readPhoto\s*\(/,
    "the customer photo is deliberately a square crop — it wants readPhoto");
  assert.doesNotMatch(src, /\breadPhotoFit\s*\(/,
    "and it must not drift to the ratio-keeping one");
});

test("every product picture is drawn with `cover`, because the stored photo is already a square", () => {
  const store = read("store/app.css");
  const admin = read("admin/css/app.css");
  const rule = (css, sel) => (css.match(new RegExp(sel.replace(".", "\\.") + "\\s*\\{([^}]*)\\}")) || [])[1] || "";
  const boxes = [
    ["the shop card", rule(store, ".menu-thumb")],
    ["the app row", rule(admin, ".prod-thumb")],
    ["the editor preview", rule(admin, ".thumb-box")],
  ];
  for (const [label, body] of boxes) {
    assert.ok(body, `${label} must have its own rule`);
    assert.match(body, /object-fit:\s*cover/, `${label} must be cover — the photo is a square that fills the window`);
    assert.doesNotMatch(body, /object-fit:\s*contain/,
      `${label} must not be contain — a square photo in a square window has nothing to letterbox`);
  }
});

test("the three photo windows are ONE standard size — 120 x 120, the same in all three places", () => {
  const store = read("store/app.css");
  const admin = read("admin/css/app.css");
  const rule = (css, sel) => (css.match(new RegExp(sel.replace(".", "\\.") + "\\s*\\{([^}]*)\\}")) || [])[1] || "";
  const size = (body) => [
    (body.match(/(?:^|;)\s*width:\s*(\d+)px/) || [])[1],
    (body.match(/(?:^|;)\s*height:\s*(\d+)px/) || [])[1],
  ];
  const boxes = [
    ["the shop card", rule(store, ".menu-thumb")],
    ["the app row", rule(admin, ".prod-thumb")],
    ["the editor preview", rule(admin, ".thumb-box")],
  ];
  for (const [label, body] of boxes) {
    assert.deepEqual(size(body), ["120", "120"],
      `${label} must be the ONE standard 120 x 120 window — all three the same is the point`);
    // A window that stretches or has a min/max height is NOT standard: it changes
    // with the card it sits in, which is exactly what this version replaced.
    assert.doesNotMatch(body, /align-self:\s*stretch/,
      `${label} must not stretch to its card — the window is a fixed size`);
    assert.doesNotMatch(body, /(?:min|max)-height/,
      `${label} must not carry a min/max height — the window is a fixed size`);
  }
});

test("the customer avatar is STILL a square crop — it was not swept up by the change", () => {
  const admin = read("admin/css/app.css");
  const body = (admin.match(/\.customer-avatar\s*\{([^}]*)\}/) || [])[1] || "";
  assert.match(body, /object-fit:\s*cover/,
    "the round avatar wants a filled square; contain would letterbox a face");
});
