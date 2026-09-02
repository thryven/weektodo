import { describe, expect, it } from "vitest";
import { buildInitialSnapshotOperations } from "./initialSnapshot";

describe("initial sync snapshot", () => {
  it("emits every canonical entity and excludes derived recurrence caches", () => {
    const operations = buildInitialSnapshotOperations({
      tasks: [{ text: "Task", listId: "today" }],
      repeatingEvents: [{ id: "repeat", repeating_rule: "RRULE:FREQ=DAILY" }],
      lists: [{ listId: "work", listName: "Work" }],
      settings: { language: "en", _sync: { id: "settings", serverRevision: 0, localRevision: 1 } },
      deviceId: "device-a",
    });

    expect(operations.map((item) => item.entityType)).toEqual(["task", "repeating_event", "custom_list", "settings"]);
    expect(operations.every((item) => item.deviceId === "device-a" && item.action === "upsert")).toBe(true);
    expect(operations.every((item) => item.payload._sync?.id)).toBe(true);
  });
});
