# Request Signing — Specification 1.0.0 (draft)

Write requests across all GrowHub tiers (browser → server, browser → device,
server → device) can be signed so that state-changing API calls cannot be
forged or tampered with on the local network. Reads stay open.

Signing is **opt-in per installation**: it activates when an installation
secret is configured, and everything works unsigned when it is not (mock
demo, first setup). One shared secret per installation, present in three
places: `server/config.json` (`apiSecret`), each device's config
(`apiSecret` in the irrigation controller's `wifi.json`), and the browser
(stored locally, entered once in the settings UI).

## Scheme

HMAC-SHA256 over a canonical string:

```text
canonical = "v1\n" + timestamp + "\n" + METHOD + "\n" + pathname + "\n" + sha256hex(body)
signature = hmac_sha256_hex(secret, canonical)
```

- `timestamp` — Unix epoch **milliseconds**, as sent in the header.
- `METHOD` — uppercase HTTP method (`POST`, `DELETE`).
- `pathname` — URL path only, **no query string** (queries appear only on
  reads and on the range-delete endpoint, where the body hash of the empty
  body still binds the signature to time and path).
- `sha256hex(body)` — lowercase hex SHA-256 of the raw request body
  (empty string for bodyless requests).

Headers on the request:

```text
X-GrowHub-Timestamp: 1787000000000
X-GrowHub-Signature: v1:<hex>
```

## Verification rules

- Applies to all write methods (`POST`, `DELETE`) when a secret is
  configured; `GET` is never signed.
- Reject with **401** and `{ "error": "…" }` when the signature is missing,
  malformed, or wrong. Comparison MUST be constant-time.
- **Replay window:** reject when `|now − timestamp| > 5 min`. Devices without
  a valid clock skip only the window check, never the signature check.
- When the GrowHub Server proxies a signed write, it verifies the incoming
  signature against its own path (`/api/devices/<id>/…`) and **re-signs**
  the forwarded request against the device path with the same secret.

## Provisioning

The secret is set out-of-band: in `server/config.json`, in the device
filesystem image, and once in the browser UI. Rotating it means updating all
three. Roadmap: per-device secrets and a hardware-key (FIDO2) admin mode as
the tamper-proof tier — see the discussion in the device spec roadmaps.
