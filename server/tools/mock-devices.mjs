import { createServer } from "node:http";

import { mockLightingRequest } from "../../src/core/mock.js";
import { mockIrrigationRequest } from "../../src/devices/irrigation/mock.js";
import { verifySignature } from "../src/signing.mjs";

// Dev tool: exposes the reference mocks as real HTTP devices so the GrowHub
// Server (registry, collector, proxy, signing) can be tested end-to-end
// without ESP hardware. Set GROWHUB_SECRET to enforce write signatures the
// way real firmware does.
//
//   node server/tools/mock-devices.mjs
//   -> lighting on :9101, irrigation on :9102

const secret = process.env.GROWHUB_SECRET || "";

function serve(port, name, handler) {
  createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString("utf8");
    const url = new URL(req.url, `http://localhost:${port}`);

    const respond = (code, payload) => {
      res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
      res.end(JSON.stringify(payload));
    };

    if (secret && req.method === "POST") {
      const result = verifySignature(secret, req.method, url.pathname, body,
        req.headers["x-growhub-timestamp"], req.headers["x-growhub-signature"]);
      if (!result.ok) {
        respond(401, { error: result.error });
        return;
      }
    }
    try {
      respond(200, handler(url.pathname, { method: req.method, body: body || undefined }));
    } catch (err) {
      respond(409, { error: err.message });
    }
  }).listen(port, () => console.log(`[mock-devices] ${name} auf http://localhost:${port} (Signierung ${secret ? "aktiv" : "aus"})`));
}

serve(9101, "lighting", mockLightingRequest);
serve(9102, "irrigation", mockIrrigationRequest);
