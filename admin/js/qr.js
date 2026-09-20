// qr.js — a QR Code encoder, written by hand so the app keeps its promise of
// carrying no third-party code and loading nothing from a CDN at run time.
//
// Text in, one square matrix of dark/light modules out. `qrSvg` draws that
// matrix for the screen and for print, `qrPngBytes` makes a real PNG file (a
// shop can be sent one on WhatsApp; an SVG cannot be). Nothing here touches the
// DOM — canvas would have meant a browser-only path and no Node tests, so the
// PNG is assembled byte by byte instead.
//
// Deliberately only what a printed label needs: byte mode (any URL, any
// character), error correction level M (what a shop counter and a phone camera
// want), and versions 1–10, reaching 213 bytes. That is several times the
// longest link this app builds. A longer string would be a programming error
// rather than a customer's, so it throws instead of quietly printing a square
// that cannot be scanned.

// ---------------------------------------------------------------------------
// Reed–Solomon over GF(256), primitive polynomial 0x11D (x^8+x^4+x^3+x^2+1)
// ---------------------------------------------------------------------------

const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(function buildGaloisTables() {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x = (x << 1) ^ (x & 0x80 ? 0x11d : 0);
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255];
})();

function gfMul(a, b) {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a] + GF_LOG[b]];
}

// The generator polynomial for `count` error-correction codewords: the product
// (x-α^0)(x-α^1)...(x-α^(count-1)). Highest power first, so poly[0] is always 1.
function rsGenerator(count) {
  let poly = [1];
  for (let i = 0; i < count; i++) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], GF_EXP[i]);
    }
    poly = next;
  }
  return poly;
}

// Long division of the data by the generator: the remainder is the EC codewords.
function rsRemainder(data, count) {
  const gen = rsGenerator(count);
  const rem = new Uint8Array(count);
  for (const byte of data) {
    const factor = byte ^ rem[0];
    rem.copyWithin(0, 1);
    rem[count - 1] = 0;
    if (factor !== 0) {
      for (let i = 0; i < count; i++) rem[i] ^= gfMul(gen[i + 1], factor);
    }
  }
  return Array.from(rem);
}

// ---------------------------------------------------------------------------
// The version table (error correction level M)
// ---------------------------------------------------------------------------
//
// One row per version: how many error-correction codewords each block carries,
// then the two block groups as [how many blocks, data codewords each]. A version
// with no second group carries all its blocks in the first. Total codewords per
// version are fixed by the symbol size; every row here sums to the published
// figure, and the data codewords left over are what set the byte capacities in
// BYTE_CAPACITY below.
const BLOCKS = {
  1: { ec: 10, groups: [[1, 16]] },
  2: { ec: 16, groups: [[1, 28]] },
  3: { ec: 26, groups: [[1, 44]] },
  4: { ec: 18, groups: [[2, 32]] },
  5: { ec: 24, groups: [[2, 43]] },
  6: { ec: 16, groups: [[4, 27]] },
  7: { ec: 18, groups: [[4, 31]] },
  8: { ec: 22, groups: [[2, 38], [2, 39]] },
  9: { ec: 22, groups: [[3, 36], [2, 37]] },
  10: { ec: 26, groups: [[4, 43], [1, 44]] },
};

// The published byte-mode capacities at level M, kept here so the table above
// can be checked against a number that did not come from the table itself.
const BYTE_CAPACITY = { 1: 14, 2: 26, 3: 42, 4: 62, 5: 84, 6: 106, 7: 122, 8: 152, 9: 180, 10: 213 };

// The five-module alignment squares, by version. Version 1 has none.
const ALIGN_CENTERS = {
  2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34],
  7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const PAD_CODEWORDS = [0xec, 0x11];

// ---------------------------------------------------------------------------
// Bit stream
// ---------------------------------------------------------------------------

function utf8Bytes(text) {
  const out = [];
  for (const ch of String(text)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 | (cp >> 6), 0x80 | (cp & 63));
    else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63));
    } else {
      out.push(
        0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63),
        0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63),
      );
    }
  }
  return out;
}

function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v++) {
    if (byteLength <= BYTE_CAPACITY[v]) return v;
  }
  throw new Error(`QR: ${byteLength} bytes is past this encoder's limit of ${BYTE_CAPACITY[10]}`);
}

function dataCodewordCount(version) {
  return BLOCKS[version].groups.reduce((sum, [n, per]) => sum + n * per, 0);
}

// Byte mode: 4 bits of mode, the character count, then the bytes. The count
// widens from 8 to 16 bits at version 10.
function payloadBits(bytes, version) {
  const bits = [];
  const push = (value, width) => {
    for (let i = width - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  return bits;
}

// Terminator, then zero bits to the next byte, then the alternating pad
// codewords until the version's data capacity is full.
function padToCapacity(bits, version) {
  const capacity = dataCodewordCount(version) * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i++) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);
  let which = 0;
  while (bits.length < capacity) {
    const byte = PAD_CODEWORDS[which++ % 2];
    for (let i = 7; i >= 0; i--) bits.push((byte >>> i) & 1);
  }
  return bits;
}

function bitsToCodewords(bits) {
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j];
    out.push(byte);
  }
  return out;
}

// Split into blocks, add each block's EC codewords, then interleave: the first
// data codeword of every block, then the second of every block, and so on, with
// the EC codewords interleaved the same way behind them.
function makeCodewordStream(codewords, version) {
  const spec = BLOCKS[version];
  const blocks = [];
  let at = 0;
  for (const [count, per] of spec.groups) {
    for (let i = 0; i < count; i++) {
      blocks.push(codewords.slice(at, (at += per)));
    }
  }
  const ecc = blocks.map((b) => rsRemainder(b, spec.ec));
  const longest = Math.max(...blocks.map((b) => b.length));
  const stream = [];
  for (let i = 0; i < longest; i++) {
    for (const block of blocks) if (i < block.length) stream.push(block[i]);
  }
  for (let i = 0; i < spec.ec; i++) {
    for (const block of ecc) stream.push(block[i]);
  }
  return stream;
}

// ---------------------------------------------------------------------------
// Format and version information
// ---------------------------------------------------------------------------
//
// Both are BCH codes: shift the data left, then reduce modulo the generator.
// Level M is 00 in the two level bits, so `data` is just the mask number.
const G15 = 0b10100110111;
const G15_MASK = 0b101010000010010;
const G18 = 0b1111100100101;

function bch(data, generator, shift) {
  let d = data << shift;
  const digit = (n) => { let bits = 0; while (n) { bits++; n >>>= 1; } return bits; };
  while (digit(d) >= digit(generator)) d ^= generator << (digit(d) - digit(generator));
  return (data << shift) | d;
}

function formatBits(mask) {
  return bch(mask, G15, 10) ^ G15_MASK;
}

function versionBits(version) {
  return bch(version, G18, 12);
}

function bitAt(value, index) {
  return ((value >>> index) & 1) === 1;
}

// ---------------------------------------------------------------------------
// The symbol
// ---------------------------------------------------------------------------

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

class QrSymbol {
  constructor(size) {
    this.size = size;
    // null marks a module the data has not reached yet; `fixed` marks the ones
    // the spec puts there (finders, timing, alignment, format, version), which
    // the mask must never touch.
    this.modules = Array.from({ length: size }, () => new Array(size).fill(null));
    this.fixed = Array.from({ length: size }, () => new Array(size).fill(false));
  }

  set(row, col, dark, isFixed = false) {
    this.modules[row][col] = dark;
    if (isFixed) this.fixed[row][col] = true;
  }

  // A 7x7 finder and the light separator around it — the whole 8x8 corner.
  placeFinder(top, left) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const row = top + r;
        const col = left + c;
        if (row < 0 || row >= this.size || col < 0 || col >= this.size) continue;
        const edgeRow = r === 0 || r === 6;
        const edgeCol = c === 0 || c === 6;
        const inside = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        const ring = (r >= 0 && r <= 6 && edgeCol) || (c >= 0 && c <= 6 && edgeRow);
        this.set(row, col, !!(ring || inside), true);
      }
    }
  }

  placeFunctionPatterns(version) {
    this.placeFinder(0, 0);
    this.placeFinder(0, this.size - 7);
    this.placeFinder(this.size - 7, 0);

    for (let i = 8; i < this.size - 8; i++) {
      const dark = i % 2 === 0;
      this.set(6, i, dark, true);
      this.set(i, 6, dark, true);
    }

    const centers = ALIGN_CENTERS[version] || [];
    for (const r of centers) {
      for (const c of centers) {
        // The three that would land on a finder are left out.
        if ((r === 6 && c === 6) || (r === 6 && c === this.size - 7)
          || (r === this.size - 7 && c === 6)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const ring = Math.max(Math.abs(dr), Math.abs(dc));
            this.set(r + dr, c + dc, ring !== 1, true);
          }
        }
      }
    }

    // The dark module, always dark, just above where the format bits turn the
    // corner.
    this.set(this.size - 8, 8, true, true);
  }

  placeFormat(mask) {
    const bits = formatBits(mask);
    for (let i = 0; i < 15; i++) {
      const dark = bitAt(bits, i);
      // Down the left of the top-left finder, then under it.
      if (i < 6) this.set(i, 8, dark, true);
      else if (i < 8) this.set(i + 1, 8, dark, true);
      else this.set(this.size - 15 + i, 8, dark, true);
      // Along the bottom of the top-left finder, then right of the top-right.
      if (i < 8) this.set(8, this.size - i - 1, dark, true);
      else if (i < 9) this.set(8, 15 - i, dark, true);
      else this.set(8, 15 - i - 1, dark, true);
    }
  }

  placeVersion(version) {
    if (version < 7) return;
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const dark = bitAt(bits, i);
      this.set(Math.floor(i / 3), (i % 3) + this.size - 11, dark, true);
      this.set((i % 3) + this.size - 11, Math.floor(i / 3), dark, true);
    }
  }

  // The zigzag: two columns at a time from the right, upward then downward,
  // stepping over the vertical timing column.
  placeData(codewords, mask) {
    let dir = -1;
    let row = this.size - 1;
    let bitIndex = 7;
    let byteIndex = 0;

    for (let col = this.size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (let c = 0; c < 2; c++) {
          const at = col - c;
          if (this.modules[row][at] !== null) continue;
          let dark = false;
          if (byteIndex < codewords.length) {
            dark = ((codewords[byteIndex] >>> bitIndex) & 1) === 1;
          }
          if (MASK_RULES[mask](row, at)) dark = !dark;
          this.modules[row][at] = dark;
          bitIndex--;
          if (bitIndex < 0) { byteIndex++; bitIndex = 7; }
        }
        row += dir;
        if (row < 0 || row >= this.size) {
          row -= dir;
          dir = -dir;
          break;
        }
      }
    }
  }

  // The four penalties the spec asks for. Picking the gentlest mask is what
  // keeps a busy label readable; it never changes what the square *means*.
  penalty() {
    const n = this.size;
    const dark = (r, c) => this.modules[r][c] === true;
    let score = 0;

    for (let i = 0; i < n; i++) {
      for (const alongRow of [true, false]) {
        let run = 1;
        for (let j = 1; j < n; j++) {
          const prev = alongRow ? dark(i, j - 1) : dark(j - 1, i);
          const cur = alongRow ? dark(i, j) : dark(j, i);
          if (cur === prev) run++;
          else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    }

    for (let r = 0; r < n - 1; r++) {
      for (let c = 0; c < n - 1; c++) {
        const first = dark(r, c);
        if (first === dark(r, c + 1) && first === dark(r + 1, c) && first === dark(r + 1, c + 1)) {
          score += 3;
        }
      }
    }

    const FINDER_LIKE = ["10111010000", "00001011101"];
    for (let i = 0; i < n; i++) {
      for (const alongRow of [true, false]) {
        let line = "";
        for (let j = 0; j < n; j++) line += (alongRow ? dark(i, j) : dark(j, i)) ? "1" : "0";
        for (const pattern of FINDER_LIKE) {
          let at = line.indexOf(pattern);
          while (at !== -1) { score += 40; at = line.indexOf(pattern, at + 1); }
        }
      }
    }

    let count = 0;
    for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (dark(r, c)) count++;
    score += Math.floor(Math.abs((count * 100) / (n * n) - 50) / 5) * 10;
    return score;
  }
}

function buildMatrix(text) {
  const bytes = utf8Bytes(text);
  const version = pickVersion(bytes.length);
  const size = 17 + 4 * version;

  const codewords = bitsToCodewords(padToCapacity(payloadBits(bytes, version), version));
  const stream = makeCodewordStream(codewords, version);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const symbol = new QrSymbol(size);
    symbol.placeFunctionPatterns(version);
    symbol.placeFormat(mask);
    symbol.placeVersion(version);
    symbol.placeData(stream, mask);
    const score = symbol.penalty();
    if (!best || score < best.score) best = { score, symbol };
  }
  return best.symbol.modules.map((row) => row.map((cell) => cell === true));
}

// The square, as an array of rows of booleans (true = dark). Version 1 is 21
// modules across; every version adds four.
export function qrMatrix(text) {
  return buildMatrix(text);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// Horizontal runs of dark modules, already scaled — a row of twelve dark
// modules is one rectangle, not twelve.
function darkRuns(matrix, quiet, scale) {
  const n = matrix.length;
  const rects = [];
  for (let r = 0; r < n; r++) {
    let c = 0;
    while (c < n) {
      if (matrix[r][c] !== true) { c++; continue; }
      let end = c;
      while (end < n && matrix[r][end] === true) end++;
      rects.push({
        x: (c + quiet) * scale,
        y: (r + quiet) * scale,
        w: (end - c) * scale,
        h: scale,
      });
      c = end;
    }
  }
  return rects;
}

// The square as SVG text: one path made of merged runs rather than one element
// per module, so a version 10 symbol stays a small string. `shape-rendering`
// keeps the edges hard, which is what a scanner wants and what a printer wants.
//
// width/height are not optional. An SVG that carries only a viewBox has no size
// of its own, so anything that rasterizes it — saving it, printing it, drawing
// it to a canvas — falls back to the browser's default 150x150 and then scales
// THAT bitmap, which turns a dense symbol into a smear. The default here is
// somewhere around 300-500px, which is a printable label at 300dpi; a caller
// that wants a different rendered size passes `size` (CSS can override it too).
export function qrSvg(matrix, options = {}) {
  const quiet = options.quiet == null ? 4 : options.quiet;
  const scale = options.scale == null ? 8 : options.scale;
  const dark = options.dark || "#101010";
  const light = options.light || "#ffffff";
  const side = (matrix.length + quiet * 2) * scale;
  const size = options.size == null ? side : options.size;
  const path = darkRuns(matrix, quiet, scale)
    .map((r) => `M${r.x} ${r.y}h${r.w}v${r.h}h-${r.w}z`)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" `
    + `viewBox="0 0 ${side} ${side}" shape-rendering="crispEdges" role="img">`
    + `<rect width="${side}" height="${side}" fill="${light}"/>`
    + `<path d="${path}" fill="${dark}"/>`
    + `</svg>`;
}

// ---------------------------------------------------------------------------
// PNG, assembled by hand
// ---------------------------------------------------------------------------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  for (const x of bytes) {
    a = (a + x) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

// A zlib stream made of stored (uncompressed) deflate blocks. Legal zlib, and it
// needs no compressor — a QR square is mostly flat runs anyway, so the few extra
// bytes cost nothing on a label.
function zlibStored(bytes) {
  const out = [0x78, 0x01];
  let at = 0;
  do {
    const chunk = Math.min(65535, bytes.length - at);
    const last = at + chunk >= bytes.length ? 1 : 0;
    const nlen = chunk ^ 0xffff;
    out.push(last, chunk & 0xff, (chunk >>> 8) & 0xff, nlen & 0xff, (nlen >>> 8) & 0xff);
    for (let i = 0; i < chunk; i++) out.push(bytes[at + i]);
    at += chunk;
  } while (at < bytes.length);
  const sum = adler32(bytes);
  out.push((sum >>> 24) & 0xff, (sum >>> 16) & 0xff, (sum >>> 8) & 0xff, sum & 0xff);
  return out;
}

function pngChunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

// A 1-bit greyscale PNG: no canvas, no DOM, and small enough to send on
// WhatsApp. Pixels repeat by `scale` so the file is a usable size rather than
// one pixel per module.
export function qrPngBytes(matrix, options = {}) {
  const quiet = options.quiet == null ? 4 : options.quiet;
  const scale = options.scale == null ? 8 : options.scale;
  const n = matrix.length;
  const side = (n + quiet * 2) * scale;
  const rowBytes = Math.ceil(side / 8);

  const raw = [];
  for (let y = 0; y < side; y++) {
    const row = Math.floor(y / scale) - quiet;
    raw.push(0); // filter: none
    for (let byte = 0; byte < rowBytes; byte++) {
      let value = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byte * 8 + bit;
        const col = Math.floor(x / scale) - quiet;
        const inside = row >= 0 && row < n && col >= 0 && col < n;
        // 1 is white and 0 is black in a 1-bit greyscale PNG.
        const dark = inside && matrix[row][col] === true;
        if (!dark) value |= 0x80 >> bit;
      }
      raw.push(value);
    }
  }

  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, side);
  view.setUint32(4, side);
  header[8] = 1;  // bit depth
  header[9] = 0;  // greyscale
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", new Uint8Array(zlibStored(raw))),
    pngChunk("IEND", new Uint8Array(0)),
  ];
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const file = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    file.set(part, at);
    at += part.length;
  }
  return file;
}
