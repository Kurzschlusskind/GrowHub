import { mockIrrigationRequest, mockLightingData, mockLightingStatus, mockThermalDrillRequest } from "./mock";

export function createApiClient(baseUrl) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const mock = base.length === 0;

  async function request(path, init = {}) {
    if (mock) return mockRequest(path, init);
    const response = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      ...init,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(body.error || response.statusText);
    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
  };
}

function mockRequest(path, init = {}) {
  if (path.startsWith("/api/irrigation/")) return mockIrrigationRequest(path, init);
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
