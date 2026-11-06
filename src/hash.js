// Duplicate detection without any server:
// 1. colour histogram, which doesn't care about rotation at all
// 2. "difference hash" of the shape/contrast, checked in 4 rotations
const SIZE = 16;
const DUPE_MIN_SIM = 0.7; // 16x16 grid → 256-bit hash (stored as hex)

function draw(canvas, w, h, rotation = 0) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff"; // transparent background → white, like the sticker paper
  ctx.fillRect(0, 0, w, h);
  ctx.translate(w / 2, h / 2);
  ctx.rotate((rotation * Math.PI) / 180);
  const swap = rotation % 180 !== 0;
  const dw = swap ? h : w, dh = swap ? w : h;
  ctx.drawImage(canvas, -dw / 2, -dh / 2, dw, dh);
  return ctx.getImageData(0, 0, w, h).data;
}

export function dHash(canvas, rotation = 0) {
  const px = draw(canvas, SIZE + 1, SIZE, rotation);
  const lum = (x, y) => {
    const i = (y * (SIZE + 1) + x) * 4;
    return px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
  };
  let bits = "";
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) bits += lum(x, y) > lum(x + 1, y) ? "1" : "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Hashes of the sticker turned by 0°, 90°, 180° and 270°. */
export const rotatedHashes = (canvas) => [0, 90, 180, 270].map((r) => dHash(canvas, r));

/** 8×8×8 colour histogram of the non-transparent pixels, normalised to sum 1. */
export function colorHistogram(canvas) {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;
  const hist = new Array(512).fill(0);
  let n = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue;
    hist[(px[i] >> 5) * 64 + (px[i + 1] >> 5) * 8 + (px[i + 2] >> 5)]++;
    n++;
  }
  return n ? hist.map((v) => v / n) : hist;
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

/** Histogram intersection: 1 = identical colours, 0 = nothing in common. */
export function histSimilarity(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += Math.min(a[i], b[i]);
  return s;
}

/**
 * Returns the existing sticker that most likely is the same one, or null.
 * `hashes` = rotatedHashes(newSticker), `hist` = colorHistogram(newSticker).
 */
export function findDuplicate(hashes, hist, stickers) {
  let best = null;
  for (const s of stickers) {
    // Entries from older versions (other histogram format) are skipped.
    if (!s.hash || s.hist?.length !== hist.length) continue;
    const d = Math.min(...hashes.map((h) => distance(h, s.hash)));
    const sim = histSimilarity(hist, s.hist);
    // The outline alone isn't enough (many stickers are rounded rectangles),
    // so the colours have to match too.
    const isDupe = sim >= DUPE_MIN_SIM && d <= 64;
    const score = sim - d / 256;
    if (isDupe && (!best || score > best.score)) best = { sticker: s, score };
  }
  return best?.sticker ?? null;
}
