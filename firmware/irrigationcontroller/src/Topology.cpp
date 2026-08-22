#include "Topology.h"

#include <ArduinoJson.h>
#include <LittleFS.h>

#include "Version.h"

bool Topology::load() {
  File file = LittleFS.open("/topology.json", "r");
  if (!file) return false;
  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, file);
  file.close();
  if (err) return false;

  pumps_.clear();
  valves_.clear();
  for (JsonObject p : doc["pumps"].as<JsonArray>()) {
    PumpDef pump;
    pump.id = p["id"].as<String>();
    pump.name = p["name"].as<String>();
    pump.pin = p["pin"] | 255;
    pump.activeLow = p["activeLow"] | true;
    if (pump.id.length() && pump.pin != 255) pumps_.push_back(pump);
  }
  for (JsonObject v : doc["valves"].as<JsonArray>()) {
    ValveDef valve;
    valve.id = v["id"].as<String>();
    valve.type = v["type"] | "irrigation";
    valve.name = v["name"].as<String>();
    valve.pump = v["pump"].as<String>();
    valve.pin = v["pin"] | 255;
    valve.activeLow = v["activeLow"] | true;
    if (valve.id.length() && valve.pin != 255 && pump(valve.pump)) valves_.push_back(valve);
  }
  return !pumps_.empty() && !valves_.empty();
}

const PumpDef* Topology::pump(const String& id) const {
  for (const PumpDef& p : pumps_) {
    if (p.id == id) return &p;
  }
  return nullptr;
}

const ValveDef* Topology::valve(const String& id) const {
  for (const ValveDef& v : valves_) {
    if (v.id == id) return &v;
  }
  return nullptr;
}

String Topology::capabilitiesJson() const {
  JsonDocument doc;
  doc["spec"] = SPEC_VERSION;
  doc["firmware"] = FIRMWARE_VERSION;
  JsonArray pumps = doc["pumps"].to<JsonArray>();
  for (const PumpDef& p : pumps_) {
    JsonObject obj = pumps.add<JsonObject>();
    obj["id"] = p.id;
    obj["name"] = p.name;
  }
  JsonArray valves = doc["valves"].to<JsonArray>();
  for (const ValveDef& v : valves_) {
    JsonObject obj = valves.add<JsonObject>();
    obj["id"] = v.id;
    obj["type"] = v.type;
    obj["name"] = v.name;
    obj["pump"] = v.pump;
  }
  String out;
  serializeJson(doc, out);
  return out;
}
