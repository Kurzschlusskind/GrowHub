# GrowHub Irrigation Controller (ESP32)

PlatformIO firmware implementing
[spec/irrigation-controller.md](../../spec/irrigation-controller.md). Valves
and pumps are **variable**: the entire topology lives in
`data/topology.json` — the firmware announces it via
`/api/irrigation/capabilities`, and GrowHub renders whatever is reported.
Supply voltage (12 V / 24 V) is the driver stage's business; the firmware
switches GPIOs (`activeLow` configurable per component, default: relay
board = active-low).

## Behaviour (spec in short)

- **Fail-safe:** after every boot/reset all outputs are off before anything
  else runs. Hardware watchdog (10 s) reboots on hangs.
- **One pump = one open valve.** Runs have a hard firmware deadline
  (`maxRunSeconds`), independent of app and Wi-Fi.
- **Lockout** per irrigation valve (drain valves exempt).
- **Schedules run on-device** (NTP); suspended without a valid clock.
- **Idempotent starts** via `runId`; config writes are atomic
  (temp + rename); history (last 30 runs) is persistent.
- Write endpoints verify request signatures when an `apiSecret` is
  configured ([spec/signing.md](../../spec/signing.md)).
- Switching order: valve open → pump on; pump off → valve closed.

## Setup

1. Adapt `data/topology.json` to your rig (ids, names, pins, `activeLow`).
2. Copy `data/wifi.example.json` to `data/wifi.json` and fill it in
   (not committed).
3. Flash filesystem and firmware:

```text
pio run -t uploadfs
pio run -t upload
```

4. Connect in GrowHub: `?irrigation=http://<esp32-ip>` — or as a registry
   entry in the server config.

## Default pin mapping (topology.json)

| Component | Pin |
|---|---|
| Pump p1 | 26 |
| Valves v1–v5 | 16, 17, 18, 19, 21 |
| Drain d1 | 22 |

## License

[PolyForm Strict 1.0.0](../../LICENSE) — noncommercial use permitted; no
commercial use, no distribution, no derivative works.
