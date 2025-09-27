# Greenception RS-485 Ersatz-Controller

Vollständiges PlatformIO-Projekt für einen ESP32 (Arduino-Framework), das als Ersatz-Controller für Greenception-Growlights dient. Es stellt eine Web-UI zur Verfügung, snifft und sendet proprietäre RS-485-Frames und bietet eine editierbare Kalibrier-Mapping-Tabelle.

## Funktionsüberblick

- AsyncWebServer + WebSocket Dashboard (Kanäle, Presets, Mapping, Log/Sniffer).
- Mapping-Komponente mit Stückweise-Interpolation und Identity-Mode (0..100 % → 0..255).
- Periodischer Heartbeat mit konfigurierbarem Intervall, optionaler Dry-Run (Listen-only standard).
- Proprietäres Frame-Format (`F1 E2 ... SUM F3`) inkl. Kurzformen (Header optional, weniger Kanäle).
- RS-485 MAX485-Ansteuerung über UART2 (TX2/RX2 + DE/RE-Pin) mit sicherem Richtungsschalten.
- Presets, Mapping und Log-Rotation (letzte 1000 Einträge) in LittleFS gespeichert.
- REST-API (Status, Set, Preset, Mapping) + WebSocket-Echtzeitereignisse.
- Umfangreiche Dokumentation, Tests und Beispiele.

## Hardware / Verdrahtung

| ESP32 Pin | MAX485 | Beschreibung |
|-----------|--------|--------------|
| 17 (TX2)  | DI     | UART2 TX → RS-485 Send |
| 16 (RX2)  | RO     | UART2 RX ← RS-485 Receive |
| 4         | DE & RE| Direction Enable (gemeinsam, HIGH = senden) |
| 3V3       | VCC    | Versorgung MAX485 |
| GND       | GND    | Masse |
| A / B     | RS-485 | Busleitungen (differenziell) |

ASCII-Schaltskizze:

```
        ESP32 (esp32dev)                      MAX485
        ┌───────────────┐                ┌──────────────┐
   3V3 ─┤3V3         GND├───────────────┤VCC        GND├─┐
        │               │               │              │ │
  TX2 ──┤IO17       IO16├── RX2         │DI         RO ├─┘
  RX2 ──┤               │               │              │
  DE ───┤IO4            │──────────────►│DE         /RE├─┐
  RE ───┤IO4 (gemeinsam)│───────────────┤              │ │
        │               │               │      A   B   │ │RS-485
        └───────────────┘               └──────┬───┬───┘ │Bus
                                               │   │     │
                                               └───┴─────┘
```

> **Hinweis:** DE und /RE sind gekoppelt (gleicher Pin). LOW = Empfangen, HIGH = Senden. Die Software hält den Pin standardmäßig LOW (Listen-only).

## Firmware-Build & Flash

1. Abhängigkeiten installieren (PlatformIO Core).
2. Projekt klonen oder entpacken.
3. WLAN-Zugangsdaten in `src/main.cpp` (`WIFI_SSID`/`WIFI_PASSWORD`) anpassen oder offen lassen, um in den AP-Fallback zu wechseln.
4. LittleFS Web-Assets hochladen:
   ```bash
   pio run -t uploadfs
   ```
5. Firmware flashen:
   ```bash
   pio run -t upload
   ```
6. Serielle Konsole (optional):
   ```bash
   pio device monitor
   ```

Standard-Baudrate RS-485: `9600 baud`, Format `8N1`.

## Projektstruktur

```
├── include/        # Header mit Klassen (Frame, Parser, Mapping, RS485, WebServer)
├── src/            # Implementierungen + main.cpp
├── data/           # Web-UI (LittleFS)
├── test/           # Unit-Tests (Unity)
├── docs/           # Zusatzdokumentation (USAGE.md, TESTS.md, BOM.md)
├── README.md
└── platformio.ini
```

Weitere Details siehe [docs/USAGE.md](docs/USAGE.md), [docs/BOM.md](docs/BOM.md) und [docs/TESTS.md](docs/TESTS.md).

