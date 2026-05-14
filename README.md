# GrowHub

Multi-device control app for local ESP controllers.

## Goals

- One app for multiple device types: lighting, irrigation, climate, sensors.
- Device adapters keep firmware-specific APIs isolated.
- The app can run locally during development and later be embedded into ESP firmware.

## Development

```powershell
npm install
npm run dev
```

Open:

```text
http://localhost:5173/
```

Use a real lighting controller:

```text
http://localhost:5173/?lighting=http://192.168.178.36
```

Without a query parameter, GrowHub uses mock data.

## Structure

```text
src/core/       app state, API clients, shared types
src/devices/    device adapters and metadata
src/views/      screen components
src/styles/     design system and layout
tools/          firmware embedding helpers
```
