import React from "react";
import { Stat } from "../../core/ui";

// Views of the sensor device module: a pure display of what the device
// reports. Thresholds and alarms are server concerns (spec/growhub-server.md);
// long-term charts come from the server history panel in server mode.

const quantityLabels = {
  temperature: "Temperatur",
  humidity: "Luftfeuchte",
  co2: "CO₂",
  pressure: "Druck",
  vpd: "VPD",
  moisture: "Substratfeuchte",
  ph: "pH",
  ec: "EC",
  flow: "Durchfluss",
  level: "Füllstand",
};

function formatValue(value, unit) {
  if (value === null || value === undefined) return "—";
  return `${value} ${unit}`.trim();
}

function LiveView({ data }) {
  const valueFor = (id) => data.readings.find((reading) => reading.sensor === id)?.value ?? null;
  return (
    <>
      <div className="stat-row">
        {data.capabilities.sensors.map((sensor) => (
          <Stat
            key={sensor.id}
            label={quantityLabels[sensor.quantity] || sensor.quantity}
            value={formatValue(valueFor(sensor.id), sensor.unit)}
            note={sensor.name || sensor.id}
          />
        ))}
      </div>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Messwerte</h2>
            <p className="panel-sub">Das Gerät reicht Werte nur durch — Schwellen und Alarme verwaltet der GrowHub Server</p>
          </div>
          <span className="badge">Mock — Hardware-Anbindung folgt</span>
        </div>
        <div className="panel-body">
          <dl className="info-list">
            {data.capabilities.sensors.map((sensor) => (
              <div key={sensor.id}>
                <dt>{sensor.name || sensor.id} · {quantityLabels[sensor.quantity] || sensor.quantity}</dt>
                <dd>{formatValue(valueFor(sensor.id), sensor.unit)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>
    </>
  );
}

function HistoryView() {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Verlauf</h2>
          <p className="panel-sub">Sensorwerte werden vom GrowHub Server aufgezeichnet</p>
        </div>
      </div>
      <div className="panel-body">
        <p className="muted">Im Direktmodus gibt es keine Aufzeichnung — der Langzeit-Verlauf erscheint hier, sobald die App über einen GrowHub Server läuft.</p>
      </div>
    </section>
  );
}

const resetReasonLabels = {
  "power-on": "Einschalten",
  watchdog: "Watchdog",
  brownout: "Brownout",
  software: "Software-Reset",
};

function uptimeLabel(seconds) {
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.floor((seconds % 3600) / 60)} min`;
  return `${Math.floor(seconds / 86400)} d ${Math.floor((seconds % 86400) / 3600)} h`;
}

function SystemView({ data }) {
  const health = data.health;
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2 className="panel-title">Controller-Zustand</h2>
          <p className="panel-sub">Selbstauskunft über /api/sensors/health</p>
        </div>
      </div>
      <div className="panel-body">
        <dl className="info-list">
          <div><dt>Uptime</dt><dd>{uptimeLabel(health.uptimeSeconds)}</dd></div>
          <div><dt>Letzter Reset</dt><dd>{resetReasonLabels[health.resetReason] || health.resetReason}</dd></div>
          <div><dt>Freier Heap</dt><dd>{Math.round(health.heapFreeBytes / 1024)} kB</dd></div>
          <div><dt>Netzwerk</dt><dd>{health.wifi.connected ? `${health.wifi.ssid} · ${health.wifi.rssi} dBm` : "nicht verbunden"}</dd></div>
          <div><dt>IP-Adresse</dt><dd>{health.wifi.ip}</dd></div>
          <div><dt>Uhrzeit</dt><dd>{health.clockValid ? `synchron · ${new Date(health.time).toLocaleTimeString("de-DE")}` : "ungültig"}</dd></div>
          <div><dt>Anbindung</dt><dd>Mock — Hardware folgt</dd></div>
        </dl>
      </div>
    </section>
  );
}

export const sensorViews = {
  dashboard: LiveView,
  logs: HistoryView,
  system: SystemView,
};
