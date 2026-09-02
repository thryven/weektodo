import { describe, expect, it } from "vitest";
import { passwordHasher, tokenHash } from "./security.mjs";

describe("server credential primitives", () => {
  it("stores Argon2id password verifiers and hashes opaque tokens", async () => {
    const encoded = await passwordHasher.hash("a sufficiently long password");
    expect(encoded).toContain("argon2id");
    expect(await passwordHasher.verify(encoded, "a sufficiently long password")).toBe(true);
    expect(await passwordHasher.verify(encoded, "wrong password")).toBe(false);
    expect(tokenHash("token")).not.toContain("token");
  }, 20000);
});
