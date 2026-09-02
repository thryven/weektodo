import { afterEach, describe, expect, it, vi } from "vitest";
import { SyncCoordinator } from "./syncCoordinator";

afterEach(() => vi.useRealTimers());

describe("background sync coordinator", () => {
  it("invokes receiver-sensitive platform timers with their original receiver", async () => {
    const platform={interval:null,setInterval(callback){
      if(this!==platform)throw new TypeError("Illegal invocation");this.interval=callback;return 7;
    },clearInterval(){},setTimeout(){},clearTimeout(){}};
    const engine={initialize:vi.fn().mockResolvedValue(),synchronize:vi.fn().mockResolvedValue({conflicts:[]})};
    const coordinator=new SyncCoordinator({engine,eventTarget:new EventTarget(),isOnline:()=>true,
      setIntervalFn:platform.setInterval.bind(platform),clearIntervalFn:platform.clearInterval.bind(platform),
      setTimeoutFn:platform.setTimeout.bind(platform),clearTimeoutFn:platform.clearTimeout.bind(platform)});
    await expect(coordinator.start()).resolves.toBeTruthy();
    expect(platform.interval).toBeTypeOf("function");coordinator.stop();
  });

  it("stays offline without touching the transport and resumes on an online event", async () => {
    vi.useFakeTimers(); let online = false;
    const engine = { initialize:vi.fn().mockResolvedValue(),synchronize:vi.fn().mockResolvedValue({conflicts:[]}) };
    const events = new EventTarget(); const coordinator = new SyncCoordinator({ engine,eventTarget:events,isOnline:()=>online,
      intervalMs:60000,debounceMs:10 });
    const states=[]; coordinator.subscribe((state)=>states.push(state.status)); await coordinator.start();
    expect(engine.synchronize).not.toHaveBeenCalled(); expect(states).toContain("offline");
    online=true; events.dispatchEvent(new Event("online")); await vi.advanceTimersByTimeAsync(10);
    expect(engine.synchronize).toHaveBeenCalledOnce(); coordinator.stop();
  });

  it("coalesces rapid writes and prevents overlapping synchronization", async () => {
    vi.useFakeTimers(); let resolveSync;
    const engine={initialize:vi.fn().mockResolvedValue(),synchronize:vi.fn(()=>new Promise((resolve)=>{resolveSync=resolve;}))};
    const events=new EventTarget(); const coordinator=new SyncCoordinator({engine,eventTarget:events,isOnline:()=>true,
      intervalMs:60000,debounceMs:20});
    const starting=coordinator.start(); await Promise.resolve(); events.dispatchEvent(new Event("weektodo:sync-needed"));
    events.dispatchEvent(new Event("weektodo:sync-needed")); await vi.advanceTimersByTimeAsync(20);
    expect(engine.synchronize).toHaveBeenCalledOnce(); resolveSync({conflicts:[]}); await starting; coordinator.stop();
  });
});
