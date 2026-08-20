# Irrigation Controller API — Specification 1.0.0 (draft)

HTTP contract for irrigation controllers (typically ESP32) controlled by the
GrowHub app. A conforming device exposes the endpoints below and follows the
behaviour and robustness rules. The GrowHub mock is the reference
implementation.

Keywords: **MUST** (required for conformance), **SHOULD** (strongly
recommended), **MAY** (optional).

## 1. Transport & conventions

- Plain HTTP on the local network, JSON request/response bodies
  (`Content-Type: application/json`).
- The device **MUST** send permissive CORS headers
  (`Access-Control-Allow-Origin: *`, plus `Access-Control-Allow-Headers:
  Content-Type` and handling of `OPTIONS` preflight) — the GrowHub app runs in
  a browser and cannot talk to the device otherwise.
- Errors are returned with an HTTP 4xx/5xx status and a body of
  `{ "error": "<human-readable message>" }`. The message is shown to the user
  verbatim, so it should be specific ("Pumpe belegt — Zone 2 läuft noch"),
  not generic.
- All timestamps are Unix epoch milliseconds. Times of day are minutes since
  midnight (0–1439) in the device's local time.

## 2. Topology model

The device announces its own hardware layout. The app renders exactly what is
reported — a controller with 1 pump and 6 valves and a controller with 2 pumps
and 20 valves use the same app without any configuration.

- **Pump** — a shared resource. At most **one valve per pump** is open at any
  time. Runs on different pumps may overlap.
- **Valve** — belongs to exactly one pump. Two types:
  - `irrigation`: waters plants. Protected by the lockout (§5).
  - `drain`: flushes the line / emergency drain. **Not** subject to the
    lockout — its purpose is maintenance, not watering.
- Names are configured **on the device** and displayed by the app as-is.

## 3. Endpoints

### `GET /api/irrigation/capabilities` (MUST)

```json
{
  "spec": "1.0.0",
  "firmware": "1.2.0",
  "pumps": [
    { "id": "p1", "name": "Hauptpumpe" }
  ],
  "valves": [
    { "id": "v1", "type": "irrigation", "name": "Zone 1 · Tropf", "pump": "p1" },
    { "id": "d1", "type": "drain", "name": "Drainage", "pump": "p1" }
  ]
}
```

IDs are stable across reboots. The app uses them in every other endpoint.

### `GET /api/irrigation/status` (MUST)

```json
{
  "firmware": "1.2.0",
  "wifi": { "connected": true, "ssid": "…", "ip": "…", "rssi": -61 },
  "pumps": [
    { "id": "p1", "running": true, "valve": "v2", "durationSeconds": 90, "remainingSeconds": 41 }
  ],
  "valves": [
    { "id": "v1", "state": "ready", "lastRunAt": 1787000000000, "lastDurationSeconds": 90 },
    { "id": "v2", "state": "running", "lastRunAt": 1786913600000, "lastDurationSeconds": 90 }
  ]
}
```

`state` is `ready` | `running` | `error` (`error` for detected hardware
faults, if the device can detect them).

### `GET /api/irrigation/health` (MUST)

```json
{
  "uptimeSeconds": 93211,
  "resetReason": "power-on",
  "heapFreeBytes": 182456,
  "wifi": { "connected": true, "ssid": "…", "ip": "…", "rssi": -61 },
  "clockValid": true,
  "time": "2026-08-20T09:12:44Z"
}
```

`resetReason` **SHOULD** distinguish at least `power-on`, `watchdog`,
`brownout`, `software`. A device that keeps rebooting looks fine in `status`;
`health` is where problems become visible.

### `POST /api/irrigation/run` (MUST)

```json
{ "valve": "v2", "durationSeconds": 90, "runId": "b3f1…" }
```

- Starts a run on the given valve. Response: `{ "ok": true }`.
- `runId` is a client-generated unique string. If the device has seen this
  `runId` recently it **MUST NOT** start a second run and responds
  `{ "ok": true, "duplicate": true }` — this makes retries after network
  failures safe. Keeping the last ~16 IDs is sufficient.
- Rejected with an error if the valve's pump is busy, or if an irrigation
  valve is inside its lockout window.
- `durationSeconds` is capped at `maxRunSeconds` by the device.

### `POST /api/irrigation/stop` (MUST)

```json
{ "pump": "p1" }
```

Stops the active run on that pump (valve closes, run is logged with its
actual duration). Stopping an idle pump is a no-op, not an error.

### `GET/POST /api/irrigation/schedules` (MUST)

```json
{
  "enabled": true,
  "windows": [
    { "valve": "v1", "time": 390, "durationSeconds": 90, "enabled": true }
  ]
}
```

POST replaces the whole document and responds with the stored state.

### `GET/POST /api/irrigation/safety` (MUST)

```json
{ "maxRunSeconds": 300, "lockoutMinutes": 10 }
```

### `GET /api/irrigation/history` (MUST)

```json
{
  "events": [
    { "at": 1787000090000, "valve": "v1", "durationSeconds": 90, "trigger": "schedule" }
  ]
}
```

`trigger` is `manual` | `schedule` | `thermal` (emergency run commanded by a
supervisor). The device keeps at least the last 20 events.

## 4. Schedule execution (device-side)

- Schedules run **on the device**, independent of the app.
- When a window's start time is reached, the run is **enqueued on its pump**.
  If the pump is busy, the run starts as soon as the pump is free — collisions
  are processed sequentially, never dropped because of pump contention.
- A queued run whose irrigation valve is inside its lockout when the pump
  becomes free is **skipped** (not delayed).
- If the device has no valid clock (`clockValid: false`), schedules are
  **suspended** — never fired at guessed times.

## 5. Safety rules (enforced by the device)

- `maxRunSeconds` is a **hard firmware deadline** per run. It fires even if
  the app, Wi-Fi and everything else is gone. The app can start runs; it can
  never be required to end them.
- `lockoutMinutes`: minimum pause between two runs of the same *irrigation*
  valve, regardless of trigger. Protects roots from double watering. Drain
  valves are exempt.
- One open valve per pump, enforced by the device.

## 6. Robustness requirements

- **Fail-safe boot (MUST):** after any reset — power-on, watchdog, brownout —
  all valves are closed and all pumps are off before anything else happens.
- **No resume (MUST):** a run interrupted by a reset is not resumed. It is
  logged (trigger of the original run, actual duration unknown → log what is
  known) and shows up in `history`; the reset shows up in `health`.
- **Watchdog (MUST):** a hardware watchdog reboots the device if the firmware
  hangs — into the fail-safe boot state.
- **Atomic config (MUST):** schedules and safety settings are persisted
  atomically (write-temp-then-rename or equivalent). A power cut during save
  leaves the previous config intact, never a half-written file.
- **Honest reporting (SHOULD):** if the device cannot verify an outcome (no
  flow sensor, no valve feedback), it reports state as commanded, not as
  confirmed. Future capability flags will let devices declare verified
  feedback.

## 7. App behaviour (informative)

The GrowHub app, for its part: treats every command as unconfirmed until the
next state read; retries with the same `runId`; backs off polling when the
device is unreachable and shows the staleness of its data; and disables
controls that require a live device instead of letting them fail silently.

## 8. Roadmap (non-normative)

- Config versioning (`If-Match`/ETag) to detect concurrent edits from two
  clients.
- Capability flags for verified feedback (flow sensor, valve position).
- Sensor endpoints (moisture, tank level) as an optional module.
