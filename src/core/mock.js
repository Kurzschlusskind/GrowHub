export const mockLightingData = {
  status: {
    firmware: "mock",
    desired: { ch1: 42, ch2: 28 },
    applied: { ch1: 42, ch2: 28 },
    wifi: { connected: true, ssid: "MockNet", ip: "192.168.178.36", rssi: -57 },
    thermal: {
      sensorPresent: false,
      overrideActive: false,
      temperatureC: 0,
      config: { enabled: true, triggerC: 30, releaseC: 27, overridePercent: 25, sampleIntervalMs: 5000 },
    },
  },
  schedule: {
    enabled: false,
    ch1: [
      { time: 360, percent: 20 },
      { time: 720, percent: 75 },
      { time: 1200, percent: 70 },
      { time: 1320, percent: 8 },
    ],
    ch2: [
      { time: 360, percent: 0 },
      { time: 720, percent: 38 },
      { time: 1200, percent: 36 },
      { time: 1320, percent: 0 },
    ],
  },
  presets: [
    {
      name: "Veg",
      ch1: [{ time: 360, percent: 25 }, { time: 1320, percent: 10 }],
      ch2: [{ time: 360, percent: 5 }, { time: 1320, percent: 0 }],
    },
    {
      name: "Blüte",
      ch1: [{ time: 360, percent: 20 }, { time: 720, percent: 85 }, { time: 1320, percent: 5 }],
      ch2: [{ time: 360, percent: 0 }, { time: 720, percent: 50 }, { time: 1320, percent: 0 }],
    },
  ],
  logs: Array.from({ length: 48 }, (_, index) => ({
    timestamp: 0,
    uptimeMinutes: index * 15,
    desiredCh1: 20 + Math.sin(index / 6) * 20 + index * 0.5,
    desiredCh2: 12 + Math.sin(index / 5) * 12,
    appliedCh1: 20 + Math.sin(index / 6) * 20 + index * 0.5,
    appliedCh2: 12 + Math.sin(index / 5) * 12,
    temperature: -273.1,
    sensor: false,
    thermal: false,
  })),
  logConfig: { enabled: true, intervalMinutes: 15 },
};
