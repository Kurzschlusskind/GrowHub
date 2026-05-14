export type DeviceType = "lighting-rs485" | "irrigation" | "climate";

export type DeviceDefinition = {
  id: string;
  name: string;
  type: DeviceType;
  endpoint?: string;
};

export type LightingStatus = {
  firmware: string;
  desired: { ch1: number; ch2: number };
  applied: { ch1: number; ch2: number };
  wifi: { connected: boolean; ssid: string; ip: string; rssi: number };
  thermal: {
    sensorPresent: boolean;
    overrideActive: boolean;
    temperatureC: number;
    config: ThermalConfig;
  };
};

export type ThermalConfig = {
  enabled: boolean;
  triggerC: number;
  releaseC: number;
  overridePercent: number;
  sampleIntervalMs: number;
};

export type SchedulePoint = {
  time: number;
  percent: number;
};

export type LightingSchedule = {
  enabled: boolean;
  ch1: SchedulePoint[];
  ch2: SchedulePoint[];
};

export type LightingPreset = {
  name: string;
  ch1: SchedulePoint[];
  ch2: SchedulePoint[];
};

export type LogRecord = {
  timestamp: number;
  uptimeMinutes: number;
  desiredCh1: number;
  desiredCh2: number;
  appliedCh1: number;
  appliedCh2: number;
  temperature: number;
  sensor: boolean;
  thermal: boolean;
};

export type LightingData = {
  status: LightingStatus;
  schedule: LightingSchedule;
  presets: LightingPreset[];
  logs: LogRecord[];
  logConfig: { enabled: boolean; intervalMinutes: number };
};

export type DeviceRuntime = {
  definition: DeviceDefinition;
  data?: LightingData;
  online: boolean;
  error?: string;
};
