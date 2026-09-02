import { describe, expect, it } from "vitest";
import { createSyncRuntime } from "./syncRuntime";

describe("sync runtime feature flag", () => {
  it("is inert unless explicitly enabled", () => {
    expect(createSyncRuntime({})).toBeNull();
    expect(createSyncRuntime({ VITE_SYNC_ENABLED: "false" })).toBeNull();
  });
});
