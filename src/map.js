// Fundort-Karte: every sticker with a location appears as a little sticker
// on an OpenStreetMap map. Leaflet is loaded only when the map is opened.
let L = null;
let map = null;
let layer = null;

async function ensureMap(el) {
  if (!L) {
    const mod = await import("leaflet");
    await import("leaflet/dist/leaflet.css");
    L = mod.default ?? mod;
  }
  if (!map) {
    map = L.map(el, { zoomControl: false, attributionControl: true }).setView([51.16, 10.45], 5); // Deutschland
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    }).addTo(map);
    layer = L.layerGroup().addTo(map);
  }
  return map;
}

/**
 * Shows all located stickers. `imageUrl(sticker)` gives the picture,
 * `onSelect(id)` is called when a marker is tapped.
 */
export async function renderMap(el, stickers, imageUrl, onSelect, focusId = null) {
  await ensureMap(el);
  map.invalidateSize();
  layer.clearLayers();
  const located = stickers.filter((s) => s.location);
  for (const s of located) {
    const icon = L.divIcon({
      className: "map-sticker",
      html: `<img src="${imageUrl(s)}" alt="" />`,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });
    L.marker([s.location.lat, s.location.lng], { icon, title: s.name })
      .on("click", () => onSelect(s.id))
      .addTo(layer);
  }
  const focus = located.find((s) => s.id === focusId);
  if (focus) map.setView([focus.location.lat, focus.location.lng], 16);
  else if (located.length === 1) map.setView([located[0].location.lat, located[0].location.lng], 15);
  else if (located.length > 1)
    map.fitBounds(
      located.map((s) => [s.location.lat, s.location.lng]),
      { padding: [40, 40], maxZoom: 16 },
    );
  return located.length;
}

/** Current position (or null), never waits longer than `timeout` ms. */
export function currentLocation(timeout = 8000) {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }, // always a fresh fix
    );
  });
}
