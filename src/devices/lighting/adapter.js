import { createApiClient } from "../../core/api";

export function createLightingAdapter(endpoint) {
  const api = createApiClient(endpoint);

  return {
    async load() {
      const [status, schedule, presets, logs] = await Promise.all([
        api.get("/api/status"),
        api.get("/api/schedules"),
        api.get("/api/presets"),
        api.get("/api/logs"),
      ]);

      return {
        status,
        schedule,
        presets: presets.presets || [],
        logs: logs.records || [],
        logConfig: logs.config || { enabled: true, intervalMinutes: 15 },
        receivedAt: Date.now(),
      };
    },

    setLevels(ch1, ch2) {
      return api.post("/api/levels", { ch1, ch2 });
    },

    saveSchedule(schedule) {
      return api.post("/api/schedules", schedule);
    },

    savePresets(presets) {
      return api.post("/api/presets", { presets });
    },

    saveThermal(config) {
      return api.post("/api/thermal", config);
    },

    startThermalDrill() {
      return api.post("/api/thermal/drill/start", {});
    },

    stopThermalDrill() {
      return api.post("/api/thermal/drill/stop", {});
    },

    saveLogConfig(config) {
      return api.post("/api/logs/config", config);
    },

    clearLogs() {
      return api.post("/api/logs/clear", {});
    },
  };
}
