// Copies the MediaPipe WASM runtime and downloads the segmentation model into
// public/vendor so the app can run (and be cached) without third-party CDNs.
import { cp, mkdir, stat, writeFile } from "node:fs/promises";

const out = new URL("../public/vendor/", import.meta.url);
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/interactive_segmenter/magic_touch/float32/1/magic_touch.tflite";

await mkdir(out, { recursive: true });
await mkdir(new URL("wasm/", out), { recursive: true });
for (const f of ["vision_wasm_internal.js", "vision_wasm_internal.wasm"]) {
  await cp(new URL(`../node_modules/@mediapipe/tasks-vision/wasm/${f}`, import.meta.url), new URL(`wasm/${f}`, out));
}

const modelFile = new URL("magic_touch.tflite", out);
const exists = await stat(modelFile).then((s) => s.size > 0, () => false);
if (!exists) {
  console.log("Lade Segmentierungsmodell …");
  const res = await fetch(MODEL_URL);
  if (!res.ok) throw new Error(`Modell-Download fehlgeschlagen: ${res.status}`);
  await writeFile(modelFile, Buffer.from(await res.arrayBuffer()));
}
console.log("Assets bereit in public/vendor/");
