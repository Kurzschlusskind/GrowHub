#pragma once

#include <Arduino.h>
#include <vector>

#include "Outputs.h"
#include "Topology.h"

// Core logic implementing spec/irrigation-controller.md: one open valve per
// pump, hard per-run deadline, lockout for irrigation valves, device-side
// schedule execution, idempotent runs, atomic config persistence.

struct RunState {
  bool running = false;
  String valve;
  uint32_t startedMs = 0;
  uint16_t durationS = 0;
  String trigger;  // "manual" | "schedule" | "thermal"
};

struct ValveState {
  uint64_t lastRunAtMs = 0;   // epoch ms, 0 = unknown (no valid clock)
  uint32_t lastRunTickMs = 0; // millis() at end of last run, 0 = never
  uint16_t lastDurationS = 0;
};

struct ScheduleWindow {
  String valve;
  uint16_t time = 0;  // minutes since midnight
  uint16_t durationS = 60;
  bool enabled = true;
};

struct HistoryEvent {
  uint64_t atMs = 0;  // epoch ms, 0 = unknown
  String valve;
  uint16_t durationS = 0;
  String trigger;
};

class IrrigationController {
 public:
  void begin(Topology* topology, Outputs* outputs);
  void tick();  // call from loop(): enforces deadlines, runs the scheduler

  // Commands. On failure `error` carries the user-facing message.
  bool startRun(const String& valveId, uint16_t durationS, const String& runId,
                String& error, bool& duplicate);
  void stopRun(const String& pumpId);

  // Config, replaces the whole document (spec §3).
  bool applySchedules(const String& body, String& error);
  bool applySafety(const String& body, String& error);

  String statusJson() const;
  String healthJson() const;
  String schedulesJson() const;
  String safetyJson() const;
  String historyJson() const;

 private:
  Topology* topology_ = nullptr;
  Outputs* outputs_ = nullptr;

  std::vector<RunState> runs_;          // parallel to topology pumps
  std::vector<ValveState> valveStates_; // parallel to topology valves
  std::vector<ScheduleWindow> windows_;
  bool schedulesEnabled_ = true;
  uint16_t maxRunSeconds_ = 300;
  uint16_t lockoutMinutes_ = 10;
  std::vector<HistoryEvent> history_;
  std::vector<String> recentRunIds_;
  int lastMinuteOfDay_ = -1;

  RunState* runForPump(const String& pumpId);
  ValveState* stateForValve(const String& valveId);
  bool clockValid() const;
  bool valveLocked(const ValveDef& valve) const;
  void beginRun(const PumpDef& pump, const ValveDef& valve, uint16_t durationS,
                const char* trigger);
  void finishRun(size_t pumpIndex, uint16_t actualSeconds);
  void recordEvent(const String& valveId, uint16_t durationS, const String& trigger);
  void runScheduler();

  void loadPersisted();
  void persistSchedules();
  void persistSafety();
  void persistHistory();
  static bool writeAtomic(const char* path, const String& json);
};
