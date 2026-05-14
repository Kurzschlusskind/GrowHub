import type { LightingData, LightingSchedule, ThermalConfig } from "./types";
import { mockLightingData } from "./mock";

export type ApiClient = ReturnType<typeof createApiClient>;

export function createApiClient(baseUrl?: string) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const mock = base.length === 0;

  async function request<T>(path: string, init?: RequestInit): Promise<T> {
    if (mock) return mockRequest(path, init) as T;
    const response = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
      ...init,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(body.error || response.statusText);
    return body as T;
  }

  return {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body: unknown) =>
      request<T>(path, { method: "POST", body: JSON.stringify(body) }),
  };
}

function mockRequest(path: string, init?: RequestInit) {
  if (path === "/api/status") return structuredClone(mockLightingData.status);
  if (path === "/api/schedules") {
    if (init?.method === "POST" && init.body) {
      mockLightingData.schedule = JSON.parse(init.body as string) as LightingSchedule;
    }
    return structuredClone(mockLightingData.schedule);
  }
  if (path === "/api/presets") {
    return { presets: structuredClone(mockLightingData.presets) };
  }
  if (path === "/api/logs") {
    return {
      config: structuredClone(mockLightingData.logConfig),
      records: structuredClone(mockLightingData.logs),
    };
  }
  if (path === "/api/levels" && init?.body) {
    const body = JSON.parse(init.body as string) as { ch1: number; ch2: number };
    mockLightingData.status.desired = body;
    mockLightingData.status.applied = body;
    return { ok: true };
  }
  if (path === "/api/thermal" && init?.body) {
    mockLightingData.status.thermal.config = JSON.parse(init.body as string) as ThermalConfig;
    return { thermal: structuredClone(mockLightingData.status.thermal) };
  }
  if (path === "/api/logs/config" && init?.body) {
    mockLightingData.logConfig = JSON.parse(init.body as string);
    return { ok: true };
  }
  if (path === "/api/logs/clear") {
    mockLightingData.logs = [];
    return { ok: true };
  }
  return {};
}
