// photo.js — shrink a phone photo into a small JPEG data URL, cropped to a
// SQUARE. Every picture the app keeps is square: a customer's profile photo (a
// face, 200 px) and a product picture (the shop's window, 360 px). The crop is
// the point now — you asked for the product window to be square and for your
// photo to be cropped to fit it — so nothing here keeps a photo's own shape. It
// was the other way round for v220-v223 (see CLAUDE.md, 2026-09-28).
//
// The app's whole state lives under one ~5 MB localStorage key and is embedded in
// every cloud snapshot and export, so any picture it keeps must be small:
// downscaled and JPEG-compressed, and held under a byte budget rather than left
// to chance.
//
// Browser-only (FileReader + Image + canvas) — never imported from Node tests.

// Read a picked file and hand `cb(dataUrl)` a JPEG of exactly `w` x `h` px,
// centre-cropped so the subject fills the box. Hands null when the file isn't an
// image or can't be read — the caller keeps the old photo.
//
// One number means a square: `readPhoto(f, cb)` is a 200 px avatar, and
// `readPhoto(f, cb, 360)` is the shop's product window.
//
// The byte budget is the second half of the job, and it is not decoration. These
// bytes ride in the single ~5 MB localStorage key that every snapshot and export
// carries, and they are sent to every customer on each shop load, so `THUMB_MAX`
// (storefront-fields.js) is a hard ceiling — a picture over it is DROPPED from
// the shop rather than published broken, which would look like the photo simply
// never arrived. A square at 360 px is well under it for a plain photo but a busy
// one (a full tray, a crumb close-up) can be several times heavier at the same
// pixel count, so this steps the SIZE down and re-encodes rather than trusting
// one guess. The floor stops it shrinking forever on a photo that somehow stays
// heavy.
export function readPhoto(file, cb, w = 200, h = w, budget = 30000) {
  if (!file || !/^image\//.test(file.type)) { cb(null); return; }
  const outW = Math.max(1, Math.round(Number(w) || 200));
  const outH = Math.max(1, Math.round(Number(h) || outW));
  const cap = Number(budget) > 0 ? Number(budget) : Infinity;
  const reader = new FileReader();
  reader.onerror = () => cb(null);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => cb(null);
    img.onload = () => {
      if (!img.width || !img.height) { cb(null); return; }
      // Cover, not contain: crop the source to the box's RATIO first, centred,
      // then scale that strip down. Cropping before scaling is what keeps a tall
      // portrait from squashing into the box.
      const ratio = outW / outH;
      let sw = img.width;
      let sh = img.height;
      if (img.width / img.height > ratio) sw = img.height * ratio;   // source too wide — trim the sides
      else sh = img.width / ratio;                                   // source too tall — trim the top and bottom
      const sx = (img.width - sw) / 2;
      const sy = (img.height - sh) / 2;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      // The source rectangle never moves as the box shrinks, so every pass shows
      // the same part of the photo — only at a lower resolution.
      let scale = 1;
      let url = "";
      for (let i = 0; i < 6; i++) {
        const cw = Math.max(1, Math.round(outW * scale));
        const ch = Math.max(1, Math.round(outH * scale));
        canvas.width = cw;
        canvas.height = ch;
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
        url = canvas.toDataURL("image/jpeg", 0.72);
        if (url.length <= cap || Math.max(cw, ch) <= 64) break;
        scale *= 0.8;
      }
      cb(url);
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}
