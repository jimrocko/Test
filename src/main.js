import "./style.css";
import * as db from "./db.js";
import { imageBlob } from "./db.js";
import { rotatedHashes, colorHistogram, findDuplicate } from "./hash.js";
import { suggestName, rollRarity } from "./naming.js";
import { renderMap, currentLocation } from "./map.js";
import { shareCard } from "./share.js";
import { loadSegmenter, segmentCenter, maskStats, isPlausible, cutout, centerCrop, drawOutline } from "./segment.js";

const $ = (id) => document.getElementById(id);
const video = $("video");
const overlay = $("overlay");
const frame = $("frame");
const hint = $("hint");

/* ---------------- Helpers ---------------- */

let toastTimer;
function toast(msg, ms = 2800) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), ms);
}

const pad = (n) => `#${String(n).padStart(3, "0")}`;
const canvasToBlob = (c) => new Promise((r) => c.toBlob(r, "image/png"));

const urlCache = new Map();
function imageUrl(sticker) {
  let url = urlCache.get(sticker.id);
  if (!url) {
    url = URL.createObjectURL(imageBlob(sticker));
    urlCache.set(sticker.id, url);
  }
  return url;
}

function metaPills(el, s) {
  el.innerHTML = "";
  const add = (text, cls = "") => {
    const p = document.createElement("span");
    p.className = `pill ${cls}`;
    p.textContent = text;
    el.append(p);
  };
  if (s.seltenheit) {
    add(s.seltenheit, "rarity");
    el.lastChild.dataset.rarity = s.seltenheit;
  }
  if (s.kategorie) add(s.kategorie);
  if (s.count > 1) add(`×${s.count}`);
}

const isHolo = (rarity) => rarity === "episch" || rarity === "legendär";

function setRarity(el, rarity) {
  if (rarity) el.dataset.rarity = rarity;
  else delete el.dataset.rarity;
}

/* ---------------- Tabs ---------------- */

let activeTab = "camera";
function showTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tabbar button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${tab}`));
  if (tab === "camera") startCamera();
  else {
    stopCamera();
    renderDex();
  }
}
document.querySelectorAll(".tabbar button").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));

/* ---------------- Camera ---------------- */

let stream = null;
async function startCamera() {
  if (stream) return;
  $("camera-error").classList.add("hidden");
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play().catch(() => {});
    $("shutter").disabled = false;
    scheduleLive();
  } catch (err) {
    console.error(err);
    stream = null;
    $("camera-error").classList.remove("hidden");
    $("shutter").disabled = true;
  }
}
function stopCamera() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  video.srcObject = null;
}
$("camera-retry").addEventListener("click", startCamera);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopCamera();
  else if (activeTab === "camera") startCamera();
});

/**
 * Draws exactly the part of the video that's visible on screen
 * (the <video> uses object-fit: cover) into a canvas of at most `max` px.
 */
function grabVisible(max) {
  const vw = video.videoWidth, vh = video.videoHeight;
  const ew = video.clientWidth, eh = video.clientHeight;
  if (!vw || !vh || !ew || !eh) return null;
  const scale = Math.max(ew / vw, eh / vh);
  const sw = ew / scale, sh = eh / scale;
  const sx = (vw - sw) / 2, sy = (vh - sh) / 2;
  const k = Math.min(1, max / Math.max(sw, sh));
  const c = document.createElement("canvas");
  c.width = Math.round(sw * k);
  c.height = Math.round(sh * k);
  c.getContext("2d").drawImage(video, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}

/* Live preview: highlight the sticker in the middle a few times per second. */
let liveTimer = null;
let liveBusy = false;
let segmenterReady = false;

/* Auto-Auslöser: fires when the sticker has been held still for a moment. */
const AUTO_HOLD_MS = 1200;
let autoOn = localStorage.getItem("stickerdex.auto") !== "off";
let lastBox = null;
let stableSince = 0;
let autoBlockedUntil = 0;
function setAutoProgress(p) {
  $("shutter").style.setProperty("--progress", `${Math.round(p * 100)}%`);
  $("shutter").classList.toggle("charging", p > 0);
}
function updateAutoButton() {
  $("auto-toggle").textContent = autoOn ? "AUTO an" : "AUTO aus";
  $("auto-toggle").classList.toggle("on", autoOn);
}
$("auto-toggle").addEventListener("click", () => {
  autoOn = !autoOn;
  localStorage.setItem("stickerdex.auto", autoOn ? "on" : "off");
  updateAutoButton();
  stableSince = 0;
  setAutoProgress(0);
  toast(autoOn ? "Auto-Auslöser an: Sticker kurz ruhig halten" : "Auto-Auslöser aus");
});
updateAutoButton();

/** Same spot and size as last frame (within ~6 % of the frame)? */
function isSteady(box, w, h) {
  const prev = lastBox;
  lastBox = box;
  if (!prev) return false;
  const tol = 0.06;
  return (
    Math.abs(box.minX - prev.minX) / w < tol &&
    Math.abs(box.maxX - prev.maxX) / w < tol &&
    Math.abs(box.minY - prev.minY) / h < tol &&
    Math.abs(box.maxY - prev.maxY) / h < tol
  );
}
function scheduleLive() {
  clearTimeout(liveTimer);
  liveTimer = setTimeout(liveTick, segmenterReady ? 300 : 50);
}
async function liveTick() {
  if (!stream || activeTab !== "camera" || !$("catch").classList.contains("hidden") || liveBusy) {
    if (stream) scheduleLive();
    return;
  }
  liveBusy = true;
  try {
    if (!segmenterReady) {
      hint.textContent = "Sticker-Erkennung lädt …";
      await loadSegmenter();
      segmenterReady = true;
      hint.textContent = "Sticker in die Mitte halten";
    }
    const c = grabVisible(320);
    if (c) {
      const mask = await segmentCenter(c);
      const stats = maskStats(mask);
      const ok = isPlausible(stats);
      if (ok) drawOutline(overlay, mask);
      overlay.style.opacity = ok ? "1" : "0";
      frame.classList.toggle("locked", ok);
      hint.classList.toggle("locked", ok);
      hint.textContent = ok ? (autoOn ? "Sticker erkannt – ruhig halten ✨" : "Sticker erkannt ✨") : "Sticker in die Mitte halten";

      const now = Date.now();
      if (ok && autoOn && now > autoBlockedUntil && isSteady(stats, mask.width, mask.height)) {
        stableSince ||= now;
        const progress = Math.min(1, (now - stableSince) / AUTO_HOLD_MS);
        setAutoProgress(progress);
        if (progress >= 1) {
          stableSince = 0;
          setAutoProgress(0);
          liveBusy = false;
          capture();
        }
      } else {
        if (!ok) lastBox = null;
        stableSince = 0;
        setAutoProgress(0);
      }
    }
  } catch (err) {
    console.error(err);
    hint.textContent = "Erkennung nicht verfügbar – Foto geht trotzdem";
    await new Promise((r) => setTimeout(r, 3000)); // back off before retrying
  } finally {
    liveBusy = false;
    if (stream) scheduleLive();
  }
}

/* ---------------- Capture ---------------- */

let current = null; // { canvas, hashes, hist, duplicate, rarity }
let capturing = false;

$("shutter").addEventListener("click", () => capture());

async function capture() {
  if (capturing || !$("catch").classList.contains("hidden")) return;
  capturing = true;
  try {
    await doCapture();
  } finally {
    capturing = false;
  }
}

async function doCapture() {
  const shot = grabVisible(1024);
  if (!shot) return;
  // Ask for the location right away (in parallel), it's saved as the Fundort.
  const locationPromise = currentLocation();
  const flash = document.createElement("div");
  flash.className = "flash";
  $("view-camera").append(flash);
  setTimeout(() => flash.remove(), 400);
  $("shutter").disabled = true;

  let sticker;
  try {
    // Wait for any running live-preview pass so we don't run the model twice at once.
    while (liveBusy) await new Promise((r) => setTimeout(r, 20));
    liveBusy = true;
    const mask = await segmentCenter(shot);
    const stats = maskStats(mask);
    if (isPlausible(stats)) sticker = cutout(shot, mask, stats);
  } catch (err) {
    console.error(err);
  } finally {
    liveBusy = false;
  }
  if (!sticker) {
    sticker = centerCrop(shot);
    toast("Kein Sticker erkannt – ich nehme den Ausschnitt in der Mitte.");
  }
  $("shutter").disabled = false;

  const hashes = rotatedHashes(sticker);
  const hist = colorHistogram(sticker);
  const duplicate = findDuplicate(hashes, hist, await db.getAll());
  current = { canvas: sticker, hashes, hist, duplicate, rarity: rollRarity(), locationPromise };
  showCatch();
}

function showCatch() {
  const { canvas, duplicate, rarity } = current;
  $("catch-img").src = canvas.toDataURL("image/png");
  $("catch-new-anyway").classList.toggle("hidden", !duplicate);
  $("catch-name").classList.toggle("hidden", !duplicate);
  $("catch-name-input").classList.toggle("hidden", !!duplicate);
  const badge = $("catch-badge");
  const shown = duplicate ? { ...duplicate, count: duplicate.count + 1 } : { seltenheit: rarity };
  if (duplicate) {
    badge.textContent = `Schon im Dex! ${pad(duplicate.nr)}`;
    badge.classList.add("dupe");
    $("catch-name").textContent = duplicate.name;
    $("catch-desc").textContent = duplicate.notiz ?? "";
    $("catch-keep").textContent = "Duplikat zählen (+1)";
  } else {
    badge.textContent = "Neuer Sticker!";
    badge.classList.remove("dupe");
    $("catch-name-input").value = suggestName(canvas);
    $("catch-desc").textContent = "";
    $("catch-keep").textContent = "Einsammeln ✨";
  }
  metaPills($("catch-meta"), shown);
  $("catch-meta").querySelector(".rarity")?.classList.add("reveal");
  setRarity($("catch-card"), shown.seltenheit);
  $("catch-stage").classList.toggle("holo", isHolo(shown.seltenheit));
  $("catch").classList.remove("hidden");
}

function closeCatch() {
  $("catch").classList.add("hidden");
  current = null;
  // Don't auto-capture the same sticker again right away.
  autoBlockedUntil = Date.now() + 2500;
  lastBox = null;
}

$("catch-retry").addEventListener("click", closeCatch);

$("catch-new-anyway").addEventListener("click", () => {
  current.duplicate = null;
  showCatch();
});

$("catch-keep").addEventListener("click", async () => {
  const cur = current;
  if (!cur) return;
  const name = $("catch-name-input").value.trim() || suggestName(cur.canvas);
  closeCatch();
  let record;
  try {
    if (cur.duplicate) {
      const s = await db.get(cur.duplicate.id);
      s.count += 1;
      await db.put(s);
      toast(`${s.name} ×${s.count} 🎉`);
      return;
    }
    const imageData = await (await canvasToBlob(cur.canvas)).arrayBuffer();
    record = await db.add({ imageData, imageType: "image/png", hash: cur.hashes[0], hist: cur.hist, name, seltenheit: cur.rarity });
    toast(`${pad(record.nr)} ${record.name} eingesammelt! ✨`);
  } catch (err) {
    console.error(err);
    toast(`Speichern fehlgeschlagen: ${err?.message ?? err}`, 6000);
    return;
  }
  const location = await cur.locationPromise;
  if (location) {
    const fresh = await db.get(record.id);
    if (fresh) await db.put({ ...fresh, location });
  }
});

$("catch-name-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") e.target.blur();
});

/* ---------------- Dex ---------------- */

let dexMode = "grid";
document.querySelectorAll("#dex-mode button").forEach((b) =>
  b.addEventListener("click", () => {
    dexMode = b.dataset.mode;
    renderDex();
  }),
);

async function renderDex(focusId = null) {
  const stickers = (await db.getAll()).sort((a, b) => a.nr - b.nr);
  document.querySelectorAll("#dex-mode button").forEach((b) => b.classList.toggle("active", b.dataset.mode === dexMode));
  const onMap = dexMode === "map";
  $("view-dex").classList.toggle("map-mode", onMap);
  $("grid").classList.toggle("hidden", onMap);
  $("map-wrap").classList.toggle("hidden", !onMap);
  if (onMap) {
    const n = await renderMap($("map"), stickers, imageUrl, openDetail, focusId);
    $("map-empty").classList.toggle("hidden", n > 0);
  }
  const grid = $("grid");
  grid.innerHTML = "";
  const total = stickers.reduce((n, s) => n + s.count, 0);
  $("dex-count").textContent =
    stickers.length === 1 ? "1 Sticker gesammelt" : `${stickers.length} Sticker gesammelt`;
  const dupes = total - stickers.length;
  if (dupes > 0) $("dex-count").textContent += ` · ${dupes} ${dupes === 1 ? "Duplikat" : "Duplikate"}`;
  $("empty").classList.toggle("hidden", stickers.length > 0 || onMap);
  for (const s of stickers) {
    const card = document.createElement("button");
    card.className = "card";
    setRarity(card, s.seltenheit);
    card.innerHTML = `<span class="nr"></span><img class="die-cut" alt="" loading="lazy" /><span class="name"></span>`;
    card.querySelector(".nr").textContent = pad(s.nr);
    card.querySelector("img").src = imageUrl(s);
    card.querySelector(".name").textContent = s.name;
    if (s.count > 1) {
      const d = document.createElement("span");
      d.className = "dupes";
      d.textContent = `×${s.count}`;
      card.append(d);
    }
    card.addEventListener("click", () => openDetail(s.id));
    grid.append(card);
  }
}

let detailId = null;
async function openDetail(id) {
  const s = await db.get(id);
  if (!s) return;
  detailId = id;
  $("detail-nr").textContent = pad(s.nr);
  $("detail-img").src = imageUrl(s);
  $("detail-name").textContent = s.name;
  metaPills($("detail-meta"), s);
  $("detail-desc").textContent = s.notiz ?? "";
  $("detail-fun").textContent = "";
  $("detail-found").textContent = `Gefunden am ${new Date(s.createdAt).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
  $("detail-stage").classList.toggle("holo", isHolo(s.seltenheit));
  $("detail-map").classList.toggle("hidden", !s.location);
  $("detail").classList.remove("hidden");
}

$("detail-share").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const result = await shareCard(await db.get(detailId));
    if (result === "downloaded") toast("Sammelkarte gespeichert 🃏");
  } catch (err) {
    console.error(err);
    toast("Teilen hat nicht geklappt.");
  } finally {
    btn.disabled = false;
  }
});

$("detail-map").addEventListener("click", () => {
  $("detail").classList.add("hidden");
  dexMode = "map";
  renderDex(detailId);
});

$("detail-name").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    e.target.blur();
  }
});
$("detail-name").addEventListener("blur", async (e) => {
  const name = e.target.textContent.trim();
  const s = await db.get(detailId);
  if (s && name && name !== s.name) {
    await db.put({ ...s, name });
    renderDex();
  }
});

$("detail-desc").addEventListener("blur", async (e) => {
  const notiz = e.target.textContent.trim();
  const s = await db.get(detailId);
  if (s && notiz !== (s.notiz ?? "")) await db.put({ ...s, notiz });
});

$("detail-delete").addEventListener("click", async () => {
  const s = await db.get(detailId);
  if (!confirm(`${pad(s.nr)} ${s.name} wirklich löschen?`)) return;
  await db.remove(s.id);
  $("detail").classList.add("hidden");
  renderDex();
});

/* Close sheets via ✕ or tapping the backdrop */
document.querySelectorAll(".sheet-backdrop").forEach((bd) => {
  bd.addEventListener("click", (e) => {
    if (e.target === bd || e.target.closest("[data-close]")) {
      if (bd.id === "catch") closeCatch();
      else bd.classList.add("hidden");
    }
  });
});

/* ---------------- Boot ---------------- */

if ("serviceWorker" in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register("./sw.js").catch(console.error);
}
navigator.storage?.persist?.();
showTab("camera");
loadSegmenter().catch(console.error);
