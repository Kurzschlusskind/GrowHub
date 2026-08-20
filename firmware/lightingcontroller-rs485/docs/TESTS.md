# Tests & Verifikation

## Unit-Tests (PlatformIO Unity)

Ausführen:

```bash
pio test
```

### Abgedeckte Fälle

1. **Kalibrier-Mapping**
   - Prüft Interpolation anhand der Default-Messpunkte (z. B. 25 %, 50 %, 73 %, 100 %).
   - Kontrolliert Identity-Mode (100 % → 255, 0 % → 0).
2. **Frame-Erstellung**
   - Summe `SUM = (CH1+…+CH5) mod 256`.
   - Beispiel VEGI/FLOWER Frame (3F 26 → SUM 0x65).
3. **Parser**
   - Vollformat mit Header `F1 E2 … F3`.
   - Kurzformat ohne Header (nur Kanäle + Summe + F3).
   - Sum-Validation (gültig/ungültig).

## Manuelle Checks

1. Web-UI aufrufen, Slider bewegen → Raw-Werte aktualisieren, Log zeigt Set-Events.
2. `Allow TX` deaktiviert: Send-Button erzeugt Dry-Run (`dry:true` im WebSocket-Event, keine DE-Pin Umschaltung).
3. `Allow TX` aktiv + Heartbeat 2000 ms: LED blinkt kurz, Log zeigt TX alle 2 s.
4. Sniffer: Eingehende Frame-Beispiele (`F1 E2 58 25 00 00 00 7D F3`) werden als gültig markiert.

## Beispiel-Parser-Output

Für das Frame `F1 E2 3F 26 00 00 00 65 F3` erwartet der Parser:

```json
{
  "channels": [63, 38, 0, 0, 0],
  "receivedSum": 101,
  "calculatedSum": 101,
  "sumValid": true,
  "hadHeader": true,
  "short": false
}
```

