// History collector: polls every registered device on a fixed interval and
// persists status snapshots plus irrigation run events. A device being
// unreachable marks it offline and is retried on the next cycle — the server
// never stops because a controller is down (spec/growhub-server.md).

const STATUS_PATH = {
  "lighting-rs485": "/api/status",
  irrigation: "/api/irrigation/status",
  sensors: "/api/sensors/health",
};

// Numeric metrics extracted per device type so long ranges can be
// aggregated in SQL (db.history with bucketMinutes).
function extractMetrics(type, status) {
  if (type === "lighting-rs485") {
    return {
      ch1: status.applied?.ch1 ?? null,
      ch2: status.applied?.ch2 ?? null,
      temperature: status.thermal?.sensorPresent ? status.thermal.temperatureC : null,
    };
  }
  return {};
}

export function startCollector({ devices, db, pollIntervalSeconds, getRetentionDays, log, onCycle }) {
  const state = new Map(devices.map((device) => [device.id, { online: false, lastSeenAt: 0 }]));
  const latestReadings = new Map(); // deviceId -> readings array (sensor devices)

  async function fetchJson(endpoint, path) {
    const response = await fetch(`${endpoint}${path}`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  async function pollDevice(device) {
    const statusPath = STATUS_PATH[device.type];
    if (!statusPath || !device.endpoint) return;
    try {
      const status = await fetchJson(device.endpoint, statusPath);
      db.insertSample(device.id, Date.now(), status, extractMetrics(device.type, status));
      if (device.type === "irrigation") {
        const history = await fetchJson(device.endpoint, "/api/irrigation/history");
        for (const event of history.events || []) {
          if (event.at) db.insertRun(device.id, event);
        }
      }
      if (device.type === "sensors") {
        const result = await fetchJson(device.endpoint, "/api/sensors/readings");
        const readings = result.readings || [];
        const now = Date.now();
        for (const reading of readings) {
          db.insertSensorValue(device.id, reading.sensor, now, reading.value);
        }
        latestReadings.set(device.id, readings);
      }
      markOnline(device.id, true);
    } catch (err) {
      markOnline(device.id, false);
      log(`[collector] ${device.id} unreachable: ${err.message}`);
    }
  }

  function markOnline(deviceId, online) {
    const entry = state.get(deviceId);
    if (!entry) return;
    entry.online = online;
    if (online) entry.lastSeenAt = Date.now();
  }

  async function cycle() {
    for (const device of devices) await pollDevice(device);
    db.prune(Date.now() - getRetentionDays() * 86400000);
    if (onCycle) await onCycle(latestReadings);
  }

  cycle();
  const timer = setInterval(cycle, pollIntervalSeconds * 1000);
  timer.unref();

  return {
    deviceState(deviceId) {
      return state.get(deviceId) || { online: false, lastSeenAt: 0 };
    },
    markOnline,
  };
}
