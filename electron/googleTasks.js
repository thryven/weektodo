import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const SCOPE = "https://www.googleapis.com/auth/tasks";
const ROOT = "https://tasks.googleapis.com/tasks/v1";

// Only this main-process service ever sees OAuth credentials or bearer tokens.
export class GoogleTasksService {
  constructor({ app, safeStorage, shell, config, fetchFn = fetch }) {
    Object.assign(this, { app, safeStorage, shell, config, fetchFn });
    this.tokens = null;
    this.generation = 0;
  }
  secure() {
    return this.safeStorage.isEncryptionAvailable() && this.safeStorage.getSelectedStorageBackend?.() !== "basic_text";
  }
  async configuration() {
    let installed = {};
    try {
      installed = JSON.parse(await readFile(path.join(this.app.getPath("userData"), "google-oauth.json"), "utf8")).installed || {};
    } catch (error) { if (error.code !== "ENOENT") throw new Error("Invalid google-oauth.json configuration", { cause: error }); }
    const clientId = process.env.GOOGLE_TASKS_CLIENT_ID || installed.client_id;
    const clientSecret = process.env.GOOGLE_TASKS_CLIENT_SECRET || installed.client_secret;
    if (!clientId) throw new Error("Configure a Google Desktop app OAuth client (see GOOGLE_TASKS.md)");
    return { client_id: clientId, ...(clientSecret ? { client_secret: clientSecret } : {}) };
  }
  load() {
    if (!this.tokens && this.secure()) {
      const encrypted = this.config.get("googleTasksTokens");
      if (encrypted) {
        try { this.tokens = JSON.parse(this.safeStorage.decryptString(Buffer.from(encrypted, "base64"))); }
        catch { throw new Error("Google credentials cannot be decrypted. Disconnect and sign in again."); }
      }
    }
    return this.tokens;
  }
  save(tokens) {
    if (!this.secure()) throw new Error("Secure OS credential storage is unavailable. Unlock your keychain and retry.");
    this.config.set("googleTasksTokens", this.safeStorage.encryptString(JSON.stringify(tokens)).toString("base64"));
    this.tokens = tokens;
  }
  status() { return { connected: Boolean(this.load()?.refresh_token), secureStorage: this.secure() }; }
  async tokenRequest(values) {
    const response = await this.fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST", body: new URLSearchParams({ ...await this.configuration(), ...values }),
      signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(response.status === 400 ? "Google authorization expired or was denied. Disconnect and sign in again." : "Google sign-in service is unavailable. Retry later.");
    const data = await response.json();
    return { ...data, expires_at: Date.now() + data.expires_in * 1000 };
  }
  async signIn() {
    if (this.authorizing) throw new Error("Google sign-in is already open in your browser");
    if (!this.secure()) throw new Error("Secure OS credential storage is unavailable");
    const configuration = await this.configuration();
    const generation = this.generation;
    const verifier = randomBytes(32).toString("base64url");
    const state = randomBytes(32).toString("base64url");
    this.authorizing = true;
    let server, timeout;
    try {
      const code = await new Promise((resolve, reject) => {
        server = createServer((req, res) => {
          const url = new URL(req.url, "http://127.0.0.1");
          if (req.method !== "GET" || url.pathname !== "/oauth/callback" || url.searchParams.get("state") !== state) {
            res.writeHead(400).end("Invalid authorization response"); return;
          }
          res.setHeader("Content-Type", "text/plain; charset=utf-8");
          res.end("You can close this tab and return to WeekToDo.");
          if (url.searchParams.has("error") || !url.searchParams.get("code")) reject(new Error("Google sign-in was cancelled"));
          else resolve(url.searchParams.get("code"));
        });
        server.on("error", () => reject(new Error("Cannot open the local Google authorization callback")));
        server.listen(0, "127.0.0.1", () => {
          this.redirect = `http://127.0.0.1:${server.address().port}/oauth/callback`;
          const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
          url.search = new URLSearchParams({ client_id: configuration.client_id, redirect_uri: this.redirect,
            response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state,
            code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256" }).toString();
          this.shell.openExternal(url.href).catch(() => reject(new Error("Cannot open the system browser")));
        });
        timeout = setTimeout(() => reject(new Error("Google sign-in timed out. Try again.")), 180000);
      });
      const tokens = await this.tokenRequest({ code, code_verifier: verifier, redirect_uri: this.redirect, grant_type: "authorization_code" });
      if (generation !== this.generation) throw new Error("Google sign-in cancelled");
      if (!tokens.refresh_token) throw new Error("Google did not grant offline access. Reconnect and grant access.");
      if (tokens.scope && !tokens.scope.split(" ").includes(SCOPE)) throw new Error("Google Tasks permission was not granted");
      this.save(tokens);
      return this.status();
    } finally { clearTimeout(timeout); server?.close(); this.authorizing = false; }
  }
  async disconnect() {
    ++this.generation;
    const token = this.load()?.refresh_token;
    this.tokens = null;
    this.config.delete("googleTasksTokens");
    // Local disconnect succeeds offline; revocation is best effort.
    if (token) try { await this.fetchFn("https://oauth2.googleapis.com/revoke", {
      method: "POST", body: new URLSearchParams({ token }), signal: AbortSignal.timeout(10000),
    }); } catch { /* User may also revoke access in their Google account. */ }
    return { connected: false, secureStorage: this.secure() };
  }
  async accessToken() {
    const tokens = this.load();
    if (!tokens?.refresh_token) throw new Error("Sign in with Google to sync tasks");
    if (tokens.expires_at > Date.now() + 60000) return tokens.access_token;
    if (!this.refreshing) {
      const generation = this.generation;
      this.refreshing = this.tokenRequest({ refresh_token: tokens.refresh_token, grant_type: "refresh_token" })
        .then((next) => { if (generation !== this.generation) throw new Error("Google disconnected");
          this.save({ ...tokens, ...next }); return this.tokens.access_token; })
        .finally(() => { this.refreshing = null; });
    }
    return this.refreshing;
  }
  async request(route, { method = "GET", body, etag } = {}, retry = true) {
    const response = await this.fetchFn(ROOT + route, { method,
      headers: { Authorization: `Bearer ${await this.accessToken()}`, "Content-Type": "application/json", ...(etag ? { "If-Match": etag } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) });
    if (response.status === 401 && retry) {
      this.tokens.expires_at = 0;
      return this.request(route, { method, body, etag }, false);
    }
    if (!response.ok) {
      const error = new Error(`Google Tasks ${response.status}: ${response.status === 412 ? "task changed during sync; retrying safely" : "request failed; local changes are saved"}`);
      error.status = response.status; throw error;
    }
    return response.status === 204 ? null : response.json();
  }
  async pages(route) {
    const items = []; let pageToken;
    do {
      const data = await this.request(`${route}${route.includes("?") ? "&" : "?"}maxResults=100${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
      items.push(...(data.items || [])); pageToken = data.nextPageToken;
    } while (pageToken);
    return items;
  }
  lists() { return this.pages("/users/@me/lists"); }
  tasks(listId) { return this.pages(`/lists/${encodeURIComponent(listId)}/tasks?showCompleted=true&showHidden=true&showDeleted=true`); }
  write({ listId, taskId, action, task, etag }) {
    if (typeof listId !== "string" || !listId || listId.length > 1024 || !["create", "update", "delete"].includes(action)) throw new Error("Invalid Google task request");
    if (action !== "create" && (typeof taskId !== "string" || !taskId || taskId.length > 1024)) throw new Error("Invalid task ID");
    let body;
    if (action !== "delete") {
      if (!task || typeof task.title !== "string" || task.title.length > 1024 || typeof task.notes !== "string" || task.notes.length > 8192 || !["completed", "needsAction"].includes(task.status)) throw new Error("Task title or notes exceed Google's limits");
      if (task.due !== null && !/^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/.test(task.due)) throw new Error("Invalid due date");
      body = { title: task.title, notes: task.notes, status: task.status, due: task.due };
    }
    return this.request(`/lists/${encodeURIComponent(listId)}/tasks${action === "create" ? "" : `/${encodeURIComponent(taskId)}`}`,
      { method: { create: "POST", update: "PATCH", delete: "DELETE" }[action], body, etag });
  }
}

export function registerGoogleTasksIpc({ ipcMain, getWindow, service }) {
  const operations = { status: () => service.status(), signIn: () => service.signIn(), disconnect: () => service.disconnect(),
    lists: () => service.lists(), tasks: (id) => { if (typeof id !== "string" || !id || id.length > 1024) throw new Error("Invalid list"); return service.tasks(id); },
    write: (request) => service.write(request) };
  for (const [name, operation] of Object.entries(operations)) ipcMain.handle(`google-tasks:${name}`, async (event, value) => {
    const window = getWindow();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error("Untrusted Google Tasks IPC sender");
    try { return { ok: true, value: await operation(value) }; }
    catch (error) { return { ok: false, error: error.message, status: error.status }; }
  });
}
