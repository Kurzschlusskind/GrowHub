import { signRequest } from "./signing.js";

// Device-neutral HTTP client. Without a base URL the client runs against the
// mock handler the device adapter supplies, so every device module owns its
// own endpoints and mock behaviour. Write requests are signed with the
// installation secret when one is configured (spec/signing.md).
export function createApiClient(baseUrl, mockHandler) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const mock = base.length === 0;

  async function request(path, init = {}) {
    if (mock) return mockHandler(path, init);
    const headers = { "Content-Type": "application/json", ...(init.headers || {}) };
    const secret = typeof localStorage !== "undefined" ? localStorage.getItem("growhub.apiSecret") : null;
    if (secret && init.method === "POST") {
      const pathname = new URL(`${base}${path}`, globalThis.location?.origin).pathname;
      Object.assign(headers, await signRequest(secret, init.method, pathname, init.body || ""));
    }
    const response = await fetch(`${base}${path}`, {
      ...init,
      headers,
    });
    const text = await response.text();
    const body = text ? JSON.parse(text) : {};
    if (!response.ok) throw new Error(body.error || response.statusText);
    return body;
  }

  return {
    get: (path) => request(path),
    post: (path, body) => request(path, { method: "POST", body: JSON.stringify(body) }),
  };
}
