// Verifies the request-signing scheme (spec/signing.md): the browser-side
// implementation (WebCrypto and the pure-JS fallback used on plain-http
// origins) must produce byte-identical signatures to the server-side
// node:crypto implementation, and the server verifier must accept them.

import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";

import { hmacSha256Hex, sha256Hex, signRequest } from "../src/core/signing.js";
import { signHeaders, verifySignature } from "../server/src/signing.mjs";

const SECRET = "test-secret-🌿";

test("signing: sha256 matches node:crypto (WebCrypto path)", async () => {
  for (const input of ["", "hallo", '{"valve":"v1","durationSeconds":60}', "ä ö ü 🌿"]) {
    assert.equal(await sha256Hex(input), createHash("sha256").update(input).digest("hex"));
  }
});

test("signing: hmac matches node:crypto (WebCrypto path)", async () => {
  assert.equal(
    await hmacSha256Hex(SECRET, "v1\n123\nPOST\n/api/x\nabc"),
    createHmac("sha256", SECRET).update("v1\n123\nPOST\n/api/x\nabc").digest("hex"),
  );
});

test("signing: pure-JS fallback matches WebCrypto", async (t) => {
  // Force the fallback by importing a fresh module instance without subtle.
  const subtle = globalThis.crypto.subtle;
  Object.defineProperty(globalThis.crypto, "subtle", { value: undefined, configurable: true });
  try {
    const fallback = await import(`../src/core/signing.js?fallback=${Date.now()}`);
    for (const input of ["", "hallo", "ä ö ü 🌿", "x".repeat(1000)]) {
      assert.equal(await fallback.sha256Hex(input), createHash("sha256").update(input).digest("hex"));
    }
    assert.equal(
      await fallback.hmacSha256Hex(SECRET, "message"),
      createHmac("sha256", SECRET).update("message").digest("hex"),
    );
  } finally {
    Object.defineProperty(globalThis.crypto, "subtle", { value: subtle, configurable: true });
  }
});

test("signing: browser-signed request passes server verification", async () => {
  const body = '{"retentionDays":180}';
  const headers = await signRequest(SECRET, "POST", "/api/server/settings", body);
  const result = verifySignature(
    SECRET, "POST", "/api/server/settings", body,
    headers["X-GrowHub-Timestamp"], headers["X-GrowHub-Signature"],
  );
  assert.equal(result.ok, true);
});

test("signing: verifier rejects tampering, wrong secret and stale timestamps", () => {
  const good = signHeaders(SECRET, "POST", "/api/x", "body");
  assert.equal(verifySignature(SECRET, "POST", "/api/x", "TAMPERED", good["X-GrowHub-Timestamp"], good["X-GrowHub-Signature"]).ok, false);
  assert.equal(verifySignature("other-secret", "POST", "/api/x", "body", good["X-GrowHub-Timestamp"], good["X-GrowHub-Signature"]).ok, false);
  assert.equal(verifySignature(SECRET, "POST", "/api/y", "body", good["X-GrowHub-Timestamp"], good["X-GrowHub-Signature"]).ok, false);
  const staleTs = String(Date.now() - 10 * 60 * 1000);
  const stale = signHeaders(SECRET, "POST", "/api/x", "body");
  assert.equal(verifySignature(SECRET, "POST", "/api/x", "body", staleTs, stale["X-GrowHub-Signature"]).ok, false);
  assert.equal(verifySignature(SECRET, "POST", "/api/x", "body", undefined, undefined).ok, false);
});
