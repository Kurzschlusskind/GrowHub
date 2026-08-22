#include "IrrigationController.h"

#include <ArduinoJson.h>
#include <LittleFS.h>
#include <WiFi.h>
#include <esp_system.h>
#include <time.h>

#include "Version.h"

namespace {
constexpr uint64_t kMinValidEpoch = 1600000000ULL;  // 2020-09-13, sanity floor
constexpr size_t kHistoryLimit = 30;
constexpr size_t kRunIdLimit = 16;
constexpr size_t kQueueLimitPerPump = 8;
}  // namespace

// Per-pump schedule queues live outside the class to keep the header lean.
static std::vector<std::vector<ScheduleWindow>> s_queues;

void IrrigationController::begin(Topology* topology, Outputs* outputs) {
  topology_ = topology;
  outputs_ = outputs;
  runs_.assign(topology_->pumps().size(), RunState{});
  valveStates_.assign(topology_->valves().size(), ValveState{});
  s_queues.assign(topology_->pumps().size(), {});
  loadPersisted();
}

bool IrrigationController::clockValid() const {
  return (uint64_t)time(nullptr) > kMinValidEpoch;
}

RunState* IrrigationController::runForPump(const String& pumpId) {
  const auto& pumps = topology_->pumps();
  for (size_t i = 0; i < pumps.size(); i++) {
    if (pumps[i].id == pumpId) return &runs_[i];
  }
  return nullptr;
}

ValveState* IrrigationController::stateForValve(const String& valveId) {
  const auto& valves = topology_->valves();
  for (size_t i = 0; i < valves.size(); i++) {
    if (valves[i].id == valveId) return &valveStates_[i];
  }
  return nullptr;
}

bool IrrigationController::valveLocked(const ValveDef& valve) const {
  if (valve.type != "irrigation") return false;  // drain valves are exempt
  for (size_t i = 0; i < topology_->valves().size(); i++) {
    if (topology_->valves()[i].id != valve.id) continue;
    const ValveState& state = valveStates_[i];
    if (state.lastRunTickMs == 0) return false;
    return (uint32_t)(millis() - state.lastRunTickMs) < (uint32_t)lockoutMinutes_ * 60000UL;
  }
  return false;
}

void IrrigationController::beginRun(const PumpDef& pump, const ValveDef& valve,
                                    uint16_t durationS, const char* trigger) {
  RunState* run = runForPump(pump.id);
  run->running = true;
  run->valve = valve.id;
  run->startedMs = millis();
  run->durationS = min(durationS, maxRunSeconds_);
  if (run->durationS == 0) run->durationS = 1;
  run->trigger = trigger;
  // Open the valve before the pump starts so the pump never runs dead-headed.
  outputs_->setValve(valve, true);
  outputs_->setPump(pump, true);
}

void IrrigationController::finishRun(size_t pumpIndex, uint16_t actualSeconds) {
  RunState& run = runs_[pumpIndex];
  const PumpDef& pump = topology_->pumps()[pumpIndex];
  const ValveDef* valve = topology_->valve(run.valve);
  // Pump off first, then close the valve — no pressure spike against a
  // closed line.
  outputs_->setPump(pump, false);
  if (valve) outputs_->setValve(*valve, false);
  if (ValveState* state = stateForValve(run.valve)) {
    state->lastRunTickMs = millis() == 0 ? 1 : millis();
    state->lastRunAtMs = clockValid() ? (uint64_t)time(nullptr) * 1000ULL : 0;
    state->lastDurationS = actualSeconds;
  }
  recordEvent(run.valve, actualSeconds, run.trigger);
  run.running = false;
  run.valve = "";
  run.durationS = 0;
}

void IrrigationController::recordEvent(const String& valveId, uint16_t durationS,
                                       const String& trigger) {
  HistoryEvent event;
  event.atMs = clockValid() ? (uint64_t)time(nullptr) * 1000ULL : 0;
  event.valve = valveId;
  event.durationS = durationS;
  event.trigger = trigger;
  history_.insert(history_.begin(), event);
  if (history_.size() > kHistoryLimit) history_.resize(kHistoryLimit);
  persistHistory();
}

void IrrigationController::tick() {
  // Hard per-run deadline — fires with or without any client (spec §5).
  for (size_t i = 0; i < runs_.size(); i++) {
    if (runs_[i].running &&
        (uint32_t)(millis() - runs_[i].startedMs) >= (uint32_t)runs_[i].durationS * 1000UL) {
      finishRun(i, runs_[i].durationS);
    }
  }

  runScheduler();

  // Start queued runs on idle pumps; locked valves are skipped (spec §4).
  for (size_t i = 0; i < runs_.size(); i++) {
    while (!runs_[i].running && !s_queues[i].empty()) {
      ScheduleWindow next = s_queues[i].front();
      s_queues[i].erase(s_queues[i].begin());
      const ValveDef* valve = topology_->valve(next.valve);
      if (!valve || valveLocked(*valve)) continue;
      beginRun(topology_->pumps()[i], *valve, next.durationS, "schedule");
    }
  }
}

void IrrigationController::runScheduler() {
  // No valid clock -> schedules suspended, never fired at guessed times.
  if (!clockValid()) {
    lastMinuteOfDay_ = -1;
    return;
  }
  time_t now = time(nullptr);
  struct tm local;
  localtime_r(&now, &local);
  int minuteOfDay = local.tm_hour * 60 + local.tm_min;
  if (lastMinuteOfDay_ < 0) {
    lastMinuteOfDay_ = minuteOfDay;  // no catch-up at boot: missed = missed
    return;
  }
  while (lastMinuteOfDay_ != minuteOfDay) {
    lastMinuteOfDay_ = (lastMinuteOfDay_ + 1) % 1440;
    if (!schedulesEnabled_) continue;
    for (const ScheduleWindow& window : windows_) {
      if (!window.enabled || window.time != lastMinuteOfDay_) continue;
      const ValveDef* valve = topology_->valve(window.valve);
      if (!valve) continue;
      const auto& pumps = topology_->pumps();
      for (size_t i = 0; i < pumps.size(); i++) {
        if (pumps[i].id == valve->pump && s_queues[i].size() < kQueueLimitPerPump) {
          s_queues[i].push_back(window);
        }
      }
    }
  }
}

bool IrrigationController::startRun(const String& valveId, uint16_t durationS,
                                    const String& runId, String& error, bool& duplicate) {
  duplicate = false;
  if (runId.length()) {
    for (const String& seen : recentRunIds_) {
      if (seen == runId) {
        duplicate = true;
        return true;  // idempotent retry (spec §3)
      }
    }
  }
  const ValveDef* valve = topology_->valve(valveId);
  if (!valve) {
    error = "Unbekanntes Ventil";
    return false;
  }
  RunState* run = runForPump(valve->pump);
  if (!run) {
    error = "Unbekannte Pumpe";
    return false;
  }
  if (run->running) {
    const ValveDef* active = topology_->valve(run->valve);
    error = "Pumpe belegt — " + (active ? active->name : String("anderes Ventil")) + " läuft noch";
    return false;
  }
  if (valveLocked(*valve)) {
    const ValveState* state = stateForValve(valveId);
    uint32_t elapsedMs = millis() - state->lastRunTickMs;
    uint32_t waitMin = ((uint32_t)lockoutMinutes_ * 60000UL - elapsedMs + 59999UL) / 60000UL;
    error = "Sperrzeit aktiv — " + valve->name + " ist in " + String(waitMin) + " min wieder freigegeben";
    return false;
  }
  beginRun(*topology_->pump(valve->pump), *valve, durationS, "manual");
  if (runId.length()) {
    recentRunIds_.push_back(runId);
    if (recentRunIds_.size() > kRunIdLimit) recentRunIds_.erase(recentRunIds_.begin());
  }
  return true;
}

void IrrigationController::stopRun(const String& pumpId) {
  const auto& pumps = topology_->pumps();
  for (size_t i = 0; i < pumps.size(); i++) {
    if (pumps[i].id == pumpId && runs_[i].running) {
      uint32_t elapsedS = (uint32_t)(millis() - runs_[i].startedMs) / 1000UL;
      uint16_t actual = elapsedS < 1 ? 1 : (uint16_t)min(elapsedS, (uint32_t)65535);
      finishRun(i, actual);
    }
  }
}

bool IrrigationController::applySchedules(const String& body, String& error) {
  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    error = "Ungültiges JSON";
    return false;
  }
  std::vector<ScheduleWindow> windows;
  for (JsonObject w : doc["windows"].as<JsonArray>()) {
    ScheduleWindow window;
    window.valve = w["valve"].as<String>();
    window.time = min((int)(w["time"] | 0), 1439);
    window.durationS = min((int)(w["durationSeconds"] | 60), (int)maxRunSeconds_);
    window.enabled = w["enabled"] | true;
    if (topology_->valve(window.valve)) windows.push_back(window);
  }
  windows_ = windows;
  schedulesEnabled_ = doc["enabled"] | true;
  persistSchedules();
  return true;
}

bool IrrigationController::applySafety(const String& body, String& error) {
  JsonDocument doc;
  if (deserializeJson(doc, body)) {
    error = "Ungültiges JSON";
    return false;
  }
  maxRunSeconds_ = constrain((int)(doc["maxRunSeconds"] | 300), 10, 3600);
  lockoutMinutes_ = constrain((int)(doc["lockoutMinutes"] | 10), 0, 1440);
  persistSafety();
  return true;
}

String IrrigationController::statusJson() const {
  JsonDocument doc;
  doc["firmware"] = FIRMWARE_VERSION;
  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["connected"] = WiFi.isConnected();
  wifi["ssid"] = WiFi.SSID();
  wifi["ip"] = WiFi.localIP().toString();
  wifi["rssi"] = WiFi.RSSI();
  JsonArray pumps = doc["pumps"].to<JsonArray>();
  const auto& pumpDefs = topology_->pumps();
  for (size_t i = 0; i < pumpDefs.size(); i++) {
    JsonObject obj = pumps.add<JsonObject>();
    obj["id"] = pumpDefs[i].id;
    obj["running"] = runs_[i].running;
    if (runs_[i].running) {
      obj["valve"] = runs_[i].valve;
      obj["durationSeconds"] = runs_[i].durationS;
      uint32_t elapsedS = (uint32_t)(millis() - runs_[i].startedMs) / 1000UL;
      obj["remainingSeconds"] = elapsedS >= runs_[i].durationS ? 0 : runs_[i].durationS - elapsedS;
    } else {
      obj["valve"] = nullptr;
      obj["durationSeconds"] = 0;
      obj["remainingSeconds"] = 0;
    }
  }
  JsonArray valves = doc["valves"].to<JsonArray>();
  const auto& valveDefs = topology_->valves();
  for (size_t i = 0; i < valveDefs.size(); i++) {
    JsonObject obj = valves.add<JsonObject>();
    obj["id"] = valveDefs[i].id;
    bool running = false;
    for (size_t p = 0; p < runs_.size(); p++) {
      if (runs_[p].running && runs_[p].valve == valveDefs[i].id) running = true;
    }
    obj["state"] = running ? "running" : "ready";
    obj["lastRunAt"] = valveStates_[i].lastRunAtMs;
    obj["lastDurationSeconds"] = valveStates_[i].lastDurationS;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

String IrrigationController::healthJson() const {
  JsonDocument doc;
  doc["uptimeSeconds"] = (uint32_t)(millis() / 1000UL);
  switch (esp_reset_reason()) {
    case ESP_RST_POWERON: doc["resetReason"] = "power-on"; break;
    case ESP_RST_TASK_WDT:
    case ESP_RST_INT_WDT:
    case ESP_RST_WDT: doc["resetReason"] = "watchdog"; break;
    case ESP_RST_BROWNOUT: doc["resetReason"] = "brownout"; break;
    case ESP_RST_SW: doc["resetReason"] = "software"; break;
    default: doc["resetReason"] = "other"; break;
  }
  doc["heapFreeBytes"] = ESP.getFreeHeap();
  JsonObject wifi = doc["wifi"].to<JsonObject>();
  wifi["connected"] = WiFi.isConnected();
  wifi["ssid"] = WiFi.SSID();
  wifi["ip"] = WiFi.localIP().toString();
  wifi["rssi"] = WiFi.RSSI();
  doc["clockValid"] = clockValid();
  if (clockValid()) {
    time_t now = time(nullptr);
    struct tm utc;
    gmtime_r(&now, &utc);
    char buffer[24];
    strftime(buffer, sizeof(buffer), "%Y-%m-%dT%H:%M:%SZ", &utc);
    doc["time"] = buffer;
  } else {
    doc["time"] = nullptr;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

String IrrigationController::schedulesJson() const {
  JsonDocument doc;
  doc["enabled"] = schedulesEnabled_;
  JsonArray windows = doc["windows"].to<JsonArray>();
  for (const ScheduleWindow& window : windows_) {
    JsonObject obj = windows.add<JsonObject>();
    obj["valve"] = window.valve;
    obj["time"] = window.time;
    obj["durationSeconds"] = window.durationS;
    obj["enabled"] = window.enabled;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

String IrrigationController::safetyJson() const {
  JsonDocument doc;
  doc["maxRunSeconds"] = maxRunSeconds_;
  doc["lockoutMinutes"] = lockoutMinutes_;
  String out;
  serializeJson(doc, out);
  return out;
}

String IrrigationController::historyJson() const {
  JsonDocument doc;
  JsonArray events = doc["events"].to<JsonArray>();
  for (const HistoryEvent& event : history_) {
    JsonObject obj = events.add<JsonObject>();
    obj["at"] = event.atMs;
    obj["valve"] = event.valve;
    obj["durationSeconds"] = event.durationS;
    obj["trigger"] = event.trigger;
  }
  String out;
  serializeJson(doc, out);
  return out;
}

void IrrigationController::loadPersisted() {
  String error;
  File safety = LittleFS.open("/safety.json", "r");
  if (safety) {
    String body = safety.readString();
    safety.close();
    applySafety(body, error);
  }
  File schedules = LittleFS.open("/schedules.json", "r");
  if (schedules) {
    String body = schedules.readString();
    schedules.close();
    applySchedules(body, error);
  }
  File history = LittleFS.open("/history.json", "r");
  if (history) {
    JsonDocument doc;
    if (!deserializeJson(doc, history)) {
      for (JsonObject e : doc["events"].as<JsonArray>()) {
        HistoryEvent event;
        event.atMs = e["at"] | 0ULL;
        event.valve = e["valve"].as<String>();
        event.durationS = e["durationSeconds"] | 0;
        event.trigger = e["trigger"].as<String>();
        history_.push_back(event);
        if (history_.size() >= kHistoryLimit) break;
      }
    }
    history.close();
  }
}

void IrrigationController::persistSchedules() { writeAtomic("/schedules.json", schedulesJson()); }
void IrrigationController::persistSafety() { writeAtomic("/safety.json", safetyJson()); }
void IrrigationController::persistHistory() { writeAtomic("/history.json", historyJson()); }

// Write-temp-then-rename so a power cut never leaves a half-written config
// (spec §6). LittleFS rename() does not overwrite, hence the remove().
bool IrrigationController::writeAtomic(const char* path, const String& json) {
  String tmp = String(path) + ".tmp";
  File file = LittleFS.open(tmp.c_str(), "w");
  if (!file) return false;
  size_t written = file.print(json);
  file.close();
  if (written != json.length()) return false;
  LittleFS.remove(path);
  return LittleFS.rename(tmp.c_str(), path);
}
