# GrowHub Irrigation Controller (ESP32)

PlatformIO-Firmware, die [spec/irrigation-controller.md](../../spec/irrigation-controller.md)
implementiert. Ventile und Pumpen sind **variabel**: Die Topologie kommt
komplett aus `data/topology.json` — die Firmware meldet sie über
`/api/irrigation/capabilities`, GrowHub rendert, was gemeldet wird. Spannung
(12 V / 24 V) ist Sache der Treiberstufe; die Firmware schaltet GPIOs
(`activeLow` pro Bauteil konfigurierbar, Standard: Relais-Board = active-low).

## Verhalten (Kurzfassung der Spec)

- **Fail-safe:** Nach jedem Boot/Reset sind alle Ausgänge aus, bevor
  irgendetwas anderes läuft. Hardware-Watchdog (10 s) rebootet bei Hängern.
- **Eine Pumpe = ein offenes Ventil.** Läufe haben eine harte
  Firmware-Deadline (`maxRunSeconds`), unabhängig von App/WLAN.
- **Sperrzeit** pro Bewässerungsventil (Drainage ausgenommen).
- **Zeitpläne laufen on-device** (NTP); ohne gültige Uhrzeit pausiert.
- **Idempotente Starts** über `runId`, Config-Schreibvorgänge atomar
  (temp + rename), Historie (letzte 30 Läufe) persistent.
- Reihenfolge beim Schalten: Ventil auf → Pumpe an; Pumpe aus → Ventil zu.

## Einrichtung

1. `data/topology.json` an die eigene Anlage anpassen (IDs, Namen, Pins,
   `activeLow`).
2. `data/wifi.example.json` nach `data/wifi.json` kopieren und ausfüllen
   (wird nicht committet).
3. Dateisystem und Firmware flashen:

```text
pio run -t uploadfs
pio run -t upload
```

4. In GrowHub verbinden: `?irrigation=http://<ip-des-esp32>`

## Standard-Pinbelegung (topology.json)

| Bauteil | Pin |
|---|---|
| Pumpe p1 | 26 |
| Ventil v1–v5 | 16, 17, 18, 19, 21 |
| Drainage d1 | 22 |

## Lizenz

[PolyForm Strict 1.0.0](../../LICENSE) — nichtkommerzielle Nutzung erlaubt,
keine kommerzielle Nutzung, keine Weiterverbreitung, keine abgeleiteten Werke.
