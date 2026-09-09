// photo.js — shrink a phone photo into a small square-ish JPEG data URL for a
// customer profile. The app's whole state lives under one ~5 MB localStorage key
// and is embedded in every cloud snapshot/export, so a profile photo must be
// tiny: downscaled to fit 200 px and JPEG-compressed, it lands around 6–15 KB.
//
// Browser-only (FileReader + Image + canvas) — never imported from Node tests.

// Read a picked file and hand `cb(dataUrl)` a JPEG that fits inside `size` px
// (square canvas, centre-cropped so the dog's face fills the thumb). Hands null
// when the file isn't an image or can't be read — the caller keeps the old photo.
export function readPhoto(file, cb, size = 200) {
  if (!file || !/^image\//.test(file.type)) { cb(null); return; }
  const reader = new FileReader();
  reader.onerror = () => cb(null);
  reader.onload = () => {
    const img = new Image();
    img.onerror = () => cb(null);
    img.onload = () => {
      const side = Math.min(img.width, img.height);
      if (!side) { cb(null); return; }
      const canvas = document.createElement("canvas");
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext("2d");
      // Centre-crop to the square side before scaling, so a tall portrait
      // doesn't squash.
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      cb(canvas.toDataURL("image/jpeg", 0.72));
    };
    img.src = String(reader.result);
  };
  reader.readAsDataURL(file);
}
