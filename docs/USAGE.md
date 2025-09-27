# Bedienung & Web-UI

Nach dem Flashen verbindet sich der ESP32 mit dem konfigurierten WLAN. Bei Fehlschlag startet er einen Access Point `GC-RS485` (Passwort `gccontroller`). Das Dashboard ist anschließend über `http://<ip-des-controllers>/` erreichbar.

```
┌───────────────────────────────────────────────┐
│ Greenception RS-485 Controller                │
│ Warning: Listen-only until "Allow TX"         │
├───────────────┬───────────────────────────────┤
│ Kanäle        │ Presets                       │
│  Ch1 [slider] │  • Veg 50/25   [Laden][X]     │
│  Ch2 [slider] │  • Bloom 100/60 [Laden][X]    │
│  Allow TX []  │ Preset speichern              │
│  HB Interval  │                               │
│  Heartbeat [] │ Mapping                       │
│  Frame senden │  Tabelle %↔Raw + Identity    │
├───────────────┴───────────────────────────────┤
│ Sniffer Log (Rolling 1000 Zeilen)             │
└───────────────────────────────────────────────┘
```

## Dashboard-Elemente

- **Kanäle / Slider**: 0–100 % Eingabe, Anzeige des berechneten Raw-Bytes. Änderungen werden live an den Controller gemeldet (kein automatischer Bus-TX).
- **Frame senden**: Baut sofort einen Frame und sendet ihn, sofern `Allow TX` aktiv ist. Andernfalls wird im Dry-Run nur geloggt.
- **Allow TX**: Sicherheitscheckbox, initial deaktiviert. Nur wenn aktiv, wird der MAX485 in den Sendemodus geschaltet.
- **Heartbeat**: Start/Stopp-Button + Intervall (ms). Bei Aktivierung werden Frames periodisch gesendet.
- **Presets**: Speichern / Laden von Kanalpaaren. Presets persistieren in `presets.json`.
- **Mapping**: Editierbare Tabelle der Messpunkte (Display% ↔ Raw). Identity-Mode erzwingt lineares Mapping 0..255. Änderungen müssen mit „Recompute & Speichern“ bestätigt werden.
- **Sniffer/Log**: Rolling-Log (max. 1000 Zeilen) aller RX/TX-Frames, Summenvalidierung, Statusmeldungen.

## API Endpunkte

| Methode | Pfad      | Beschreibung |
|---------|-----------|--------------|
| GET     | `/status` | JSON mit Status, Mapping, Presets, Logs |
| POST    | `/set`    | Body `{ "ch1": %, "ch2": %, "send": bool }` |
| POST    | `/preset` | Body `{ "name": str, "ch1": %, "ch2": % }` |
| POST    | `/mapping`| Body `{ "identity": bool, "points": [{percent, raw}, ...] }` |

WebSocket (`/ws`) Nachrichten (JSON): `setChannels`, `sendOnce`, `toggleHeartbeat`, `setHeartbeatInterval`, `toggleTx`, `savePreset`, `loadPreset`, `deletePreset`, `updateMapping`, `requestState`.

## RS-485 Frame Beispiele

| Beschreibung | Kanäle (%→Raw) | Frame (Hex) | Summe gültig |
|--------------|----------------|-------------|--------------|
| VEGI 50 %, FLOWER 25 % | 50 % → 0x3F, 25 % → 0x26 | `F1 E2 3F 26 00 00 00 65 F3` | ✔ |
| Sniffer Beispiel | 88 / 37 Raw | `F1 E2 58 25 00 00 00 7D F3` | ✔ |
| Kurzform | Raw Bytes | `00 00 00 26 F3` | Parser füllt Rest mit 0 |

## Sicherheitshinweise

- „Allow TX“ ist standardmäßig deaktiviert. Nur aktivieren, wenn der Bus frei ist.
- Heartbeat sendet solange `Allow TX` aktiv ist. Beim Deaktivieren wird wieder Listen-only.
- Logging nur in RAM (Ringpuffer), keine dauerhafte Speicherung → Schonung des Flash.

