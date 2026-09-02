import { describe, expect, it, vi } from "vitest";
import { buildServer } from "./app.mjs";
import { AuthService } from "./authService.mjs";
import { InMemoryIdentityRepository } from "./inMemoryIdentityRepository.mjs";

describe("Vercel Linux authentication runtime", () => {
  it("registers, verifies, and checks a password with the native Argon2 package", async () => {
    const repository = new InMemoryIdentityRepository(); let verificationToken;
    const verificationSender = { send: vi.fn(async ({ token }) => { verificationToken = token; }) };
    const app = await buildServer({ identityRepository: repository,
      authService: new AuthService({ repository, verificationSender }) });
    const credentials = { email: "vercel-function@example.com", password: "native-argon2-password",
      passwordKeyEnvelope: {}, recoveryKeyEnvelope: {} };
    const registration = await app.inject({ method: "POST", url: "/v1/auth/register", payload: credentials });
    expect(registration.statusCode).toBe(201);
    expect(verificationToken).toHaveLength(43);
    const verification = await app.inject({ method: "POST", url: "/v1/auth/verify",
      payload: { token: verificationToken } });
    expect(verification.statusCode).toBe(200);
    const login = await app.inject({ method: "POST", url: "/v1/auth/login",
      payload: { email: credentials.email, password: credentials.password, deviceName: "Linux gate" } });
    expect(login.statusCode).toBe(200);
    expect(login.json().accessToken).toHaveLength(43);
    await app.close();
  }, 30000);
});
