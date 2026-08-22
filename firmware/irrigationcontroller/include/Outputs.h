#pragma once

#include "Topology.h"

// GPIO layer. Fail-safe by design: begin() forces every configured output to
// OFF before anything else in the system runs (spec §6).
class Outputs {
 public:
  void begin(const Topology& topology);
  void setPump(const PumpDef& pump, bool on);
  void setValve(const ValveDef& valve, bool on);
  void allOff(const Topology& topology);

 private:
  void write(uint8_t pin, bool activeLow, bool on);
};
