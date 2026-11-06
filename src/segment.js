// Sticker detection + cut-out, fully on-device with MediaPipe's
// interactive segmenter ("magic touch"): we "tap" the centre of the frame and
// the model returns a mask of the object under that point.
import { FilesetResolver, InteractiveSegmenterLegacy } from "@mediapipe/tasks-vision";

// WASM runtime + model come from public CDNs (cached by the service worker).
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";
const CENTER = { keypoint: { x: 0.5, y: 0.5 } };

let segmenterPromise = null;

export function loadSegmenter() {
  if (!segmenterPromise) {
    segmenterPromise = (async () => {
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      const create = (delegate) =>
        InteractiveSegmenterLegacy.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          outputCategoryMask: false,
          outputConfidenceMasks: true,
        });
      try {
        return await create("GPU");
      } catch (err) {
        console.warn("GPU-Delegate nicht verfügbar, nutze CPU", err);
        return await create("CPU");
      }
    })();
    segmenterPromise.catch(() => (segmenterPromise = null));
  }
  return segmenterPromise;
}

/**
 * Runs the segmenter on a canvas and returns the foreground confidence
 * (0..1 per pixel, same size as the canvas).
 */
export async function segmentCenter(canvas) {
  const seg = await loadSegmenter();
  const result = seg.segment(canvas, CENTER);
  const masks = result.confidenceMasks ?? [];
  // The last mask is the foreground ("selected object") confidence.
  const mask = masks[masks.length - 1];
  const data = Float32Array.from(mask.getAsFloat32Array());
  const out = { data, width: mask.width, height: mask.height };
  masks.forEach((m) => m.close());
  return refineMask(out);
}

/**
 * Cleans up the raw model output so the sticker comes out as one solid piece:
 * 1. keep only the blob under (or nearest to) the centre – drops stray specks
 * 2. fill holes inside it (text, logos, shiny spots the model left out)
 * 3. light blur for a smooth, anti-aliased edge
 */
export function refineMask(mask, threshold = 0.5) {
  const { data, width: w, height: h } = mask;
  const n = w * h;
  const fg = new Uint8Array(n);
  for (let i = 0; i < n; i++) fg[i] = data[i] > threshold ? 1 : 0;

  // 1. Seed: centre pixel, or the closest foreground pixel within 15 % of the frame.
  const cx = w >> 1, cy = h >> 1;
  let seed = -1;
  const maxR = Math.round(Math.min(w, h) * 0.15);
  for (let r = 0; r <= maxR && seed < 0; r++) {
    for (let dy = -r; dy <= r && seed < 0; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const i = (cy + dy) * w + (cx + dx);
        if (fg[i]) {
          seed = i;
          break;
        }
      }
    }
  }
  const region = new Uint8Array(n);
  if (seed < 0) return { data: new Float32Array(n), width: w, height: h };

  // Flood fill the centre blob.
  const stack = [seed];
  region[seed] = 1;
  while (stack.length) {
    const i = stack.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0 && fg[i - 1] && !region[i - 1]) (region[i - 1] = 1), stack.push(i - 1);
    if (x < w - 1 && fg[i + 1] && !region[i + 1]) (region[i + 1] = 1), stack.push(i + 1);
    if (y > 0 && fg[i - w] && !region[i - w]) (region[i - w] = 1), stack.push(i - w);
    if (y < h - 1 && fg[i + w] && !region[i + w]) (region[i + w] = 1), stack.push(i + w);
  }

  // 2. Everything outside the blob that can't be reached from the image border is a hole → fill it.
  const outside = new Uint8Array(n);
  const q = [];
  const push = (i) => {
    if (!region[i] && !outside[i]) {
      outside[i] = 1;
      q.push(i);
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (q.length) {
    const i = q.pop();
    const x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }

  // 3. Solid inside, soft 1–2 px edge.
  const solid = new Float32Array(n);
  for (let i = 0; i < n; i++) solid[i] = outside[i] ? 0 : 1;
  const out = new Float32Array(n);
  const k = Math.max(1, Math.round(Math.max(w, h) / 500));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, cnt = 0;
      for (let dy = -k; dy <= k; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -k; dx <= k; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          sum += solid[yy * w + xx];
          cnt++;
        }
      }
      out[y * w + x] = sum / cnt;
    }
  }
  return { data: out, width: w, height: h };
}

/** Bounding box + coverage of mask pixels above a threshold. */
export function maskStats(mask, threshold = 0.5) {
  const { data, width, height } = mask;
  let minX = width, minY = height, maxX = -1, maxY = -1, count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[y * width + x] > threshold) {
        count++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const coverage = count / (width * height);
  return { minX, minY, maxX, maxY, coverage, found: count > 0 };
}

/** A detection is plausible if it's neither a speck nor the whole frame. */
export function isPlausible(stats) {
  return stats.found && stats.coverage > 0.01 && stats.coverage < 0.85;
}

/**
 * Cuts the masked object out of `source` (same size as the mask) and returns
 * a tightly cropped canvas with a transparent background.
 */
export function cutout(source, mask, stats) {
  const { width, height, data } = mask;
  const pad = Math.round(Math.max(width, height) * 0.01);
  const x0 = Math.max(0, stats.minX - pad);
  const y0 = Math.max(0, stats.minY - pad);
  const x1 = Math.min(width - 1, stats.maxX + pad);
  const y1 = Math.min(height - 1, stats.maxY + pad);
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;

  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  ctx.drawImage(source, x0, y0, w, h, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = data[(y + y0) * width + (x + x0)];
      // Soft edge: ramp alpha between 0.35 and 0.65 confidence.
      const a = Math.min(1, Math.max(0, (c - 0.35) / 0.3));
      img.data[(y * w + x) * 4 + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

/** Fallback when nothing sensible was detected: centre square crop. */
export function centerCrop(source, fraction = 0.6) {
  const size = Math.round(Math.min(source.width, source.height) * fraction);
  const out = document.createElement("canvas");
  out.width = out.height = size;
  out
    .getContext("2d")
    .drawImage(source, (source.width - size) / 2, (source.height - size) / 2, size, size, 0, 0, size, size);
  return out;
}

/**
 * Draws just a clean outline around the detected sticker into the overlay
 * canvas (live preview). The glow comes from a CSS drop-shadow.
 */
export function drawOutline(overlay, mask, thickness = 3) {
  const { width: w, height: h, data } = mask;
  const m = document.createElement("canvas");
  m.width = w;
  m.height = h;
  const mctx = m.getContext("2d");
  const img = mctx.createImageData(w, h);
  for (let i = 0; i < data.length; i++) {
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = Math.round(Math.min(1, data[i] * 1.6) * 255);
  }
  mctx.putImageData(img, 0, 0);

  const dpr = window.devicePixelRatio || 1;
  const W = Math.round(overlay.clientWidth * dpr), H = Math.round(overlay.clientHeight * dpr);
  if (overlay.width !== W || overlay.height !== H) {
    overlay.width = W;
    overlay.height = H;
  }
  const ctx = overlay.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  ctx.imageSmoothingEnabled = true;
  ctx.globalCompositeOperation = "source-over";
  // Grow the shape a bit in every direction …
  const r = thickness * dpr;
  for (let a = 0; a < 360; a += 20) {
    const t = (a * Math.PI) / 180;
    ctx.drawImage(m, Math.cos(t) * r, Math.sin(t) * r, W, H);
  }
  // … then punch the shape itself out again → only the ring remains.
  ctx.globalCompositeOperation = "destination-out";
  ctx.drawImage(m, 0, 0, W, H);
  ctx.globalCompositeOperation = "source-over";
}
