import { DRILL_FLUSH_SECONDS, thermalDrillSnapshot } from "../../core/mock";

// Reference implementation of spec/irrigation-controller.md. Self-contained:
// everything irrigation lives inside this device module.

function hoursAgo(hours) {
  return Date.now() - hours * 3600000;
}

// Timestamp of a schedule window's occurrence `daysBack` days ago.
function occurrenceOnDay(timeMinutes, daysBack) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime() - daysBack * 86400000 + timeMinutes * 60000;
}

// The controller announces its own topology (spec §2); the app renders
// whatever is reported. This mock mirrors the real rig: one pump, five
// irrigation valves, one drain valve to flush the line.
export const irrigationCapabilities = {
  spec: "1.0.0",
  firmware: "mock",
  pumps: [{ id: "p1", name: "Hauptpumpe" }],
  valves: [
    { id: "v1", type: "irrigation", name: "Zone 1 · Tropf", pump: "p1" },
    { id: "v2", type: "irrigation", name: "Zone 2 · Tropf", pump: "p1" },
    { id: "v3", type: "irrigation", name: "Zone 3 · Tropf", pump: "p1" },
    { id: "v4", type: "irrigation", name: "Zone 4 · Tropf", pump: "p1" },
    { id: "v5", type: "irrigation", name: "Zone 5 · Sprüher", pump: "p1" },
    { id: "d1", type: "drain", name: "Drainage", pump: "p1" },
  ],
};

const irrigationWindows = [
  { valve: "v1", time: 390, durationSeconds: 90, enabled: true },
  { valve: "v2", time: 395, durationSeconds: 90, enabled: true },
  { valve: "v3", time: 400, durationSeconds: 90, enabled: true },
  { valve: "v4", time: 405, durationSeconds: 90, enabled: true },
  { valve: "v5", time: 1140, durationSeconds: 45, enabled: false },
];

// Seed history is derived from the configured schedule windows — the mock
// behaves like firmware that has been running this schedule for a week.
function seedIrrigationHistory(windows) {
  const events = [];
  for (let day = 0; day < 7; day++) {
    for (const window of windows) {
      if (!window.enabled) continue;
      const startedAt = occurrenceOnDay(window.time, day);
      if (startedAt + window.durationSeconds * 1000 < Date.now()) {
        events.push({ at: startedAt + window.durationSeconds * 1000, valve: window.valve, durationSeconds: window.durationSeconds, trigger: "schedule" });
      }
    }
  }
  events.push({ at: hoursAgo(30), valve: "v5", durationSeconds: 45, trigger: "manual" });
  events.push({ at: hoursAgo(54), valve: "d1", durationSeconds: 30, trigger: "manual" });
  return events.sort((a, b) => b.at - a.at).slice(0, 30);
}

const irrigationHistory = seedIrrigationHistory(irrigationWindows);

function lastEventFor(valveId) {
  return irrigationHistory.find((event) => event.valve === valveId);
}

const irrigationState = {
  bootAt: Date.now(),
  wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.37", rssi: -61 },
  pumps: Object.fromEntries(irrigationCapabilities.pumps.map((pump) => [
    pump.id,
    { running: false, valve: null, startedAt: 0, durationSeconds: 0, trigger: "manual" },
  ])),
  valves: Object.fromEntries(irrigationCapabilities.valves.map((valve) => [
    valve.id,
    { lastRunAt: lastEventFor(valve.id)?.at || 0, lastDurationSeconds: lastEventFor(valve.id)?.durationSeconds || 0 },
  ])),
  schedules: { enabled: true, windows: irrigationWindows },
  safety: { maxRunSeconds: 300, lockoutMinutes: 10 },
  history: irrigationHistory,
  recentRunIds: [],
};

function valveMeta(valveId) {
  return irrigationCapabilities.valves.find((valve) => valve.id === valveId) || null;
}

// Lockout protects roots from double watering — drain valves are exempt
// (spec §5).
function valveLocked(valveId, now = Date.now()) {
  const meta = valveMeta(valveId);
  if (!meta || meta.type !== "irrigation") return false;
  const valve = irrigationState.valves[valveId];
  return Boolean(valve.lastRunAt) && now - valve.lastRunAt < irrigationState.safety.lockoutMinutes * 60000;
}

// Live schedule execution: windows fire at their start time and are enqueued
// on their valve's pump; each pump processes its queue sequentially, valves
// inside their lockout are skipped (spec §4).
const scheduler = { lastCheck: Date.now(), queues: {} };

function advanceIrrigation() {
  const now = Date.now();

  for (const pump of Object.values(irrigationState.pumps)) {
    if (pump.running && now - pump.startedAt >= pump.durationSeconds * 1000) {
      finishPumpRun(pump);
    }
  }

  if (irrigationState.schedules.enabled) {
    for (const window of irrigationState.schedules.windows) {
      if (!window.enabled) continue;
      let occurrence = occurrenceOnDay(window.time, 0);
      if (occurrence > now) occurrence -= 86400000;
      if (occurrence > scheduler.lastCheck && occurrence <= now) {
        const pumpId = valveMeta(window.valve)?.pump;
        if (!pumpId) continue;
        if (!scheduler.queues[pumpId]) scheduler.queues[pumpId] = [];
        scheduler.queues[pumpId].push({ valve: window.valve, durationSeconds: window.durationSeconds });
      }
    }
  }
  scheduler.lastCheck = now;

  for (const [pumpId, queue] of Object.entries(scheduler.queues)) {
    const pump = irrigationState.pumps[pumpId];
    while (pump && !pump.running && queue.length) {
      const next = queue.shift();
      if (valveLocked(next.valve, now)) continue;
      beginPumpRun(pumpId, next.valve, next.durationSeconds, "schedule");
    }
  }

  advanceDrillRuns();
}

function beginPumpRun(pumpId, valveId, durationSeconds, trigger) {
  const pump = irrigationState.pumps[pumpId];
  pump.running = true;
  pump.valve = valveId;
  pump.startedAt = Date.now();
  pump.durationSeconds = Math.min(Math.max(1, Math.round(durationSeconds)), irrigationState.safety.maxRunSeconds);
  pump.trigger = trigger;
}

function finishPumpRun(pump, actualSeconds = pump.durationSeconds) {
  const endedAt = pump.startedAt + actualSeconds * 1000;
  recordRun(pump.valve, endedAt, actualSeconds, pump.trigger);
  pump.running = false;
  pump.valve = null;
  pump.durationSeconds = 0;
}

function recordRun(valveId, endedAt, durationSeconds, trigger) {
  const valve = irrigationState.valves[valveId];
  if (valve) {
    valve.lastRunAt = endedAt;
    valve.lastDurationSeconds = durationSeconds;
  }
  irrigationState.history.unshift({ at: endedAt, valve: valveId, durationSeconds, trigger });
  irrigationState.history = irrigationState.history.slice(0, 30);
}

/* --- supervisor drill integration ---
   The lighting controller's drill commands an emergency drain (drain stage)
   and a root flush (flush stage). The irrigation mock derives both from the
   drill snapshot and logs them as trigger "thermal". */

const drillRuns = { seenStart: 0, drainLogged: false, flushLogged: false };

function currentDrillRun() {
  const drill = thermalDrillSnapshot();
  if (!drill) return null;
  const escalation = drill.escalationSeconds;
  const drainElapsed = drill.elapsed - escalation * 2;
  const flushElapsed = drill.elapsed - escalation * 3;
  if (drill.stageIndex === 2 && drainElapsed >= 0 && drainElapsed < DRILL_FLUSH_SECONDS) {
    return { valve: "d1", pump: "p1", remainingSeconds: Math.max(0, Math.round(DRILL_FLUSH_SECONDS - drainElapsed)) };
  }
  if (drill.stageIndex === 3 && flushElapsed >= 0 && flushElapsed < DRILL_FLUSH_SECONDS) {
    return { valve: "v1", pump: "p1", remainingSeconds: Math.max(0, Math.round(DRILL_FLUSH_SECONDS - flushElapsed)) };
  }
  return null;
}

function advanceDrillRuns() {
  const drill = thermalDrillSnapshot();
  if (!drill) return;
  if (drill.startedAt !== drillRuns.seenStart) {
    drillRuns.seenStart = drill.startedAt;
    drillRuns.drainLogged = false;
    drillRuns.flushLogged = false;
  }
  const escalation = drill.escalationSeconds;
  if (!drillRuns.drainLogged && drill.elapsed >= escalation * 2 + DRILL_FLUSH_SECONDS) {
    drillRuns.drainLogged = true;
    recordRun("d1", Date.now(), DRILL_FLUSH_SECONDS, "thermal");
  }
  if (!drillRuns.flushLogged && drill.elapsed >= escalation * 3 + DRILL_FLUSH_SECONDS) {
    drillRuns.flushLogged = true;
    recordRun("v1", Date.now(), DRILL_FLUSH_SECONDS, "thermal");
  }
}

function startManualRun(valveId, durationSeconds, runId) {
  if (runId && irrigationState.recentRunIds.includes(runId)) return { ok: true, duplicate: true };
  const meta = valveMeta(valveId);
  if (!meta) throw new Error("Unbekanntes Ventil");
  const pump = irrigationState.pumps[meta.pump];
  const emergency = currentDrillRun();
  if (pump.running || emergency?.pump === meta.pump) {
    const activeId = pump.running ? pump.valve : emergency.valve;
    throw new Error(`Pumpe belegt — ${valveMeta(activeId)?.name || "anderes Ventil"} läuft noch`);
  }
  if (valveLocked(valveId)) {
    const valve = irrigationState.valves[valveId];
    const waitMinutes = Math.ceil((irrigationState.safety.lockoutMinutes * 60000 - (Date.now() - valve.lastRunAt)) / 60000);
    throw new Error(`Sperrzeit aktiv — ${meta.name} ist in ${waitMinutes} min wieder freigegeben`);
  }
  beginPumpRun(meta.pump, valveId, durationSeconds, "manual");
  if (runId) irrigationState.recentRunIds = [...irrigationState.recentRunIds, runId].slice(-16);
  return { ok: true };
}

export function mockIrrigationRequest(path, init = {}) {
  advanceIrrigation();
  const state = irrigationState;

  if (path === "/api/irrigation/capabilities") {
    return structuredClone(irrigationCapabilities);
  }
  if (path === "/api/irrigation/status") {
    const emergency = currentDrillRun();
    const pumps = irrigationCapabilities.pumps.map((meta) => {
      const pump = state.pumps[meta.id];
      if (pump.running) {
        return {
          id: meta.id,
          running: true,
          valve: pump.valve,
          durationSeconds: pump.durationSeconds,
          remainingSeconds: Math.max(0, Math.round(pump.durationSeconds - (Date.now() - pump.startedAt) / 1000)),
        };
      }
      if (emergency && emergency.pump === meta.id) {
        return { id: meta.id, running: true, valve: emergency.valve, durationSeconds: DRILL_FLUSH_SECONDS, remainingSeconds: emergency.remainingSeconds };
      }
      return { id: meta.id, running: false, valve: null, durationSeconds: 0, remainingSeconds: 0 };
    });
    const activeValves = new Set(pumps.filter((pump) => pump.running).map((pump) => pump.valve));
    return {
      firmware: irrigationCapabilities.firmware,
      wifi: structuredClone(state.wifi),
      pumps,
      valves: irrigationCapabilities.valves.map((meta) => ({
        id: meta.id,
        state: activeValves.has(meta.id) ? "running" : "ready",
        lastRunAt: state.valves[meta.id].lastRunAt,
        lastDurationSeconds: state.valves[meta.id].lastDurationSeconds,
      })),
    };
  }
  if (path === "/api/irrigation/health") {
    return {
      uptimeSeconds: Math.round((Date.now() - state.bootAt) / 1000),
      resetReason: "power-on",
      heapFreeBytes: 182456,
      wifi: structuredClone(state.wifi),
      clockValid: true,
      time: new Date().toISOString(),
    };
  }
  if (path === "/api/irrigation/schedules") {
    if (init.method === "POST" && init.body) state.schedules = JSON.parse(init.body);
    return structuredClone(state.schedules);
  }
  if (path === "/api/irrigation/history") {
    return { events: structuredClone(state.history) };
  }
  if (path === "/api/irrigation/safety") {
    if (init.method === "POST" && init.body) state.safety = JSON.parse(init.body);
    return structuredClone(state.safety);
  }
  if (path === "/api/irrigation/run" && init.body) {
    const body = JSON.parse(init.body);
    return startManualRun(body.valve, body.durationSeconds, body.runId);
  }
  if (path === "/api/irrigation/stop" && init.body) {
    const body = JSON.parse(init.body);
    const pump = state.pumps[body.pump];
    if (pump?.running) finishPumpRun(pump, Math.max(1, Math.round((Date.now() - pump.startedAt) / 1000)));
    return { ok: true };
  }
  return {};
}
