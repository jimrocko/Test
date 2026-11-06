// Turns a sticker into a shareable trading-card image (PNG), drawn on a canvas.
const RARITY_COLORS = {
  gewöhnlich: "#9aa1b2",
  selten: "#4da3ff",
  episch: "#b469ff",
  legendär: "#ffb000",
};

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function fitText(ctx, text, maxWidth, size, weight = 800) {
  let s = size;
  do ctx.font = `${weight} ${s}px -apple-system, "SF Pro Rounded", "Segoe UI", Roboto, sans-serif`;
  while (ctx.measureText(text).width > maxWidth && --s > 16);
}

export async function renderCard(sticker) {
  const W = 750, H = 1050;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d");
  const color = RARITY_COLORS[sticker.seltenheit] ?? RARITY_COLORS.gewöhnlich;
  const holo = sticker.seltenheit === "episch" || sticker.seltenheit === "legendär";

  // Outer frame in rarity colour
  roundRect(ctx, 0, 0, W, H, 48);
  ctx.fillStyle = color;
  ctx.fill();
  // Inner card
  roundRect(ctx, 24, 24, W - 48, H - 48, 32);
  ctx.fillStyle = "#1b1e26";
  ctx.fill();

  // Header: number + rarity
  ctx.fillStyle = "#9aa1b2";
  ctx.font = "800 34px -apple-system, Roboto, sans-serif";
  ctx.textBaseline = "top";
  ctx.fillText(`#${String(sticker.nr).padStart(3, "0")}`, 60, 60);
  const rarity = sticker.seltenheit ?? "gewöhnlich";
  ctx.font = "800 28px -apple-system, Roboto, sans-serif";
  const rw = ctx.measureText(rarity).width + 36;
  roundRect(ctx, W - 60 - rw, 56, rw, 44, 22);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = "#111";
  ctx.textAlign = "center";
  ctx.fillText(rarity.charAt(0).toUpperCase() + rarity.slice(1), W - 60 - rw / 2, 64);

  // Picture area
  const px = 60, py = 130, pw = W - 120, ph = 560;
  roundRect(ctx, px, py, pw, ph, 28);
  const grad = ctx.createRadialGradient(W / 2, py + ph / 2, 20, W / 2, py + ph / 2, ph / 1.2);
  grad.addColorStop(0, "#343b4d");
  grad.addColorStop(1, "#14161c");
  ctx.fillStyle = grad;
  ctx.fill();
  if (holo) {
    ctx.save();
    ctx.clip();
    ctx.globalAlpha = 0.35;
    const h = ctx.createLinearGradient(px, py, px + pw, py + ph);
    ["#ff6ec4", "#7873f5", "#4ade80", "#facc15", "#ff6ec4"].forEach((col, i, a) => h.addColorStop(i / (a.length - 1), col));
    ctx.fillStyle = h;
    ctx.fillRect(px, py, pw, ph);
    ctx.restore();
  }

  // Sticker with white die-cut edge + shadow
  const img = await createImageBitmap(sticker.image);
  const scale = Math.min((pw - 90) / img.width, (ph - 90) / img.height);
  const iw = img.width * scale, ih = img.height * scale;
  const ix = W / 2 - iw / 2, iy = py + ph / 2 - ih / 2;
  const edge = document.createElement("canvas");
  edge.width = Math.ceil(iw + 24);
  edge.height = Math.ceil(ih + 24);
  const ectx = edge.getContext("2d");
  for (let a = 0; a < 360; a += 30) {
    const r = (a * Math.PI) / 180;
    ectx.drawImage(img, 12 + Math.cos(r) * 6, 12 + Math.sin(r) * 6, iw, ih);
  }
  ectx.globalCompositeOperation = "source-in";
  ectx.fillStyle = "#fff";
  ectx.fillRect(0, 0, edge.width, edge.height);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.5)";
  ctx.shadowBlur = 30;
  ctx.shadowOffsetY = 14;
  ctx.drawImage(edge, ix - 12, iy - 12);
  ctx.restore();
  ctx.drawImage(img, ix, iy, iw, ih);

  // Name
  ctx.textAlign = "left";
  ctx.fillStyle = "#f4f5f8";
  fitText(ctx, sticker.name, W - 120, 60);
  ctx.fillText(sticker.name, 60, 730);

  // Note (max 3 lines)
  if (sticker.notiz) {
    ctx.fillStyle = "#c9cdd6";
    ctx.font = "500 30px -apple-system, Roboto, sans-serif";
    const words = sticker.notiz.split(/\s+/);
    let line = "", y = 815, lines = 0;
    for (const w of words) {
      const test = line ? `${line} ${w}` : w;
      if (ctx.measureText(test).width > W - 120 && line) {
        ctx.fillText(line, 60, y);
        y += 40;
        line = w;
        if (++lines === 2) break;
      } else line = test;
    }
    if (lines < 3 && line) ctx.fillText(line, 60, y);
  }

  // Footer
  ctx.fillStyle = "#9aa1b2";
  ctx.font = "600 26px -apple-system, Roboto, sans-serif";
  const date = new Date(sticker.createdAt).toLocaleDateString("de-DE", { day: "numeric", month: "long", year: "numeric" });
  ctx.fillText(`Gefunden am ${date}${sticker.count > 1 ? `  ·  ×${sticker.count}` : ""}`, 60, H - 100);
  ctx.textAlign = "right";
  ctx.fillStyle = color;
  ctx.font = "900 26px -apple-system, Roboto, sans-serif";
  ctx.fillText("STICKERDEX", W - 60, H - 100);

  return new Promise((r) => c.toBlob(r, "image/png"));
}

/** Opens the iOS share sheet with the card, or downloads it as a fallback. */
export async function shareCard(sticker) {
  const blob = await renderCard(sticker);
  const fileName = `stickerdex-${String(sticker.nr).padStart(3, "0")}.png`;
  const file = new File([blob], fileName, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: sticker.name, text: `Neu in meinem Stickerdex: ${sticker.name}` });
      return "shared";
    } catch (err) {
      if (err.name === "AbortError") return "cancelled";
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return "downloaded";
}
