import { createApiClient } from "../../core/api";

// HTTP contract for the irrigation ESP firmware. The mock in core/mock.js
// implements the same routes, so connecting real hardware later only means
// passing an endpoint (?irrigation=http://<ip>).
export function createIrrigationAdapter(endpoint) {
  const api = createApiClient(endpoint);

  return {
    async load() {
      const [status, schedules, history, safety] = await Promise.all([
        api.get("/api/irrigation/status"),
        api.get("/api/irrigation/schedules"),
        api.get("/api/irrigation/history"),
        api.get("/api/irrigation/safety"),
      ]);

      return {
        status,
        schedules,
        history: history.events || [],
        safety,
        receivedAt: Date.now(),
      };
    },

    run(zone, durationSeconds) {
      return api.post("/api/irrigation/run", { zone, durationSeconds });
    },

    stop() {
      return api.post("/api/irrigation/stop", {});
    },

    saveSchedules(schedules) {
      return api.post("/api/irrigation/schedules", schedules);
    },

    saveSafety(safety) {
      return api.post("/api/irrigation/safety", safety);
    },
  };
}
