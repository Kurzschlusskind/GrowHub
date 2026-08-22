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

## Device API

Controllers talk to GrowHub over documented HTTP contracts — a device that
implements one of the [specifications](spec/README.md) works with the app out
of the box, no app changes required. The device announces its own topology
(pumps, valves, channels); the app renders whatever is reported. The mock is
the reference implementation of every spec.

## Structure

```text
spec/           device API specifications (own sub-project)
firmware/       controller firmware (PlatformIO sub-projects)
src/core/       app shell services: HTTP client, formatting, shared UI
src/devices/    self-contained device modules (adapter + mock + views) + catalog
src/styles/     design system and layout
tools/          firmware embedding helpers
```

Firmware sub-projects: `firmware/lightingcontroller-rs485/` (RS-485 lighting
controller, moved here from its former standalone repository with full
history) and `firmware/irrigationcontroller/` (ESP32 irrigation controller
implementing `spec/irrigation-controller.md` — valve/pump topology is pure
configuration).

## License

- **App & firmware:** [PolyForm Strict 1.0.0](LICENSE) — you may use GrowHub
  for noncommercial purposes, including running it privately at home. No
  commercial use, no distribution, no derivative works. For anything beyond
  that, ask the author.
- **Device API specifications** (`spec/`): [CC BY 4.0](spec/LICENSE) — free
  to implement, including in commercial devices, with attribution.

## Deployment

Every push to `main` builds the app and deploys it to GitHub Pages via GitHub Actions (`.github/workflows/deploy.yml`). The build uses a relative base path, so the same bundle also works when embedded into ESP firmware.
