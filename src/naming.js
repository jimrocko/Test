// Free, on-device extras instead of an AI: a name suggestion from the
// sticker's main colour and a random rarity roll (like opening a booster pack).

export const RARITIES = ["gewöhnlich", "selten", "episch", "legendär"];
const WEIGHTS = [60, 25, 12, 3]; // percent

export function rollRarity() {
  let r = Math.random() * 100;
  for (let i = 0; i < RARITIES.length; i++) {
    if ((r -= WEIGHTS[i]) < 0) return RARITIES[i];
  }
  return RARITIES[0];
}

const HUES = [
  [15, "Roter"], [40, "Oranger"], [65, "Gelber"], [160, "Grüner"], [195, "Türkiser"],
  [255, "Blauer"], [290, "Lila"], [335, "Pinker"], [360, "Roter"],
];

/** "Blauer Sticker", "Schwarz-weißer Sticker", … based on the dominant colour. */
export function suggestName(canvas) {
  const size = 48;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(canvas, 0, 0, size, size);
  const px = ctx.getImageData(0, 0, size, size).data;

  const bins = new Map();
  let grey = 0, dark = 0, light = 0, total = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue; // transparent background
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2, d = max - min;
    total++;
    if (d < 0.15) {
      grey++;
      if (l < 0.3) dark++;
      if (l > 0.75) light++;
      continue;
    }
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    const name = HUES.find(([lim]) => h < lim)[1];
    bins.set(name, (bins.get(name) ?? 0) + d);
  }
  if (!total) return "Neuer Sticker";
  if (grey / total > 0.7) {
    if (dark / total > 0.2 && light / total > 0.2) return "Schwarz-weißer Sticker";
    return dark > light ? "Schwarzer Sticker" : "Weißer Sticker";
  }
  const best = [...bins].sort((a, b) => b[1] - a[1])[0];
  return `${best[0]} Sticker`;
}
