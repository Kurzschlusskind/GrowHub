import { DatabaseSync } from "node:sqlite";

// SQLite persistence for collected device history (spec/growhub-server.md).
// node:sqlite is built into Node >= 24 — no external dependencies.
// Lighting samples carry extracted numeric columns (ch1/ch2/temperature) so
// long ranges can be aggregated in SQL instead of loading raw rows.

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS samples (
      device_id TEXT NOT NULL,
      at INTEGER NOT NULL,
      payload TEXT NOT NULL,
      ch1 REAL,
      ch2 REAL,
      temperature REAL
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
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
  // Migrate pre-0.2 databases that lack the metric columns.
  for (const column of ["ch1", "ch2", "temperature"]) {
    try {
      db.exec(`ALTER TABLE samples ADD COLUMN ${column} REAL`);
    } catch {
      /* column exists */
    }
  }

  return {
    insertSample(deviceId, at, payload, metrics = {}) {
      db.prepare(
        "INSERT INTO samples (device_id, at, payload, ch1, ch2, temperature) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(deviceId, at, JSON.stringify(payload), metrics.ch1 ?? null, metrics.ch2 ?? null, metrics.temperature ?? null);
    },

    insertRun(deviceId, event) {
      db.prepare(
        "INSERT OR IGNORE INTO runs (device_id, at, valve, duration_seconds, trigger) VALUES (?, ?, ?, ?, ?)",
      ).run(deviceId, event.at, event.valve, event.durationSeconds, event.trigger);
    },

    history(deviceId, fromMs, toMs, limit, bucketMinutes) {
      let samples;
      if (bucketMinutes > 0) {
        const bucketMs = bucketMinutes * 60000;
        samples = db.prepare(
          `SELECT (at / ?) * ? AS bucket, AVG(ch1) AS ch1, AVG(ch2) AS ch2,
                  AVG(temperature) AS temperature, COUNT(*) AS count
           FROM samples WHERE device_id = ? AND at >= ? AND at <= ?
           GROUP BY bucket ORDER BY bucket DESC LIMIT ?`,
        ).all(bucketMs, bucketMs, deviceId, fromMs, toMs, limit)
          .map((row) => ({ at: row.bucket, ch1: row.ch1, ch2: row.ch2, temperature: row.temperature, count: row.count }));
      } else {
        samples = db.prepare(
          "SELECT at, payload FROM samples WHERE device_id = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ?",
        ).all(deviceId, fromMs, toMs, limit)
          .map((row) => ({ at: row.at, payload: JSON.parse(row.payload) }));
      }
      const runs = db.prepare(
        "SELECT at, valve, duration_seconds, trigger FROM runs WHERE device_id = ? AND at >= ? AND at <= ? ORDER BY at DESC LIMIT ?",
      ).all(deviceId, fromMs, toMs, limit)
        .map((row) => ({ at: row.at, valve: row.valve, durationSeconds: row.duration_seconds, trigger: row.trigger }));
      return { samples, runs };
    },

    // User-controlled range deletion (spec §history): removes samples and
    // runs of one device inside [fromMs, toMs].
    deleteRange(deviceId, fromMs, toMs) {
      const samples = db.prepare("DELETE FROM samples WHERE device_id = ? AND at >= ? AND at <= ?").run(deviceId, fromMs, toMs);
      const runs = db.prepare("DELETE FROM runs WHERE device_id = ? AND at >= ? AND at <= ?").run(deviceId, fromMs, toMs);
      return { deletedSamples: Number(samples.changes), deletedRuns: Number(runs.changes) };
    },

    prune(olderThanMs) {
      db.prepare("DELETE FROM samples WHERE at < ?").run(olderThanMs);
      db.prepare("DELETE FROM runs WHERE at < ?").run(olderThanMs);
    },

    getSetting(key, fallback) {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
      return row ? JSON.parse(row.value) : fallback;
    },

    setSetting(key, value) {
      db.prepare(
        "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      ).run(key, JSON.stringify(value));
    },
  };
}
