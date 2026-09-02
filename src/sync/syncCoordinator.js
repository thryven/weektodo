export class SyncCoordinator {
  constructor({ engine, eventTarget = globalThis, isOnline = () => navigator.onLine, intervalMs = 30000,
    debounceMs = 500, setIntervalFn = globalThis.setInterval.bind(globalThis),
    clearIntervalFn = globalThis.clearInterval.bind(globalThis),
    setTimeoutFn = globalThis.setTimeout.bind(globalThis),
    clearTimeoutFn = globalThis.clearTimeout.bind(globalThis), notificationLoop = null }) {
    this.engine = engine; this.eventTarget = eventTarget; this.isOnline = isOnline; this.intervalMs = intervalMs;
    this.debounceMs = debounceMs; this.setIntervalFn = setIntervalFn; this.clearIntervalFn = clearIntervalFn;
    this.notificationLoop=notificationLoop;
    this.setTimeoutFn = setTimeoutFn; this.clearTimeoutFn = clearTimeoutFn; this.listeners = new Set();
    this.state = { status: "idle", lastSuccessAt: null, error: null, conflicts: [] };
    this.onWake = () => this.requestSync(); this.interval = null; this.debounce = null; this.running = null;
  }
  subscribe(listener) { this.listeners.add(listener); listener(this.state); return () => this.listeners.delete(listener); }
  update(patch) { this.state = { ...this.state, ...patch }; for (const listener of this.listeners) listener(this.state); }
  async start() {
    await this.engine.initialize();
    this.eventTarget.addEventListener?.("online", this.onWake);
    this.eventTarget.addEventListener?.("weektodo:sync-needed", this.onWake);
    this.eventTarget.addEventListener?.("weektodo:sync-notification", this.onWake);
    this.interval = this.setIntervalFn(this.onWake, this.intervalMs);
    this.notificationLoop?.start();
    return this.syncNow();
  }
  stop() {
    this.eventTarget.removeEventListener?.("online", this.onWake);
    this.eventTarget.removeEventListener?.("weektodo:sync-needed", this.onWake);
    this.eventTarget.removeEventListener?.("weektodo:sync-notification", this.onWake);
    if (this.interval) this.clearIntervalFn(this.interval);
    if (this.debounce) this.clearTimeoutFn(this.debounce);
    this.notificationLoop?.stop();
  }
  requestSync() {
    if (this.debounce) this.clearTimeoutFn(this.debounce);
    this.debounce = this.setTimeoutFn(() => { this.debounce = null; this.syncNow(); }, this.debounceMs);
  }
  syncNow() {
    if (this.running) return this.running;
    if (!this.isOnline()) { this.update({ status: "offline" }); return Promise.resolve(null); }
    this.update({ status: "syncing", error: null });
    this.running = this.engine.synchronize().then((result) => {
      this.update({ status: result.conflicts.length ? "conflict" : "synced", conflicts: result.conflicts,
        lastSuccessAt: result.lastSuccessAt||new Date().toISOString(), error: null }); return result;
    }).catch((error) => { this.update({ status: "error", error: error.message }); throw error; })
      .finally(() => { this.running = null; });
    return this.running;
  }
}
