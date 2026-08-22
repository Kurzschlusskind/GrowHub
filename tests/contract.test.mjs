// Contract tests for the device API mocks — the reference implementations of
// spec/lighting-controller.md and spec/irrigation-controller.md. Every
// endpoint is exercised, including the behaviour rules (single pump, lockout,
// idempotent runs, duration cap, supervisor drill coupling).
//
// Run with: npm test  (node --test, no extra dependencies)
//
// Time-dependent behaviour is tested by shifting Date.now — the mocks derive
// all timing from it, exactly like the firmware derives timing from its clock.

import assert from "node:assert/strict";
import test from "node:test";

import { mockLightingRequest } from "../src/core/mock.js";
import { irrigationCapabilities, mockIrrigationRequest } from "../src/devices/irrigation/mock.js";
import { mockSensorsRequest, sensorCapabilities } from "../src/devices/sensors/mock.js";

const realNow = Date.now.bind(Date);
let offsetMs = 0;
Date.now = () => realNow() + offsetMs;

function advanceSeconds(seconds) {
  offsetMs += seconds * 1000;
}

function post(handler, path, body) {
  return handler(path, { method: "POST", body: JSON.stringify(body) });
}

/* ---------- lighting contract ---------- */

test("lighting: status shape", () => {
  const status = mockLightingRequest("/api/status");
  assert.ok(status.firmware);
  for (const key of ["desired", "applied"]) {
    assert.equal(typeof status[key].ch1, "number");
    assert.equal(typeof status[key].ch2, "number");
  }
  assert.equal(typeof status.wifi.connected, "boolean");
  assert.equal(typeof status.thermal.config.escalationSeconds, "number");
  assert.ok(["off", "on", "blink", "disabled"].includes(status.signal.state));
});

test("lighting: levels are applied and read back", () => {
  post(mockLightingRequest, "/api/levels", { ch1: 55, ch2: 44 });
  const status = mockLightingRequest("/api/status");
  assert.equal(status.desired.ch1, 55);
  assert.equal(status.applied.ch2, 44);
});

test("lighting: schedules and presets replace and read back", () => {
  const schedule = { enabled: true, ch1: [{ time: 60, percent: 10 }], ch2: [] };
  const saved = post(mockLightingRequest, "/api/schedules", schedule);
  assert.deepEqual(saved, schedule);
  const presets = post(mockLightingRequest, "/api/presets", { presets: [{ name: "T", ch1: [], ch2: [] }] });
  assert.equal(presets.presets.length, 1);
});

test("lighting: log config and clear", () => {
  post(mockLightingRequest, "/api/logs/config", { enabled: false, intervalMinutes: 30 });
  let logs = mockLightingRequest("/api/logs");
  assert.equal(logs.config.intervalMinutes, 30);
  mockLightingRequest("/api/logs/clear", { method: "POST", body: "{}" });
  logs = mockLightingRequest("/api/logs");
  assert.equal(logs.records.length, 0);
});

test("lighting: thermal and signal config persist", () => {
  post(mockLightingRequest, "/api/thermal", {
    enabled: true, triggerC: 31, releaseC: 27, overridePercent: 20, escalationSeconds: 10, sampleIntervalMs: 5000,
  });
  const status = mockLightingRequest("/api/status");
  assert.equal(status.thermal.config.triggerC, 31);
  post(mockLightingRequest, "/api/signal", { enabled: true, pin: 27, activeHigh: false });
  assert.equal(mockLightingRequest("/api/status").signal.config.pin, 27);
});

test("lighting: drill caps output, drives signal, ends by itself", () => {
  post(mockLightingRequest, "/api/levels", { ch1: 80, ch2: 80 });
  mockLightingRequest("/api/thermal/drill/start", { method: "POST", body: "{}" });
  let status = mockLightingRequest("/api/status");
  assert.equal(status.thermal.drill.active, true);
  assert.equal(status.thermal.overrideActive, true);
  assert.equal(status.applied.ch1, 20); // capped at overridePercent
  assert.equal(status.signal.state, "on");
  advanceSeconds(25); // escalation 10s -> stage 3 (drain)
  status = mockLightingRequest("/api/status");
  assert.equal(status.thermal.drill.stageIndex, 2);
  assert.equal(status.signal.state, "blink");
  advanceSeconds(60); // beyond total (45s) -> drill over
  status = mockLightingRequest("/api/status");
  assert.equal(status.thermal.drill, undefined);
  assert.equal(status.signal.state, "off");
});

/* ---------- irrigation contract ---------- */

test("irrigation: capabilities shape", () => {
  const caps = mockIrrigationRequest("/api/irrigation/capabilities");
  assert.equal(caps.spec, "1.0.0");
  assert.ok(caps.pumps.length >= 1);
  for (const valve of caps.valves) {
    assert.ok(["irrigation", "drain"].includes(valve.type));
    assert.ok(caps.pumps.some((pump) => pump.id === valve.pump));
  }
});

test("irrigation: status matches topology", () => {
  const status = mockIrrigationRequest("/api/irrigation/status");
  assert.equal(status.pumps.length, irrigationCapabilities.pumps.length);
  assert.equal(status.valves.length, irrigationCapabilities.valves.length);
  for (const valve of status.valves) assert.ok(["ready", "running", "error"].includes(valve.state));
});

test("irrigation: health shape", () => {
  const health = mockIrrigationRequest("/api/irrigation/health");
  assert.equal(typeof health.uptimeSeconds, "number");
  assert.ok(health.resetReason);
  assert.equal(health.clockValid, true);
  assert.ok(health.time);
});

test("irrigation: schedules and safety replace and read back", () => {
  const schedules = { enabled: false, windows: [{ valve: "v1", time: 400, durationSeconds: 60, enabled: true }] };
  assert.deepEqual(post(mockIrrigationRequest, "/api/irrigation/schedules", schedules), schedules);
  const safety = post(mockIrrigationRequest, "/api/irrigation/safety", { maxRunSeconds: 120, lockoutMinutes: 10 });
  assert.equal(safety.maxRunSeconds, 120);
});

test("irrigation: run lifecycle — busy pump, stop, history, lockout", () => {
  const started = post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v2", durationSeconds: 60, runId: "run-1" });
  assert.equal(started.ok, true);
  let status = mockIrrigationRequest("/api/irrigation/status");
  const pump = status.pumps.find((entry) => entry.id === "p1");
  assert.equal(pump.running, true);
  assert.equal(pump.valve, "v2");
  assert.ok(pump.remainingSeconds > 0 && pump.remainingSeconds <= 60);

  // same pump, other valve -> rejected
  assert.throws(() => post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v3", durationSeconds: 30 }), /Pumpe belegt/);

  // duplicate runId -> idempotent, still the same single run
  const dup = post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v2", durationSeconds: 60, runId: "run-1" });
  assert.equal(dup.duplicate, true);

  advanceSeconds(5);
  post(mockIrrigationRequest, "/api/irrigation/stop", { pump: "p1" });
  status = mockIrrigationRequest("/api/irrigation/status");
  assert.equal(status.pumps[0].running, false);
  const history = mockIrrigationRequest("/api/irrigation/history");
  assert.equal(history.events[0].valve, "v2");
  assert.equal(history.events[0].trigger, "manual");

  // v2 is now inside its lockout
  assert.throws(() => post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v2", durationSeconds: 30 }), /Sperrzeit/);
  advanceSeconds(11 * 60);
  assert.equal(post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v2", durationSeconds: 30, runId: "run-2" }).ok, true);
  post(mockIrrigationRequest, "/api/irrigation/stop", { pump: "p1" });
});

test("irrigation: drain valves are exempt from the lockout", () => {
  advanceSeconds(11 * 60);
  assert.equal(post(mockIrrigationRequest, "/api/irrigation/run", { valve: "d1", durationSeconds: 15, runId: "d-1" }).ok, true);
  post(mockIrrigationRequest, "/api/irrigation/stop", { pump: "p1" });
  // immediately again — no lockout for drain
  assert.equal(post(mockIrrigationRequest, "/api/irrigation/run", { valve: "d1", durationSeconds: 15, runId: "d-2" }).ok, true);
  post(mockIrrigationRequest, "/api/irrigation/stop", { pump: "p1" });
});

test("irrigation: duration is capped at maxRunSeconds", () => {
  advanceSeconds(11 * 60);
  post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v4", durationSeconds: 9999, runId: "cap-1" });
  const status = mockIrrigationRequest("/api/irrigation/status");
  assert.equal(status.pumps[0].durationSeconds, 120); // safety set earlier
  post(mockIrrigationRequest, "/api/irrigation/stop", { pump: "p1" });
});

test("irrigation: run ends by itself at the deadline", () => {
  advanceSeconds(11 * 60);
  post(mockIrrigationRequest, "/api/irrigation/run", { valve: "v5", durationSeconds: 30, runId: "auto-1" });
  advanceSeconds(31);
  const status = mockIrrigationRequest("/api/irrigation/status");
  assert.equal(status.pumps[0].running, false);
  const history = mockIrrigationRequest("/api/irrigation/history");
  assert.equal(history.events[0].valve, "v5");
  assert.equal(history.events[0].durationSeconds, 30);
});

/* ---------- sensor contract ---------- */

test("sensors: capabilities shape", () => {
  const caps = mockSensorsRequest("/api/sensors/capabilities");
  assert.equal(caps.spec, "1.0.0");
  assert.ok(caps.sensors.length >= 1);
  for (const sensor of caps.sensors) {
    assert.ok(sensor.id);
    assert.ok(sensor.quantity);
    assert.equal(typeof sensor.unit, "string");
  }
});

test("sensors: readings cover every capability sensor with numeric or null values", () => {
  const readings = mockSensorsRequest("/api/sensors/readings").readings;
  assert.equal(readings.length, sensorCapabilities.sensors.length);
  for (const reading of readings) {
    assert.ok(sensorCapabilities.sensors.some((sensor) => sensor.id === reading.sensor));
    assert.ok(reading.value === null || typeof reading.value === "number");
  }
});

test("sensors: health shape and config mirror roundtrip", () => {
  const health = mockSensorsRequest("/api/sensors/health");
  assert.equal(typeof health.uptimeSeconds, "number");
  assert.equal(health.clockValid, true);

  assert.equal(mockSensorsRequest("/api/sensors/config-mirror").hash, null);
  const stored = post(mockSensorsRequest, "/api/sensors/config-mirror", { hash: "abc123", config: { rules: [] } });
  assert.equal(stored.ok, true);
  const mirror = mockSensorsRequest("/api/sensors/config-mirror");
  assert.equal(mirror.hash, "abc123");
  assert.ok(mirror.updatedAt > 0);
});

test("cross-device: supervisor drill commands drain and flush runs", () => {
  advanceSeconds(11 * 60);
  mockLightingRequest("/api/thermal/drill/start", { method: "POST", body: "{}" }); // escalation 10s
  advanceSeconds(21); // stage 2 (drain), first seconds of the emergency run
  let status = mockIrrigationRequest("/api/irrigation/status");
  let pump = status.pumps.find((entry) => entry.id === "p1");
  assert.equal(pump.running, true);
  assert.equal(pump.valve, "d1");
  advanceSeconds(10); // stage 3 (flush)
  status = mockIrrigationRequest("/api/irrigation/status");
  pump = status.pumps.find((entry) => entry.id === "p1");
  assert.equal(pump.valve, "v1");
  advanceSeconds(8); // flush finished — a poll inside the drill logs it
  mockIrrigationRequest("/api/irrigation/status");
  advanceSeconds(30); // drill over
  const history = mockIrrigationRequest("/api/irrigation/history");
  const triggers = history.events.slice(0, 2).map((event) => event.trigger);
  assert.deepEqual(triggers, ["thermal", "thermal"]);
  assert.equal(mockIrrigationRequest("/api/irrigation/status").pumps[0].running, false);
});
