# GrowHub

Multi-device control app for local ESP controllers — lighting, irrigation and climate as one local grow room console.

**Live demo (mock mode):** https://kurzschlusskind.github.io/GrowHub/

Without a connected controller, GrowHub runs on mock data — every panel is fully interactive, so the demo behaves like the real thing.

## Goals

- One app for multiple device types: lighting, irrigation, climate, sensors.
- Device adapters keep firmware-specific APIs isolated.
- The app runs locally during development and can later be embedded into ESP firmware (`npm run embed`).

## Development

Requires Node.js >= 20.19.

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

Use a real controller by passing its endpoint as a query parameter:

```text
http://localhost:5173/?lighting=http://192.168.178.36
http://localhost:5173/?irrigation=http://192.168.178.37
```

Without a query parameter, GrowHub uses mock data. The irrigation controller currently always runs on mock data — the hardware integration is still in progress and marked as such in the UI.

## Structure

```text
src/core/       app state, API clients, formatting, mock data
src/devices/    device adapters and catalog
src/styles/     design system and layout
tools/          firmware embedding helpers
```

## License

**All rights reserved.** This repository is public for demonstration purposes
only — using the code in any form requires the explicit written permission of
the author. See [LICENSE](LICENSE).

## Deployment

Every push to `main` builds the app and deploys it to GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`). The build uses a relative base path, so the same bundle also works when embedded into ESP firmware.
