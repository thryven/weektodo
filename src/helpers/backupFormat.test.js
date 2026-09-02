import { describe, expect, it } from "vitest";
import { parseBackup, serializeBackup } from "./backupFormat";

describe("backup format compatibility", () => {
  it("normalizes a current backup and marks it for post-import cleanup", () => {
    const backup = parseBackup(
      JSON.stringify({ config: JSON.stringify({ language: "es" }), customTodoListIds: "[]", todoLists: { today: [] } })
    );

    expect(JSON.parse(backup.config)).toEqual({ language: "es", importing: true });
    expect(backup.todoLists).toEqual({ today: [] });
  });

  it("accepts legacy object configuration and missing database sections", () => {
    const backup = parseBackup(JSON.stringify({ config: { version: "1.0.0" } }));

    expect(JSON.parse(backup.config)).toMatchObject({ version: "1.0.0", importing: true });
    expect(backup.customTodoListIds).toBe("[]");
    expect(backup.todoLists).toEqual({});
    expect(backup.repeating_events).toEqual({});
    expect(backup.repeating_events_by_date).toEqual({});
  });

  it("rejects malformed backups and serializes without data loss", () => {
    expect(() => parseBackup("{}")) .toThrow("Invalid WeekToDo backup");
    expect(() => parseBackup('{"config":"bad json"}')).toThrow();
    expect(JSON.parse(serializeBackup({ config: "{}", todoLists: { a: [1] } }))).toEqual({
      config: "{}",
      todoLists: { a: [1] },
    });
  });

  it("preserves entity sync metadata needed for recovery while accepting a versioned backup",()=>{
    const task={text:"Recover me",_sync:{id:"task-1",serverRevision:7,localRevision:8}};
    const backup=parseBackup(serializeBackup({backupVersion:2,config:"{}",todoLists:{today:[task]}}));
    expect(backup.backupVersion).toBe(2);expect(backup.todoLists.today[0]).toEqual(task);
  });
});
