# GrowHub Sensor Controller (ESP32)

PlatformIO-Firmware, die [spec/sensor-controller.md](../../spec/sensor-controller.md)
implementiert. Das Gerät ist ein reiner **Durchreicher**: Es misst und
meldet — Schwellen, Alarme und die Eskalationskette verwaltet der GrowHub
Server.

Welche Sensorik dahinter steckt (SCD30, SCD41, NDIR, Druck, ein
Zwölf-Sensoren-Stack …), ist reine Konfiguration: `data/sensors.json`
deklariert die Sensoren (`id`, `quantity`, `unit`, `name`, `provider`), die
Firmware meldet exakt das über `/api/sensors/capabilities`.

**Eigene Sensoren anbinden:** In `src/main.cpp` die Funktion `readSensor()`
erweitern — dort wird pro `provider` der eigene Treibercode eingehängt.
Der mitgelieferte Provider `demo` liefert deterministische Pseudowerte,
damit die Firmware ohne verdrahtete Hardware testbar ist. Ein Sensor, der
gerade nicht messen kann, meldet `null` — niemals einen alten Wert.

Weitere Eigenschaften: Config-Mirror für den Server-Abgleich (persistiert
atomar), signierte Schreibzugriffe ([spec/signing.md](../../spec/signing.md),
`apiSecret` in `wifi.json`), Watchdog, Health-Endpunkt, CORS.

## Einrichtung

```text
cp data/wifi.example.json data/wifi.json   # ausfüllen
pio run -t uploadfs
pio run -t upload
```

Direktmodus: `?sensors=http://<ip>` — oder als Registry-Eintrag
(`"type": "sensors"`) in der Server-Config.

## Lizenz

[PolyForm Strict 1.0.0](../../LICENSE).
