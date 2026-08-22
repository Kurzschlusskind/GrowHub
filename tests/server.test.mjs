// End-to-end test of the GrowHub Server (spec/growhub-server.md): spawns the
// real server with a temp config/database and exercises registry, settings,
// signed writes, range deletion and the 401 paths.

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { signRequest } from "../src/core/signing.js";

const SECRET = "server-test-secret";
const PORT = 18420 + Math.floor(Math.random() * 1000);
const BASE = `http://127.0.0.1:${PORT}`;

let child;

async function signed(path, method, bodyObj) {
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const headers = { "Content-Type": "application/json" };
  Object.assign(headers, await signRequest(SECRET, method, new URL(BASE + path).pathname, body));
  return fetch(BASE + path, { method, headers, body: body || undefined });
}

test.before(async () => {
  const dir = mkdtempSync(join(tmpdir(), "growhub-server-test-"));
  const configPath = join(dir, "config.json");
  writeFileSync(configPath, JSON.stringify({
    port: PORT,
    pollIntervalSeconds: 3600,
    retentionDays: 365,
    apiSecret: SECRET,
    devices: [{ id: "irrigation-test", type: "irrigation", endpoint: "http://127.0.0.1:1" }],
  }));
  child = spawn(process.execPath, ["server/src/index.mjs"], {
    env: { ...process.env, GROWHUB_CONFIG: configPath, GROWHUB_DB: join(dir, "test.db") },
    stdio: "ignore",
  });
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`${BASE}/api/server/info`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("server did not start");
});

test.after(() => {
  child?.kill();
});

test("server: info and registry", async () => {
  const info = await (await fetch(`${BASE}/api/server/info`)).json();
  assert.equal(info.name, "growhub-server");
  assert.equal(info.signing, true);
  const registry = await (await fetch(`${BASE}/api/server/devices`)).json();
  assert.equal(registry.devices.length, 1);
  assert.equal(registry.devices[0].id, "irrigation-test");
});

test("server: unsigned writes are rejected, signed writes accepted", async () => {
  const unsigned = await fetch(`${BASE}/api/server/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ retentionDays: 30 }),
  });
  assert.equal(unsigned.status, 401);

  const response = await signed("/api/server/settings", "POST", { retentionDays: 180 });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).retentionDays, 180);

  const readBack = await (await fetch(`${BASE}/api/server/settings`)).json();
  assert.equal(readBack.retentionDays, 180);
});

test("server: settings validation", async () => {
  const response = await signed("/api/server/settings", "POST", { retentionDays: 99999 });
  assert.equal(response.status, 400);
});

test("server: history read and signed range delete", async () => {
  const history = await (await fetch(`${BASE}/api/server/history/irrigation-test`)).json();
  assert.deepEqual(history, { samples: [], runs: [], sensorSeries: {} });

  const unsigned = await fetch(`${BASE}/api/server/history/irrigation-test?from=0&to=1`, { method: "DELETE" });
  assert.equal(unsigned.status, 401);

  const response = await signed("/api/server/history/irrigation-test?from=0&to=1", "DELETE");
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.deletedSamples, 0);
  assert.equal(result.deletedRuns, 0);
});

test("server: alarm rules CRUD (signed) and alarms/events endpoints", async () => {
  const unsigned = await fetch(`${BASE}/api/server/alarm-rules`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rules: [] }),
  });
  assert.equal(unsigned.status, 401);

  const rules = [{ id: "r1", deviceId: "sensors-x", sensorId: "s1", label: "Temp", min: null, max: 30, escalate: true }];
  const saved = await signed("/api/server/alarm-rules", "POST", { rules });
  assert.equal(saved.status, 200);
  const readBack = await (await fetch(`${BASE}/api/server/alarm-rules`)).json();
  assert.equal(readBack.rules.length, 1);
  assert.equal(readBack.rules[0].max, 30);
  assert.equal(readBack.rules[0].escalate, true);

  const alarms = await (await fetch(`${BASE}/api/server/alarms`)).json();
  assert.ok(Array.isArray(alarms.alarms));
  assert.ok(alarms.signals.driver);

  const events = await (await fetch(`${BASE}/api/server/events`)).json();
  assert.ok(events.events.some((event) => event.type === "rules"));
});

test("server: proxy to unreachable device responds 502", async () => {
  const response = await fetch(`${BASE}/api/devices/irrigation-test/api/irrigation/status`);
  assert.equal(response.status, 502);
});
