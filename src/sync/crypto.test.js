import { describe, expect, it } from "vitest";
import { decryptPayload, encryptPayload, generateAccountKey, generateRecoveryKey, unwrapAccountKeyWithPassword,
  unwrapAccountKeyWithRecoveryKey, wrapAccountKeyWithPassword, wrapAccountKeyWithRecoveryKey } from "./crypto";

describe("end-to-end encryption", () => {
  it("round-trips payloads with authenticated context", async () => {
    const key = await generateAccountKey();
    const encrypted = await encryptPayload(key, { text: "private task" }, "workspace:task:one");
    expect(JSON.stringify(encrypted)).not.toContain("private task");
    await expect(decryptPayload(key, encrypted, "workspace:task:two")).rejects.toThrow();
    expect(await decryptPayload(key, encrypted, "workspace:task:one")).toEqual({ text: "private task" });
  });

  it("recovers the account key through password and recovery envelopes", async () => {
    const key = await generateAccountKey();
    const passwordEnvelope = await wrapAccountKeyWithPassword(key, "correct horse battery staple");
    const passwordKey = await unwrapAccountKeyWithPassword(passwordEnvelope, "correct horse battery staple");
    await expect(unwrapAccountKeyWithPassword(passwordEnvelope, "wrong password")).rejects.toThrow();

    const recoveryKey = generateRecoveryKey();
    const recoveryEnvelope = await wrapAccountKeyWithRecoveryKey(key, recoveryKey);
    const recoveredKey = await unwrapAccountKeyWithRecoveryKey(recoveryEnvelope, recoveryKey);
    const encrypted = await encryptPayload(passwordKey, { ok: true }, "test");
    expect(await decryptPayload(recoveredKey, encrypted, "test")).toEqual({ ok: true });
  }, 20000);
});
