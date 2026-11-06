// Tiny IndexedDB wrapper – everything stays on the device.
const DB_NAME = "stickerdex";
const STORE = "stickers";

let dbPromise;
function db() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
      store.createIndex("nr", "nr", { unique: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode);
    const result = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(result.result ?? result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error ?? new Error("Speichern abgebrochen (Speicher voll?)"));
  });
}

export const getAll = () => tx("readonly", (s) => s.getAll());
export const get = (id) => tx("readonly", (s) => s.get(id));
export const put = (sticker) => tx("readwrite", (s) => s.put(sticker));
export const remove = (id) => tx("readwrite", (s) => s.delete(id));

/**
 * The picture is stored as raw bytes (ArrayBuffer) – Safari on iOS can fail to
 * store Blob objects in IndexedDB. Older entries may still hold a Blob.
 */
export function imageBlob(sticker) {
  if (sticker.image instanceof Blob) return sticker.image;
  return new Blob([sticker.imageData], { type: sticker.imageType ?? "image/png" });
}

/** Adds a new sticker and assigns the next dex number (#001, #002, …). */
export async function add(sticker) {
  const all = await getAll();
  const nr = all.reduce((max, s) => Math.max(max, s.nr), 0) + 1;
  const record = { ...sticker, nr, count: 1, createdAt: Date.now() };
  record.id = await put(record);
  return record;
}
