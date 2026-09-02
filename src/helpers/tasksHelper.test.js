import { describe, expect, it } from "vitest";
import tasksHelper from "./tasksHelper";

describe("tasksHelper", () => {
  it("counts only unfinished tasks", () => {
    expect(tasksHelper.pendingTasksCount(null)).toBe(0);
    expect(tasksHelper.pendingTasksCount([{ checked: false }, { checked: true }, { checked: false }])).toBe(2);
  });

  it("orders unfinished timed tasks first and completed tasks last", () => {
    const tasks = [
      { text: "completed", checked: true, time: "08:00" },
      { text: "without time", checked: false, time: null },
      { text: "later", checked: false, time: "12:00" },
      { text: "earlier", checked: false, time: "09:00" },
    ];

    expect(tasksHelper.reorderTasksList(tasks).map((task) => task.text)).toEqual([
      "earlier",
      "later",
      "without time",
      "completed",
    ]);
  });
});
