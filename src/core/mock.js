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
      config: { enabled: true, triggerC: 30, releaseC: 27, overridePercent: 25, sampleIntervalMs: 5000 },
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

/* ---------- irrigation ---------- */

function hoursAgo(hours) {
  return Date.now() - hours * 3600000;
}

export const mockIrrigationData = {
  status: {
    firmware: "mock",
    wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.37", rssi: -61 },
    pump: { running: false, zone: null, startedAt: 0, durationSeconds: 0, trigger: "manual" },
    zones: [
      { id: "z1", name: "Zone 1 · Tropf", state: "ready", lastRunAt: hoursAgo(6.5), lastDurationSeconds: 90 },
      { id: "z2", name: "Zone 2 · Tropf", state: "ready", lastRunAt: hoursAgo(6.4), lastDurationSeconds: 90 },
      { id: "z3", name: "Zone 3 · Sprüher", state: "ready", lastRunAt: hoursAgo(30), lastDurationSeconds: 45 },
    ],
  },
  schedules: {
    enabled: true,
    windows: [
      { zone: "z1", time: 390, durationSeconds: 90, enabled: true },
      { zone: "z2", time: 395, durationSeconds: 90, enabled: true },
      { zone: "z3", time: 1140, durationSeconds: 45, enabled: false },
    ],
  },
  safety: { maxRunSeconds: 300, lockoutMinutes: 10 },
  history: seedIrrigationHistory(),
};

function seedIrrigationHistory() {
  const events = [];
  for (let day = 0; day < 8; day++) {
    events.push({ at: hoursAgo(6.5 + day * 24), zone: "z1", durationSeconds: 90, trigger: "schedule" });
    events.push({ at: hoursAgo(6.4 + day * 24), zone: "z2", durationSeconds: 90, trigger: "schedule" });
  }
  events.push({ at: hoursAgo(30), zone: "z3", durationSeconds: 45, trigger: "manual" });
  events.push({ at: hoursAgo(54), zone: "z3", durationSeconds: 60, trigger: "manual" });
  return events.sort((a, b) => b.at - a.at).slice(0, 20);
}

// Mock endpoint handler for the irrigation API. Mirrors what the ESP firmware
// will do, including the safety rules: single shared pump, per-run duration
// cap, lockout between runs of the same zone.
export function mockIrrigationRequest(path, init = {}) {
  advancePump();
  const data = mockIrrigationData;

  if (path === "/api/irrigation/status") {
    const pump = data.status.pump;
    const remainingSeconds = pump.running
      ? Math.max(0, Math.round(pump.durationSeconds - (Date.now() - pump.startedAt) / 1000))
      : 0;
    return {
      firmware: data.status.firmware,
      wifi: structuredClone(data.status.wifi),
      pump: { running: pump.running, zone: pump.zone, durationSeconds: pump.durationSeconds, remainingSeconds },
      zones: data.status.zones.map((zone) => ({
        ...zone,
        state: pump.running && pump.zone === zone.id ? "running" : zone.state,
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
  pump.running = true;
  pump.zone = zoneId;
  pump.startedAt = Date.now();
  pump.durationSeconds = Math.min(Math.max(1, Math.round(durationSeconds)), data.safety.maxRunSeconds);
  pump.trigger = "manual";
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
