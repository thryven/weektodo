import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleTasksController } from "./service";

function fixture(auto = true) {
  const events = new EventTarget();
  vi.stubGlobal("addEventListener", events.addEventListener.bind(events));
  vi.stubGlobal("removeEventListener", events.removeEventListener.bind(events));
  vi.stubGlobal("navigator", { onLine: true });
  const repository = { settings: async () => ({ auto, listId: "list" }), configure: vi.fn(async () => {}) };
  const controller = new GoogleTasksController({ transport: { status: async () => ({ connected: true }) }, repository });
  controller.engine.synchronize = vi.fn(async () => {});
  return { controller, events, repository };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("Google sync triggers", () => {
  it("syncs at startup, focus, reconnect, local writes and periodically", async () => {
    vi.useFakeTimers(); const { controller, events } = fixture(); await controller.start();
    expect(controller.engine.synchronize).toHaveBeenCalledTimes(1);
    for (const name of ["focus", "online", "weektodo:sync-needed"]) {
      events.dispatchEvent(new Event(name)); await vi.advanceTimersByTimeAsync(601);
    }
    expect(controller.engine.synchronize).toHaveBeenCalledTimes(4);
    await vi.advanceTimersByTimeAsync(61000); expect(controller.engine.synchronize).toHaveBeenCalledTimes(5);
    controller.stop();
  });
  it("honors auto off while allowing manual sync", async () => {
    vi.useFakeTimers(); const { controller, events } = fixture(false); await controller.start();
    events.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(1000);
    expect(controller.engine.synchronize).not.toHaveBeenCalled();
    await controller.sync(); expect(controller.engine.synchronize).toHaveBeenCalledTimes(1); controller.stop();
  });
  it("preserves offline work and retries when connectivity returns", async () => {
    vi.useFakeTimers(); const { controller, events } = fixture(); navigator.onLine = false; await controller.start();
    expect(controller.state.status).toContain("Offline"); expect(controller.engine.synchronize).not.toHaveBeenCalled();
    navigator.onLine = true; events.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(601);
    expect(controller.engine.synchronize).toHaveBeenCalledTimes(1); controller.stop();
  });
  it("backs off failures and allows an immediate manual retry", async () => {
    vi.useFakeTimers(); const { controller } = fixture(); controller.engine.synchronize.mockRejectedValueOnce(new Error("quota"));
    await controller.start(); expect(controller.state.error).toBe("quota");
    await controller.sync(false); expect(controller.engine.synchronize).toHaveBeenCalledTimes(1);
    await controller.sync(); expect(controller.state.status).toBe("Synced"); controller.stop();
  });
});
