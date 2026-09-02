import { describe, expect, it } from "vitest";
import { prepareSharedSettings, sharedSettings } from "./syncSettings";

describe("sync settings boundary", () => {
  it("excludes device-only and credential-adjacent preferences", () => {
    expect(
      sharedSettings({ darkTheme: true, language: "fr", openOnStartup: true, runInBackground: false, reportErrors: true })
    ).toEqual({ darkTheme: true, language: "fr" });
  });

  it("keeps a stable settings identity across updates", () => {
    const options = { now: () => "2026-08-31T00:00:00.000Z", id: () => "settings-id" };
    const first = prepareSharedSettings({ language: "en" }, null, null, options);
    const second = prepareSharedSettings({ language: "fr" }, { language: "en" }, first._sync, options);
    expect(second._sync).toMatchObject({ id: "settings-id", localRevision: 2 });
  });
});
