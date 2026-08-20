import React, { useEffect, useState } from "react";
import { Play, Plus, Save, Square } from "lucide-react";
import { Stat, useNow } from "../../core/ui";
import { agoLabel, durationLabel, parseTime, timeLabel } from "../../core/format";

// Views of the irrigation device module. Each view receives { data, adapter,
// run } from the app shell — the shell knows nothing about irrigation.

function valveName(capabilities, id) {
  return capabilities.valves.find((valve) => valve.id === id)?.name || id;
}

function LiveView({ data, adapter, run }) {
  const caps = data.capabilities;
  const onRun = (valve, durationSeconds) => run(() => adapter.run(valve, durationSeconds), "Start");
  const onStop = (pump) => run(() => adapter.stop(pump), "Stopp");
  const anyRunning = data.status.pumps.some((pump) => pump.running);
  const now = useNow(1000, anyRunning);
  const remainingFor = (pump) => (pump?.running ? Math.max(0, Math.round(pump.remainingSeconds - (now - data.receivedAt) / 1000)) : 0);
  const irrigationValves = caps.valves.filter((valve) => valve.type === "irrigation");
  const drainValves = caps.valves.filter((valve) => valve.type === "drain");
  const valveState = (id) => data.status.valves.find((valve) => valve.id === id);
  const pumpFor = (valveId) => data.status.pumps.find((pump) => pump.id === caps.valves.find((valve) => valve.id === valveId)?.pump);
  const lastRunAt = Math.max(0, ...data.status.valves.map((valve) => valve.lastRunAt || 0));
  const lastValve = data.status.valves.find((valve) => valve.lastRunAt === lastRunAt);

  return (
    <>
      <div className="stat-row">
        {caps.pumps.map((pumpMeta) => {
          const pump = data.status.pumps.find((entry) => entry.id === pumpMeta.id);
          return (
            <Stat
              key={pumpMeta.id}
              label={pumpMeta.name}
              value={pump?.running ? "läuft" : "bereit"}
              note={pump?.running ? `${valveName(caps, pump.valve)} · noch ${remainingFor(pump)} s` : "kein Lauf aktiv"}
            />
          );
        })}
        <Stat label="Ventile" value={`${irrigationValves.length} + ${drainValves.length}`} note="Bewässerung + Drainage" />
        <Stat label="Letzter Lauf" value={lastRunAt ? agoLabel(lastRunAt) : "—"} note={lastValve ? valveName(caps, lastValve.id) : ""} />
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Bewässerungsventile</h2>
            <p className="panel-sub">Manueller Start — pro Pumpe ist immer nur ein Ventil offen, Dauer begrenzt durch die maximale Pumpenlaufzeit</p>
          </div>
          <span className="badge">Mock — Hardware-Anbindung folgt</span>
        </div>
        <div className="panel-body zone-grid">
          {irrigationValves.map((meta) => (
            <ValveCard
              key={meta.id}
              meta={meta}
              state={valveState(meta.id)}
              pump={pumpFor(meta.id)}
              remaining={remainingFor(pumpFor(meta.id))}
              maxRunSeconds={data.safety.maxRunSeconds}
              onRun={onRun}
              onStop={onStop}
            />
          ))}
        </div>
      </section>

      {drainValves.length > 0 && (
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2 className="panel-title">Drainage</h2>
              <p className="panel-sub">Spülventile — belegen die Pumpe, unterliegen aber keiner Sperrzeit</p>
            </div>
          </div>
          <div className="panel-body zone-grid">
            {drainValves.map((meta) => (
              <ValveCard
                key={meta.id}
                drain
                meta={meta}
                state={valveState(meta.id)}
                pump={pumpFor(meta.id)}
                remaining={remainingFor(pumpFor(meta.id))}
                maxRunSeconds={data.safety.maxRunSeconds}
                onRun={onRun}
                onStop={onStop}
              />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ValveCard({ meta, state, pump, remaining, maxRunSeconds, drain, onRun, onStop }) {
  const [duration, setDuration] = useState(drain ? 30 : 60);
  const isActive = Boolean(pump?.running && pump.valve === meta.id);
  const durations = (drain ? [15, 30, 60] : [30, 60, 90, 120, 180, 300]).filter((value) => value <= maxRunSeconds);

  return (
    <div className={`zone ${isActive ? "running" : ""}`}>
      <div className="zone-head">
        <span className={`zone-dot ${isActive ? "run" : state?.state === "error" ? "bad" : "ok"}`} />
        <strong>{meta.name}</strong>
      </div>
      <p className="zone-last">
        {state?.lastRunAt ? `zuletzt ${agoLabel(state.lastRunAt)} · ${durationLabel(state.lastDurationSeconds)}` : "noch nie gelaufen"}
      </p>
      {isActive ? (
        <div className="zone-actions">
          <strong className="countdown">{remaining} s</strong>
          <button className="danger" onClick={() => onStop(meta.pump)}><Square size={14} /> Stopp</button>
        </div>
      ) : (
        <div className="zone-actions">
          <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label={`Dauer ${meta.name}`}>
            {durations.map((value) => (
              <option key={value} value={value}>{durationLabel(value)}</option>
            ))}
          </select>
          <button className="primary" disabled={Boolean(pump?.running)} onClick={() => onRun(meta.id, duration)}>
            <Play size={14} /> {drain ? "Spülen" : "Start"}
          </button>
        </div>
      )}
    </div>
  );
}

function ScheduleView({ data, adapter, run }) {
  const caps = data.capabilities;
  const [schedules, setSchedules] = useState(data.schedules);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!dirty) setSchedules(data.schedules);
  }, [data.schedules, dirty]);

  function commit(next) {
    setSchedules(next);
    setDirty(true);
  }

  function updateWindow(index, patch) {
    const windows = [...schedules.windows];
    windows[index] = { ...windows[index], ...patch };
    commit({ ...schedules, windows });
  }

  function addWindow() {
    commit({
      ...schedules,
      windows: [...schedules.windows, { valve: caps.valves[0].id, time: 360, durationSeconds: 60, enabled: true }],
    });
  }

  function save() {
    const sorted = { ...schedules, windows: [...schedules.windows].sort((a, b) => a.time - b.time) };
    run(() => adapter.saveSchedules(sorted)).then((ok) => {
      if (ok) setDirty(false);
    });
  }

  // Windows that request a pump an earlier window still holds start delayed —
  // computed per pump, matching the runtime queues.
  const delayedWindows = (() => {
    const enabled = schedules.windows
      .map((window, index) => ({ ...window, index }))
      .filter((window) => window.enabled)
      .sort((a, b) => a.time - b.time || a.index - b.index);
    const delayed = new Set();
    const pumpFreeAt = {};
    for (const window of enabled) {
      const pumpId = caps.valves.find((valve) => valve.id === window.valve)?.pump;
      if (!pumpId) continue;
      const startSeconds = window.time * 60;
      if (startSeconds < (pumpFreeAt[pumpId] ?? -1)) delayed.add(window.index);
      pumpFreeAt[pumpId] = Math.max(startSeconds, pumpFreeAt[pumpId] ?? -1) + window.durationSeconds;
    }
    return delayed;
  })();

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Zeitfenster</h2>
          <p className="panel-sub">{schedules.enabled ? "aktiv" : "inaktiv"} · {schedules.windows.length} Fenster · Kollisionen werden pro Pumpe nacheinander abgearbeitet</p>
        </div>
        <div className="button-row">
          <label className="switch"><input type="checkbox" checked={schedules.enabled} onChange={(e) => commit({ ...schedules, enabled: e.target.checked })} /> aktiv</label>
          <button onClick={addWindow}><Plus size={14} /> Fenster</button>
          <button className="primary" onClick={save}><Save size={14} /> Speichern</button>
        </div>
      </div>
      <div className="panel-body window-table">
        {schedules.windows.map((window, index) => (
          <div className={`window-row ${window.enabled ? "" : "disabled"} ${delayedWindows.has(index) ? "delayed" : ""}`} key={index}>
            <label className="switch" title={window.enabled ? "Fenster aktiv" : "Fenster deaktiviert"}>
              <input type="checkbox" checked={window.enabled} onChange={(e) => updateWindow(index, { enabled: e.target.checked })} />
            </label>
            <select value={window.valve} onChange={(e) => updateWindow(index, { valve: e.target.value })} aria-label="Ventil">
              {caps.valves.map((valve) => (
                <option key={valve.id} value={valve.id}>{valve.name}</option>
              ))}
            </select>
            <input type="time" value={timeLabel(window.time)} onChange={(e) => { const time = parseTime(e.target.value); if (time !== null) updateWindow(index, { time }); }} />
            <div className="window-duration">
              <input
                type="number"
                min={5}
                max={data.safety.maxRunSeconds}
                value={window.durationSeconds}
                aria-label="Dauer in Sekunden"
                onChange={(e) => updateWindow(index, { durationSeconds: Math.max(5, Math.min(data.safety.maxRunSeconds, Number(e.target.value) || 5)) })}
              />
              <span className="muted">s</span>
            </div>
            <button
              className="danger ghost"
              aria-label="Fenster löschen"
              onClick={() => commit({ ...schedules, windows: schedules.windows.filter((_, i) => i !== index) })}
            >
              ×
            </button>
            {delayedWindows.has(index) && (
              <p className="window-hint">Überschneidung — startet verzögert, sobald die Pumpe frei ist</p>
            )}
          </div>
        ))}
        {schedules.windows.length === 0 && <p className="muted">Keine Zeitfenster — über „Fenster" eines anlegen.</p>}
      </div>
    </section>
  );
}

function HistoryView({ data }) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Verlauf</h2>
          <p className="panel-sub">Letzte {data.history.length} Läufe</p>
        </div>
      </div>
      <div className="panel-body history">
        {data.history.map((event, index) => (
          <div className="history-row" key={index}>
            <span className="muted">{agoLabel(event.at)}</span>
            <strong>{valveName(data.capabilities, event.valve)}</strong>
            <span>{durationLabel(event.durationSeconds)}</span>
            <span className={`badge ${event.trigger === "thermal" ? "alert" : ""}`}>
              {event.trigger === "manual" ? "manuell" : event.trigger === "thermal" ? "Notkühlung" : "Zeitplan"}
            </span>
          </div>
        ))}
        {data.history.length === 0 && <p className="muted">Noch keine Läufe aufgezeichnet.</p>}
      </div>
    </section>
  );
}

function uptimeLabel(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}

const resetReasonLabels = {
  "power-on": "Einschalten",
  watchdog: "Watchdog",
  brownout: "Brownout",
  software: "Software-Reset",
};

function SystemView({ data, adapter, run }) {
  const [safety, setSafety] = useState(data.safety);
  const health = data.health;
  return (
    <div className="system-grid">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Pumpenschutz</h2>
            <p className="panel-sub">Maximale Laufzeit gilt pro Lauf; die Sperrzeit gilt pro Bewässerungsventil (Drainage ausgenommen)</p>
          </div>
          <button className="primary" onClick={() => run(() => adapter.saveSafety(safety))}><Save size={14} /> Speichern</button>
        </div>
        <div className="panel-body form-grid">
          <label>Max. Laufzeit (s)<input type="number" min={10} value={safety.maxRunSeconds} onChange={(e) => setSafety({ ...safety, maxRunSeconds: Number(e.target.value) })} /></label>
          <label>Sperrzeit (min)<input type="number" min={0} value={safety.lockoutMinutes} onChange={(e) => setSafety({ ...safety, lockoutMinutes: Number(e.target.value) })} /></label>
        </div>
      </section>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Controller-Zustand</h2>
            <p className="panel-sub">Selbstauskunft über /api/irrigation/health</p>
          </div>
        </div>
        <div className="panel-body">
          <dl className="info-list">
            <div><dt>Uptime</dt><dd>{uptimeLabel(health.uptimeSeconds)}</dd></div>
            <div><dt>Letzter Reset</dt><dd>{resetReasonLabels[health.resetReason] || health.resetReason}</dd></div>
            <div><dt>Freier Heap</dt><dd>{Math.round(health.heapFreeBytes / 1024)} kB</dd></div>
            <div><dt>Netzwerk</dt><dd>{health.wifi.connected ? `${health.wifi.ssid} · ${health.wifi.rssi} dBm` : "nicht verbunden"}</dd></div>
            <div><dt>IP-Adresse</dt><dd>{health.wifi.ip}</dd></div>
            <div><dt>Uhrzeit</dt><dd>{health.clockValid ? `synchron · ${new Date(health.time).toLocaleTimeString("de-DE")}` : "ungültig — Zeitpläne pausiert"}</dd></div>
            <div><dt>Anbindung</dt><dd>Mock — Hardware folgt</dd></div>
          </dl>
        </div>
      </section>
    </div>
  );
}

export const irrigationViews = {
  dashboard: LiveView,
  schedule: ScheduleView,
  logs: HistoryView,
  system: SystemView,
};
