import { createApiClient } from "../../core/api";
import type { LightingData, LightingSchedule, ThermalConfig } from "../../core/types";

export function createLightingAdapter(endpoint?: string) {
  const api = createApiClient(endpoint);

  return {
    async load(): Promise<LightingData> {
      const [status, schedule, presets, logs] = await Promise.all([
        api.get<LightingData["status"]>("/api/status"),
        api.get<LightingSchedule>("/api/schedules"),
        api.get<{ presets: LightingData["presets"] }>("/api/presets"),
        api.get<{ config: LightingData["logConfig"]; records: LightingData["logs"] }>("/api/logs"),
      ]);

      return {
        status,
        schedule,
        presets: presets.presets || [],
        logs: logs.records || [],
        logConfig: logs.config || { enabled: true, intervalMinutes: 15 },
      };
    },

    setLevels(ch1: number, ch2: number) {
      return api.post("/api/levels", { ch1, ch2 });
    },

    saveSchedule(schedule: LightingSchedule) {
      return api.post("/api/schedules", schedule);
    },

    saveThermal(config: ThermalConfig) {
      return api.post("/api/thermal", config);
    },

    saveLogConfig(config: LightingData["logConfig"]) {
      return api.post("/api/logs/config", config);
    },

    clearLogs() {
      return api.post("/api/logs/clear", {});
    },
  };
}
