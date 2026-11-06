# 🌿 Jointlog

Dein Joint-Tagebuch als Web-App: Joint Snap (Video oder Foto) aufnehmen und dazu speichern,
wann, wo und was drin war. Nach dem Rauchen gibst du jeweils 1–10 Punkte für Knall, Spot und Trip.

## Öffnen

👉 **https://raw.githack.com/jimrocko/Test/master/index.html**

Auf dem iPhone in Safari öffnen, dann Teilen → „Zum Home-Bildschirm“. Danach startet die App im
Vollbild wie eine normale App, ganz ohne App Store.

## Funktionen

- **🎥 Snap:** Die Kamera öffnet sich direkt, du filmst deinen Joint. Der Standort wird automatisch per GPS mitgespeichert, wenn du ihn erlaubst.
- **Eintrag:** Zeit, Ort, Sorte, Menge, THC, Art (Joint/Spliff/Blunt/Pur), Mische und eine freie Notiz.
- **Später bewerten:** Ohne Haken speichern, erst rauchen. Unbewertete Joints stehen im Verlauf mit ⏳.
  Dann jeweils 1–10 für 💥 Knall, 📍 Spot und 🌀 Trip.
- **📊 Stats:** Anzahl, Gramm, Durchschnittswerte, Sorten mit dem meisten Knall, beste Spots.
- **📤 Teilen:** Video und Daten per WhatsApp & Co. an Freunde schicken.
- **💾 Backup:** Export/Import als Datei.

Alle Daten bleiben im Browser auf deinem Handy (IndexedDB). Es gibt keinen Server und keinen Account.

## Dateien

| Datei | Aufgabe |
|---|---|
| `index.html` | Die ganze App (HTML, CSS, JS) |
| `sw.js` | Offline-Cache |
| `manifest.webmanifest`, `icon.svg` | Home-Bildschirm-App |
