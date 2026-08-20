export const mockLightingData = {
  status: {
    firmware: "mock",
    desired: { ch1: 42, ch2: 28 },
    applied: { ch1: 42, ch2: 28 },
    wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.36", rssi: -57 },
    thermal: {
      sensorPresent: false,
      overrideActive: false,
      temperatureC: 0,
      config: { enabled: true, triggerC: 30, releaseC: 27, overridePercent: 25, escalationSeconds: 120, sampleIntervalMs: 5000 },
    },
    signal: {
      config: { enabled: true, pin: 14, activeHigh: true },
      state: "off",
    },
  },
  schedule: {
    enabled: false,
    ch1: [
      { time: 360, percent: 20 },
      { time: 720, percent: 75 },
      { time: 1200, percent: 70 },
      { time: 1320, percent: 8 },
    ],
    ch2: [
      { time: 360, percent: 0 },
      { time: 720, percent: 38 },
      { time: 1200, percent: 36 },
      { time: 1320, percent: 0 },
    ],
  },
  presets: [
    {
      name: "Veg",
      ch1: [{ time: 360, percent: 25 }, { time: 1320, percent: 10 }],
      ch2: [{ time: 360, percent: 5 }, { time: 1320, percent: 0 }],
    },
    {
      name: "Blüte",
      ch1: [{ time: 360, percent: 20 }, { time: 720, percent: 85 }, { time: 1320, percent: 5 }],
      ch2: [{ time: 360, percent: 0 }, { time: 720, percent: 50 }, { time: 1320, percent: 0 }],
    },
  ],
  logs: Array.from({ length: 48 }, (_, index) => ({
    timestamp: 0,
    uptimeMinutes: index * 15,
    desiredCh1: 20 + Math.sin(index / 6) * 20 + index * 0.5,
    desiredCh2: 12 + Math.sin(index / 5) * 12,
    appliedCh1: 20 + Math.sin(index / 6) * 20 + index * 0.5,
    appliedCh2: 12 + Math.sin(index / 5) * 12,
    temperature: -273.1,
    sensor: false,
    thermal: false,
  })),
  logConfig: { enabled: true, intervalMinutes: 15 },
};

/* ---------- thermal supervisor drill ---------- */

// Simulated over-temperature event that plays the whole escalation chain.
// Stage 1 (dim) fires immediately on detection; every further stage only
// fires after the configured escalation time has passed without the
// temperature falling — the same dwell logic the firmware will use.
// Stage layout: dim [0,E) -> fan [E,2E) -> drain [2E,3E) -> flush [3E,4E)
// -> recovery [4E,4.5E), with E = thermal.config.escalationSeconds.
const DRILL_FLUSH_SECONDS = 8;

const thermalDrill = { active: false, startedAt: 0, drainLogged: false, flushLogged: false };

export function mockThermalDrillRequest(path) {
  if (path === "/api/thermal/drill/start") {
    thermalDrill.active = true;
    thermalDrill.startedAt = Date.now();
    thermalDrill.drainLogged = false;
    thermalDrill.flushLogged = false;
    return { ok: true };
  }
  if (path === "/api/thermal/drill/stop") {
    thermalDrill.active = false;
    return { ok: true };
  }
  return {};
}

function drillEscalationSeconds() {
  const configured = mockLightingData.status.thermal.config.escalationSeconds;
  return Math.max(10, Math.min(900, Number.isFinite(configured) ? configured : 120));
}

function drillState() {
  if (!thermalDrill.active) return null;
  const escalation = drillEscalationSeconds();
  const total = escalation * 4.5;
  const elapsed = (Date.now() - thermalDrill.startedAt) / 1000;
  if (elapsed >= total) {
    thermalDrill.active = false;
    return null;
  }
  const config = mockLightingData.status.thermal.config;
  const trigger = config.triggerC;
  const release = config.releaseC;
  // Log the emergency drain and flush runs into the irrigation history once
  // their stage's pump run has finished.
  if (elapsed >= escalation * 2 + DRILL_FLUSH_SECONDS && !thermalDrill.drainLogged) {
    thermalDrill.drainLogged = true;
    recordDrillRun("d1");
  }
  if (elapsed >= escalation * 3 + DRILL_FLUSH_SECONDS && !thermalDrill.flushLogged) {
    thermalDrill.flushLogged = true;
    recordDrillRun("v1");
  }
  const stageIndex = Math.min(4, Math.floor(elapsed / escalation));
  // Each measure slows the rise but does not stop it (hence the escalation);
  // the flush finally turns the curve around. Peak = trigger + 8 K.
  const segment = elapsed / escalation;
  let temperatureC;
  if (segment < 1) temperatureC = trigger + segment * 4;
  else if (segment < 2) temperatureC = trigger + 4 + (segment - 1) * 2.5;
  else if (segment < 3) temperatureC = trigger + 6.5 + (segment - 2) * 1.5;
  else if (segment < 4) temperatureC = trigger + 8 - (segment - 3) * (trigger + 8 - (release + 1));
  else temperatureC = release + 1 - ((segment - 4) / 0.5) * 1.5;
  const nextBoundary = stageIndex < 4 ? (stageIndex + 1) * escalation : total;
  return {
    active: true,
    elapsed,
    stageIndex,
    temperatureC: Math.round(temperatureC * 10) / 10,
    totalSeconds: total,
    escalationSeconds: escalation,
    nextStageInSeconds: Math.max(0, Math.round(nextBoundary - elapsed)),
  };
}

export function mockLightingStatus() {
  const status = structuredClone(mockLightingData.status);
  const drill = drillState();
  if (drill) {
    const limit = status.thermal.config.overridePercent;
    status.thermal.sensorPresent = true;
    status.thermal.temperatureC = drill.temperatureC;
    status.thermal.overrideActive = drill.stageIndex >= 0 && drill.stageIndex < 4;
    if (status.thermal.overrideActive) {
      status.applied = {
        ch1: Math.min(status.applied.ch1, limit),
        ch2: Math.min(status.applied.ch2, limit),
      };
    }
    status.thermal.drill = drill;
  }
  // Signal output follows the supervisor: steady while limited (stage 1-2),
  // blinking from stage 3 on, off in normal operation.
  status.signal.state = !status.signal.config.enabled
    ? "disabled"
    : !status.thermal.overrideActive
      ? "off"
      : (drill?.stageIndex ?? 0) >= 2
        ? "blink"
        : "on";
  return status;
}

/* ---------- irrigation ---------- */

function hoursAgo(hours) {
  return Date.now() - hours * 3600000;
}

// Timestamp of a schedule window's occurrence `daysBack` days ago.
function occurrenceOnDay(timeMinutes, daysBack) {
  const day = new Date();
  day.setHours(0, 0, 0, 0);
  return day.getTime() - daysBack * 86400000 + timeMinutes * 60000;
}

// The controller announces its own topology (spec/irrigation-controller.md §2);
// the app renders whatever is reported. This mock mirrors the real rig:
// one pump, five irrigation valves, one drain valve to flush the line.
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

export const mockIrrigationData = {
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
  const valve = mockIrrigationData.valves[valveId];
  return Boolean(valve.lastRunAt) && now - valve.lastRunAt < mockIrrigationData.safety.lockoutMinutes * 60000;
}

// Live schedule execution: windows fire at their start time and are enqueued
// on their valve's pump; each pump processes its queue sequentially, valves
// inside their lockout are skipped (spec §4).
const scheduler = { lastCheck: Date.now(), queues: {} };

function advanceIrrigation() {
  const data = mockIrrigationData;
  const now = Date.now();

  for (const pump of Object.values(data.pumps)) {
    if (pump.running && now - pump.startedAt >= pump.durationSeconds * 1000) {
      finishPumpRun(pump);
    }
  }

  if (data.schedules.enabled) {
    for (const window of data.schedules.windows) {
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
    const pump = data.pumps[pumpId];
    while (pump && !pump.running && queue.length) {
      const next = queue.shift();
      if (valveLocked(next.valve, now)) continue;
      beginPumpRun(pumpId, next.valve, next.durationSeconds, "schedule");
    }
  }
}

function beginPumpRun(pumpId, valveId, durationSeconds, trigger) {
  const pump = mockIrrigationData.pumps[pumpId];
  pump.running = true;
  pump.valve = valveId;
  pump.startedAt = Date.now();
  pump.durationSeconds = Math.min(Math.max(1, Math.round(durationSeconds)), mockIrrigationData.safety.maxRunSeconds);
  pump.trigger = trigger;
}

function finishPumpRun(pump, actualSeconds = pump.durationSeconds) {
  const endedAt = pump.startedAt + actualSeconds * 1000;
  const valve = mockIrrigationData.valves[pump.valve];
  if (valve) {
    valve.lastRunAt = endedAt;
    valve.lastDurationSeconds = actualSeconds;
  }
  logIrrigationEvent({ at: endedAt, valve: pump.valve, durationSeconds: actualSeconds, trigger: pump.trigger });
  pump.running = false;
  pump.valve = null;
  pump.durationSeconds = 0;
}

export function logIrrigationEvent(event) {
  mockIrrigationData.history.unshift(event);
  mockIrrigationData.history = mockIrrigationData.history.slice(0, 30);
}

function startManualRun(valveId, durationSeconds, runId) {
  const data = mockIrrigationData;
  if (runId && data.recentRunIds.includes(runId)) return { ok: true, duplicate: true };
  const meta = valveMeta(valveId);
  if (!meta) throw new Error("Unbekanntes Ventil");
  const pump = data.pumps[meta.pump];
  const emergency = drillEmergencyRun();
  if (pump.running || emergency?.pump === meta.pump) {
    const activeId = pump.running ? pump.valve : emergency.valve;
    throw new Error(`Pumpe belegt — ${valveMeta(activeId)?.name || "anderes Ventil"} läuft noch`);
  }
  if (valveLocked(valveId)) {
    const valve = data.valves[valveId];
    const waitMinutes = Math.ceil((data.safety.lockoutMinutes * 60000 - (Date.now() - valve.lastRunAt)) / 60000);
    throw new Error(`Sperrzeit aktiv — ${meta.name} ist in ${waitMinutes} min wieder freigegeben`);
  }
  beginPumpRun(meta.pump, valveId, durationSeconds, "manual");
  if (runId) data.recentRunIds = [...data.recentRunIds, runId].slice(-16);
  return { ok: true };
}

// During the supervisor drill the drain valve opens in the drain stage and an
// irrigation valve flushes the roots in the flush stage — unless a real run
// already holds the pump.
function drillEmergencyRun() {
  const drill = drillState();
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

export function mockIrrigationRequest(path, init = {}) {
  advanceIrrigation();
  const data = mockIrrigationData;

  if (path === "/api/irrigation/capabilities") {
    return structuredClone(irrigationCapabilities);
  }
  if (path === "/api/irrigation/status") {
    const emergency = drillEmergencyRun();
    const pumps = irrigationCapabilities.pumps.map((meta) => {
      const pump = data.pumps[meta.id];
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
      wifi: structuredClone(data.wifi),
      pumps,
      valves: irrigationCapabilities.valves.map((meta) => ({
        id: meta.id,
        state: activeValves.has(meta.id) ? "running" : "ready",
        lastRunAt: data.valves[meta.id].lastRunAt,
        lastDurationSeconds: data.valves[meta.id].lastDurationSeconds,
      })),
    };
  }
  if (path === "/api/irrigation/health") {
    return {
      uptimeSeconds: Math.round((Date.now() - data.bootAt) / 1000),
      resetReason: "power-on",
      heapFreeBytes: 182456,
      wifi: structuredClone(data.wifi),
      clockValid: true,
      time: new Date().toISOString(),
    };
  }
  if (path === "/api/irrigation/schedules") {
    if (init.method === "POST" && init.body) data.schedules = JSON.parse(init.body);
    return structuredClone(data.schedules);
  }
  if (path === "/api/irrigation/history") {
    return { events: structuredClone(data.history) };
  }
  if (path === "/api/irrigation/safety") {
    if (init.method === "POST" && init.body) data.safety = JSON.parse(init.body);
    return structuredClone(data.safety);
  }
  if (path === "/api/irrigation/run" && init.body) {
    const body = JSON.parse(init.body);
    return startManualRun(body.valve, body.durationSeconds, body.runId);
  }
  if (path === "/api/irrigation/stop" && init.body) {
    const body = JSON.parse(init.body);
    const pump = data.pumps[body.pump];
    if (pump?.running) finishPumpRun(pump, Math.max(1, Math.round((Date.now() - pump.startedAt) / 1000)));
    return { ok: true };
  }
  return {};
}

