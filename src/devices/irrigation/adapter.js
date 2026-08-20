import { createApiClient } from "../../core/api";
import { mockIrrigationRequest } from "./mock";

// Client for the irrigation controller contract (spec/irrigation-controller.md).
// The device announces its own topology via /capabilities; the app renders
// whatever is reported. Connect real hardware via ?irrigation=http://<ip>.
export function createIrrigationAdapter(endpoint) {
  const api = createApiClient(endpoint, mockIrrigationRequest);

  return {
    async load() {
      const [capabilities, status, schedules, history, safety, health] = await Promise.all([
        api.get("/api/irrigation/capabilities"),
        api.get("/api/irrigation/status"),
        api.get("/api/irrigation/schedules"),
        api.get("/api/irrigation/history"),
        api.get("/api/irrigation/safety"),
        api.get("/api/irrigation/health"),
      ]);

      return {
        capabilities,
        status,
        schedules,
        history: history.events || [],
        safety,
        health,
        receivedAt: Date.now(),
      };
    },

    // runId makes retries safe: the device ignores a duplicate (spec §3).
    run(valve, durationSeconds) {
      const runId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`;
      return api.post("/api/irrigation/run", { valve, durationSeconds, runId });
    },

    stop(pump) {
      return api.post("/api/irrigation/stop", { pump });
    },

    saveSchedules(schedules) {
      return api.post("/api/irrigation/schedules", schedules);
    },

    saveSafety(safety) {
      return api.post("/api/irrigation/safety", safety);
    },
  };
}
