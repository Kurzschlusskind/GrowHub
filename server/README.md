# GrowHub Server

Persistence layer of a GrowHub installation
([spec/growhub-server.md](../spec/growhub-server.md)) — runs on a PC, home
server or Raspberry Pi. **Zero npm dependencies**: plain `node:http` and the
built-in `node:sqlite`. Requires Node.js >= 24.

Phase 1 provides:

- **Device registry** from `config.json` — no more `?irrigation=<ip>` query
  parameters
- **Device proxy** (`/api/devices/<id>/…`) — the browser talks to one origin
- **History collector** — polls every device, persists status samples and
  irrigation runs to SQLite (`growhub.db`), prunes by `retentionDays`
- **Static hosting** of the built web app (`dist/`)

## Run

```text
cp server/config.example.json server/config.json   # edit devices
npm run build                                      # build the app once
node server/src/index.mjs
```

Then open `http://<host>:8420`. The server keeps running when controllers
are unreachable — they show as offline and are retried on the next cycle.

## License

[PolyForm Strict 1.0.0](../LICENSE).
