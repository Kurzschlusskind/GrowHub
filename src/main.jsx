import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Leaf, Plus, Power, Save, Trash2 } from "lucide-react";
import { deviceCatalog } from "./devices/catalog";
import { parseTime, percent, timeLabel } from "./core/format";
import "./styles/app.css";

const params = new URLSearchParams(location.search);
const endpoint = params.get("lighting") || "";
const initialView = ["dashboard", "schedule", "logs", "system"].includes(params.get("view")) ? params.get("view") : "dashboard";

const devices = [
  { id: "lighting-main", type: "lighting-rs485", endpoint },
  { id: "irrigation-next", type: "irrigation" },
  { id: "climate-next", type: "climate" },
].map((device) => ({ ...device, ...deviceCatalog[device.type] }));

const views = [
  { id: "dashboard", label: "Übersicht" },
  { id: "schedule", label: "Zeitplan" },
  { id: "logs", label: "Verlauf" },
  { id: "system", label: "System" },
];

// Measures an element in CSS pixels so charts can render 1:1 (viewBox = size),
// which keeps pointer coordinates exact and text at native size.
function useElementSize() {
  const ref = useRef(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
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
  return [ref, size];
}

function App() {
  const [view, setView] = useState(initialView);
  const [activeDeviceId, setActiveDeviceId] = useState("lighting-main");
  const [lighting, setLighting] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const noticeTimer = useRef(null);
  const adapter = useMemo(() => deviceCatalog["lighting-rs485"].createAdapter(endpoint), []);

  async function refresh() {
    try {
      setLighting(await adapter.load());
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "API-Fehler");
    }
  }

  // Wraps a save action: refreshes on success, surfaces failure as a banner.
  // Resolves to true/false so callers can keep local dirty state on failure.
  function run(action) {
    return action()
      .then(() => {
        refresh();
        return true;
      })
      .catch((err) => {
        setNotice(`Speichern fehlgeschlagen: ${err instanceof Error ? err.message : "API-Fehler"}`);
        window.clearTimeout(noticeTimer.current);
        noticeTimer.current = window.setTimeout(() => setNotice(""), 6000);
        return false;
      });
  }

  useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, 4000);
    return () => window.clearInterval(timer);
  }, []);

  const activeDevice = devices.find((device) => device.id === activeDeviceId) || devices[0];
  const isLighting = activeDevice.type === "lighting-rs485";
  const wifi = lighting?.status.wifi;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Leaf size={16} />
          <strong>GrowHub</strong>
          <span className="crumb">Blütezelt</span>
        </div>
        <div className="conn" title={error || undefined}>
          <span className={`conn-dot ${error ? "bad" : "ok"}`} />
          <span>{error ? "Verbindung gestört" : wifi?.connected ? `${wifi.ssid} · ${wifi.ip}` : "Mock-Daten"}</span>
        </div>
      </header>

      <div className="toolbar">
        <div className="device-picker" role="tablist" aria-label="Controller">
          {devices.map((device) => (
            <button
              className={`device-chip ${activeDeviceId === device.id ? "active" : ""}`}
              key={device.id}
              onClick={() => setActiveDeviceId(device.id)}
            >
              <device.icon size={14} />
              {device.label}
            </button>
          ))}
        </div>
        {isLighting && (
          <nav className="view-tabs">
            {views.map((entry) => (
              <button key={entry.id} className={view === entry.id ? "active" : ""} onClick={() => setView(entry.id)}>
                {entry.label}
              </button>
            ))}
          </nav>
        )}
      </div>

      <main className="content">
        {notice && <div className="notice" role="alert">{notice}</div>}
        {!isLighting && <ComingSoon device={activeDevice} />}
        {isLighting && lighting && view === "dashboard" && (
          <LiveView data={lighting} onSetLevels={(ch1, ch2) => run(() => adapter.setLevels(ch1, ch2))} />
        )}
        {isLighting && lighting && view === "schedule" && (
          <ScheduleView
            data={lighting}
            onSave={(schedule) => run(() => adapter.saveSchedule(schedule))}
            onSavePresets={(presets) => run(() => adapter.savePresets(presets))}
          />
        )}
        {isLighting && lighting && view === "logs" && (
          <LogsView data={lighting} onSaveConfig={(config) => run(() => adapter.saveLogConfig(config))} onClear={() => run(() => adapter.clearLogs())} />
        )}
        {isLighting && lighting && view === "system" && (
          <SystemView data={lighting} onSaveThermal={(config) => run(() => adapter.saveThermal(config))} />
        )}
      </main>
    </div>
  );
}

function ComingSoon({ device }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">{device.label}</h2>
          <p className="panel-sub">Controller-Typ „{device.type}"</p>
        </div>
        <span className="badge">geplant</span>
      </div>
      <div className="panel-body">
        <p className="muted">Dieser Gerätetyp ist in der Architektur vorgesehen, aber noch nicht implementiert.</p>
      </div>
    </section>
  );
}

function Stat({ label, value, note, series }) {
  return (
    <div className="stat">
      <span className="stat-label">
        {series && <i className={`chip ${series}`} />}
        {label}
      </span>
      <strong className="stat-value">{value}</strong>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function LiveView({ data, onSetLevels }) {
  const [ch1, setCh1] = useState(data.status.desired.ch1);
  const [ch2, setCh2] = useState(data.status.desired.ch2);
  const sendTimer = useRef(null);

  useEffect(() => {
    setCh1(data.status.desired.ch1);
    setCh2(data.status.desired.ch2);
  }, [data.status.desired.ch1, data.status.desired.ch2]);

  useEffect(() => () => window.clearTimeout(sendTimer.current), []);

  // Sliders fire on every pixel; batch into one request per pause so a real
  // controller is not flooded while dragging.
  function queueLevels(nextCh1, nextCh2) {
    setCh1(nextCh1);
    setCh2(nextCh2);
    window.clearTimeout(sendTimer.current);
    sendTimer.current = window.setTimeout(() => onSetLevels(nextCh1, nextCh2), 250);
  }

  function setBoth(value) {
    setCh1(value);
    setCh2(value);
    window.clearTimeout(sendTimer.current);
    onSetLevels(value, value);
  }

  const thermal = data.status.thermal;

  return (
    <>
      <div className="stat-row">
        <Stat series="ch1" label="Kanal 1" value={percent(data.status.applied.ch1)} note={`Soll ${percent(data.status.desired.ch1)}`} />
        <Stat series="ch2" label="Kanal 2" value={percent(data.status.applied.ch2)} note={`Soll ${percent(data.status.desired.ch2)}`} />
        <Stat label="Temperatur" value={thermal.sensorPresent ? `${thermal.temperatureC.toFixed(1)} °C` : "—"} note={thermal.sensorPresent ? "DS18B20" : "kein Sensor"} />
        <Stat label="Output" value={thermal.overrideActive ? "limitiert" : "frei"} note={thermal.overrideActive ? `Thermal-Limit ${thermal.config.overridePercent}%` : "kein Thermal-Limit aktiv"} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Kanalsteuerung</h2>
            <p className="panel-sub">Direkte Ansteuerung, Thermal-Limit wird firmwareseitig angewendet</p>
          </div>
          <div className="button-row">
            {[25, 50, 75].map((value) => (
              <button key={value} onClick={() => setBoth(value)}>{value}%</button>
            ))}
            <button className="danger" onClick={() => setBoth(0)}><Power size={14} /> Aus</button>
          </div>
        </div>
        <div className="panel-body channel-grid">
          <ChannelControl name="Kanal 1" series="ch1" value={ch1} applied={data.status.applied.ch1} onChange={(value) => queueLevels(value, ch2)} />
          <ChannelControl name="Kanal 2" series="ch2" value={ch2} applied={data.status.applied.ch2} onChange={(value) => queueLevels(ch1, value)} />
        </div>
      </section>
    </>
  );
}

function ChannelControl({ name, series, value, applied, onChange }) {
  return (
    <div className={`channel ${series}`}>
      <div className="channel-head">
        <span>{name}</span>
        <strong>{percent(value)}</strong>
      </div>
      <input
        type="range"
        min={0}
        max={100}
        value={value}
        aria-label={name}
        style={{ "--level": `${value}%` }}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <div className="channel-applied">
        <span className="applied-track"><span style={{ width: `${applied}%` }} /></span>
        <small>angewendet {percent(applied)}</small>
      </div>
    </div>
  );
}

function ScheduleView({ data, onSave, onSavePresets }) {
  const [schedule, setSchedule] = useState(data.schedule);
  const [channel, setChannel] = useState("ch1");
  const [dirty, setDirty] = useState(false);
  const [presetName, setPresetName] = useState("");
  const points = schedule[channel];
  const presets = data.presets;

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
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Zeitplan</h2>
          <p className="panel-sub">{schedule.enabled ? "aktiv" : "inaktiv"} · CH1 {schedule.ch1.length} Punkte · CH2 {schedule.ch2.length} Punkte</p>
        </div>
        <div className="button-row">
          <label className="switch"><input type="checkbox" checked={schedule.enabled} onChange={(e) => commit({ ...schedule, enabled: e.target.checked })} /> aktiv</label>
          <button className="primary" onClick={() => onSave(schedule).then((ok) => { if (ok) setDirty(false); })}><Save size={14} /> Speichern</button>
        </div>
      </div>
      <div className="panel-body schedule-layout">
        <ScheduleChart
          schedule={schedule}
          active={channel}
          onAdd={(point) => addPoint(point)}
          onMove={(index, point) => movePoint(index, point)}
          onDragEnd={endDrag}
        />
        <div className="editor">
          <div className="segmented">
            <button className={channel === "ch1" ? "active ch1" : ""} onClick={() => setChannel("ch1")}><i className="chip ch1" /> Kanal 1</button>
            <button className={channel === "ch2" ? "active ch2" : ""} onClick={() => setChannel("ch2")}><i className="chip ch2" /> Kanal 2</button>
          </div>
          <div className="button-row">
            <button onClick={() => addPoint()}><Plus size={14} /> Punkt</button>
            <button className="danger" onClick={() => commit({ ...schedule, [channel]: [] })}><Trash2 size={14} /> Leeren</button>
          </div>
          <div className="point-table">
            {points.map((point, index) => (
              <div className="point-row" key={`${point.time}-${index}`}>
                <span>{index + 1}</span>
                <input type="time" value={timeLabel(point.time)} onChange={(e) => { const time = parseTime(e.target.value); if (time !== null) updatePoint(index, { time }); }} />
                <input type="number" min={0} max={100} value={Math.round(point.percent)} onChange={(e) => updatePoint(index, { percent: Number(e.target.value) })} />
                <button className="danger ghost" onClick={() => commit({ ...schedule, [channel]: points.filter((_, i) => i !== index) })} aria-label="Punkt löschen">×</button>
              </div>
            ))}
            {points.length === 0 && <p className="muted">Keine Punkte — in den Chart klicken, um einen anzulegen.</p>}
          </div>
          <div className="preset-block">
            <span className="editor-label">Vorlagen</span>
            {presets.map((preset) => (
              <div className="preset-row" key={preset.name}>
                <button
                  title="Vorlage in den Entwurf laden (beide Kanäle)"
                  onClick={() => commit({ ...schedule, ch1: normalize(preset.ch1), ch2: normalize(preset.ch2) })}
                >
                  {preset.name}
                </button>
                <button
                  className="danger ghost"
                  aria-label={`Vorlage ${preset.name} löschen`}
                  onClick={() => onSavePresets(presets.filter((entry) => entry.name !== preset.name))}
                >
                  ×
                </button>
              </div>
            ))}
            {presets.length === 0 && <p className="muted">Noch keine Vorlagen gespeichert.</p>}
            <div className="preset-save">
              <input
                placeholder="Name, z.B. Blüte"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
              />
              <button
                disabled={!presetName.trim()}
                title="Aktuellen Entwurf (beide Kanäle) als Vorlage speichern"
                onClick={() => {
                  const name = presetName.trim();
                  onSavePresets([
                    ...presets.filter((entry) => entry.name !== name),
                    { name, ch1: schedule.ch1, ch2: schedule.ch2 },
                  ]).then((ok) => {
                    if (ok) setPresetName("");
                  });
                }}
              >
                <Save size={14} /> Ablegen
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const seriesColor = { ch1: "#5794f2", ch2: "#d17513" };

function ScheduleChart({ schedule, active, onAdd, onMove, onDragEnd }) {
  const [wrapRef, size] = useElementSize();
  const svgRef = useRef(null);
  const [dragIndex, setDragIndex] = useState(null);
  const activePoints = schedule[active];

  const plot = { left: 44, top: 16, width: Math.max(0, size.w - 44 - 12), height: Math.max(0, size.h - 16 - 30) };
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
    <div className="chart schedule-chart" ref={wrapRef}>
      {size.w > 0 && (
        <svg
          ref={svgRef}
          viewBox={`0 0 ${size.w} ${size.h}`}
          onPointerDown={(event) => onAdd(toPoint(event))}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line className="grid-line" x1={plot.left} x2={plot.left + plot.width} y1={yFor(value)} y2={yFor(value)} />
              <text className="axis-label" x={plot.left - 8} y={yFor(value) + 4} textAnchor="end">{value}%</text>
            </g>
          ))}
          {[0, 4, 8, 12, 16, 20, 24].map((hour) => (
            <g key={hour}>
              <line className="grid-line" x1={xFor(Math.min(1439, hour * 60))} x2={xFor(Math.min(1439, hour * 60))} y1={plot.top} y2={plot.top + plot.height} />
              <text className="axis-label" x={xFor(Math.min(1439, hour * 60))} y={size.h - 8} textAnchor="middle">{String(hour).padStart(2, "0")}:00</text>
            </g>
          ))}
          <Polyline points={schedule.ch1} color={seriesColor.ch1} active={active === "ch1"} xFor={xFor} yFor={yFor} plot={plot} />
          <Polyline points={schedule.ch2} color={seriesColor.ch2} active={active === "ch2"} xFor={xFor} yFor={yFor} plot={plot} />
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
              <circle className="dot" cx={xFor(point.time)} cy={yFor(point.percent)} r="6" stroke={seriesColor[active]} />
              <text x={labelX(point.time)} y={Math.max(12, yFor(point.percent) - 13)}>{timeLabel(point.time)} · {Math.round(point.percent)}%</text>
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
    <g opacity={active ? 1 : 0.35}>
      <polygon points={area} fill={color} opacity={active ? 0.1 : 0.05} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </g>
  );
}

function LogsView({ data, onSaveConfig, onClear }) {
  const [config, setConfig] = useState(data.logConfig);
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Verlauf</h2>
          <p className="panel-sub">{data.logs.length} Samples · Intervall {data.logConfig.intervalMinutes} min</p>
        </div>
        <div className="button-row">
          <span className="legend"><i className="chip ch1" /> CH1 <i className="chip ch2" /> CH2</span>
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
      <div className="panel-body">
        <LogsChart records={data.logs} />
      </div>
    </section>
  );
}

function LogsChart({ records }) {
  const [wrapRef, size] = useElementSize();
  const [hover, setHover] = useState(null);

  if (!records.length) {
    return <div className="chart logs-chart empty" ref={wrapRef}><p className="muted">Keine Samples aufgezeichnet.</p></div>;
  }

  const minUptime = records[0].uptimeMinutes;
  const maxUptime = records.at(-1).uptimeMinutes;
  const span = Math.max(1, maxUptime - minUptime);
  const plot = { left: 44, top: 12, width: Math.max(0, size.w - 44 - 12), height: Math.max(0, size.h - 12 - 30) };
  const xFor = (uptime) => plot.left + ((uptime - minUptime) / span) * plot.width;
  const yFor = (value) => plot.top + ((100 - Math.max(0, Math.min(100, value))) / 100) * plot.height;

  // Ticks count back from "now" in whole hours, at most ~6 labels.
  const stepMinutes = [60, 120, 240, 360, 720].find((step) => span / step <= 6) || 1440;
  const ticks = [];
  for (let back = 0; maxUptime - back >= minUptime; back += stepMinutes) ticks.push(back);

  const line = (key) => records.map((record) => `${xFor(record.uptimeMinutes)},${yFor(record[key])}`).join(" ");

  function handleMove(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    let nearest = 0;
    let best = Infinity;
    records.forEach((record, index) => {
      const distance = Math.abs(xFor(record.uptimeMinutes) - x);
      if (distance < best) {
        best = distance;
        nearest = index;
      }
    });
    setHover(nearest);
  }

  const hovered = hover === null ? null : records[hover];
  const hoursAgo = hovered ? (maxUptime - hovered.uptimeMinutes) / 60 : 0;

  return (
    <div className="chart logs-chart" ref={wrapRef}>
      {size.w > 0 && (
        <svg viewBox={`0 0 ${size.w} ${size.h}`} onPointerMove={handleMove} onPointerLeave={() => setHover(null)}>
          {[0, 25, 50, 75, 100].map((value) => (
            <g key={value}>
              <line className="grid-line" x1={plot.left} x2={plot.left + plot.width} y1={yFor(value)} y2={yFor(value)} />
              <text className="axis-label" x={plot.left - 8} y={yFor(value) + 4} textAnchor="end">{value}%</text>
            </g>
          ))}
          {ticks.map((back) => (
            <g key={back}>
              <line className="grid-line" x1={xFor(maxUptime - back)} x2={xFor(maxUptime - back)} y1={plot.top} y2={plot.top + plot.height} />
              <text className="axis-label" x={xFor(maxUptime - back)} y={size.h - 8} textAnchor="middle">{back === 0 ? "jetzt" : `-${back / 60}h`}</text>
            </g>
          ))}
          <polyline points={line("appliedCh1")} fill="none" stroke={seriesColor.ch1} strokeWidth={2} strokeLinejoin="round" />
          <polyline points={line("appliedCh2")} fill="none" stroke={seriesColor.ch2} strokeWidth={2} strokeLinejoin="round" />
          {hovered && (
            <g>
              <line className="crosshair" x1={xFor(hovered.uptimeMinutes)} x2={xFor(hovered.uptimeMinutes)} y1={plot.top} y2={plot.top + plot.height} />
              <circle cx={xFor(hovered.uptimeMinutes)} cy={yFor(hovered.appliedCh1)} r="4" fill={seriesColor.ch1} />
              <circle cx={xFor(hovered.uptimeMinutes)} cy={yFor(hovered.appliedCh2)} r="4" fill={seriesColor.ch2} />
            </g>
          )}
        </svg>
      )}
      {hovered && size.w > 0 && (
        <div
          className="chart-tooltip"
          style={{
            left: Math.min(size.w - 150, Math.max(0, xFor(hovered.uptimeMinutes) + 10)),
            top: 10,
          }}
        >
          <strong>{hoursAgo === 0 ? "jetzt" : `vor ${hoursAgo.toFixed(1).replace(".", ",")} h`}</strong>
          <span><i className="chip ch1" /> CH1 {Math.round(hovered.appliedCh1)}%</span>
          <span><i className="chip ch2" /> CH2 {Math.round(hovered.appliedCh2)}%</span>
        </div>
      )}
    </div>
  );
}

function SystemView({ data, onSaveThermal }) {
  const [thermal, setThermal] = useState(data.status.thermal.config);
  const wifi = data.status.wifi;
  return (
    <div className="system-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Thermal-Schutz</h2>
            <p className="panel-sub">Drosselt den Output, wenn die Leuchte zu heiß wird</p>
          </div>
          <button className="primary" onClick={() => onSaveThermal(thermal)}><Save size={14} /> Speichern</button>
        </div>
        <div className="panel-body form-grid">
          <label>Auslösen ab (°C)<input type="number" value={thermal.triggerC} onChange={(e) => setThermal({ ...thermal, triggerC: Number(e.target.value) })} /></label>
          <label>Freigabe unter (°C)<input type="number" value={thermal.releaseC} onChange={(e) => setThermal({ ...thermal, releaseC: Number(e.target.value) })} /></label>
          <label>Limit (%)<input type="number" value={thermal.overridePercent} onChange={(e) => setThermal({ ...thermal, overridePercent: Number(e.target.value) })} /></label>
          <label>Messintervall (ms)<input type="number" value={thermal.sampleIntervalMs} onChange={(e) => setThermal({ ...thermal, sampleIntervalMs: Number(e.target.value) })} /></label>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <h2 className="panel-title">Gerät</h2>
        </div>
        <div className="panel-body">
          <dl className="info-list">
            <div><dt>Firmware</dt><dd>{data.status.firmware}</dd></div>
            <div><dt>Netzwerk</dt><dd>{wifi.connected ? wifi.ssid : "nicht verbunden"}</dd></div>
            <div><dt>IP-Adresse</dt><dd>{wifi.ip}</dd></div>
            <div><dt>Signal</dt><dd>{wifi.rssi} dBm</dd></div>
            <div><dt>Temperatursensor</dt><dd>{data.status.thermal.sensorPresent ? "erkannt" : "nicht angeschlossen"}</dd></div>
          </dl>
        </div>
      </section>
    </div>
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
