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
export const DRILL_FLUSH_SECONDS = 8;

const thermalDrill = { active: false, startedAt: 0 };

export function mockThermalDrillRequest(path) {
  if (path === "/api/thermal/drill/start") {
    thermalDrill.active = true;
    thermalDrill.startedAt = Date.now();
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
    startedAt: thermalDrill.startedAt,
    elapsed,
    stageIndex,
    temperatureC: Math.round(temperatureC * 10) / 10,
    totalSeconds: total,
    escalationSeconds: escalation,
    nextStageInSeconds: Math.max(0, Math.round(nextBoundary - elapsed)),
  };
}

// Read-only view of the drill for other device mocks (e.g. the irrigation
// mock derives its emergency drain/flush runs from it).
export function thermalDrillSnapshot() {
  return drillState();
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

// Mock endpoint handler for the lighting controller contract
// (spec/lighting-controller.md). Passed to createApiClient by the adapter.
export function mockLightingRequest(path, init = {}) {
  if (path.startsWith("/api/thermal/drill")) return mockThermalDrillRequest(path);
  if (path === "/api/status") return mockLightingStatus();
  if (path === "/api/schedules") {
    if (init.method === "POST" && init.body) {
      mockLightingData.schedule = JSON.parse(init.body);
    }
    return structuredClone(mockLightingData.schedule);
  }
  if (path === "/api/presets") {
    if (init.method === "POST" && init.body) {
      const body = JSON.parse(init.body);
      mockLightingData.presets = body.presets || [];
    }
    return { presets: structuredClone(mockLightingData.presets) };
  }
  if (path === "/api/logs") {
    return {
      config: structuredClone(mockLightingData.logConfig),
      records: structuredClone(mockLightingData.logs),
    };
  }
  if (path === "/api/levels" && init.body) {
    const body = JSON.parse(init.body);
    mockLightingData.status.desired = { ch1: body.ch1, ch2: body.ch2 };
    mockLightingData.status.applied = { ch1: body.ch1, ch2: body.ch2 };
    return { ok: true };
  }
  if (path === "/api/signal" && init.body) {
    mockLightingData.status.signal.config = JSON.parse(init.body);
    return { signal: structuredClone(mockLightingData.status.signal) };
  }
  if (path === "/api/thermal" && init.body) {
    mockLightingData.status.thermal.config = JSON.parse(init.body);
    return { thermal: structuredClone(mockLightingData.status.thermal) };
  }
  if (path === "/api/logs/config" && init.body) {
    mockLightingData.logConfig = JSON.parse(init.body);
    return { ok: true };
  }
  if (path === "/api/logs/clear") {
    mockLightingData.logs = [];
    return { ok: true };
  }
  return {};
}

