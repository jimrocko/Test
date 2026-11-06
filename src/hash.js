// Perceptual "difference hash" for duplicate detection. Two photos of the same
// sticker produce hashes with a small Hamming distance.
const SIZE = 16; // 16x16 grid → 256-bit hash (stored as hex)

export function dHash(canvas) {
  const c = document.createElement("canvas");
  c.width = SIZE + 1;
  c.height = SIZE;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; // transparent background → white, like the sticker paper
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(canvas, 0, 0, c.width, c.height);
  const px = ctx.getImageData(0, 0, c.width, c.height).data;
  const lum = (x, y) => {
    const i = (y * c.width + x) * 4;
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  };
  let bits = "";
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) bits += lum(x, y) > lum(x + 1, y) ? "1" : "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

export function distance(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/** Returns the closest existing sticker if it is likely the same one. */
export function findDuplicate(hash, stickers, maxDistance = 40) {
  let best = null;
  for (const s of stickers) {
    if (!s.hash) continue;
    const d = distance(hash, s.hash);
    if (d <= maxDistance && (!best || d < best.d)) best = { sticker: s, d };
  }
  return best?.sticker ?? null;
}
