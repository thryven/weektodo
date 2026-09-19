import { describe, expect, it, vi } from "vitest";
import { GoogleTasksService, registerGoogleTasksIpc } from "../../electron/googleTasks";
import { Buffer } from "node:buffer";

function service() {
  const values = new Map();
  const config = { get: (key) => values.get(key), set: (key, value) => values.set(key, value), delete: (key) => values.delete(key) };
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (v) => Buffer.from(v), decryptString: (v) => v.toString() };
  const instance = new GoogleTasksService({ app: {}, shell: {}, config, safeStorage, fetchFn: vi.fn() });
  return { instance, config, safeStorage };
}
describe("Google credential boundary", () => {
  it("does not expose tokens through status", () => {
    const { instance } = service(); instance.tokens = { refresh_token: "secret" };
    expect(instance.status()).toEqual({ connected: true, secureStorage: true });
  });
  it("refuses insecure Linux plaintext fallback", () => {
    const { instance, safeStorage } = service(); safeStorage.getSelectedStorageBackend = () => "basic_text";
    expect(() => instance.save({ refresh_token: "secret" })).toThrow("Secure OS");
  });
  it("rejects foreign frames before calling the service", async () => {
    const handlers = {}; const mainFrame = {}; const webContents = { mainFrame };
    const status = vi.fn(() => ({}));
    registerGoogleTasksIpc({ ipcMain: { handle: (name, fn) => { handlers[name] = fn; } }, getWindow: () => ({ webContents }), service: { status } });
    await expect(handlers["google-tasks:status"]({ sender: webContents, senderFrame: {} })).rejects.toThrow("Untrusted");
    expect(status).not.toHaveBeenCalled();
    expect(await handlers["google-tasks:status"]({ sender: webContents, senderFrame: mainFrame })).toEqual({ ok: true, value: {} });
  });
  it("validates task input without making arbitrary requests", () => {
    const { instance } = service();
    expect(() => instance.write({ listId: "x", action: "arbitrary" })).toThrow("Invalid");
  });
  it("uses a system-browser loopback flow, rejects bad state, and exchanges PKCE", async () => {
    const { instance } = service(); let auth;
    instance.configuration = async () => ({ client_id: "desktop-client" });
    instance.tokenRequest = vi.fn(async () => ({ refresh_token: "private-refresh", access_token: "private-access" }));
    instance.shell.openExternal = async (raw) => {
      auth = new URL(raw); const redirect = auth.searchParams.get("redirect_uri");
      const invalid = await fetch(`${redirect}?state=wrong&code=bad`); expect(invalid.status).toBe(400);
      await fetch(`${redirect}?state=${auth.searchParams.get("state")}&code=good`);
    };
    expect(await instance.signIn()).toEqual({ connected: true, secureStorage: true });
    expect(auth.origin).toBe("https://accounts.google.com"); expect(auth.searchParams.get("code_challenge_method")).toBe("S256");
    expect(instance.tokenRequest.mock.calls[0][0]).toMatchObject({ code: "good", grant_type: "authorization_code" });
    expect(instance.tokenRequest.mock.calls[0][0].code_verifier.length).toBeGreaterThanOrEqual(43);
  });
  it("paginates task reads and includes hidden/completed/deleted tasks", async () => {
    const { instance } = service(); instance.request = vi.fn().mockResolvedValueOnce({ items: [{ id: "a" }], nextPageToken: "next" }).mockResolvedValueOnce({ items: [{ id: "b" }] });
    expect(await instance.tasks("list")).toHaveLength(2);
    expect(instance.request.mock.calls[0][0]).toContain("showHidden=true&showDeleted=true");
    expect(instance.request.mock.calls[1][0]).toContain("pageToken=next");
  });
});
