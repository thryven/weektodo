import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

export const normalizeEmail = (email) => String(email).trim().toLowerCase();
export const tokenHash = (token) => createHash("sha256").update(token).digest("base64url");
export const createOpaqueToken = () => randomBytes(32).toString("base64url");
export const createApprovalCode = () => String(randomInt(0, 1000000)).padStart(6, "0");
export const passwordHasher = {
  hash: (password) => hash(password, { algorithm: 2, memoryCost: 19456, timeCost: 2, parallelism: 1 }),
  verify: (encoded, password) => verify(encoded, password),
};
export { randomUUID };
