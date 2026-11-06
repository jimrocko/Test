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
  return out;
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

/** Paints the mask as a glowing tint into an overlay canvas (live preview). */
export function drawMaskOverlay(overlay, mask, color = [255, 214, 0]) {
  const { width, height, data } = mask;
  overlay.width = width;
  overlay.height = height;
  const ctx = overlay.getContext("2d");
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < data.length; i++) {
    const c = data[i];
    if (c > 0.5) {
      img.data[i * 4] = color[0];
      img.data[i * 4 + 1] = color[1];
      img.data[i * 4 + 2] = color[2];
      img.data[i * 4 + 3] = 110;
    }
  }
  ctx.putImageData(img, 0, 0);
}
