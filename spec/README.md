# GrowHub Device API Specifications

This directory is a self-contained sub-project: the HTTP contracts that GrowHub
speaks to its controllers. A device that implements one of these specifications
works with the GrowHub app out of the box — connect it via query parameter
(e.g. `?irrigation=http://<device-ip>`), no app changes required.

The GrowHub mock (`src/core/mock.js`) is the reference implementation of these
contracts: everything specified here can be observed live in the
[demo](https://kurzschlusskind.github.io/GrowHub/).

## Specifications

| Spec | Version | Status |
|------|---------|--------|
| [Irrigation Controller](irrigation-controller.md) | 1.0.0 | draft |
| [Lighting Controller](lighting-controller.md) | 1.0.0 | draft |
| [Sensor Controller](sensor-controller.md) | 1.0.0 | draft |
| [GrowHub Server](growhub-server.md) | 0.3.0 | draft |
| [Request Signing](signing.md) | 1.0.0 | draft |

## License

The specifications in this directory are licensed under
[CC BY 4.0](LICENSE) (© 2026 Lennard Musch) — implement them freely,
including in commercial devices, with attribution. Note that this covers the
specifications only; the GrowHub app and firmware are licensed separately
(PolyForm Strict 1.0.0, see the repository root LICENSE).

## Versioning

Each specification carries its own semantic version, stated at the top of the
document. Breaking changes to request/response shapes bump the major version.
Firmware should report the spec version it implements in its capabilities
response so the app can detect mismatches.

## Design principles

1. **The device is autonomous.** Schedules run on the controller, safety limits
   are enforced by the controller, and the device boots into a safe state. The
   app is a stateless remote control — it must never be required for safe
   operation.
2. **The device describes itself.** Topology (pumps, valves, sensors) comes
   from the device via its capabilities endpoint. The app renders whatever is
   reported; nothing about the hardware layout is configured in the app.
3. **State is read, never assumed.** The app treats every command as a request
   and confirms the outcome by reading device state afterwards. Commands are
   idempotent so retries are safe.
