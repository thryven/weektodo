import { GoogleRepository } from "./repository";
import { GoogleSyncEngine } from "./engine";

// The renderer service exposes task data and status, never tokens or arbitrary HTTP.
export function createGoogleTasksClient(api) {
  return Object.fromEntries(["status", "signIn", "disconnect", "lists", "tasks", "write"].map((name) => [name, async (value) => {
    const response = await api[name](value);
    if (!response.ok) { const error = new Error(response.error); error.status = response.status; throw error; }
    return response.value;
  }]));
}

export class GoogleTasksController {
  constructor({ transport, repository = new GoogleRepository(), onApplied }) {
    Object.assign(this, { transport, repository });
    this.engine = new GoogleSyncEngine({ transport, repository, onApplied });
    this.listeners = new Set(); this.state = { connected: false, listId: "", auto: true, lastSync: null, status: "Disconnected", error: "", lists: [] };
    this.attempts = 0; this.retryAt = 0;
    this.wake = () => { clearTimeout(this.debounce); this.debounce = setTimeout(() => this.sync(false), 600); };
  }
  subscribe(callback) { this.listeners.add(callback); callback(this.state); return () => this.listeners.delete(callback); }
  update(patch) { this.state = { ...this.state, ...patch }; this.listeners.forEach((callback) => callback(this.state)); }
  async start() {
    try {
      this.update({ ...await this.repository.settings(), ...await this.transport.status() });
      this.update({ status: this.state.connected ? "Ready" : "Disconnected" });
      for (const event of ["online", "focus", "weektodo:sync-needed"]) globalThis.addEventListener(event, this.wake);
      this.interval = setInterval(this.wake, 60000);
      await this.sync(false);
    } catch (error) { this.update({ error: error.message, status: "Error" }); }
  }
  stop() {
    clearTimeout(this.debounce); clearInterval(this.interval);
    for (const event of ["online", "focus", "weektodo:sync-needed"]) globalThis.removeEventListener(event, this.wake);
  }
  async connect() {
    if (this.busy) return;
    this.busy = true; this.update({ status: "Waiting for Google sign-in", error: "" });
    try { this.update(await this.transport.signIn()); await this.refreshLists(); this.update({ status: "Choose a task list" }); }
    catch (error) { this.update({ error: error.message, status: "Error" }); }
    finally { this.busy = false; }
  }
  async refreshLists() {
    try { this.update({ lists: await this.transport.lists(), error: "" }); }
    catch (error) { this.update({ error: error.message }); }
  }
  async disconnect() {
    if (this.busy) return;
    this.busy = true;
    try {
      await this.running;
      this.update(await this.transport.disconnect());
      await this.configure({ listId: "" });
      this.update({ status: "Disconnected", lists: [], error: "" });
    } catch (error) { this.update({ error: error.message }); }
    finally { this.busy = false; }
  }
  async configure(patch) {
    await this.running;
    const value = { listId: this.state.listId, auto: this.state.auto, lastSync: this.state.lastSync, ...patch };
    if (patch.listId !== undefined && patch.listId !== this.state.listId) value.lastSync = null;
    await this.repository.configure(value); this.update(value); this.retryAt = 0;
    if (!this.busy) this.wake();
  }
  sync(manual = true) {
    if (this.running) return this.running;
    if (this.busy || !this.state.connected || !this.state.listId || (!manual && (!this.state.auto || Date.now() < this.retryAt))) return Promise.resolve();
    if (globalThis.navigator?.onLine === false) { this.update({ status: "Offline — changes queued" }); return Promise.resolve(); }
    this.update({ status: "Syncing", error: "" });
    this.running = this.engine.synchronize(this.state.listId).then(async () => {
      const lastSync = new Date().toISOString();
      await this.repository.configure({ listId: this.state.listId, auto: this.state.auto, lastSync });
      this.attempts = 0; this.retryAt = 0; this.update({ lastSync, status: "Synced" });
    }).catch((error) => {
      this.retryAt = Date.now() + Math.min(600000, 1000 * 2 ** Math.min(++this.attempts, 10)) + Math.random() * 1000;
      this.update({ status: "Sync paused — changes queued", error: error.message });
    }).finally(() => { this.running = null; });
    return this.running;
  }
}

let controller;
export function getGoogleTasksController() { return controller; }
export function startGoogleTasks(store) {
  if (!globalThis.weekToDoDesktop?.googleTasks) return;
  controller = new GoogleTasksController({ transport: createGoogleTasksClient(globalThis.weekToDoDesktop.googleTasks), onApplied: ({ before, lists, changed }) => {
    if (!changed) return;
    for (const [id, tasks] of Object.entries(lists)) {
      const shown = store.getters.todoLists[id];
      // Do not replace an active unsaved UI edit with a stale network result.
      if (shown && JSON.stringify(shown) === JSON.stringify(before[id] || [])) store.commit("loadTodoLists", { todoListId: id, todoList: tasks });
    }
  } });
  controller.start();
}
