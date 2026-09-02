import { beforeEach, describe, expect, it, vi } from "vitest";

const repositories = vi.hoisted(() => ({ todoUpdate: vi.fn(), dateUpdate: vi.fn() }));
vi.mock("../repositories/toDoListRepository", () => ({ default: { update: repositories.todoUpdate } }));
vi.mock("../repositories/repeatingEventByDateRepository", () => ({ default: { update: repositories.dateUpdate } }));

import repeatingEvents from "./repeatingEvents";

function createVue() {
  const state = {
    repeatingEventDateCache: { "20260901": ["daily"] },
    repeatingEventList: { daily: { data: { text: "Stand-up", repeatingEvent: "daily" } } },
    repeatingEventByDate: { "20260901": {} },
    todoLists: { "20260901": [] },
    config: { autoReorderTasks: false },
  };
  return {
    state,
    $store: {
      getters: state,
      commit: vi.fn((type, payload) => {
        if (type === "addTodo") state.todoLists[payload.listId].push(payload);
        if (type === "removeTodo") state.todoLists[payload.toDoListId].splice(payload.index, 1);
      }),
    },
  };
}

describe("repeating event generation", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates and records an occurrence only once for a date", () => {
    const vue = createVue();
    repeatingEvents.generateRepeatingEventsIntances("20260901", vue);
    repeatingEvents.generateRepeatingEventsIntances("20260901", vue);

    expect(vue.state.todoLists["20260901"]).toHaveLength(1);
    expect(vue.state.todoLists["20260901"][0]).toMatchObject({ text: "Stand-up", listId: "20260901" });
    expect(vue.state.repeatingEventByDate["20260901"].daily).toBe(true);
    expect(repositories.dateUpdate).toHaveBeenCalledOnce();
  });

  it("removes a future occurrence whose recurrence definition was deleted", () => {
    const vue = createVue();
    vue.state.todoLists["29990101"] = [{ listId: "29990101", repeatingEvent: "deleted" }];

    repeatingEvents.removeGeneratedRepeatingEvents("29990101", vue);

    expect(vue.state.todoLists["29990101"]).toEqual([]);
    expect(repositories.todoUpdate).toHaveBeenCalled();
  });
});
