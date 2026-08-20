# Stückliste (BOM)

| Position | Menge | Beschreibung | Hinweise |
|----------|-------|--------------|----------|
| U1       | 1     | ESP32-DevKitC oder kompatibles Devboard | USB oder serielles Programmierinterface notwendig |
| U2       | 1     | MAX485 oder kompatibler RS-485-Treiber | 3,3 V-Variante bevorzugt |
| J1       | 1     | 2-polige RS-485-Schraubklemme | Verbindung zu A/B-Bus |
| C1       | 1     | 0,1 µF Keramikkondensator | Versorgungspuffer MAX485 |
| R1/R2    | 2     | 120 Ω Abschlusswiderstände (optional) | An den Busenden platzieren |
| PSU      | 1     | 5 V Netzteil (ESP32) | USB oder extern (Onboard-Regler) |
| Kabel    | div.  | Dupont/Schraubklemmen | Verbindung ESP32 ↔ MAX485 |

Optional:

- Gehäuse, Hutschienenadapter oder 3D-Druck zur sicheren Montage.
- Optokoppler/Trennmodule, falls galvanische Trennung benötigt wird.

