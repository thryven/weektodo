import { beforeEach, describe, expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({ config: {}, updates: [] }));

vi.mock("../repositories/configRepository", () => ({
  default: {
    load: () => repository.config,
    update: (config) => repository.updates.push({ ...config }),
  },
}));

import migrations from "./migrations";

describe("configuration migrations", () => {
  beforeEach(() => {
    repository.config = {};
    repository.updates = [];
  });

  it("adds every setting required by the current application", () => {
    migrations.migrate();

    expect(repository.config).toMatchObject({
      checkUpdates: true,
      calendar: true,
      notificationOnStartup: true,
      runInBackground: true,
      mainDividerPosition: 1,
      darkTrayIcon: false,
      reportErrors: false,
      fullscreenToDoModal: false,
      weekStartOnMonday: true,
    });
    expect(repository.config.lastDayOpened).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(repository.updates.length).toBeGreaterThan(0);
  });

  it("preserves settings already chosen by the user", () => {
    repository.config = {
      checkUpdates: false,
      calendar: false,
      notificationOnStartup: false,
      runInBackground: false,
      mainDividerPosition: 2,
      darkTrayIcon: true,
      reportErrors: true,
      fullscreenToDoModal: true,
      lastDayOpened: "2020-01-01",
    };

    migrations.migrate();

    expect(repository.config).toMatchObject({
      checkUpdates: false,
      calendar: false,
      notificationOnStartup: false,
      runInBackground: false,
      mainDividerPosition: 2,
      darkTrayIcon: true,
      reportErrors: true,
      fullscreenToDoModal: true,
      lastDayOpened: "2020-01-01",
    });
  });
});
