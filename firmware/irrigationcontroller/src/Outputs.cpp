#include "Outputs.h"

void Outputs::begin(const Topology& topology) {
  // Order matters: drive the safe level first, then switch to OUTPUT, so the
  // pin never glitches to "on" during boot.
  for (const PumpDef& pump : topology.pumps()) {
    digitalWrite(pump.pin, pump.activeLow ? HIGH : LOW);
    pinMode(pump.pin, OUTPUT);
    digitalWrite(pump.pin, pump.activeLow ? HIGH : LOW);
  }
  for (const ValveDef& valve : topology.valves()) {
    digitalWrite(valve.pin, valve.activeLow ? HIGH : LOW);
    pinMode(valve.pin, OUTPUT);
    digitalWrite(valve.pin, valve.activeLow ? HIGH : LOW);
  }
}

void Outputs::setPump(const PumpDef& pump, bool on) {
  write(pump.pin, pump.activeLow, on);
}

void Outputs::setValve(const ValveDef& valve, bool on) {
  write(valve.pin, valve.activeLow, on);
}

void Outputs::allOff(const Topology& topology) {
  for (const PumpDef& pump : topology.pumps()) setPump(pump, false);
  for (const ValveDef& valve : topology.valves()) setValve(valve, false);
}

void Outputs::write(uint8_t pin, bool activeLow, bool on) {
  digitalWrite(pin, activeLow ? (on ? LOW : HIGH) : (on ? HIGH : LOW));
}
