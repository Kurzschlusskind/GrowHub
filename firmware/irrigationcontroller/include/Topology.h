#pragma once

#include <Arduino.h>
#include <vector>

// Hardware topology, loaded from /topology.json on LittleFS. The firmware
// announces exactly this via /api/irrigation/capabilities — GrowHub renders
// whatever is reported, so valve/pump count is purely a config matter.

struct PumpDef {
  String id;
  String name;
  uint8_t pin = 255;
  bool activeLow = true;
};

struct ValveDef {
  String id;
  String type;  // "irrigation" | "drain"
  String name;
  String pump;
  uint8_t pin = 255;
  bool activeLow = true;
};

class Topology {
 public:
  bool load();  // reads /topology.json; returns false if missing/invalid

  const std::vector<PumpDef>& pumps() const { return pumps_; }
  const std::vector<ValveDef>& valves() const { return valves_; }
  const PumpDef* pump(const String& id) const;
  const ValveDef* valve(const String& id) const;

  String capabilitiesJson() const;

 private:
  std::vector<PumpDef> pumps_;
  std::vector<ValveDef> valves_;
};
