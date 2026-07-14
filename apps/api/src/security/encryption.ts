import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH = 32;
const IV_LENGTH = 12;
const VERSION = "v1";

export function parseDataEncryptionKey(encoded: string | undefined) {
  if (!encoded) {
    throw new Error("DATA_ENCRYPTION_KEY is required for PostgreSQL storage");
  }

  const key = Buffer.from(encoded, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error("DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  }

  return key;
}

export function encryptJson(value: unknown, key: Buffer) {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    VERSION,
    iv.toString("base64url"),
    authTag.toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

export function decryptJson<T>(payload: string, key: Buffer): T {
  const [version, encodedIv, encodedAuthTag, encodedCiphertext, ...rest] =
    payload.split(":");

  if (
    version !== VERSION ||
    !encodedIv ||
    !encodedAuthTag ||
    !encodedCiphertext ||
    rest.length > 0
  ) {
    throw new Error("Unsupported encrypted payload");
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(encodedIv, "base64url")
  );
  decipher.setAuthTag(Buffer.from(encodedAuthTag, "base64url"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}
