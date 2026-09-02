import { describe,expect,it,vi } from "vitest";
import { SyncNotificationLoop } from "./syncNotificationLoop";

describe("sync notification retry loop",()=>{
  it("adds bounded jitter after a failed notification request",async()=>{
    let releaseDelay;const transport={waitForChange:vi.fn()
      .mockRejectedValueOnce(new Error("offline")).mockImplementation(()=>new Promise(()=>{}))};
    const setTimeoutFn=vi.fn((_callback,delay)=>new Promise((resolve)=>{releaseDelay=resolve;setTimeout(resolve,0);return delay;}));
    const loop=new SyncNotificationLoop({transport,workspaceId:"workspace",onChange:vi.fn(),random:()=>0.5,setTimeoutFn});
    loop.start();await new Promise((resolve)=>setTimeout(resolve,10));loop.stop();releaseDelay?.();
    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function),5000);
  });
});
