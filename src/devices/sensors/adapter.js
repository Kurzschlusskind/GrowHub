import { createApiClient } from "../../core/api";
import { mockSensorsRequest } from "./mock";

// Client for the sensor controller contract (spec/sensor-controller.md).
// Connect real hardware via ?sensors=http://<ip>.
export function createSensorsAdapter(endpoint) {
  const api = createApiClient(endpoint, mockSensorsRequest);

  return {
    async load() {
      const [capabilities, readings, health] = await Promise.all([
        api.get("/api/sensors/capabilities"),
        api.get("/api/sensors/readings"),
        api.get("/api/sensors/health"),
      ]);

      return {
        capabilities,
        readings: readings.readings || [],
        health,
        receivedAt: Date.now(),
      };
    },
  };
}
