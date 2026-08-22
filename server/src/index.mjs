import { createServer } from "node:http";
import { readFile, readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "./db.mjs";
import { startCollector } from "./collector.mjs";
import { createAlarmEngine } from "./alarms.mjs";
import { createSignals } from "./signals.mjs";
import { signHeaders, verifySignature } from "./signing.mjs";

// GrowHub Server — spec/growhub-server.md: device registry, transparent
// device proxy, history collector with user-controlled retention and range
// deletion, static hosting, request signing for all write endpoints.
// Zero dependencies: node:http + node:sqlite (Node >= 24).

const VERSION = "0.2.0";
const serverDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const configPath = process.env.GROWHUB_CONFIG || join(serverDir, "config.json");

if (!existsSync(configPath)) {
  console.error("server/config.json fehlt — siehe server/config.example.json");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const port = Number(process.env.GROWHUB_PORT || config.port || 8420);
const devices = config.devices ?? [];
const distDir = resolve(serverDir, config.distDir ?? "../dist");
const apiSecret = config.apiSecret || "";
const startedAt = Date.now();

const db = openDb(process.env.GROWHUB_DB || join(serverDir, "growhub.db"));
const retentionDays = () => db.getSetting("retentionDays", config.retentionDays ?? 365);

const signals = createSignals(config.signalOutputs, console.log);
const alarmEngine = createAlarmEngine({ devices, db, apiSecret: config.apiSecret || "", signals, log: console.log });

const collector = startCollector({
  devices,
  db,
  pollIntervalSeconds: config.pollIntervalSeconds ?? 300,
  getRetentionDays: retentionDays,
  log: console.log,
  async onCycle(latestReadings) {
    alarmEngine.evaluate(latestReadings);
    await alarmEngine.runEscalations();
    for (const device of devices) {
      if (device.type === "sensors") await alarmEngine.syncMirror(device);
    }
  },
});

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json",
  ".woff2": "font/woff2",
};

function sendJson(res, code, body) {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-GrowHub-Timestamp, X-GrowHub-Signature",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolvePromise, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolvePromise(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// Write requests must carry a valid signature when an apiSecret is
// configured (spec/signing.md). Reads stay open.
function checkWriteSignature(req, res, pathname, bodyText) {
  if (!apiSecret) return true;
  const result = verifySignature(
    apiSecret, req.method, pathname, bodyText,
    req.headers["x-growhub-timestamp"], req.headers["x-growhub-signature"],
  );
  if (!result.ok) {
    sendJson(res, 401, { error: result.error });
    return false;
  }
  return true;
}

async function proxyDevice(req, res, deviceId, path, pathname) {
  const device = devices.find((entry) => entry.id === deviceId);
  if (!device || !device.endpoint) {
    sendJson(res, 404, { error: `Unbekanntes Gerät: ${deviceId}` });
    return;
  }
  try {
    const isWrite = req.method !== "GET" && req.method !== "HEAD";
    const body = isWrite ? await readBody(req) : undefined;
    const bodyText = body ? body.toString("utf8") : "";
    if (isWrite && !checkWriteSignature(req, res, pathname, bodyText)) return;

    const devicePathname = new URL(`${device.endpoint}${path}`).pathname;
    const headers = { "Content-Type": "application/json" };
    // Re-sign the forwarded write with the same installation secret; the
    // device verifies against its own copy of it.
    if (isWrite && apiSecret) Object.assign(headers, signHeaders(apiSecret, req.method, devicePathname, bodyText));

    const response = await fetch(`${device.endpoint}${path}`, {
      method: req.method,
      headers,
      body: isWrite && body?.length ? body : undefined,
      signal: AbortSignal.timeout(8000),
    });
    const text = await response.text();
    collector.markOnline(deviceId, true);
    res.writeHead(response.status, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    });
    res.end(text);
  } catch (err) {
    collector.markOnline(deviceId, false);
    sendJson(res, 502, { error: `Gerät nicht erreichbar: ${err.message}` });
  }
}

function serveStatic(res, urlPath) {
  const safePath = normalize(urlPath).replace(/^([.][.][/\\])+/, "");
  let filePath = join(distDir, safePath === "/" || safePath === "\\" ? "index.html" : safePath);
  if (!filePath.startsWith(distDir)) filePath = join(distDir, "index.html");
  if (!existsSync(filePath)) filePath = join(distDir, "index.html");
  readFile(filePath, (err, content) => {
    if (err) {
      sendJson(res, 500, { error: "App-Build nicht gefunden — erst npm run build ausführen" });
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[extname(filePath)] || "application/octet-stream" });
    res.end(content);
  });
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (pathname === "/api/server/info") {
    sendJson(res, 200, {
      name: "growhub-server",
      version: VERSION,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
      signing: Boolean(apiSecret),
    });
    return;
  }
  if (pathname === "/api/server/devices") {
    sendJson(res, 200, {
      devices: devices.map((device) => ({
        id: device.id,
        type: device.type,
        endpoint: device.endpoint,
        ...collector.deviceState(device.id),
      })),
    });
    return;
  }
  if (pathname === "/api/server/settings") {
    if (req.method === "POST") {
      const bodyText = (await readBody(req)).toString("utf8");
      if (!checkWriteSignature(req, res, pathname, bodyText)) return;
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        sendJson(res, 400, { error: "Ungültiges JSON" });
        return;
      }
      if (parsed.retentionDays !== undefined) {
        const days = Number(parsed.retentionDays);
        if (!Number.isFinite(days) || days < 1 || days > 1200) {
          sendJson(res, 400, { error: "retentionDays muss zwischen 1 und 1200 liegen" });
          return;
        }
        db.setSetting("retentionDays", Math.round(days));
      }
      if (parsed.escalationSeconds !== undefined) {
        const seconds = Number(parsed.escalationSeconds);
        if (!Number.isFinite(seconds) || seconds < 10 || seconds > 3600) {
          sendJson(res, 400, { error: "escalationSeconds muss zwischen 10 und 3600 liegen" });
          return;
        }
        db.setSetting("escalationSeconds", Math.round(seconds));
      }
    }
    sendJson(res, 200, {
      retentionDays: retentionDays(),
      escalationSeconds: db.getSetting("escalationSeconds", 120),
    });
    return;
  }
  if (pathname === "/api/server/alarms") {
    sendJson(res, 200, { alarms: alarmEngine.activeAlarms(), signals: signals.status() });
    return;
  }
  if (pathname === "/api/server/events") {
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 500);
    sendJson(res, 200, { events: db.recentEvents(limit) });
    return;
  }
  if (pathname === "/api/server/alarm-rules") {
    if (req.method === "POST") {
      const bodyText = (await readBody(req)).toString("utf8");
      if (!checkWriteSignature(req, res, pathname, bodyText)) return;
      let parsed;
      try {
        parsed = JSON.parse(bodyText);
      } catch {
        sendJson(res, 400, { error: "Ungültiges JSON" });
        return;
      }
      const rules = (parsed.rules || []).map((rule, index) => ({
        id: String(rule.id || `rule-${index + 1}`),
        deviceId: String(rule.deviceId || ""),
        sensorId: String(rule.sensorId || ""),
        label: rule.label ? String(rule.label) : "",
        min: rule.min === null || rule.min === undefined || rule.min === "" ? null : Number(rule.min),
        max: rule.max === null || rule.max === undefined || rule.max === "" ? null : Number(rule.max),
        escalate: Boolean(rule.escalate),
      })).filter((rule) => rule.deviceId && rule.sensorId && (rule.min !== null || rule.max !== null));
      db.setSetting("alarmRules", rules);
      db.logEvent("rules", null, `Alarm-Regeln aktualisiert (${rules.length})`);
    }
    sendJson(res, 200, { rules: db.getSetting("alarmRules", []) });
    return;
  }
  const historyMatch = pathname.match(/^\/api\/server\/history\/([^/]+)$/);
  if (historyMatch) {
    const deviceId = decodeURIComponent(historyMatch[1]);
    if (req.method === "DELETE") {
      const bodyText = (await readBody(req)).toString("utf8");
      if (!checkWriteSignature(req, res, pathname, bodyText)) return;
      const from = Number(url.searchParams.get("from"));
      const to = Number(url.searchParams.get("to"));
      if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) {
        sendJson(res, 400, { error: "from/to (Epoch-Millisekunden) erforderlich" });
        return;
      }
      sendJson(res, 200, db.deleteRange(deviceId, from, to));
      return;
    }
    const from = Number(url.searchParams.get("from") ?? 0);
    const to = Number(url.searchParams.get("to") ?? Date.now());
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 2000), 20000);
    const bucketMinutes = Number(url.searchParams.get("bucketMinutes") ?? 0);
    const result = db.history(deviceId, from, to, limit, bucketMinutes);
    result.sensorSeries = db.sensorSeries(deviceId, from, to, bucketMinutes || 10);
    sendJson(res, 200, result);
    return;
  }
  const proxyMatch = pathname.match(/^\/api\/devices\/([^/]+)(\/.*)$/);
  if (proxyMatch) {
    await proxyDevice(req, res, decodeURIComponent(proxyMatch[1]), proxyMatch[2] + url.search, pathname);
    return;
  }
  if (pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Unbekannter Endpunkt" });
    return;
  }
  serveStatic(res, pathname);
});

server.listen(port, () => {
  console.log(`growhub-server ${VERSION} auf http://localhost:${port} — ${devices.length} Gerät(e), Signierung ${apiSecret ? "aktiv" : "aus"}, App aus ${distDir}`);
});
