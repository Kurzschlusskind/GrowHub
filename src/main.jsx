import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, Clock3, Droplets, Fan, Gauge, Leaf, Lightbulb, ListTodo, Plus, Power, Save, Settings, Trash2, Waves, Wifi } from "lucide-react";
import { createLightingAdapter } from "./devices/lighting/adapter";
import { parseTime, percent, timeLabel } from "./core/format";
import "./styles/app.css";

const params = new URLSearchParams(location.search);
const endpoint = params.get("lighting") || "";
const initialView = ["dashboard", "schedule", "logs", "system"].includes(params.get("view")) ? params.get("view") : "dashboard";

const devices = [
  { id: "lighting-main", name: "Lighting Controller", type: "lighting-rs485", endpoint },
  { id: "irrigation-next", name: "Irrigation Controller", type: "irrigation" },
  { id: "climate-next", name: "Climate Controller", type: "climate" },
];

function App() {
  const [view, setView] = useState(initialView);
  const [activeDeviceId, setActiveDeviceId] = useState("lighting-main");
  const [lighting, setLighting] = useState(null);
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
        <div className="brand-block">
          <div className="brand-mark"><Leaf size={24} /></div>
          <div>
            <div className="eyebrow">GrowHub</div>
            <h1>Grow Room Console</h1>
            <p className="muted">Licht, Klima und Bewaesserung als ein lokales System</p>
          </div>
        </div>
        <div className="status-strip">
          <span className={error ? "status bad" : "status ok"}><Activity size={15} />{error || "online"}</span>
          <span className="status"><Wifi size={15} />{lighting?.status.wifi.ip || "mock"}</span>
          <span className="status"><Clock3 size={15} />{new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>
        </div>
      </header>

      <section className="layout">
        <aside className="sidebar">
          <div className="room-card">
            <span>Raum</span>
            <strong>Bluetezelt</strong>
            <small>{lighting?.status.wifi.connected ? lighting.status.wifi.ssid : "Mock Betrieb"}</small>
          </div>
          <div className="sidebar-title">Controller</div>
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
              <Gauge size={17} /> Live-Konsole
            </button>
            <button className={view === "schedule" ? "active" : ""} onClick={() => setView("schedule")}>
              <ListTodo size={17} /> Tageskurve
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

function ComingSoon({ device }) {
  return (
    <section className="panel">
      <h2>{device.name}</h2>
      <p className="muted">Dieser Geraetetyp ist in der Architektur vorgesehen, aber noch nicht implementiert.</p>
    </section>
  );
}

function LiveView({ data, onSetLevels }) {
  const [ch1, setCh1] = useState(data.status.desired.ch1);
  const [ch2, setCh2] = useState(data.status.desired.ch2);

  useEffect(() => {
    setCh1(data.status.desired.ch1);
    setCh2(data.status.desired.ch2);
  }, [data.status.desired.ch1, data.status.desired.ch2]);

  return (
    <section className="live-console">
      <div className="panel-head">
        <div>
          <h2>RS485 Lichtpult</h2>
          <p className="muted">Direkte Kanalsteuerung mit angewendetem Thermal-Limit.</p>
        </div>
        <div className="button-row">
          {[25, 50, 75].map((value) => (
            <button key={value} onClick={() => { setCh1(value); setCh2(value); onSetLevels(value, value); }}>{value}%</button>
          ))}
          <button className="danger" onClick={() => { setCh1(0); setCh2(0); onSetLevels(0, 0); }}><Power size={16} /> Aus</button>
        </div>
      </div>
      <div className="console-grid">
        <ChannelCard name="CH1" value={ch1} applied={data.status.applied.ch1} color="blue" onChange={(value) => { setCh1(value); onSetLevels(value, ch2); }} />
        <ChannelCard name="CH2" value={ch2} applied={data.status.applied.ch2} color="amber" onChange={(value) => { setCh2(value); onSetLevels(ch1, value); }} />
        <div className="telemetry-card">
          <div>
            <span>Thermal</span>
            <strong>{data.status.thermal.sensorPresent ? `${data.status.thermal.temperatureC.toFixed(1)} C` : "Sensor fehlt"}</strong>
          </div>
          <div>
            <span>Output</span>
            <strong>{data.status.thermal.overrideActive ? "limitiert" : "frei"}</strong>
          </div>
          <div>
            <span>Firmware</span>
            <strong>{data.status.firmware}</strong>
          </div>
        </div>
      </div>
    </section>
  );
}

function ChannelCard({ name, value, applied, color, onChange }) {
  return (
    <div className={`channel-card ${color}`}>
      <div className="channel-top">
        <h3>{name}</h3>
        <strong>{percent(value)}</strong>
      </div>
      <div className="level-control" style={{ "--level": `${value}%` }}>
        <div className="level-scale">
          <span>0</span>
          <span>50</span>
          <span>100</span>
        </div>
        <input type="range" min={0} max={100} value={value} onChange={(event) => onChange(Number(event.target.value))} />
      </div>
      <div className="bar"><span style={{ width: `${applied}%` }} /></div>
      <small>applied {percent(applied)}</small>
    </div>
  );
}

function ScheduleView({ data, onSave }) {
  const [schedule, setSchedule] = useState(data.schedule);
  const [channel, setChannel] = useState("ch1");
  const [dirty, setDirty] = useState(false);
  const points = schedule[channel];

  useEffect(() => {
    if (!dirty) setSchedule(data.schedule);
  }, [data.schedule, dirty]);

  function commit(nextSchedule) {
    setSchedule(nextSchedule);
    setDirty(true);
  }

  function updatePoint(index, patch) {
    const next = [...points];
    next[index] = { ...next[index], ...patch };
    commit({ ...schedule, [channel]: normalize(next) });
  }

  // During a drag the array must keep its order, otherwise the dragged index
  // would suddenly refer to a neighbouring point; sorting happens on drag end.
  function movePoint(index, point) {
    const next = [...points];
    next[index] = point;
    commit({ ...schedule, [channel]: next });
  }

  function endDrag() {
    commit({ ...schedule, [channel]: normalize(points) });
  }

  function addPoint(point) {
    const last = points.at(-1);
    commit({
      ...schedule,
      [channel]: normalize([...points, point || { time: last ? Math.min(1439, last.time + 120) : 720, percent: last?.percent ?? 50 }]),
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
          <label className="switch"><input type="checkbox" checked={schedule.enabled} onChange={(e) => commit({ ...schedule, enabled: e.target.checked })} /> aktiv</label>
          <button className="primary" onClick={() => onSave(schedule).then(() => setDirty(false))}><Save size={16} /> Speichern</button>
        </div>
      </div>
      <div className="schedule-layout">
        <ScheduleChart
          schedule={schedule}
          active={channel}
          onAdd={(point) => addPoint(point)}
          onMove={(index, point) => movePoint(index, point)}
          onDragEnd={endDrag}
        />
        <div className="editor-card">
          <div className="segmented">
            <button className={channel === "ch1" ? "active" : ""} onClick={() => setChannel("ch1")}>CH1</button>
            <button className={channel === "ch2" ? "active" : ""} onClick={() => setChannel("ch2")}>CH2</button>
          </div>
          <div className="button-row">
            <button onClick={() => addPoint()}><Plus size={16} /> Punkt</button>
            <button className="danger" onClick={() => commit({ ...schedule, [channel]: [] })}><Trash2 size={16} /> Leeren</button>
          </div>
          <div className="point-table">
            {points.map((point, index) => (
              <div className="point-row" key={`${point.time}-${index}`}>
                <span>{index + 1}</span>
                <input type="time" value={timeLabel(point.time)} onChange={(e) => { const time = parseTime(e.target.value); if (time !== null) updatePoint(index, { time }); }} />
                <input type="number" min={0} max={100} value={Math.round(point.percent)} onChange={(e) => updatePoint(index, { percent: Number(e.target.value) })} />
                <button className="danger" onClick={() => commit({ ...schedule, [channel]: points.filter((_, i) => i !== index) })}>x</button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScheduleChart({ schedule, active, onAdd, onMove, onDragEnd }) {
  const wrapRef = useRef(null);
  const svgRef = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [dragIndex, setDragIndex] = useState(null);
  const activePoints = schedule[active];

  // The svg is rendered 1:1 in CSS pixels (viewBox = container size) so that
  // pointer coordinates map directly to chart coordinates without letterboxing.
  useEffect(() => {
    const el = wrapRef.current;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setSize((prev) => (prev.w === rect.width && prev.h === rect.height ? prev : { w: rect.width, h: rect.height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  const plot = { left: 52, top: 26, width: Math.max(0, size.w - 52 - 16), height: Math.max(0, size.h - 26 - 38) };
  const xFor = (time) => plot.left + (time / 1439) * plot.width;
  const yFor = (value) => plot.top + ((100 - value) / 100) * plot.height;
  const labelX = (time) => Math.max(plot.left + 34, Math.min(size.w - 44, xFor(time)));
  const toPoint = (event) => {
    const rect = svgRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return {
      time: Math.round(Math.max(0, Math.min(1439, ((x - plot.left) / plot.width) * 1439))),
      percent: Math.round(Math.max(0, Math.min(100, 100 - ((y - plot.top) / plot.height) * 100))),
    };
  };

  function handlePointerMove(event) {
    if (dragIndex === null) return;
    onMove(dragIndex, toPoint(event));
  }

  function handlePointerUp() {
    if (dragIndex === null) return;
    setDragIndex(null);
    onDragEnd();
  }

  return (
    <div className="schedule-chart" ref={wrapRef}>
      {size.w > 0 && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size.w} ${size.h}`}
          onPointerDown={(event) => onAdd(toPoint(event))}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <rect className="plot-bg" x={plot.left} y={plot.top} width={plot.width} height={plot.height} rx="10" />
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line className="grid-line" x1={plot.left} x2={plot.left + plot.width} y1={yFor(value)} y2={yFor(value)} />
              <text className="axis-label" x={plot.left - 8} y={yFor(value) + 4} textAnchor="end">{value}%</text>
            </g>
          ))}
          {[0, 4, 8, 12, 16, 20, 24].map((hour) => (
            <g key={hour}>
              <line className="grid-line soft" x1={xFor(Math.min(1439, hour * 60))} x2={xFor(Math.min(1439, hour * 60))} y1={plot.top} y2={plot.top + plot.height} />
              <text className="axis-label" x={xFor(Math.min(1439, hour * 60))} y={size.h - 14} textAnchor="middle">{String(hour).padStart(2, "0")}:00</text>
            </g>
          ))}
          <Polyline points={schedule.ch1} color="#55cfff" active={active === "ch1"} xFor={xFor} yFor={yFor} plot={plot} />
          <Polyline points={schedule.ch2} color="#ffd166" active={active === "ch2"} xFor={xFor} yFor={yFor} plot={plot} />
          {activePoints.map((point, index) => (
            <g
              className="chart-handle"
              key={`${active}-${index}`}
              onPointerDown={(event) => {
                event.stopPropagation();
                setDragIndex(index);
                svgRef.current?.setPointerCapture(event.pointerId);
              }}
            >
              <circle className="hit" cx={xFor(point.time)} cy={yFor(point.percent)} r="17" />
              <circle cx={xFor(point.time)} cy={yFor(point.percent)} r="8" />
              <text x={labelX(point.time)} y={Math.max(14, yFor(point.percent) - 15)}>{timeLabel(point.time)} / {Math.round(point.percent)}%</text>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

function Polyline({ points: rawPoints, color, active, xFor, yFor, plot }) {
  if (!rawPoints.length) return null;
  // Sort a copy: while a handle is being dragged the source array is
  // intentionally left unsorted so the drag index stays stable.
  const points = [...rawPoints].sort((a, b) => a.time - b.time);
  const line = points.map((point) => `${xFor(point.time)},${yFor(point.percent)}`).join(" ");
  const area = `${xFor(points[0].time)},${plot.top + plot.height} ${line} ${xFor(points.at(-1).time)},${plot.top + plot.height}`;
  return (
    <g opacity={active ? 1 : 0.42}>
      <polygon points={area} fill={color} opacity={active ? 0.14 : 0.06} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={active ? 6 : 4} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function LogsView({ data, onSaveConfig, onClear }) {
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

function SystemView({ data, onSaveThermal }) {
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

function normalize(points) {
  return points
    .map((point) => ({
      time: Math.max(0, Math.min(1439, Number.isFinite(point.time) ? point.time : 0)),
      percent: Math.max(0, Math.min(100, Number.isFinite(point.percent) ? point.percent : 0)),
    }))
    .sort((a, b) => a.time - b.time)
    .slice(0, 16);
}

createRoot(document.getElementById("root")).render(<App />);
