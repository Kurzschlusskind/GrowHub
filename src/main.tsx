import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Droplets, Fan, Lightbulb, ListTodo, Settings, Waves } from "lucide-react";
import { createLightingAdapter } from "./devices/lighting/adapter";
import type { DeviceDefinition, LightingData, LightingSchedule, SchedulePoint, ThermalConfig } from "./core/types";
import { parseTime, percent, timeLabel } from "./core/format";
import "./styles/app.css";

const endpoint = new URLSearchParams(location.search).get("lighting") || "";

const devices: DeviceDefinition[] = [
  { id: "lighting-main", name: "Lighting Controller", type: "lighting-rs485", endpoint },
  { id: "irrigation-next", name: "Irrigation Controller", type: "irrigation" },
  { id: "climate-next", name: "Climate Controller", type: "climate" },
];

type View = "dashboard" | "schedule" | "logs" | "system";

function App() {
  const [view, setView] = useState<View>("dashboard");
  const [activeDeviceId, setActiveDeviceId] = useState("lighting-main");
  const [lighting, setLighting] = useState<LightingData | null>(null);
  const [error, setError] = useState("");
  const adapter = useMemo(() => createLightingAdapter(endpoint), []);

  async function refresh() {
    try {
      setLighting(await adapter.load());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API error");
    }
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const activeDevice = devices.find((device) => device.id === activeDeviceId) || devices[0];

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">GrowHub</div>
          <h1>Control Center</h1>
        </div>
        <div className="status-strip">
          <span className={error ? "status bad" : "status ok"}>{error || "online"}</span>
          <span className="status">{lighting?.status.wifi.ip || "mock"}</span>
          <span className="status">{lighting?.status.wifi.ssid || "no wifi"}</span>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          <div className="sidebar-title">Geraete</div>
          {devices.map((device) => (
            <button
              className={`device-button ${activeDeviceId === device.id ? "active" : ""}`}
              key={device.id}
              onClick={() => setActiveDeviceId(device.id)}
            >
              {device.type === "lighting-rs485" && <Lightbulb size={18} />}
              {device.type === "irrigation" && <Droplets size={18} />}
              {device.type === "climate" && <Fan size={18} />}
              <span>
                <strong>{device.name}</strong>
                <small>{device.type}</small>
              </span>
            </button>
          ))}
        </aside>

        <section className="workspace">
          <nav className="view-tabs">
            <button className={view === "dashboard" ? "active" : ""} onClick={() => setView("dashboard")}>
              <Activity size={17} /> Live
            </button>
            <button className={view === "schedule" ? "active" : ""} onClick={() => setView("schedule")}>
              <ListTodo size={17} /> Zeitplan
            </button>
            <button className={view === "logs" ? "active" : ""} onClick={() => setView("logs")}>
              <Waves size={17} /> Logs
            </button>
            <button className={view === "system" ? "active" : ""} onClick={() => setView("system")}>
              <Settings size={17} /> System
            </button>
          </nav>

          {activeDevice.type !== "lighting-rs485" && <ComingSoon device={activeDevice} />}
          {activeDevice.type === "lighting-rs485" && lighting && view === "dashboard" && (
            <LiveView data={lighting} onSetLevels={(ch1, ch2) => adapter.setLevels(ch1, ch2).then(refresh)} />
          )}
          {activeDevice.type === "lighting-rs485" && lighting && view === "schedule" && (
            <ScheduleView data={lighting} onSave={(schedule) => adapter.saveSchedule(schedule).then(refresh)} />
          )}
          {activeDevice.type === "lighting-rs485" && lighting && view === "logs" && (
            <LogsView data={lighting} onSaveConfig={(config) => adapter.saveLogConfig(config).then(refresh)} onClear={() => adapter.clearLogs().then(refresh)} />
          )}
          {activeDevice.type === "lighting-rs485" && lighting && view === "system" && (
            <SystemView data={lighting} onSaveThermal={(config) => adapter.saveThermal(config).then(refresh)} />
          )}
        </section>
      </section>
    </main>
  );
}

function ComingSoon({ device }: { device: DeviceDefinition }) {
  return (
    <section className="panel">
      <h2>{device.name}</h2>
      <p className="muted">Dieser Geraetetyp ist in der Architektur vorgesehen, aber noch nicht implementiert.</p>
    </section>
  );
}

function LiveView({ data, onSetLevels }: { data: LightingData; onSetLevels: (ch1: number, ch2: number) => Promise<void> }) {
  const [ch1, setCh1] = useState(data.status.desired.ch1);
  const [ch2, setCh2] = useState(data.status.desired.ch2);

  useEffect(() => {
    setCh1(data.status.desired.ch1);
    setCh2(data.status.desired.ch2);
  }, [data.status.desired.ch1, data.status.desired.ch2]);

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Live Output</h2>
          <p className="muted">Direkte Steuerung des aktiven Lichtcontrollers.</p>
        </div>
        <div className="button-row">
          {[25, 50, 75].map((value) => (
            <button key={value} onClick={() => { setCh1(value); setCh2(value); onSetLevels(value, value); }}>{value}%</button>
          ))}
          <button className="danger" onClick={() => { setCh1(0); setCh2(0); onSetLevels(0, 0); }}>Aus</button>
        </div>
      </div>
      <div className="channel-grid">
        <ChannelCard name="CH1" value={ch1} applied={data.status.applied.ch1} color="blue" onChange={(value) => { setCh1(value); onSetLevels(value, ch2); }} />
        <ChannelCard name="CH2" value={ch2} applied={data.status.applied.ch2} color="amber" onChange={(value) => { setCh2(value); onSetLevels(ch1, value); }} />
      </div>
    </section>
  );
}

function ChannelCard({ name, value, applied, color, onChange }: { name: string; value: number; applied: number; color: string; onChange: (value: number) => void }) {
  return (
    <div className={`channel-card ${color}`}>
      <div className="channel-top">
        <h3>{name}</h3>
        <strong>{percent(value)}</strong>
      </div>
      <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      <div className="bar"><span style={{ width: `${applied}%` }} /></div>
      <small>applied {percent(applied)}</small>
    </div>
  );
}

function ScheduleView({ data, onSave }: { data: LightingData; onSave: (schedule: LightingSchedule) => Promise<void> }) {
  const [schedule, setSchedule] = useState(data.schedule);
  const [channel, setChannel] = useState<"ch1" | "ch2">("ch1");
  const points = schedule[channel];

  useEffect(() => setSchedule(data.schedule), [data.schedule]);

  function updatePoint(index: number, patch: Partial<SchedulePoint>) {
    const next = [...points];
    next[index] = { ...next[index], ...patch };
    setSchedule({ ...schedule, [channel]: normalize(next) });
  }

  function addPoint() {
    const last = points.at(-1);
    setSchedule({
      ...schedule,
      [channel]: normalize([...points, { time: last ? Math.min(1439, last.time + 120) : 720, percent: last?.percent ?? 50 }]),
    });
  }

  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Zeitplan</h2>
          <p className="muted">{schedule.enabled ? "aktiv" : "inaktiv"} | CH1 {schedule.ch1.length} Punkte | CH2 {schedule.ch2.length} Punkte</p>
        </div>
        <div className="button-row">
          <label className="switch"><input type="checkbox" checked={schedule.enabled} onChange={(e) => setSchedule({ ...schedule, enabled: e.target.checked })} /> aktiv</label>
          <button className="primary" onClick={() => onSave(schedule)}>Speichern</button>
        </div>
      </div>
      <div className="schedule-layout">
        <ScheduleChart schedule={schedule} active={channel} />
        <div className="editor-card">
          <div className="segmented">
            <button className={channel === "ch1" ? "active" : ""} onClick={() => setChannel("ch1")}>CH1</button>
            <button className={channel === "ch2" ? "active" : ""} onClick={() => setChannel("ch2")}>CH2</button>
          </div>
          <div className="button-row">
            <button onClick={addPoint}>+ Punkt</button>
            <button className="danger" onClick={() => setSchedule({ ...schedule, [channel]: [] })}>Leeren</button>
          </div>
          <div className="point-table">
            {points.map((point, index) => (
              <div className="point-row" key={`${point.time}-${index}`}>
                <span>{index + 1}</span>
                <input type="time" value={timeLabel(point.time)} onChange={(e) => updatePoint(index, { time: parseTime(e.target.value) })} />
                <input type="number" min={0} max={100} value={Math.round(point.percent)} onChange={(e) => updatePoint(index, { percent: Number(e.target.value) })} />
                <button className="danger" onClick={() => setSchedule({ ...schedule, [channel]: points.filter((_, i) => i !== index) })}>x</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScheduleChart({ schedule, active }: { schedule: LightingSchedule; active: "ch1" | "ch2" }) {
  return (
    <div className="schedule-chart">
      <svg viewBox="0 0 1000 420" preserveAspectRatio="none">
        {[0, 1, 2, 3, 4, 5].map((line) => <line key={line} x1="40" x2="980" y1={360 - line * 64} y2={360 - line * 64} />)}
        <Polyline points={schedule.ch1} color="#34c6ff" active={active === "ch1"} />
        <Polyline points={schedule.ch2} color="#ffc857" active={active === "ch2"} />
      </svg>
    </div>
  );
}

function Polyline({ points, color, active }: { points: SchedulePoint[]; color: string; active: boolean }) {
  const d = points.map((point) => `${40 + (point.time / 1439) * 940},${360 - (point.percent / 100) * 320}`).join(" ");
  return <polyline points={d} fill="none" stroke={color} strokeWidth={active ? 7 : 4} opacity={active ? 1 : 0.45} />;
}

function LogsView({ data, onSaveConfig, onClear }: { data: LightingData; onSaveConfig: (config: LightingData["logConfig"]) => Promise<void>; onClear: () => Promise<void> }) {
  const [config, setConfig] = useState(data.logConfig);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>Logs</h2>
          <p className="muted">{data.logs.length} Samples im Ringbuffer</p>
        </div>
        <div className="button-row">
          <select value={config.intervalMinutes} onChange={(e) => setConfig({ ...config, intervalMinutes: Number(e.target.value) })}>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
          <label className="switch"><input type="checkbox" checked={config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} /> aktiv</label>
          <button className="primary" onClick={() => onSaveConfig(config)}>Speichern</button>
          <button className="danger" onClick={onClear}>Leeren</button>
        </div>
      </div>
      <div className="log-chart">CH1 / CH2 Verlauf wird hier als naechstes verfeinert.</div>
    </section>
  );
}

function SystemView({ data, onSaveThermal }: { data: LightingData; onSaveThermal: (config: ThermalConfig) => Promise<void> }) {
  const [thermal, setThermal] = useState(data.status.thermal.config);
  return (
    <section className="panel">
      <div className="panel-head">
        <div>
          <h2>System</h2>
          <p className="muted">Firmware {data.status.firmware} | {data.status.wifi.ip}</p>
        </div>
        <button className="primary" onClick={() => onSaveThermal(thermal)}>Thermal speichern</button>
      </div>
      <div className="form-grid">
        <label>Trigger C<input type="number" value={thermal.triggerC} onChange={(e) => setThermal({ ...thermal, triggerC: Number(e.target.value) })} /></label>
        <label>Release C<input type="number" value={thermal.releaseC} onChange={(e) => setThermal({ ...thermal, releaseC: Number(e.target.value) })} /></label>
        <label>Limit %<input type="number" value={thermal.overridePercent} onChange={(e) => setThermal({ ...thermal, overridePercent: Number(e.target.value) })} /></label>
        <label>Sample ms<input type="number" value={thermal.sampleIntervalMs} onChange={(e) => setThermal({ ...thermal, sampleIntervalMs: Number(e.target.value) })} /></label>
      </div>
    </section>
  );
}

function normalize(points: SchedulePoint[]) {
  return points
    .map((point) => ({
      time: Math.max(0, Math.min(1439, point.time)),
      percent: Math.max(0, Math.min(100, point.percent)),
    }))
    .sort((a, b) => a.time - b.time)
    .slice(0, 16);
}

createRoot(document.getElementById("root")!).render(<App />);
