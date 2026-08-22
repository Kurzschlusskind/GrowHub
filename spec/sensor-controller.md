# Sensor Controller API — Specification 1.0.0 (draft)

HTTP contract for sensor devices (typically ESP32) feeding a GrowHub
installation. The device is a **pure pass-through slave**: it measures and
reports. It never decides anything — thresholds, alarms and the escalation
chain live on the GrowHub Server ([growhub-server.md](growhub-server.md)).
What hardware sits behind a value (SCD30, SCD41, NDIR, a twelve-sensor
stack) is invisible to GrowHub by design.

Transport, conventions, error format, CORS and the robustness rules follow
[irrigation-controller.md](irrigation-controller.md) §1/§6. Write endpoints
are signed per [signing.md](signing.md) when a secret is configured.

## 1. Capabilities

### `GET /api/sensors/capabilities` (MUST)

```json
{
  "spec": "1.0.0",
  "firmware": "1.0.0",
  "sensors": [
    { "id": "s1", "quantity": "temperature", "unit": "°C", "name": "Zelt oben" },
    { "id": "s2", "quantity": "humidity", "unit": "%", "name": "Zelt oben" },
    { "id": "s3", "quantity": "co2", "unit": "ppm", "name": "Abluft" }
  ]
}
```

- `id` is stable across reboots.
- `quantity` is the physical quantity, not the chip. Well-known values:
  `temperature`, `humidity`, `co2`, `pressure`, `vpd`, `moisture`, `ph`,
  `ec`, `flow`, `level`. Devices MAY report other strings — consumers MUST
  still record and display unknown quantities with their `unit` (pass-through
  principle).
- `unit` is a display string; values are plain numbers in that unit.

## 2. Readings

### `GET /api/sensors/readings` (MUST)

```json
{
  "readings": [
    { "sensor": "s1", "value": 26.4 },
    { "sensor": "s2", "value": 61.2 },
    { "sensor": "s3", "value": 812 }
  ]
}
```

Current values, one entry per capability sensor. A sensor that currently
cannot measure reports `"value": null` (never a stale fake). Consumers poll;
there is no push channel.

### `GET /api/sensors/health` (MUST)

Same shape as the irrigation controller's `/health` (uptime, resetReason,
heap, wifi, clockValid, time).

## 3. Config mirror (MUST)

The device stores an opaque copy of the server's supervisor/alarm
configuration purely for **drift and tamper detection** — it never interprets
it.

### `POST /api/sensors/config-mirror` (signed write)

```json
{ "hash": "<sha256 hex of the canonical config>", "config": { … } }
```

Persisted atomically. Response `{ "ok": true }`.

### `GET /api/sensors/config-mirror`

```json
{ "hash": "<sha256 hex>", "updatedAt": 1787000000000 }
```

The server compares this hash against its database on every poll and after
every device restart; a mismatch raises an alarm on the server ("Config-
Abgleich fehlgeschlagen"). A device that has never been mirrored reports
`{ "hash": null }`.

## 4. Requirements

- Read-only device: no actuator outputs, nothing to fail dangerous. The
  fail-safe rule reduces to: never block, never lie about values.
- Honest values: report `null` when a sensor is absent or warming up.
- The device MUST keep working (and reporting) when the server is down.
