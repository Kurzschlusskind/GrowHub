// Reference implementation of spec/sensor-controller.md. A pure pass-through
// device: it measures (here: simulates) and reports; all decisions live on
// the server. Values drift deterministically with the time of day so charts
// and alarm rules have something realistic to chew on.

export const sensorCapabilities = {
  spec: "1.0.0",
  firmware: "mock",
  sensors: [
    { id: "s1", quantity: "temperature", unit: "°C", name: "Zelt oben" },
    { id: "s2", quantity: "humidity", unit: "%", name: "Zelt oben" },
    { id: "s3", quantity: "co2", unit: "ppm", name: "Abluft" },
  ],
};

const sensorState = {
  bootAt: Date.now(),
  wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.38", rssi: -64 },
  mirror: { hash: null, config: null, updatedAt: 0 },
};

// Deterministic pseudo-measurements: a diurnal swing plus fast wobble.
function measure(sensorId, now = Date.now()) {
  const dayPhase = ((now / 86400000) % 1) * 2 * Math.PI;
  const wobble = Math.sin(now / 47000) + Math.sin(now / 13000) * 0.5;
  if (sensorId === "s1") return Math.round((25.5 + Math.sin(dayPhase) * 2.5 + wobble * 0.4) * 10) / 10;
  if (sensorId === "s2") return Math.round((60 + Math.cos(dayPhase) * 6 + wobble) * 10) / 10;
  if (sensorId === "s3") return Math.round(750 + Math.sin(dayPhase + 1) * 120 + wobble * 25);
  return null;
}

export function mockSensorsRequest(path, init = {}) {
  if (path === "/api/sensors/capabilities") {
    return structuredClone(sensorCapabilities);
  }
  if (path === "/api/sensors/readings") {
    return {
      readings: sensorCapabilities.sensors.map((sensor) => ({ sensor: sensor.id, value: measure(sensor.id) })),
    };
  }
  if (path === "/api/sensors/health") {
    return {
      uptimeSeconds: Math.round((Date.now() - sensorState.bootAt) / 1000),
      resetReason: "power-on",
      heapFreeBytes: 201344,
      wifi: structuredClone(sensorState.wifi),
      clockValid: true,
      time: new Date().toISOString(),
    };
  }
  if (path === "/api/sensors/config-mirror") {
    if (init.method === "POST" && init.body) {
      const body = JSON.parse(init.body);
      sensorState.mirror = { hash: body.hash || null, config: body.config ?? null, updatedAt: Date.now() };
      return { ok: true };
    }
    return { hash: sensorState.mirror.hash, updatedAt: sensorState.mirror.updatedAt };
  }
  return {};
}
