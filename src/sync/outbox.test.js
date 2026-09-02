import { describe, expect, it } from "vitest";
import { compactOutbox, readyOperations } from "./outbox";

describe("sync outbox", () => {
  it("keeps only the newest complete operation for each entity", () => {
    const operations = [
      { operationId: "old", entityType: "task", entityId: "one", createdAt: "2026-01-01",baseRevision:4,
        basePayload:{text:"Server base"} },
      { operationId: "other", entityType: "task", entityId: "two", createdAt: "2026-01-02" },
      { operationId: "new", entityType: "task", entityId: "one", createdAt: "2026-01-03",baseRevision:4,
        basePayload:{text:"First offline edit"} },
    ];
    expect(compactOutbox(operations)).toEqual({ operations: [operations[1],{...operations[2],basePayload:{text:"Server base"}}],
      supersededOperationIds: ["old"] });
  });

  it("does not retry before the backoff expires", () => {
    expect(readyOperations([{ operationId: "later", nextAttemptAt: "2026-01-02" }], Date.parse("2026-01-01"))).toEqual([]);
  });
});
