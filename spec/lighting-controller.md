# Lighting Controller API — Specification 1.0.0 (draft)

HTTP contract for the RS-485 lighting controller (ESP32) controlled by the
GrowHub app. The GrowHub mock is the reference implementation; the firmware
lives in `firmware/lightingcontroller-rs485/`.

Transport, conventions, error format and the general design principles are the
same as in [irrigation-controller.md](irrigation-controller.md) §1 — including
the CORS requirement and the robustness rules (fail-safe boot, hardware
watchdog, atomic config persistence, device-side schedule execution).

## 1. Model

- Two dimmable channels (`ch1`, `ch2`), 0–100 %.
- **Desired vs applied:** `desired` is what was requested, `applied` is what
  the device actually outputs after the Thermal Supervisor's limits. The app
  displays both and never assumes they match.
- **Thermal Supervisor:** monitors lamp temperature and escalates in stages.
  Stage 1 (limit PWM to `overridePercent`) fires immediately when
  `triggerC` is exceeded; each further stage fires only after
  `escalationSeconds` have passed without the temperature falling. Limits are
  released below `releaseC`. All of this runs on the device.
- **Signal output:** a GPIO for external indicators (stack light, buzzer).
  Follows the supervisor: off in normal operation, steady from stage 1,
  blinking from stage 3.

## 2. Endpoints

### `GET /api/status` (MUST)

```json
{
  "firmware": "1.2.0",
  "desired": { "ch1": 42, "ch2": 28 },
  "applied": { "ch1": 25, "ch2": 25 },
  "wifi": { "connected": true, "ssid": "…", "ip": "…", "rssi": -57 },
  "thermal": {
    "sensorPresent": true,
    "overrideActive": true,
    "temperatureC": 34.8,
    "config": { "enabled": true, "triggerC": 30, "releaseC": 27, "overridePercent": 25, "escalationSeconds": 120, "sampleIntervalMs": 5000 }
  },
  "signal": {
    "config": { "enabled": true, "pin": 14, "activeHigh": true },
    "state": "on"
  }
}
```

`signal.state` is `off` | `on` | `blink` | `disabled`.

### `POST /api/levels` (MUST)

```json
{ "ch1": 50, "ch2": 50 }
```

Sets desired levels. The device applies its thermal limit on top; the caller
reads back `applied` from `/api/status`. Clients debounce slider input — the
device should nevertheless tolerate bursts.

### `GET/POST /api/schedules` (MUST)

Daily curve per channel, up to 16 points each:

```json
{
  "enabled": true,
  "ch1": [ { "time": 360, "percent": 20 } ],
  "ch2": [ { "time": 360, "percent": 0 } ]
}
```

Executed on the device; between points the output is interpolated linearly.

### `GET/POST /api/presets` (MUST)

```json
{ "presets": [ { "name": "Blüte", "ch1": [ … ], "ch2": [ … ] } ] }
```

POST replaces the whole list.

### `GET /api/logs`, `POST /api/logs/config`, `POST /api/logs/clear` (MUST)

Ring buffer of periodic samples:

```json
{
  "config": { "enabled": true, "intervalMinutes": 15 },
  "records": [
    { "timestamp": 0, "uptimeMinutes": 480, "desiredCh1": 42, "desiredCh2": 28, "appliedCh1": 25, "appliedCh2": 25, "temperature": 31.2, "sensor": true, "thermal": true }
  ]
}
```

### `POST /api/thermal` (MUST)

Stores the thermal supervisor config (shape as in `/api/status`). Atomic
persistence required.

### `POST /api/thermal/drill/start`, `POST /api/thermal/drill/stop` (SHOULD)

Test run ("Testlauf"): simulates an over-temperature event and plays the full
escalation chain — PWM reduction, exhaust to 100 % (climate controller),
nutrient drainage, root flush via irrigation, recovery — using the configured
`escalationSeconds` and temperature thresholds. While a drill is active,
`/api/status` reports the simulated temperature, capped `applied` values and a
`thermal.drill` object:

```json
{ "active": true, "elapsed": 31.2, "stageIndex": 1, "temperatureC": 35.9, "totalSeconds": 540, "escalationSeconds": 120, "nextStageInSeconds": 89 }
```

### `GET/POST /api/signal` (SHOULD)

```json
{ "enabled": true, "pin": 14, "activeHigh": true }
```

## 3. Safety rules (enforced by the device)

- The thermal limit applies to the **output**, never only to the UI: `applied`
  is the truth, whatever a client requests.
- Escalation timing (`escalationSeconds`, 10–900 s) runs on the device — no
  client involvement.
- Loss of the temperature sensor while the supervisor is enabled **SHOULD**
  be treated as a fault (conservative limit + visible in status), not as
  "no data, no problem".
