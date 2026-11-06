# 📸 Stickerdex

Sticker sammeln wie Pokémon: Kamera drauf, die App erkennt den Sticker in der Mitte,
schneidet ihn aus und legt ihn als Eintrag im Stickerdex ab. Eine Web-App (PWA), läuft direkt
in Safari auf dem iPhone.

## Funktionen

- **Kamera-Tab:** Live-Vorschau mit Rahmen in der Mitte. Ein erkannter Sticker wird gelb markiert.
  Auslösen stellt ihn frei (transparenter Hintergrund, weiße Stickerkante).
- **Stickerdex-Tab:** Nummerierte Sammlung (#001, #002, …), Seltenheitsfarben, Holo-Effekt für
  epische und legendäre Sticker, Detailansicht mit Beschreibung, Fun Fact und Funddatum.
  Den Namen kann man antippen und ändern.
- **Duplikat-Erkennung:** Fotografierst du einen Sticker, den du schon hast, zählt er als ×2, ×3, …
- **KI-Beschreibung (optional):** Mit einem eigenen Anthropic-API-Schlüssel (⚙︎ im Dex) schreibt
  Claude Name, Beschreibung, Kategorie, Seltenheit und Fun Fact.
- **Alles lokal:** Die Freistellung läuft auf dem Gerät (MediaPipe „Magic Touch“). Die Sammlung
  liegt in IndexedDB im Browser. Nach dem ersten Laden funktioniert die App auch offline.

## Auf dem iPhone nutzen

1. Die veröffentlichte Seite (GitHub Pages, siehe unten) in **Safari** öffnen.
2. Teilen → **„Zum Home-Bildschirm“**. Danach startet die App im Vollbild wie eine normale App.
3. Kamerazugriff erlauben.

> Die Sammlung ist an den Browser gebunden. Wer die Website-Daten in Safari löscht, löscht auch
> den Stickerdex.

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server, im WLAN erreichbar (für die Kamera auf dem Handy wird HTTPS benötigt)
npm run build    # Produktions-Build nach dist/
```

`npm run dev` und `npm run build` kopieren vorher die MediaPipe-WASM-Dateien und laden das
Segmentierungsmodell nach `public/vendor/`.

## Veröffentlichen (GitHub Pages)

Der Workflow `.github/workflows/deploy.yml` baut die App bei jedem Push auf `main` oder `master`
und veröffentlicht sie. Einmalig einrichten: Repository → **Settings → Pages → Source:
„GitHub Actions“**.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/main.js` | Tabs, Kamera, Live-Vorschau, Fang-Karte, Dex, Einstellungen |
| `src/segment.js` | Sticker in der Bildmitte erkennen und freistellen (MediaPipe) |
| `src/ai.js` | Stickerdex-Eintrag per Claude erzeugen |
| `src/hash.js` | Perceptual Hash für die Duplikat-Erkennung |
| `src/db.js` | Speicherung in IndexedDB |
| `public/sw.js` | Offline-Cache |
