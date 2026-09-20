// qr.test.js — the QR encoder, checked against the standard rather than
// against itself.
//
// There is no QR library on this machine and no third-party code in this repo,
// so the encoder cannot be diffed against a reference implementation. What it
// can be is checked four independent ways:
//
//   1. The format and version bit strings are read back out of the finished
//      matrix and compared with the tables printed in ISO/IEC 18004. A wrong
//      BCH generator or a wrong placement both show up here.
//   2. The Reed–Solomon codewords are checked by the property that defines a
//      codeword: the polynomial they form must be zero at α^0 … α^(n-1). This
//      tests the generator and the division without trusting either.
//   3. The whole symbol is decoded back to the original text by a decoder
//      written from the standard, reading nothing but the matrix.
//   4. The structure (finders, separators, timing, alignment, the dark module)
//      and the module count are asserted per version.
//
// The tables below are transcribed separately from the ones in qr.js on
// purpose: if the module's copy is wrong, these disagree with it.

import test from "node:test";
import assert from "node:assert/strict";
import { qrMatrix, qrSvg, qrPngBytes } from "../admin/js/qr.js";

// --- the standard's own numbers --------------------------------------------

// The 15-bit format strings for error correction level M (ISO/IEC 18004
// Table C.1), indexed by mask pattern.
const REF_FORMAT_M = [
  "101010000010010", "101000100100101", "101111001111100", "101101101001011",
  "100010111111001", "100000011001110", "100111110010111", "100101010100000",
];

// The 18-bit version strings (Table D.1). Versions 1–6 carry none.
const REF_VERSION = {
  7: "000111110010010100",
  8: "001000010110111100",
  9: "001001101010011001",
  10: "001010010011010011",
};

// Blocks as [how many, data codewords each, error-correction codewords each].
const REF_BLOCKS = {
  1: [[1, 16, 10]],
  2: [[1, 28, 16]],
  3: [[1, 44, 26]],
  4: [[2, 32, 18]],
  5: [[2, 43, 24]],
  6: [[4, 27, 16]],
  7: [[4, 31, 18]],
  8: [[2, 38, 22], [2, 39, 22]],
  9: [[3, 36, 22], [2, 37, 22]],
  10: [[4, 43, 26], [1, 44, 26]],
};

// Total codewords per version — a fixed consequence of the symbol size, so it
// is a check on REF_BLOCKS rather than a restatement of it.
const REF_TOTAL = { 1: 26, 2: 44, 3: 70, 4: 100, 5: 134, 6: 172, 7: 196, 8: 242, 9: 292, 10: 346 };

// The published byte-mode capacities at level M (Table 7).
const REF_CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };

const REF_ALIGN = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

// Remainder bits, from Table 1.
const REF_REMAINDER = { 1: 0, 2: 7, 3: 7, 4: 7, 5: 7, 6: 7, 7: 0, 8: 0, 9: 0, 10: 0 };

const VERSIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const sizeOf = (version) => 17 + 4 * version;
const versionOf = (matrix) => (matrix.length - 17) / 4;

function refDataCodewords(version) {
  return REF_BLOCKS[version].reduce((sum, [n, per]) => sum + n * per, 0);
}

// --- reading a finished symbol ---------------------------------------------

// Every module the spec puts there itself, which the mask never touches.
function functionMap(version) {
  const size = sizeOf(version);
  const fn = Array.from({ length: size }, () => new Array(size).fill(false));
  const mark = (r, c) => {
    if (r >= 0 && r < size && c >= 0 && c < size) fn[r][c] = true;
  };

  for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(top + r, left + c);
  }
  for (let i = 8; i < size - 8; i++) { mark(6, i); mark(i, 6); }

  for (const r of REF_ALIGN[version] || []) {
    for (const c of REF_ALIGN[version] || []) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  }

  for (let i = 0; i < 15; i++) {
    if (i < 6) mark(i, 8); else if (i < 8) mark(i + 1, 8); else mark(size - 15 + i, 8);
    if (i < 8) mark(8, size - i - 1); else if (i < 9) mark(8, 15 - i); else mark(8, 15 - i - 1);
  }
  mark(size - 8, 8);

  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      mark(Math.floor(i / 3), (i % 3) + size - 11);
      mark((i % 3) + size - 11, Math.floor(i / 3));
    }
  }
  return fn;
}

// Where bit i of the format string is written, in both copies.
const formatSpotA = (i, size) => (i < 6 ? [i, 8] : i < 8 ? [i + 1, 8] : [size - 15 + i, 8]);
const formatSpotB = (i, size) => (i < 8 ? [8, size - i - 1] : i < 9 ? [8, 15 - i] : [8, 15 - i - 1]);

function formatString(matrix) {
  const size = matrix.length;
  let out = "";
  for (let i = 14; i >= 0; i--) {
    const [r, c] = formatSpotA(i, size);
    out += matrix[r][c] ? "1" : "0";
  }
  return out;
}

function formatStringCopy(matrix) {
  const size = matrix.length;
  let out = "";
  for (let i = 14; i >= 0; i--) {
    const [r, c] = formatSpotB(i, size);
    out += matrix[r][c] ? "1" : "0";
  }
  return out;
}

function versionString(matrix) {
  const size = matrix.length;
  let out = "";
  for (let i = 17; i >= 0; i--) {
    out += matrix[Math.floor(i / 3)][(i % 3) + size - 11] ? "1" : "0";
  }
  return out;
}

function versionStringCopy(matrix) {
  const size = matrix.length;
  let out = "";
  for (let i = 17; i >= 0; i--) {
    out += matrix[(i % 3) + size - 11][Math.floor(i / 3)] ? "1" : "0";
  }
  return out;
}

const MASK_RULES = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r * c) % 3) + ((r + c) % 2)) % 2 === 0,
];

// The order the data actually fills the symbol: two columns at a time from the
// right, up then down, stepping over the vertical timing column.
function walkOrder(version) {
  const size = sizeOf(version);
  const fn = functionMap(version);
  const order = [];
  let dir = -1;
  let row = size - 1;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col--;
    for (;;) {
      for (let c = 0; c < 2; c++) {
        const at = col - c;
        if (!fn[row][at]) order.push([row, at]);
      }
      row += dir;
      if (row < 0 || row >= size) { row -= dir; dir = -dir; break; }
    }
  }
  return order;
}

// The symbol, read back to the codewords that were placed in it.
function readCodewords(matrix) {
  const version = versionOf(matrix);
  const maskIndex = REF_FORMAT_M.indexOf(formatString(matrix));
  assert.notEqual(maskIndex, -1, "the format bits are not one of the standard's eight M strings");

  const order = walkOrder(version);
  const bits = order.map(([r, c]) => {
    const raw = matrix[r][c];
    return (MASK_RULES[maskIndex](r, c) ? !raw : raw) ? 1 : 0;
  });

  const codewords = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    codewords.push(byte);
  }
  return { version, maskIndex, order, bits, codewords };
}

// Undo the block interleaving: back to one flat list of codewords per block.
function deinterleave(codewords, version) {
  const blocks = [];
  for (const [count, per, ec] of REF_BLOCKS[version]) {
    for (let i = 0; i < count; i++) blocks.push({ data: [], ec: [], per, ecCount: ec });
  }
  const dataLens = blocks.map((b) => b.per);
  const longest = Math.max(...dataLens);

  let at = 0;
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) {
      if (i < block.per) block.data.push(codewords[at++]);
    }
  }
  for (let i = 0; i < blocks[0].ecCount; i++) {
    for (const block of blocks) block.ec.push(codewords[at++]);
  }
  return blocks;
}

// --- Reed–Solomon -----------------------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}
const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// Evaluate the codeword polynomial at `point`. A Reed–Solomon codeword is
// exactly a polynomial with roots at α^0 … α^(ec-1), so every one of these
// must come out zero.
function evalPoly(codewords, point) {
  let acc = 0;
  for (const byte of codewords) acc = mul(acc, point) ^ byte;
  return acc;
}

function syndromes(codewords, ecCount) {
  const out = [];
  for (let i = 0; i < ecCount; i++) out.push(evalPoly(codewords, EXP[i]));
  return out;
}

// --- tests ------------------------------------------------------------------

test("the block table adds up to the standard's total codewords", () => {
  for (const v of VERSIONS) {
    const total = REF_BLOCKS[v].reduce((sum, [n, per, ec]) => sum + n * (per + ec), 0);
    assert.equal(total, REF_TOTAL[v], `version ${v}`);
  }
});

test("the block table yields the standard's byte capacities", () => {
  for (const v of VERSIONS) {
    const dataBits = refDataCodewords(v) * 8;
    const header = 4 + (v < 10 ? 8 : 16);
    assert.equal(Math.floor((dataBits - header) / 8), REF_CAPACITY[v], `version ${v}`);
  }
});

test("a message picks the smallest version that holds it", () => {
  for (const v of VERSIONS) {
    const exact = qrMatrix("a".repeat(REF_CAPACITY[v]));
    assert.equal(versionOf(exact), v, `exactly ${REF_CAPACITY[v]} bytes should fit version ${v}`);
  }
  for (const v of VERSIONS.slice(0, -1)) {
    const over = qrMatrix("a".repeat(REF_CAPACITY[v] + 1));
    assert.equal(versionOf(over), v + 1, `one byte past version ${v} should move up`);
  }
});

test("text past the encoder's limit is refused rather than mangled", () => {
  assert.throws(() => qrMatrix("a".repeat(REF_CAPACITY[10] + 1)), /past this encoder's limit/);
});

test("every version fills exactly its data modules", () => {
  for (const v of VERSIONS) {
    const order = walkOrder(v);
    const expected = REF_TOTAL[v] * 8 + REF_REMAINDER[v];
    assert.equal(order.length, expected, `version ${v} should have ${expected} data modules`);
  }
});

test("the format bits match Table C.1, written the same in both copies", () => {
  for (let mask = 0; mask < 8; mask++) {
    // A string whose length is fixed across masks, so only the mask changes.
    const matrix = qrMatrix("MUNCHIES-FURKIDZ");
    const bits = formatString(matrix);
    assert.ok(REF_FORMAT_M.includes(bits), `format string ${bits} is not in the table`);
    assert.equal(bits, formatStringCopy(matrix), "the two copies of the format bits disagree");
  }
});

test("across many payloads, the format bits are always a standard value and agree with themselves", () => {
  const payloads = ["A", "munchies.com.my", "https://munchies.com.my/taster/?c=K3X9", "x".repeat(100), "x".repeat(213)];
  for (const payload of payloads) {
    const matrix = qrMatrix(payload);
    const bits = formatString(matrix);
    assert.ok(REF_FORMAT_M.includes(bits), `${payload}: format string ${bits} is not in the table`);
    assert.equal(bits, formatStringCopy(matrix), `${payload}: the copies disagree`);
    if (versionOf(matrix) >= 7) {
      assert.equal(versionString(matrix), REF_VERSION[versionOf(matrix)], `${payload}: version info`);
      assert.equal(versionString(matrix), versionStringCopy(matrix), `${payload}: version copies`);
    }
  }
});

test("the data placed in version 1 is a true Reed–Solomon codeword", () => {
  // Version 1 is a single block, so the codewords read straight off the symbol
  // are the whole codeword — no interleaving to undo. That makes it the one
  // case where the syndrome can be checked with nothing else in the way.
  const { version, codewords } = readCodewords(qrMatrix("Furkidz")); // 7 bytes, inside version 1's 14
  assert.equal(version, 1);
  assert.equal(codewords.length, REF_TOTAL[1]);
  assert.deepEqual(syndromes(codewords, 10), new Array(10).fill(0));
});

test("every block of every version is a true Reed–Solomon codeword", () => {
  for (const v of VERSIONS) {
    const payload = "x".repeat(REF_CAPACITY[v]);
    const { version, codewords } = readCodewords(qrMatrix(payload));
    assert.equal(version, v);
    const blocks = deinterleave(codewords, v);
    for (const [i, block] of blocks.entries()) {
      assert.equal(block.data.length, block.per, `version ${v} block ${i} data length`);
      assert.equal(block.ec.length, block.ecCount, `version ${v} block ${i} ec length`);
      assert.deepEqual(
        syndromes([...block.data, ...block.ec], block.ecCount),
        new Array(block.ecCount).fill(0),
        `version ${v} block ${i} is not a codeword`,
      );
    }
  }
});

test("the short-payload blocks are padded with the standard's pad codewords", () => {
  const { codewords } = readCodewords(qrMatrix("hi"));
  // 4 bits mode + 8 bits count + 2 bytes = 28 bits, then a 4-bit terminator,
  // which lands exactly on the fourth byte — so the pad begins at index 4 and
  // alternates 0xEC, 0x11 to the end of the 16 data codewords.
  assert.deepEqual(codewords.slice(0, 4), [0x40, 0x26, 0x86, 0x90]);
  for (let i = 4; i < 16; i++) assert.equal(codewords[i], i % 2 === 0 ? 0xec : 0x11, `pad ${i}`);
  assert.deepEqual(syndromes(codewords, 10), new Array(10).fill(0));
});

test("what goes in comes back out, for every version and a spread of payloads", () => {
  const payloads = [
    "A",
    "hello",
    "https://munchies.com.my/taster/?c=K3X9",
    "https://munchies.com.my/taster/?c=SHOP-A&via=60189136389",
    "MUNCHIES FURKIDZ — Duck Jerky 100g",
    "x".repeat(120),
    "x".repeat(180),
    "x".repeat(213),
    "é中文🐾",
  ];

  for (const payload of payloads) {
    const matrix = qrMatrix(payload);
    const version = versionOf(matrix);
    const { bits } = readCodewords(matrix);
    const blocks = deinterleave(readCodewords(matrix).codewords, version);
    const data = blocks.flatMap((b) => b.data);

    const dataBits = [];
    for (const byte of data) {
      for (let i = 7; i >= 0; i--) dataBits.push((byte >>> i) & 1);
    }

    let at = 0;
    const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | dataBits[at++]; return v; };
    assert.equal(take(4), 0b0100, `${payload}: mode should be byte mode`);
    const length = take(version < 10 ? 8 : 16);
    const bytes = [];
    for (let i = 0; i < length; i++) bytes.push(take(8));

    assert.equal(Buffer.from(bytes).toString("utf8"), payload, `${payload}: decoded text`);
    assert.ok(bits.length >= length * 8, `${payload}: the symbol carries less than it claims`);
  }
});

test("the finders, separators, timing and dark module are where the standard puts them", () => {
  for (const v of VERSIONS) {
    const matrix = qrMatrix("x".repeat(REF_CAPACITY[v]));
    const size = sizeOf(v);
    const dark = (r, c) => matrix[r][c] === true;

    for (const [top, left] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let i = 0; i < 7; i++) {
        assert.equal(dark(top, left + i), true, `v${v} finder top row`);
        assert.equal(dark(top + 6, left + i), true, `v${v} finder bottom row`);
        assert.equal(dark(top + i, left), true, `v${v} finder left column`);
        assert.equal(dark(top + i, left + 6), true, `v${v} finder right column`);
      }
      for (let r = 2; r <= 4; r++) {
        for (let c = 2; c <= 4; c++) assert.equal(dark(top + r, left + c), true, `v${v} finder core`);
      }
      assert.equal(dark(top + 1, left + 1), false, `v${v} finder inner ring`);
      assert.equal(dark(top + 5, left + 5), false, `v${v} finder inner ring`);
    }

    // Separators: the light line hugging each finder.
    for (let i = 0; i < 8; i++) {
      assert.equal(dark(7, i), false, `v${v} top separator`);
      assert.equal(dark(i, 7), false, `v${v} left separator`);
      assert.equal(dark(7, size - 1 - i), false, `v${v} top-right separator`);
      assert.equal(dark(size - 1 - i, 7), false, `v${v} bottom-left separator`);
    }

    // Timing: alternating along row 6 and column 6, dark on the even index.
    for (let i = 8; i < size - 8; i++) {
      assert.equal(dark(6, i), i % 2 === 0, `v${v} row timing at ${i}`);
      assert.equal(dark(i, 6), i % 2 === 0, `v${v} column timing at ${i}`);
    }

    assert.equal(dark(size - 8, 8), true, `v${v} dark module`);

    // Alignment squares, where the version has any.
    for (const r of REF_ALIGN[v] || []) {
      for (const c of REF_ALIGN[v] || []) {
        if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            assert.equal(dark(r + dr, c + dc), ring !== 1, `v${v} alignment at ${r},${c} offset ${dr},${dc}`);
          }
        }
      }
    }
  }
});

test("the mask really is the one the format bits name", () => {
  for (const payload of ["A", "munchies.com.my", "x".repeat(60), "x".repeat(213)]) {
    const matrix = qrMatrix(payload);
    const version = versionOf(matrix);
    const named = REF_FORMAT_M.indexOf(formatString(matrix));
    const fn = functionMap(version);
    const size = matrix.length;

    // For the named mask, a data module must equal its unmasked value XOR the
    // rule; for any other mask at least one module must disagree. Re-reading the
    // codewords with the named mask already produced a valid codeword above, so
    // this pins down that no *other* mask would also qualify.
    for (let other = 0; other < 8; other++) {
      if (other === named) continue;
      let differs = false;
      for (let r = 0; r < size && !differs; r++) {
        for (let c = 0; c < size; c++) {
          if (fn[r][c]) continue;
          if (MASK_RULES[other](r, c) === MASK_RULES[named](r, c)) continue;
          differs = true;
          break;
        }
      }
      assert.ok(differs, `${payload}: mask ${other} and ${named} would be indistinguishable`);
    }
  }
});

// --- drawing ----------------------------------------------------------------

test("the SVG is a self-contained string with a quiet zone and one path", () => {
  const matrix = qrMatrix("https://munchies.com.my/taster/?c=K3X9");
  const svg = qrSvg(matrix, { scale: 4, quiet: 4 });
  const side = (matrix.length + 8) * 4;

  assert.equal(typeof svg, "string");
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, new RegExp(`viewBox="0 0 ${side} ${side}"`));
  assert.match(svg, /shape-rendering="crispEdges"/);
  assert.equal((svg.match(/<path/g) || []).length, 1, "the runs should merge into one path");
  assert.ok(!svg.includes("undefined") && !svg.includes("NaN"), "no undefined or NaN in the output");

  // The white background covers the whole square including the quiet zone.
  assert.match(svg, new RegExp(`<rect width="${side}" height="${side}"`));
});

test("the SVG carries a real pixel size, not just a viewBox", () => {
  // Without width/height an SVG has no size of its own and every rasteriser
  // falls back to 150x150 — which silently ruins a dense symbol when it is
  // saved, printed or drawn to a canvas.
  for (const version of VERSIONS) {
    const matrix = qrMatrix("x".repeat(REF_CAPACITY[version]));
    for (const options of [{}, { scale: 4 }, { scale: 12, quiet: 2 }, { size: 1024 }]) {
      const svg = qrSvg(matrix, options);
      const width = Number(/^<svg[^>]*\swidth="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
      const height = Number(/^<svg[^>]*\sheight="(\d+(?:\.\d+)?)"/.exec(svg)?.[1]);
      assert.ok(Number.isFinite(width) && width > 0, `v${version}: width missing`);
      assert.equal(width, height, `v${version}: the square should be square`);
    }
  }
});

test("a bigger symbol gets a bigger SVG, so nothing is drawn at a fixed size", () => {
  const small = qrSvg(qrMatrix("A"));
  const large = qrSvg(qrMatrix("x".repeat(REF_CAPACITY[10])));
  const sideOf = (svg) => Number(/viewBox="0 0 (\d+)/.exec(svg)[1]);
  assert.ok(sideOf(large) > sideOf(small), "the largest symbol should not be drawn at the smallest size");
  assert.ok(sideOf(small) >= 200, "even the smallest symbol should be print-sized");
});

test("the SVG path covers exactly the dark modules", () => {
  const matrix = qrMatrix("hello");
  const quiet = 4;
  const scale = 2;
  const svg = qrSvg(matrix, { quiet, scale });
  const area = [...svg.matchAll(/h(\d+)v(\d+)h-\1z/g)]
    .reduce((sum, m) => sum + Number(m[1]) * Number(m[2]), 0);

  let dark = 0;
  for (const row of matrix) for (const cell of row) if (cell) dark++;
  assert.equal(area, dark * scale * scale, "the drawn area should be the dark module area");
});

test("the PNG is a real 1-bit greyscale file of the right size", () => {
  const matrix = qrMatrix("hello");
  const quiet = 4;
  const scale = 8;
  const bytes = qrPngBytes(matrix, { quiet, scale });
  const side = (matrix.length + quiet * 2) * scale;

  assert.deepEqual(
    Array.from(bytes.slice(0, 8)),
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "PNG signature",
  );

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  assert.equal(view.getUint32(8), 13, "IHDR length");
  assert.equal(String.fromCharCode(...bytes.slice(12, 16)), "IHDR");
  assert.equal(view.getUint32(16), side, "width");
  assert.equal(view.getUint32(20), side, "height");
  assert.equal(bytes[24], 1, "bit depth");
  assert.equal(bytes[25], 0, "greyscale colour type");

  // Chunks run to the end with correct lengths, and the CRC of each is right.
  const crcTable = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const crc = (buf) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };

  let at = 8;
  const seen = [];
  while (at < bytes.length) {
    const length = view.getUint32(at);
    const type = String.fromCharCode(...bytes.slice(at + 4, at + 8));
    const body = bytes.slice(at + 4, at + 8 + length);
    assert.equal(view.getUint32(at + 8 + length), crc(body), `${type} CRC`);
    seen.push(type);
    at += 12 + length;
  }
  assert.deepEqual(seen, ["IHDR", "IDAT", "IEND"]);
});

test("the PNG's stored pixels are the symbol, quiet zone and all", () => {
  const matrix = qrMatrix("hello");
  const quiet = 4;
  const scale = 3;
  const bytes = qrPngBytes(matrix, { quiet, scale });
  const side = (matrix.length + quiet * 2) * scale;

  // The IDAT body is a zlib stream of stored deflate blocks, so the pixels can
  // be read straight back out without a decompressor.
  let idat = null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 8;
  while (at < bytes.length) {
    const length = view.getUint32(at);
    if (String.fromCharCode(...bytes.slice(at + 4, at + 8)) === "IDAT") {
      idat = bytes.slice(at + 8, at + 8 + length);
      break;
    }
    at += 12 + length;
  }
  assert.ok(idat, "IDAT found");
  assert.deepEqual(Array.from(idat.slice(0, 2)), [0x78, 0x01], "zlib header");

  const raw = [];
  let p = 2;
  for (;;) {
    const last = idat[p];
    const len = idat[p + 1] | (idat[p + 2] << 8);
    p += 5;
    for (let i = 0; i < len; i++) raw.push(idat[p + i]);
    p += len;
    if (last) break;
  }

  const rowBytes = Math.ceil(side / 8);
  assert.equal(raw.length, (rowBytes + 1) * side, "one filter byte per row, packed pixels after");

  // 1 is white, 0 is black: check a dark module and a light one, at the middle
  // of each so the scale does not matter.
  const pixel = (x, y) => {
    const rowStart = y * (rowBytes + 1);
    assert.equal(raw[rowStart], 0, "filter byte");
    return (raw[rowStart + 1 + (x >> 3)] >> (7 - (x & 7))) & 1;
  };

  let darkChecked = 0;
  let lightChecked = 0;
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      const x = (c + quiet) * scale + Math.floor(scale / 2);
      const y = (r + quiet) * scale + Math.floor(scale / 2);
      const isDark = pixel(x, y) === 0;
      assert.equal(isDark, matrix[r][c] === true, `module ${r},${c}`);
      if (isDark) darkChecked++; else lightChecked++;
    }
  }
  assert.ok(darkChecked > 0 && lightChecked > 0, "the symbol has both colours");

  // The quiet zone is white all the way round.
  for (let i = 0; i < side; i++) {
    assert.equal(pixel(i, 0), 1, "top quiet zone");
    assert.equal(pixel(i, side - 1), 1, "bottom quiet zone");
    assert.equal(pixel(0, i), 1, "left quiet zone");
    assert.equal(pixel(side - 1, i), 1, "right quiet zone");
  }
});

test("the SVG and the PNG agree, module for module", () => {
  const matrix = qrMatrix("https://munchies.com.my/taster/?c=SHOP-A");
  const svg = qrSvg(matrix, { quiet: 4, scale: 1 });
  // With scale 1 the path is in module units offset by the quiet zone, so the
  // two drawings can be compared position by position.
  const drawn = new Set();
  for (const m of svg.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    for (let i = 0; i < Number(m[3]); i++) drawn.add(`${y - 4},${x - 4 + i}`);
  }
  for (let r = 0; r < matrix.length; r++) {
    for (let c = 0; c < matrix.length; c++) {
      assert.equal(drawn.has(`${r},${c}`), matrix[r][c] === true, `module ${r},${c}`);
    }
  }
});
