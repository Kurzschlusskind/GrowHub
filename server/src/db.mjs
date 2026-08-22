import { DatabaseSync } from "node:sqlite";

// SQLite persistence for collected device history (spec/growhub-server.md).
// node:sqlite is built into Node >= 24 — no external dependencies.

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      device_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_samples ON samples(device_id, at);
    CREATE TABLE IF NOT EXISTS runs (
      device_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      valve TEXT NOT NULL,
      duration_seconds INTEGER NOT NULL,
      trigger TEXT NOT NULL,
      UNIQUE(device_id, at, valve)
    );
  `);

  return {
    insertSample(deviceId, at, payload) {
      db.prepare("INSERT INTO samples (device_id, at, payload) VALUES (?, ?, ?)")
        .run(deviceId, at, JSON.stringify(payload));
    },

    insertRun(deviceId, event) {
      db.prepare(
        "INSERT OR IGNORE INTO runs (device_id, at, valve, duration_seconds, trigger) VALUES (?, ?, ?, ?, ?)",
      ).run(deviceId, event.at, event.valve, event.durationSeconds, event.trigger);
    },

    history(deviceId, fromMs, toMs, limit) {
      const samples = db.prepare(
        "SELECT at, payload FROM samples WHERE device_id = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ?",
      ).all(deviceId, fromMs, toMs, limit)
        .map((row) => ({ at: row.at, payload: JSON.parse(row.payload) }));
      const runs = db.prepare(
        "SELECT at, valve, duration_seconds, trigger FROM runs WHERE device_id = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ?",
      ).all(deviceId, fromMs, toMs, limit)
        .map((row) => ({ at: row.at, valve: row.valve, durationSeconds: row.duration_seconds, trigger: row.trigger }));
      return { samples, runs };
    },

    prune(olderThanMs) {
      db.prepare("DELETE FROM samples WHERE at < ?").run(olderThanMs);
      db.prepare("DELETE FROM runs WHERE at < ?").run(olderThanMs);
    },
  };
}
