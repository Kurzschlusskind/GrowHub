# GrowHub Sensor Controller (ESP32)

PlatformIO firmware implementing
[spec/sensor-controller.md](../../spec/sensor-controller.md). The device is
a pure **pass-through slave**: it measures and reports — thresholds, alarms
and the escalation chain are managed by the GrowHub Server.

What hardware sits behind a value (SCD30, SCD41, NDIR, pressure, a
twelve-sensor stack …) is pure configuration: `data/sensors.json` declares
the sensors (`id`, `quantity`, `unit`, `name`, `provider`) and the firmware
announces exactly that via `/api/sensors/capabilities`.

**Integrating your own sensors:** extend `readSensor()` in `src/main.cpp` —
that is where your driver code hooks in per `provider`. The bundled `demo`
provider produces deterministic pseudo-values so the firmware is testable
without any wired sensor. A sensor that currently cannot measure reports
`null` — never a stale value.

Also on board: config mirror for the server-side drift check (persisted
atomically), signed write requests
([spec/signing.md](../../spec/signing.md), `apiSecret` in `wifi.json`),
watchdog, health endpoint, CORS.

## Setup

```text
cp data/wifi.example.json data/wifi.json   # fill in
pio run -t uploadfs
pio run -t upload
```

Direct mode: `?sensors=http://<ip>` — or as a registry entry
(`"type": "sensors"`) in the server config.

## License

[PolyForm Strict 1.0.0](../../LICENSE).
