const encoder = new TextEncoder();
const decoder = new TextDecoder();
const PBKDF2_ITERATIONS = 600000;

function encode(bytes) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

async function importAesKey(raw, extractable = true) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", extractable, ["encrypt", "decrypt"]);
}

async function derivePasswordKey(password, salt, iterations = PBKDF2_ITERATIONS) {
  const material = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, material,
    { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
}

async function wrapRawKey(rawKey, wrappingKey, metadata = {}) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, wrappingKey, rawKey);
  return { version: 1, algorithm: "A256GCM", iv: encode(iv), ciphertext: encode(ciphertext), ...metadata };
}

async function unwrapRawKey(envelope, wrappingKey) {
  if (envelope?.version !== 1 || envelope.algorithm !== "A256GCM") throw new Error("Unsupported key envelope");
  return crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv) }, wrappingKey, decode(envelope.ciphertext));
}

export function generateRecoveryKey() {
  return `wtd1.${encode(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export async function generateAccountKey() {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function wrapAccountKeyWithPassword(accountKey, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const wrappingKey = await derivePasswordKey(password, salt);
  const raw = await crypto.subtle.exportKey("raw", accountKey);
  return wrapRawKey(raw, wrappingKey, { kdf: "PBKDF2-SHA256", iterations: PBKDF2_ITERATIONS, salt: encode(salt) });
}

export async function unwrapAccountKeyWithPassword(envelope, password) {
  if (envelope.kdf !== "PBKDF2-SHA256" || envelope.iterations < PBKDF2_ITERATIONS) throw new Error("Unsafe key derivation envelope");
  const wrappingKey = await derivePasswordKey(password, decode(envelope.salt), envelope.iterations);
  return importAesKey(await unwrapRawKey(envelope, wrappingKey));
}

export async function wrapAccountKeyWithRecoveryKey(accountKey, recoveryKey) {
  if (!recoveryKey.startsWith("wtd1.")) throw new Error("Invalid recovery key");
  const wrappingKey = await importAesKey(decode(recoveryKey.slice(5)), false);
  return wrapRawKey(await crypto.subtle.exportKey("raw", accountKey), wrappingKey);
}

export async function unwrapAccountKeyWithRecoveryKey(envelope, recoveryKey) {
  if (!recoveryKey.startsWith("wtd1.")) throw new Error("Invalid recovery key");
  const wrappingKey = await importAesKey(decode(recoveryKey.slice(5)), false);
  return importAesKey(await unwrapRawKey(envelope, wrappingKey));
}

export async function encryptPayload(accountKey, payload, associatedData) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(associatedData) },
    accountKey, encoder.encode(JSON.stringify(payload)));
  return { version: 1, algorithm: "A256GCM", iv: encode(iv), ciphertext: encode(ciphertext) };
}

export async function decryptPayload(accountKey, envelope, associatedData) {
  if (envelope?.version !== 1 || envelope.algorithm !== "A256GCM") throw new Error("Unsupported payload envelope");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decode(envelope.iv),
    additionalData: encoder.encode(associatedData) }, accountKey, decode(envelope.ciphertext));
  return JSON.parse(decoder.decode(plaintext));
}
