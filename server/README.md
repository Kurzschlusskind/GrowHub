# GrowHub Server

Persistence layer of a GrowHub installation
([spec/growhub-server.md](../spec/growhub-server.md)) — runs on a PC, home
server or Raspberry Pi. **Zero npm dependencies**: plain `node:http` and the
built-in `node:sqlite`. Requires Node.js >= 24.

Provides:

- **Device registry** from `config.json` — no more `?irrigation=<ip>` query
  parameters; the app detects the server and switches to server mode
- **Device proxy** (`/api/devices/<id>/…`) — the browser talks to one origin
- **History collector** — polls every device, persists status samples and
  irrigation runs to SQLite (`growhub.db`); long ranges are aggregated
  server-side for the app's long-term charts
- **User-controlled retention** — `retentionDays` adjustable in the app
  (persisted in the DB), plus targeted range deletion per device
- **Request signing** — with `apiSecret` set, every write requires an
  HMAC-SHA256 signature ([spec/signing.md](../spec/signing.md)); proxied
  writes are re-signed towards the device
- **Static hosting** of the built web app (`dist/`)

## Run

```text
cp server/config.example.json server/config.json   # edit devices
npm run build                                      # build the app once
node server/src/index.mjs
```

Then open `http://<host>:8420`. The server keeps running when controllers
are unreachable — they show as offline and are retried on the next cycle.

For development without hardware, `node server/tools/mock-devices.mjs`
exposes the reference mocks as HTTP devices on ports 9101/9102 (set
`GROWHUB_SECRET` to enforce write signatures like real firmware).

## License

[PolyForm Strict 1.0.0](../LICENSE).
