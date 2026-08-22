import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Server-side implementation of the request signing scheme (spec/signing.md):
// HMAC-SHA256 over `v1\n<timestamp>\n<METHOD>\n<pathname>\n<sha256(body)>`.

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

export function signHeaders(secret, method, pathname, body) {
  const timestamp = String(Date.now());
  return {
    "X-GrowHub-Timestamp": timestamp,
    "X-GrowHub-Signature": `v1:${computeSignature(secret, timestamp, method, pathname, body)}`,
  };
}

export function verifySignature(secret, method, pathname, body, timestampHeader, signatureHeader) {
  if (!timestampHeader || !signatureHeader?.startsWith("v1:")) {
    return { ok: false, error: "Signatur fehlt" };
  }
  const age = Math.abs(Date.now() - Number(timestampHeader));
  if (!Number.isFinite(age) || age > REPLAY_WINDOW_MS) {
    return { ok: false, error: "Signatur abgelaufen" };
  }
  const expected = computeSignature(secret, timestampHeader, method, pathname, body);
  const given = signatureHeader.slice(3);
  const expectedBuffer = Buffer.from(expected, "hex");
  const givenBuffer = Buffer.from(given.length === expected.length ? given : "00", "hex");
  if (expectedBuffer.length !== givenBuffer.length || !timingSafeEqual(expectedBuffer, givenBuffer)) {
    return { ok: false, error: "Signatur ungültig" };
  }
  return { ok: true };
}

function computeSignature(secret, timestamp, method, pathname, body) {
  const bodyHash = createHash("sha256").update(body || "").digest("hex");
  const canonical = `v1\n${timestamp}\n${method}\n${pathname}\n${bodyHash}`;
  return createHmac("sha256", secret).update(canonical).digest("hex");
}
