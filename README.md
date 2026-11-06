# 📸 Stickerdex

Sticker sammeln wie Pokémon: Kamera drauf, die App erkennt den Sticker in der Mitte,
schneidet ihn aus und legt ihn als Eintrag im Stickerdex ab. Eine Web-App (PWA), läuft direkt
in Safari auf dem iPhone.

## Demo

👉 **https://raw.githack.com/jimrocko/Test/master/docs/index.html**

Auf dem iPhone in Safari öffnen, Kamera erlauben, fertig. Mit Teilen → „Zum Home-Bildschirm“
startet die App im Vollbild wie eine normale App.

## Funktionen

- **Kamera-Tab:** Live-Vorschau mit Rahmen in der Mitte. Ein erkannter Sticker wird gelb markiert.
  Auslösen stellt ihn frei (transparenter Hintergrund, weiße Stickerkante).
- **Auto-Auslöser:** Hältst du den Sticker ruhig, füllt sich der Auslöser-Ring und die App
  fotografiert von selbst. Mit dem Knopf „AUTO“ lässt er sich ausschalten.
- **Fang-Karte:** Namensvorschlag nach Hauptfarbe („Blauer Sticker“), frei änderbar. Die Seltenheit
  wird zufällig gezogen wie bei einem Booster-Pack: gewöhnlich 60 %, selten 25 %, episch 12 %, legendär 3 %.
- **Stickerdex-Tab:** Nummerierte Sammlung (#001, #002, …), Seltenheitsfarben, Holo-Effekt für
  epische und legendäre Sticker. In der Detailansicht kannst du Name und Notiz bearbeiten.
- **Duplikat-Erkennung:** Fotografierst du einen Sticker, den du schon hast, zählt er als ×2, ×3, …
  Verglichen werden Farben und Form, auch wenn der Sticker gedreht ist. Bei einem Fehlgriff hilft
  „Ist doch ein anderer“.
- **Fundort-Karte:** Beim Fotografieren merkt sich die App den Standort, wenn du ihn erlaubst. Im
  Dex zeigt „🗺️ Karte“ alle Sticker dort, wo du sie gefunden hast (OpenStreetMap).
- **Teilen als Sammelkarte:** In der Detailansicht erzeugt „Teilen“ ein Kartenbild im Sammelkarten-Stil
  und öffnet das iPhone-Teilen-Menü (WhatsApp, Fotos sichern, …).
- **Kostenlos und lokal:** keine KI-API, kein Server, kein Account. Die Freistellung läuft auf dem
  Gerät (MediaPipe „Magic Touch“), die Sammlung liegt in IndexedDB im Browser. Nach dem ersten
  Laden funktioniert die App auch offline.

> Die Sammlung ist an den Browser gebunden. Wer die Website-Daten in Safari löscht, löscht auch
> den Stickerdex.

## Entwicklung

```bash
npm install
npm run dev      # Dev-Server
npm run build    # baut die App nach docs/ – diesen Ordner danach mit committen
```

Die Demo-Seite liefert den Ordner `docs/` direkt aus dem Repository aus. Nach Änderungen also
`npm run build` ausführen und `docs/` committen. Alternativ geht auch GitHub Pages:
Settings → Pages → „Deploy from a branch“ → `master` / `docs`.

## Aufbau

| Datei | Aufgabe |
|---|---|
| `src/main.js` | Tabs, Kamera, Live-Vorschau, Fang-Karte, Dex, Einstellungen |
| `src/segment.js` | Sticker in der Bildmitte erkennen und freistellen (MediaPipe) |
| `src/map.js` | Fundort-Karte (Leaflet + OpenStreetMap), Standort abfragen |
| `src/share.js` | Sammelkarte als Bild zeichnen und teilen |
| `src/naming.js` | Namensvorschlag nach Farbe, Seltenheits-Ziehung |
| `src/hash.js` | Perceptual Hash für die Duplikat-Erkennung |
| `src/db.js` | Speicherung in IndexedDB |
| `public/sw.js` | Offline-Cache |
