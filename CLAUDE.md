# GrowHub

Multi-Device-Kontroll-App für lokale ESP-Controller (Licht, Bewässerung, Klima) als React/Vite-SPA. Ohne Query-Parameter läuft alles auf Mock-Daten.

## Kommandos

- `npm run dev` — Dev-Server auf http://localhost:5173 (Preview über .claude/launch.json, Name "growhub")
- `npm run build` — Produktions-Build nach `dist/`
- `npm run embed` — Bundle für ESP-Firmware-Embedding (tools/embed.js)

## Struktur

- `src/main.jsx` — gesamte UI (eine Datei, ~400 Zeilen, bewusst kompakt)
- `src/core/` — api.js (HTTP-Clients), mock.js (Mock-Daten), format.js
- `src/devices/` — catalog.js (Geräte-Registry) + Adapter pro Gerätetyp (bisher nur lighting; irrigation/climate sind im Katalog als geplant markiert)
- `src/styles/app.css` — komplettes Design-System
- `.github/workflows/deploy.yml` — baut bei jedem Push auf main und deployt auf GitHub Pages

## Wichtig

- Live-Demo: https://kurzschlusskind.github.io/GrowHub/ (Mock-Modus) — jeder Push auf main deployt automatisch dorthin. Nichts auf main pushen, was die Demo bricht; vorher `npm run build` laufen lassen.
- `vite.config.js` hat `base: "./"` — relativ, damit das Bundle sowohl auf Pages (Unterpfad) als auch embedded in ESP-Firmware funktioniert. Nicht auf absolute Pfade ändern.
- Echte Controller werden per Query-Parameter verbunden: `?lighting=http://<ip>`.
- UI-Texte sind Deutsch, Code/Kommentare Englisch.
