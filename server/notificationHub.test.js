import { describe, expect, it } from "vitest";
import { NotificationHub } from "./notificationHub.mjs";

describe("sync notification hub", () => {
  it("wakes waiting devices and advances a workspace-local version", async () => {
    const hub=new NotificationHub();const waiting=hub.wait("workspace",0,1000);
    expect(hub.publish("workspace")).toBe(1);expect(await waiting).toBe(1);
    expect(await hub.wait("workspace",0,1000)).toBe(1);
  });
});
