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

const thermalDrill = { active: false, startedAt: 0, flushLogged: false };

export function mockThermalDrillRequest(path) {
  if (path === "/api/thermal/drill/start") {
    thermalDrill.active = true;
    thermalDrill.startedAt = Date.now();
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
  // Log the emergency flush into the irrigation history once the pump stops.
  if (elapsed >= escalation * 3 + DRILL_FLUSH_SECONDS && !thermalDrill.flushLogged) {
    thermalDrill.flushLogged = true;
    mockIrrigationData.history.unshift({ at: Date.now(), zone: "z1", durationSeconds: DRILL_FLUSH_SECONDS, trigger: "thermal" });
    mockIrrigationData.history = mockIrrigationData.history.slice(0, 20);
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

const irrigationWindows = [
  { zone: "z1", time: 390, durationSeconds: 90, enabled: true },
  { zone: "z2", time: 395, durationSeconds: 90, enabled: true },
  { zone: "z3", time: 1140, durationSeconds: 45, enabled: false },
];

// The seeded history is derived from the configured schedule windows — the
// mock behaves like firmware that has been running this schedule for a week.
function seedIrrigationHistory(windows) {
  const events = [];
  for (let day = 0; day < 7; day++) {
    for (const window of windows) {
      if (!window.enabled) continue;
      const startedAt = occurrenceOnDay(window.time, day);
      if (startedAt + window.durationSeconds * 1000 < Date.now()) {
        events.push({ at: startedAt + window.durationSeconds * 1000, zone: window.zone, durationSeconds: window.durationSeconds, trigger: "schedule" });
      }
    }
  }
  events.push({ at: hoursAgo(30), zone: "z3", durationSeconds: 45, trigger: "manual" });
  events.push({ at: hoursAgo(54), zone: "z3", durationSeconds: 60, trigger: "manual" });
  return events.sort((a, b) => b.at - a.at).slice(0, 20);
}

const irrigationHistory = seedIrrigationHistory(irrigationWindows);

function lastEventFor(zoneId) {
  return irrigationHistory.find((event) => event.zone === zoneId);
}

export const mockIrrigationData = {
  status: {
    firmware: "mock",
    wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.37", rssi: -61 },
    pump: { running: false, zone: null, startedAt: 0, durationSeconds: 0, trigger: "manual" },
    zones: [
      { id: "z1", name: "Zone 1 · Tropf", state: "ready", lastRunAt: lastEventFor("z1")?.at || 0, lastDurationSeconds: lastEventFor("z1")?.durationSeconds || 0 },
      { id: "z2", name: "Zone 2 · Tropf", state: "ready", lastRunAt: lastEventFor("z2")?.at || 0, lastDurationSeconds: lastEventFor("z2")?.durationSeconds || 0 },
      { id: "z3", name: "Zone 3 · Sprüher", state: "ready", lastRunAt: lastEventFor("z3")?.at || 0, lastDurationSeconds: lastEventFor("z3")?.durationSeconds || 0 },
    ],
  },
  schedules: {
    enabled: true,
    windows: irrigationWindows,
  },
  safety: { maxRunSeconds: 300, lockoutMinutes: 10 },
  history: irrigationHistory,
};

// Mock endpoint handler for the irrigation API. Mirrors what the ESP firmware
// will do, including the safety rules: single shared pump, per-run duration
// cap, lockout between runs of the same zone.
// Live schedule execution: windows fire at their start time, a single shared
// pump processes collisions sequentially, zones inside their lockout are
// skipped — the same rules the firmware will enforce.
const scheduler = { lastCheck: Date.now(), queue: [] };

function advanceSchedule() {
  const data = mockIrrigationData;
  const now = Date.now();
  if (data.schedules.enabled) {
    for (const window of data.schedules.windows) {
      if (!window.enabled) continue;
      let occurrence = occurrenceOnDay(window.time, 0);
      if (occurrence > now) occurrence -= 86400000;
      if (occurrence > scheduler.lastCheck && occurrence <= now) {
        scheduler.queue.push({ zone: window.zone, durationSeconds: window.durationSeconds });
      }
    }
  }
  scheduler.lastCheck = now;

  const pump = data.status.pump;
  while (!pump.running && scheduler.queue.length) {
    const next = scheduler.queue.shift();
    const zone = data.status.zones.find((entry) => entry.id === next.zone);
    if (!zone) continue;
    if (zone.lastRunAt && now - zone.lastRunAt < data.safety.lockoutMinutes * 60000) continue; // lockout: skip
    beginPumpRun(next.zone, next.durationSeconds, "schedule");
  }
}

export function mockIrrigationRequest(path, init = {}) {
  advancePump();
  advanceSchedule();
  const data = mockIrrigationData;

  if (path === "/api/irrigation/status") {
    const pump = data.status.pump;
    // During the supervisor drill's flush stage the pump runs the emergency
    // root-cooling flush (unless a manual run already holds it).
    const drill = drillState();
    const flushElapsed = drill ? drill.elapsed - drill.escalationSeconds * 3 : -1;
    const flush = !pump.running && drill && drill.stageIndex === 3 && flushElapsed < DRILL_FLUSH_SECONDS
      ? { zone: "z1", remainingSeconds: Math.max(0, Math.round(DRILL_FLUSH_SECONDS - flushElapsed)) }
      : null;
    const remainingSeconds = pump.running
      ? Math.max(0, Math.round(pump.durationSeconds - (Date.now() - pump.startedAt) / 1000))
      : flush
        ? flush.remainingSeconds
        : 0;
    const activeZone = pump.running ? pump.zone : flush ? flush.zone : null;
    return {
      firmware: data.status.firmware,
      wifi: structuredClone(data.status.wifi),
      pump: {
        running: pump.running || !!flush,
        zone: activeZone,
        durationSeconds: pump.running ? pump.durationSeconds : flush ? DRILL_FLUSH_SECONDS : 0,
        remainingSeconds,
      },
      zones: data.status.zones.map((zone) => ({
        ...zone,
        state: activeZone === zone.id ? "running" : zone.state,
      })),
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
    startPumpRun(body.zone, body.durationSeconds);
    return { ok: true };
  }
  if (path === "/api/irrigation/stop") {
    stopPumpRun();
    return { ok: true };
  }
  return {};
}

function advancePump() {
  const pump = mockIrrigationData.status.pump;
  if (pump.running && Date.now() - pump.startedAt >= pump.durationSeconds * 1000) {
    finishPumpRun(pump.durationSeconds);
  }
}

function startPumpRun(zoneId, durationSeconds) {
  const data = mockIrrigationData;
  const pump = data.status.pump;
  const zone = data.status.zones.find((entry) => entry.id === zoneId);
  if (!zone) throw new Error("Unbekannte Zone");
  if (pump.running) throw new Error("Pumpe läuft bereits — nur eine Zone gleichzeitig");
  const lockoutMs = data.safety.lockoutMinutes * 60000;
  const sinceLastRun = Date.now() - zone.lastRunAt;
  if (zone.lastRunAt && sinceLastRun < lockoutMs) {
    const waitMinutes = Math.ceil((lockoutMs - sinceLastRun) / 60000);
    throw new Error(`Sperrzeit aktiv — ${zone.name} ist in ${waitMinutes} min wieder freigegeben`);
  }
  beginPumpRun(zoneId, durationSeconds, "manual");
}

function beginPumpRun(zoneId, durationSeconds, trigger) {
  const pump = mockIrrigationData.status.pump;
  pump.running = true;
  pump.zone = zoneId;
  pump.startedAt = Date.now();
  pump.durationSeconds = Math.min(Math.max(1, Math.round(durationSeconds)), mockIrrigationData.safety.maxRunSeconds);
  pump.trigger = trigger;
}

function stopPumpRun() {
  const pump = mockIrrigationData.status.pump;
  if (!pump.running) return;
  finishPumpRun(Math.max(1, Math.round((Date.now() - pump.startedAt) / 1000)));
}

function finishPumpRun(actualSeconds) {
  const data = mockIrrigationData;
  const pump = data.status.pump;
  const zone = data.status.zones.find((entry) => entry.id === pump.zone);
  const endedAt = pump.startedAt + actualSeconds * 1000;
  if (zone) {
    zone.lastRunAt = endedAt;
    zone.lastDurationSeconds = actualSeconds;
  }
  data.history.unshift({ at: endedAt, zone: pump.zone, durationSeconds: actualSeconds, trigger: pump.trigger });
  data.history = data.history.slice(0, 20);
  pump.running = false;
  pump.zone = null;
  pump.durationSeconds = 0;
}
