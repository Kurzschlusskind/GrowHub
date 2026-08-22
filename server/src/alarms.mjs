import { createHash } from "node:crypto";

import { signHeaders } from "./signing.mjs";

// Alarm engine (spec/growhub-server.md): evaluates user-defined threshold
// rules against the latest sensor readings on every collector cycle. The
// sensor device is a pure slave — detection happens here. Active alarms
// drive the signal outputs, are listed via the API, and rules flagged with
// `escalate` run the supervisor escalation chain against the registered
// controllers (dim lighting -> exhaust [skipped without a climate
// controller] -> drain -> root flush), each step signed.
//
// The alarm/rule config is mirrored onto sensor devices as an opaque hash
// for drift and tamper detection (spec/sensor-controller.md §3).

const ESCALATION_STEPS = ["dim", "fan", "drain", "flush"];

export function createAlarmEngine({ devices, db, apiSecret, signals, log }) {
  const alarms = new Map(); // ruleId -> { since, value, message }
  const escalations = new Map(); // ruleId -> { step, lastStepAt }
  let mirrorAlarm = null;

  const rules = () => db.getSetting("alarmRules", []);

  function configHash() {
    return createHash("sha256").update(JSON.stringify(rules())).digest("hex");
  }

  async function deviceFetch(device, path, method = "GET", bodyObj = null) {
    const body = bodyObj ? JSON.stringify(bodyObj) : "";
    const headers = { "Content-Type": "application/json" };
    if (method !== "GET" && apiSecret) {
      Object.assign(headers, signHeaders(apiSecret, method, new URL(`${device.endpoint}${path}`).pathname, body));
    }
    const response = await fetch(`${device.endpoint}${path}`, {
      method,
      headers,
      body: body || undefined,
      signal: AbortSignal.timeout(5000),
    });
    const json = await response.json();
    if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
    return json;
  }

  // Push the current config hash to every sensor device and verify it on
  // subsequent cycles; a mismatch raises a system alarm.
  async function syncMirror(device) {
    try {
      const mirror = await deviceFetch(device, "/api/sensors/config-mirror");
      const expected = configHash();
      if (mirror.hash !== expected) {
        if (mirror.hash === null || db.getSetting("mirrorPushed." + device.id, "") !== expected) {
          await deviceFetch(device, "/api/sensors/config-mirror", "POST", { hash: expected, config: { rules: rules() } });
          db.setSetting("mirrorPushed." + device.id, expected);
          db.logEvent("mirror", device.id, "Config-Mirror aktualisiert");
          mirrorAlarm = null;
        } else {
          mirrorAlarm = { deviceId: device.id, message: `Config-Abgleich fehlgeschlagen auf ${device.id} — Stand auf dem Gerät weicht ab` };
          db.logEvent("mirror-mismatch", device.id, mirrorAlarm.message);
        }
      } else {
        mirrorAlarm = null;
      }
    } catch {
      /* device offline — collector already tracks that */
    }
  }

  function evaluate(readingsByDevice) {
    const now = Date.now();
    // Alarms whose rule was deleted are cleared, never left dangling.
    const ruleIds = new Set(rules().map((rule) => rule.id));
    for (const ruleId of [...alarms.keys()]) {
      if (!ruleIds.has(ruleId)) {
        alarms.delete(ruleId);
        escalations.delete(ruleId);
      }
    }
    for (const rule of rules()) {
      const readings = readingsByDevice.get(rule.deviceId);
      const value = readings?.find((entry) => entry.sensor === rule.sensorId)?.value;
      if (value === undefined || value === null) continue;
      const breached = (rule.min !== null && rule.min !== undefined && value < rule.min)
        || (rule.max !== null && rule.max !== undefined && value > rule.max);
      const active = alarms.get(rule.id);
      if (breached && !active) {
        const message = `${rule.label || rule.sensorId}: ${value} außerhalb ${rule.min ?? "-∞"}…${rule.max ?? "∞"}`;
        alarms.set(rule.id, { since: now, value, message, rule });
        db.logEvent("alarm", rule.deviceId, `Alarm: ${message}`);
        if (rule.escalate) escalations.set(rule.id, { step: -1, lastStepAt: 0 });
      } else if (breached && active) {
        active.value = value;
      } else if (!breached && active) {
        alarms.delete(rule.id);
        escalations.delete(rule.id);
        db.logEvent("alarm-clear", rule.deviceId, `Entwarnung: ${rule.label || rule.sensorId} = ${value}`);
      }
    }
    signals.setAlarm(alarms.size > 0 || Boolean(mirrorAlarm));
  }

  async function runEscalations() {
    const escalationSeconds = db.getSetting("escalationSeconds", 120);
    for (const [ruleId, state] of escalations) {
      const alarm = alarms.get(ruleId);
      if (!alarm) continue;
      const due = state.step < 0 || Date.now() - state.lastStepAt >= escalationSeconds * 1000;
      if (!due || state.step >= ESCALATION_STEPS.length - 1) continue;
      state.step += 1;
      state.lastStepAt = Date.now();
      const ok = await executeStep(ESCALATION_STEPS[state.step], alarm);
      // A failed step (e.g. pump still busy from the previous stage) is
      // retried on the next escalation interval instead of being lost.
      if (!ok) state.step -= 1;
    }
  }

  async function executeStep(step, alarm) {
    try {
      if (step === "dim") {
        const lighting = devices.find((device) => device.type === "lighting-rs485");
        if (!lighting) { db.logEvent("escalation", null, "Stufe 1 übersprungen — kein Licht-Controller registriert"); return true; }
        const status = await deviceFetch(lighting, "/api/status");
        const limit = status.thermal?.config?.overridePercent ?? 25;
        await deviceFetch(lighting, "/api/levels", "POST", {
          ch1: Math.min(status.desired.ch1, limit),
          ch2: Math.min(status.desired.ch2, limit),
        });
        db.logEvent("escalation", lighting.id, `Stufe 1: Licht auf ${limit} % reduziert (${alarm.message})`);
      } else if (step === "fan") {
        const climate = devices.find((device) => device.type === "climate");
        db.logEvent("escalation", climate?.id ?? null, climate
          ? "Stufe 2: Abluft auf 100 %"
          : "Stufe 2 übersprungen — kein Klima-Controller registriert");
      } else if (step === "drain" || step === "flush") {
        const irrigation = devices.find((device) => device.type === "irrigation");
        if (!irrigation) { db.logEvent("escalation", null, `Stufe ${step === "drain" ? 3 : 4} übersprungen — kein Bewässerungs-Controller registriert`); return true; }
        const caps = await deviceFetch(irrigation, "/api/irrigation/capabilities");
        const valve = step === "drain"
          ? caps.valves.find((entry) => entry.type === "drain")
          : caps.valves.find((entry) => entry.type === "irrigation");
        if (!valve) { db.logEvent("escalation", irrigation.id, `Stufe ${step === "drain" ? 3 : 4} übersprungen — kein passendes Ventil`); return true; }
        await deviceFetch(irrigation, "/api/irrigation/run", "POST", {
          valve: valve.id,
          durationSeconds: 30,
          runId: `escalation-${step}-${Date.now()}`,
        });
        db.logEvent("escalation", irrigation.id, `Stufe ${step === "drain" ? "3: Drainage" : "4: Wurzelkühlung"} über ${valve.name || valve.id} gestartet`);
      }
      return true;
    } catch (err) {
      db.logEvent("escalation-error", null, `Eskalationsstufe ${step} fehlgeschlagen: ${err.message} — neuer Versuch folgt`);
      return false;
    }
  }

  return {
    evaluate,
    runEscalations,
    syncMirror,
    configHash,
    activeAlarms() {
      const list = [...alarms.entries()].map(([ruleId, alarm]) => ({
        ruleId,
        deviceId: alarm.rule.deviceId,
        sensorId: alarm.rule.sensorId,
        value: alarm.value,
        since: alarm.since,
        message: alarm.message,
      }));
      if (mirrorAlarm) list.push({ ruleId: "config-mirror", deviceId: mirrorAlarm.deviceId, since: 0, message: mirrorAlarm.message });
      return list;
    },
  };
}
