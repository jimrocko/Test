import "./style.css";
import * as db from "./db.js";
import { dHash, findDuplicate } from "./hash.js";
import { describeSticker, describeError, settings, MODELS } from "./ai.js";
import { loadSegmenter, segmentCenter, maskStats, isPlausible, cutout, centerCrop, drawMaskOverlay } from "./segment.js";

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
async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  return c;
}

const urlCache = new Map();
function imageUrl(sticker) {
  let entry = urlCache.get(sticker.id);
  if (!entry || entry.blob !== sticker.image) {
    if (entry) URL.revokeObjectURL(entry.url);
    entry = { blob: sticker.image, url: URL.createObjectURL(sticker.image) };
    urlCache.set(sticker.id, entry);
  }
  return entry.url;
}

function metaPills(el, s) {
  el.innerHTML = "";
  const add = (text, cls = "") => {
    const p = document.createElement("span");
    p.className = `pill ${cls}`;
    p.textContent = text;
    el.append(p);
  };
  if (s.seltenheit) add(s.seltenheit, "rarity");
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
    const c = grabVisible(256);
    if (c) {
      const mask = await segmentCenter(c);
      const ok = isPlausible(maskStats(mask));
      if (ok) drawMaskOverlay(overlay, mask);
      overlay.style.opacity = ok ? "1" : "0";
      frame.classList.toggle("locked", ok);
      hint.classList.toggle("locked", ok);
      hint.textContent = ok ? "Sticker erkannt ✨" : "Sticker in die Mitte halten";
    }
  } catch (err) {
    console.error(err);
    hint.textContent = "Erkennung nicht verfügbar – Foto geht trotzdem";
  } finally {
    liveBusy = false;
    if (stream) scheduleLive();
  }
}

/* ---------------- Capture ---------------- */

let current = null; // { canvas, hash, entry, duplicate, describing }

$("shutter").addEventListener("click", async () => {
  const shot = grabVisible(1024);
  if (!shot) return;
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

  const hash = dHash(sticker);
  const duplicate = findDuplicate(hash, await db.getAll());
  current = { canvas: sticker, hash, entry: null, duplicate, describing: null };
  showCatch();
});

function showCatch() {
  const { canvas, duplicate } = current;
  $("catch-img").src = canvas.toDataURL("image/png");
  $("catch-new-anyway").classList.toggle("hidden", !duplicate);
  const badge = $("catch-badge");
  if (duplicate) {
    badge.textContent = `Schon im Dex! ${pad(duplicate.nr)}`;
    badge.classList.add("dupe");
    $("catch-name").textContent = duplicate.name;
    $("catch-desc").textContent = duplicate.beschreibung ?? "";
    metaPills($("catch-meta"), { ...duplicate, count: duplicate.count + 1 });
    setRarity($("catch-card"), duplicate.seltenheit);
    $("catch-stage").classList.toggle("holo", isHolo(duplicate.seltenheit));
    $("catch-keep").textContent = "Duplikat zählen (+1)";
  } else {
    badge.textContent = "Neuer Sticker!";
    badge.classList.remove("dupe");
    $("catch-keep").textContent = "Einsammeln ✨";
    setRarity($("catch-card"), null);
    $("catch-stage").classList.remove("holo");
    $("catch-meta").innerHTML = "";
    startDescribing();
  }
  $("catch").classList.remove("hidden");
}

function startDescribing() {
  const cur = current;
  if (!settings.apiKey) {
    $("catch-name").textContent = "Unbekannter Sticker";
    $("catch-desc").textContent = "Tipp: Mit einem API-Schlüssel (⚙︎ im Dex) bekommt jeder Sticker automatisch Name und Beschreibung.";
    return;
  }
  $("catch-name").textContent = "Wird erkannt …";
  $("catch-desc").innerHTML = '<span class="spinner"></span>';
  cur.describing = describeSticker(cur.canvas);
  cur.describing.then(
    (entry) => {
      cur.entry = entry;
      if (current !== cur || cur.duplicate) return;
      $("catch-name").textContent = entry.name;
      $("catch-desc").textContent = entry.beschreibung;
      metaPills($("catch-meta"), entry);
      setRarity($("catch-card"), entry.seltenheit);
      $("catch-stage").classList.toggle("holo", isHolo(entry.seltenheit));
    },
    (err) => {
      cur.error = describeError(err);
      if (current !== cur) return;
      $("catch-name").textContent = "Unbekannter Sticker";
      $("catch-desc").textContent = cur.error;
    },
  );
}

function closeCatch() {
  $("catch").classList.add("hidden");
  current = null;
}

$("catch-retry").addEventListener("click", closeCatch);

$("catch-new-anyway").addEventListener("click", () => {
  current.duplicate = null;
  showCatch();
});

$("catch-keep").addEventListener("click", async () => {
  const cur = current;
  closeCatch();
  if (cur.duplicate) {
    const s = await db.get(cur.duplicate.id);
    s.count += 1;
    await db.put(s);
    toast(`${s.name} ×${s.count} 🎉`);
    return;
  }
  const image = await canvasToBlob(cur.canvas);
  const base = { image, hash: cur.hash, name: "Unbekannter Sticker", ...(cur.entry ?? {}) };
  const record = await db.add(base);
  toast(`${pad(record.nr)} ${record.name} eingesammelt! ✨`);
  // AI still busy? Fill in the description when it arrives.
  if (!cur.entry && cur.describing) {
    cur.describing
      .then(async (entry) => {
        const fresh = await db.get(record.id);
        if (!fresh) return;
        const nameEdited = fresh.name !== "Unbekannter Sticker";
        await db.put({ ...fresh, ...entry, name: nameEdited ? fresh.name : entry.name });
        if (activeTab === "dex") renderDex();
      })
      .catch(() => {});
  }
});

/* ---------------- Dex ---------------- */

async function renderDex() {
  const stickers = (await db.getAll()).sort((a, b) => a.nr - b.nr);
  const grid = $("grid");
  grid.innerHTML = "";
  const total = stickers.reduce((n, s) => n + s.count, 0);
  $("dex-count").textContent =
    stickers.length === 1 ? "1 Sticker gesammelt" : `${stickers.length} Sticker gesammelt`;
  const dupes = total - stickers.length;
  if (dupes > 0) $("dex-count").textContent += ` · ${dupes} ${dupes === 1 ? "Duplikat" : "Duplikate"}`;
  $("empty").classList.toggle("hidden", stickers.length > 0);
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
  $("detail-desc").textContent = s.beschreibung ?? "Noch keine Beschreibung.";
  $("detail-fun").textContent = s.fun_fact ?? "";
  $("detail-found").textContent = `Gefunden am ${new Date(s.createdAt).toLocaleDateString("de-DE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  })}`;
  $("detail-stage").classList.toggle("holo", isHolo(s.seltenheit));
  $("detail-redescribe").textContent = s.beschreibung ? "Neu beschreiben" : "Beschreibung erzeugen";
  $("detail").classList.remove("hidden");
}

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

$("detail-redescribe").addEventListener("click", async (e) => {
  const btn = e.currentTarget;
  const s = await db.get(detailId);
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  try {
    const entry = await describeSticker(await blobToCanvas(s.image));
    await db.put({ ...s, ...entry });
    await openDetail(s.id);
    renderDex();
  } catch (err) {
    toast(describeError(err), 4000);
    btn.textContent = "Neu beschreiben";
  } finally {
    btn.disabled = false;
  }
});

$("detail-delete").addEventListener("click", async () => {
  const s = await db.get(detailId);
  if (!confirm(`${pad(s.nr)} ${s.name} wirklich löschen?`)) return;
  await db.remove(s.id);
  $("detail").classList.add("hidden");
  renderDex();
});

/* ---------------- Settings ---------------- */

for (const [value, label] of Object.entries(MODELS)) $("model").append(new Option(label, value));
$("open-settings").addEventListener("click", () => {
  $("api-key").value = settings.apiKey;
  $("model").value = settings.model;
  $("settings").classList.remove("hidden");
});
$("settings-save").addEventListener("click", () => {
  settings.apiKey = $("api-key").value.trim();
  settings.model = $("model").value;
  $("settings").classList.add("hidden");
  toast(settings.apiKey ? "Gespeichert – KI-Erkennung ist aktiv 🤖" : "Gespeichert – ohne KI-Erkennung");
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
