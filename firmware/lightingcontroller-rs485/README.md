# Greenception RS-485 Replacement Controller

> **Interoperability notice:** This project implements parts of a
> proprietary RS-485 protocol that were analyzed by reverse engineering
> solely for interoperability purposes. This project is not affiliated with
> Greenception; "Greenception" and all other product and manufacturer names
> are trademarks of their respective owners. Details in the
> [LICENSE](LICENSE).

Complete PlatformIO project for an ESP32 (Arduino framework) acting as a
replacement controller for Greenception grow lights. It provides a web UI,
sniffs and sends the proprietary RS-485 frames, and offers an editable
calibration mapping table.

## Feature overview

- AsyncWebServer + WebSocket dashboard (channels, presets, mapping, log/sniffer)
- Mapping component with piecewise interpolation and identity mode (0..100 % → 0..255)
- Periodic heartbeat with configurable interval, optional dry run (listen-only by default)
- Proprietary frame format (`F1 E2 ... SUM F3`) including short forms (optional header, fewer channels)
- RS-485 MAX485 driving via UART2 (TX2/RX2 + DE/RE pin) with safe direction switching
- Presets, mapping and log rotation (last 1000 entries) persisted in LittleFS
- REST API (status, set, preset, mapping) + WebSocket real-time events
- Extensive documentation, tests and examples

## Hardware / wiring

| ESP32 pin | MAX485 | Description |
|-----------|--------|-------------|
| 17 (TX2)  | DI     | UART2 TX → RS-485 send |
| 16 (RX2)  | RO     | UART2 RX ← RS-485 receive |
| 4         | DE & RE| Direction enable (shared, HIGH = transmit) |
| 3V3       | VCC    | MAX485 supply |
| GND       | GND    | Ground |
| A / B     | RS-485 | Bus lines (differential) |

ASCII wiring sketch:

```
        ESP32 (esp32dev)                      MAX485
        ┌───────────────┐                ┌──────────────┐
   3V3 ─┤3V3         GND├───────────────┤VCC        GND├─┐
        │               │               │              │ │
  TX2 ──┤IO17       IO16├── RX2         │DI         RO ├─┘
  RX2 ──┤               │               │              │
  DE ───┤IO4            │──────────────►│DE         /RE├─┐
  RE ───┤IO4 (shared)   │───────────────┤              │ │
        │               │               │      A   B   │ │RS-485
        └───────────────┘               └──────┬───┬───┘ │bus
                                               │   │     │
                                               └───┴─────┘
```

> **Note:** DE and /RE are coupled (same pin). LOW = receive, HIGH =
> transmit. The firmware keeps the pin LOW by default (listen-only).

## Build & flash

1. Install dependencies (PlatformIO Core).
2. Clone or unpack the project.
3. Adjust the Wi-Fi credentials in `src/main.cpp` (`WIFI_SSID`/`WIFI_PASSWORD`)
   or leave them empty to fall back to AP mode.
4. Upload the LittleFS web assets:
   ```bash
   pio run -t uploadfs
   ```
5. Flash the firmware:
   ```bash
   pio run -t upload
   ```
6. Serial console (optional):
   ```bash
   pio device monitor
   ```

Default RS-485 baud rate: `9600`, format `8N1`.

## Project structure

```
├── include/        # Headers (Frame, Parser, Mapping, RS485, WebServer)
├── src/            # Implementations + main.cpp
├── data/           # Web UI (LittleFS)
├── test/           # Unit tests (Unity)
├── docs/           # Additional documentation (USAGE.md, TESTS.md, BOM.md)
├── README.md
└── platformio.ini
```

See [docs/USAGE.md](docs/USAGE.md), [docs/BOM.md](docs/BOM.md) and
[docs/TESTS.md](docs/TESTS.md) for details.

## License

[PolyForm Strict 1.0.0](LICENSE) — noncommercial use (including privately at
home) permitted; no commercial use, no distribution, no derivative works.
Full text in the repository root LICENSE.

The implemented RS-485 protocol was analyzed by reverse engineering solely
for interoperability purposes. All product and manufacturer names mentioned
are trademarks of their respective owners; this project is not affiliated
with them.
