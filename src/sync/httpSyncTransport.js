import { SYNC_PROTOCOL_VERSION } from "./protocol";

export class HttpSyncTransport {
  constructor({ baseUrl, accessTokenProvider, fetchImplementation }) {
    if (!baseUrl) throw new Error("Sync base URL is required");
    this.baseUrl = baseUrl.replace(/\/$/, "");
    if (!accessTokenProvider) throw new Error("A secure sync access-token provider is required");
    this.accessTokenProvider = accessTokenProvider;
    this.fetch = fetchImplementation || globalThis.fetch.bind(globalThis);
  }

  async request(path, options = {}) {
    const accessToken = await this.accessTokenProvider();
    if (!accessToken) throw new Error("Sync authentication is required");
    const response = await this.fetch(`${this.baseUrl}/v1/sync${path}`, {
      ...options,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}`, ...options.headers },
    });
    if (!response.ok) throw new Error(`Sync request failed with status ${response.status}`);
    return response.json();
  }

  push(envelope) {
    return this.request("/changes", { method: "POST", body: JSON.stringify(envelope) });
  }

  pull({ workspaceId, cursor, limit }) {
    const query = new URLSearchParams({ workspaceId, cursor: String(cursor), limit: String(limit),
      protocolVersion: String(SYNC_PROTOCOL_VERSION) });
    return this.request(`/changes?${query}`);
  }

  waitForChange({ workspaceId, after }) {
    const query=new URLSearchParams({workspaceId,after:String(after)});return this.request(`/notifications?${query}`);
  }
}
