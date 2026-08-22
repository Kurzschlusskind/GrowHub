import { createServer } from "node:http";
import { readFile, readFileSync, existsSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { openDb } from "./db.mjs";
import { startCollector } from "./collector.mjs";

// GrowHub Server — Phase 1 of spec/growhub-server.md: device registry,
// transparent device proxy, history collector, static hosting of the app.
// Zero dependencies: node:http + node:sqlite (Node >= 24).

const VERSION = "0.1.0";
const serverDir = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const configPath = join(serverDir, "config.json");

if (!existsSync(configPath)) {
  console.error("server/config.json fehlt — siehe server/config.example.json");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
const port = config.port ?? 8420;
const devices = config.devices ?? [];
const distDir = resolve(serverDir, config.distDir ?? "../dist");
const startedAt = Date.now();

const db = openDb(join(serverDir, "growhub.db"));
const collector = startCollector({
  devices,
  db,
  pollIntervalSeconds: config.pollIntervalSeconds ?? 300,
  retentionDays: config.retentionDays ?? 90,
  log: console.log,
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
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

async function proxyDevice(req, res, deviceId, path) {
  const device = devices.find((entry) => entry.id === deviceId);
  if (!device || !device.endpoint) {
    sendJson(res, 404, { error: `Unbekanntes Gerät: ${deviceId}` });
    return;
  }
  try {
    const body = req.method === "GET" || req.method === "HEAD" ? undefined : await readBody(req);
    const response = await fetch(`${device.endpoint}${path}`, {
      method: req.method,
      headers: { "Content-Type": "application/json" },
      body: body && body.length ? body : undefined,
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

  if (req.method === "OPTIONS") {
    sendJson(res, 204, {});
    return;
  }
  if (url.pathname === "/api/server/info") {
    sendJson(res, 200, { name: "growhub-server", version: VERSION, uptimeSeconds: Math.round((Date.now() - startedAt) / 1000) });
    return;
  }
  if (url.pathname === "/api/server/devices") {
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
  const historyMatch = url.pathname.match(/^\/api\/server\/history\/([^/]+)$/);
  if (historyMatch) {
    const from = Number(url.searchParams.get("from") ?? 0);
    const to = Number(url.searchParams.get("to") ?? Date.now());
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 1000), 10000);
    sendJson(res, 200, db.history(decodeURIComponent(historyMatch[1]), from, to, limit));
    return;
  }
  const proxyMatch = url.pathname.match(/^\/api\/devices\/([^/]+)(\/.*)$/);
  if (proxyMatch) {
    await proxyDevice(req, res, decodeURIComponent(proxyMatch[1]), proxyMatch[2] + url.search);
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    sendJson(res, 404, { error: "Unbekannter Endpunkt" });
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(port, () => {
  console.log(`growhub-server ${VERSION} auf http://localhost:${port} — ${devices.length} Gerät(e), App aus ${distDir}`);
});
