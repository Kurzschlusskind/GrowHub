// Device-neutral HTTP client. Without a base URL the client runs against the
// mock handler the device adapter supplies, so every device module owns its
// own endpoints and mock behaviour.
export function createApiClient(baseUrl, mockHandler) {
  const base = (baseUrl || "").replace(/\/$/, "");
  const mock = base.length === 0;

  async function request(path, init = {}) {
    if (mock) return mockHandler(path, init);
    const response = await fetch(`${base}${path}`, {
      headers: { "Content-Type": "application/json", ...(init.headers || {}) },
      ...init,
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
