import { describe, expect, it } from "vitest";
import { createSyncOperation, prepareEntity, prepareTaskList } from "./syncModel";

const options = { now: () => "2026-08-31T00:00:00.000Z", id: () => "generated-id" };

describe("sync model", () => {
  it("assigns stable metadata and only advances changed entities", () => {
    const task = prepareEntity({ text: "One" }, null, options);
    expect(task._sync).toMatchObject({ id: "generated-id", localRevision: 1, serverRevision: 0 });

    const unchanged = prepareEntity(structuredClone(task), structuredClone(task), options);
    expect(unchanged._sync.localRevision).toBe(1);

    const changed = structuredClone(task);
    changed.text = "Two";
    prepareEntity(changed, task, options);
    expect(changed._sync.localRevision).toBe(2);
  });

  it("creates tombstones for tasks removed while offline", () => {
    const oldTask = prepareEntity({ text: "Old" }, null, options);
    const result = prepareTaskList([], [oldTask], options);

    expect(result.deletions).toHaveLength(1);
    expect(result.deletions[0]._sync.deletedAt).toBe(options.now());
    expect(createSyncOperation("task", result.deletions[0], "delete", () => "op-id")).toMatchObject({
      operationId: "op-id",
      entityId: "generated-id",
      action: "delete",
    });
  });
});
