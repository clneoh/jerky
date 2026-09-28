// photo.js — shrink a phone photo into a small JPEG data URL. Two jobs, and the
// difference between them matters:
//
//   readPhoto     a fixed box, centre-cropped to fill it. A customer's profile
//                 photo wants exactly this — one square, every time.
//   readPhotoFit  the photo's OWN shape, nothing trimmed. A product picture
//                 wants this: the shop draws it whole inside a fixed panel, so
//                 cropping here would be an invisible second crop.
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
// One number means a square, which is what a customer's profile photo wants.
export function readPhoto(file, cb, w = 200, h = w) {
  if (!file || !/^image\//.test(file.type)) { cb(null); return; }
  const outW = Math.max(1, Math.round(Number(w) || 200));
  const outH = Math.max(1, Math.round(Number(h) || outW));
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
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outW, outH);
      cb(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}

// Read a picked file and hand `cb(dataUrl)` a JPEG that keeps the photo's OWN
// width-to-height ratio. This is the one a product picture uses: nothing is
// trimmed off, so a tall portrait stays tall and a wide landscape stays wide,
// which is what you asked for after two versions of cropping her photos to
// a fixed shape. The shop draws the whole photo inside a fixed panel, so a crop
// here would be a second, invisible crop on top of that panel.
//
// Only the SIZE is reduced, and only if the photo is bigger than `maxEdge` on its
// longer side. The budget is what the old fixed crop used to guarantee by
// accident: these bytes ride in the single ~5 MB localStorage key that every
// snapshot and export carries, and they are sent to every customer on each shop
// load, so `THUMB_MAX` (storefront-fields.js) is a hard ceiling. A photo of a
// busy tray can be far heavier than a plain one at the same pixel count, which is
// why this steps the size DOWN and re-encodes rather than trusting one guess -
// and why the budget sits well under the ceiling rather than at it. The floor
// stops it shrinking forever on a photo that somehow stays heavy.
export function readPhotoFit(file, cb, maxEdge = 400, budget = 30000) {
  if (!file || !/^image\//.test(file.type)) { cb(null); return; }
  const cap = Math.max(1, Math.round(Number(maxEdge) || 400));
  const reader = new FileReader();
  reader.onerror = () => cb(null);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => cb(null);
    img.onload = () => {
      if (!img.width || !img.height) { cb(null); return; }
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      let scale = Math.min(1, cap / Math.max(img.width, img.height));
      let url = "";
      for (let i = 0; i < 6; i++) {
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        url = canvas.toDataURL("image/jpeg", 0.72);
        if (url.length <= budget || Math.max(canvas.width, canvas.height) <= 64) break;
        scale *= 0.8;
      }
      cb(url);
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}
