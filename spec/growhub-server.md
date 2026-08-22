# GrowHub Server — Specification 0.2.0 (draft)

The GrowHub Server is the persistence and orchestration layer of a GrowHub
installation. It runs on a PC, home server or Raspberry Pi, talks to the
controllers over their device contracts, and serves the web app. Controllers
remain autonomous and safe on their own (device specs §6) — the server adds
what a stateless browser app cannot provide:

| Concern | Without server | With server |
|---|---|---|
| Device connection | `?irrigation=<ip>` query parameter | persistent registry |
| History | device ring buffers (last ~30 runs / 48 samples) | weeks of data in SQLite |
| Notifications | only while a browser tab is open | server-side, always on |
| Cross-device actions | mock-only | real orchestration (roadmap) |

The browser app keeps its **direct mode** (mock or direct controller URLs)
and works without a server — the server is an optional third tier, not a
dependency.

## Architecture

```text
Browser (SPA)  ──HTTP──▶  GrowHub Server (Node, SQLite)  ──HTTP──▶  Controllers (ESP32)
UI only                   registry · proxy · collector             physical truth + safety
```

- The server **proxies** device APIs (`/api/devices/<id>/…`), so the browser
  talks to one origin and controllers need no CORS exposure beyond the LAN.
- The server **collects** history by polling each registered device and
  persisting samples and run events to SQLite.
- Device-owned state stays device-owned: names, topology, safety limits and
  schedules live on the controllers (see the device specs). The server
  stores only what no device can own — the registry, collected history,
  server settings.

## Phases

- **Phase 1:** registry, device proxy, history collector, static hosting.
- **Phase 2 (this document):** SPA server mode (auto-detect, registry-driven
  adapters, long-term history views), user-controlled retention and range
  deletion, request signing ([signing.md](signing.md)).
- **Phase 3:** server-side notifications; cross-device orchestration — the
  thermal supervisor's escalation chain (fan, drain, root flush) executed by
  the server against real controllers; automation rules.

## Configuration

`server/config.json` (see `config.example.json`):

```json
{
  "port": 8420,
  "pollIntervalSeconds": 300,
  "retentionDays": 365,
  "apiSecret": "<installation secret, empty = signing disabled>",
  "devices": [
    { "id": "lighting-main", "type": "lighting-rs485", "endpoint": "http://192.168.178.36" },
    { "id": "irrigation-1", "type": "irrigation", "endpoint": "http://192.168.178.37" }
  ]
}
```

Device `id`s are stable; history rows reference them.

## HTTP API (Phase 1)

All responses JSON, permissive CORS, errors as `{ "error": "…" }`.

### `GET /api/server/info`

```json
{ "name": "growhub-server", "version": "0.1.0", "uptimeSeconds": 1234 }
```

### `GET /api/server/devices`

```json
{
  "devices": [
    { "id": "irrigation-1", "type": "irrigation", "endpoint": "http://…", "online": true, "lastSeenAt": 1787000000000 }
  ]
}
```

`online` reflects the most recent poll or proxy contact.

### `ANY /api/devices/<id>/<path>`

Transparent proxy to the registered device: method, body and response are
passed through unchanged (e.g. `GET /api/devices/irrigation-1/api/irrigation/status`).
Unknown ids: 404. Unreachable devices: 502 with an error body.

### `GET /api/server/history/<id>?from=<ms>&to=<ms>&limit=<n>&bucketMinutes=<m>`

```json
{
  "samples": [ { "at": 1787000000000, "payload": { …device status snapshot… } } ],
  "runs":    [ { "at": 1787000000000, "valve": "v1", "durationSeconds": 90, "trigger": "schedule" } ]
}
```

Samples are periodic status snapshots (every `pollIntervalSeconds`); runs are
irrigation history events, deduplicated by `(device, at, valve)`. With
`bucketMinutes` > 0, samples are aggregated server-side per time bucket and
carry averaged numeric metrics instead of raw payloads
(`{ "at", "ch1", "ch2", "temperature", "count" }`) — this is how the app
renders months of data without shipping every raw row.

### `DELETE /api/server/history/<id>?from=<ms>&to=<ms>` (signed write)

User-controlled range deletion; responds
`{ "deletedSamples": n, "deletedRuns": m }`. Irreversible.

### `GET/POST /api/server/settings` (POST is a signed write)

```json
{ "retentionDays": 365 }
```

`retentionDays` (1–1200) controls automatic pruning after every collector
cycle and is persisted in the database, overriding the config default.

### Request signing

When `apiSecret` is configured, every write endpoint (settings, range
delete, proxied device writes) requires a valid signature per
[signing.md](signing.md); proxied writes are re-signed towards the device.
Reads stay open.

### Static hosting

Any non-`/api/…` path serves the built web app (`dist/`), with `index.html`
as fallback.

## Storage

SQLite via `node:sqlite` (no external dependencies), single file
`server/growhub.db`:

```sql
CREATE TABLE samples ( device_id TEXT, at INTEGER, payload TEXT );
CREATE TABLE runs ( device_id TEXT, at INTEGER, valve TEXT,
                    duration_seconds INTEGER, trigger TEXT,
                    UNIQUE(device_id, at, valve) );
```

## Requirements

- Node.js >= 24 (built-in `node:sqlite`).
- The server MUST keep running when devices are unreachable — collector
  errors mark the device offline and are retried on the next cycle.
- The server MUST NOT be required for device safety. Everything in the
  device specs §5–6 holds without it.
