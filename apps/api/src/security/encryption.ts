import {
  createCipheriv,
  createDecipheriv,
  randomBytes
} from "node:crypto";

const algorithm = "aes-256-gcm";
const keyLength = 32;
const ivLength = 12;
const authTagLength = 16;
const legacyVersion = "v1";
const keyringVersion = "v2";
const keyIdPattern = /^[a-z][a-z0-9_-]{0,31}$/;
export const legacyDataEncryptionKeyId = "legacy-v1";

export type DataEncryptionKeyring = {
  activeKeyId: string;
  legacyV1KeyId: string;
  keys: ReadonlyMap<string, Buffer>;
};

export type DataEncryptionMaterial = Buffer | DataEncryptionKeyring;

export function parseDataEncryptionKey(encoded: string | undefined) {
  if (!encoded?.trim()) {
    throw new Error("DATA_ENCRYPTION_KEY is required for PostgreSQL storage");
  }
  return parseBase64Key(encoded, "DATA_ENCRYPTION_KEY");
}

export function parseDataEncryptionKeyring(
  environment: NodeJS.ProcessEnv
): DataEncryptionKeyring {
  const configuredActiveKeyId = environment.DATA_ENCRYPTION_ACTIVE_KEY_ID?.trim();
  const activeKeyId = configuredActiveKeyId ||
    (environment.NODE_ENV === "production" ? "" : "local-1");
  validateKeyId(activeKeyId, "DATA_ENCRYPTION_ACTIVE_KEY_ID");
  const activeKey = parseDataEncryptionKey(environment.DATA_ENCRYPTION_KEY);
  const keys = new Map<string, Buffer>([[activeKeyId, activeKey]]);
  const previous = parsePreviousKeys(environment.DATA_ENCRYPTION_PREVIOUS_KEYS);
  if (previous.size > 4) {
    throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS may contain at most four keys");
  }
  for (const [keyId, key] of previous) {
    if (keys.has(keyId)) {
      throw new Error("Data encryption key IDs must be unique");
    }
    if ([...keys.values()].some((existing) => existing.equals(key))) {
      throw new Error("Data encryption key material must not be reused under another ID");
    }
    keys.set(keyId, key);
  }
  const configuredLegacyKeyId = environment.DATA_ENCRYPTION_LEGACY_V1_KEY_ID?.trim();
  if (previous.size > 0 && !configuredLegacyKeyId) {
    throw new Error(
      "DATA_ENCRYPTION_LEGACY_V1_KEY_ID is required when previous keys are configured"
    );
  }
  const legacyV1KeyId = configuredLegacyKeyId || activeKeyId;
  validateKeyId(legacyV1KeyId, "DATA_ENCRYPTION_LEGACY_V1_KEY_ID");
  if (!keys.has(legacyV1KeyId)) {
    throw new Error("DATA_ENCRYPTION_LEGACY_V1_KEY_ID must reference a configured key");
  }
  return { activeKeyId, legacyV1KeyId, keys };
}

export function encryptJson(value: unknown, material: DataEncryptionMaterial) {
  if (Buffer.isBuffer(material)) {
    return encryptLegacyJson(value, material);
  }
  const key = dataEncryptionKeyForId(material, material.activeKeyId);
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv, { authTagLength });
  cipher.setAAD(aadFor(material.activeKeyId));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    keyringVersion,
    material.activeKeyId,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

export function decryptJson<T>(
  payload: string,
  material: DataEncryptionMaterial
): T {
  const parts = payload.split(":");
  if (parts[0] === legacyVersion) {
    if (parts.length !== 4) throw new Error("Unsupported encrypted payload");
    const key = dataEncryptionKeyForId(material, legacyDataEncryptionKeyId);
    return decryptPayload<T>(parts.slice(1), key);
  }
  if (parts[0] === keyringVersion) {
    if (parts.length !== 5 || !parts[1]) {
      throw new Error("Unsupported encrypted payload");
    }
    const keyId = parts[1];
    validateKeyId(keyId, "encrypted payload key ID");
    const key = dataEncryptionKeyForId(material, keyId);
    return decryptPayload<T>(parts.slice(2), key, aadFor(keyId));
  }
  throw new Error("Unsupported encrypted payload");
}

export function encryptedPayloadKeyId(payload: string) {
  const [version, keyId] = payload.split(":", 3);
  if (version === legacyVersion) return legacyDataEncryptionKeyId;
  if (version === keyringVersion && keyId && keyIdPattern.test(keyId)) return keyId;
  throw new Error("Unsupported encrypted payload");
}

export function dataEncryptionActiveKeyId(material: DataEncryptionMaterial) {
  return Buffer.isBuffer(material)
    ? legacyDataEncryptionKeyId
    : material.activeKeyId;
}

export function dataEncryptionKeyForId(
  material: DataEncryptionMaterial,
  keyId: string
) {
  if (Buffer.isBuffer(material)) {
    if (keyId !== legacyDataEncryptionKeyId) {
      throw new Error("Unknown data encryption key ID");
    }
    return material;
  }
  const resolvedId = keyId === legacyDataEncryptionKeyId
    ? material.legacyV1KeyId
    : keyId;
  const key = material.keys.get(resolvedId);
  if (!key) throw new Error("Unknown data encryption key ID");
  return key;
}

export function dataEncryptionMaterialUsesKey(
  material: DataEncryptionMaterial,
  candidate: Buffer
) {
  return Buffer.isBuffer(material)
    ? material.equals(candidate)
    : [...material.keys.values()].some((key) => key.equals(candidate));
}

function encryptLegacyJson(value: unknown, key: Buffer) {
  assertKeyLength(key);
  const iv = randomBytes(ivLength);
  const cipher = createCipheriv(algorithm, key, iv, { authTagLength });
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return [
    legacyVersion,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url")
  ].join(":");
}

function decryptPayload<T>(parts: string[], key: Buffer, aad?: Buffer): T {
  const [encodedIv, encodedAuthTag, encodedCiphertext, ...rest] = parts;
  if (!encodedIv || !encodedAuthTag || !encodedCiphertext || rest.length > 0) {
    throw new Error("Unsupported encrypted payload");
  }
  assertKeyLength(key);
  const iv = decodeBase64Url(encodedIv, ivLength);
  const authTag = decodeBase64Url(encodedAuthTag, authTagLength);
  const ciphertext = decodeBase64Url(encodedCiphertext);
  if (ciphertext.length === 0) throw new Error("Unsupported encrypted payload");
  const decipher = createDecipheriv(algorithm, key, iv, { authTagLength });
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final()
  ]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

function parsePreviousKeys(value: string | undefined) {
  if (!value?.trim()) return new Map<string, Buffer>();
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS must be a JSON object");
  }
  const keys = new Map<string, Buffer>();
  for (const [keyId, encoded] of Object.entries(parsed)) {
    validateKeyId(keyId, "DATA_ENCRYPTION_PREVIOUS_KEYS key ID");
    if (typeof encoded !== "string") {
      throw new Error("DATA_ENCRYPTION_PREVIOUS_KEYS values must be base64 keys");
    }
    keys.set(keyId, parseBase64Key(encoded, "DATA_ENCRYPTION_PREVIOUS_KEYS"));
  }
  return keys;
}

function parseBase64Key(encodedValue: string, name: string) {
  const encoded = encodedValue.trim();
  const key = /^[A-Za-z0-9+/]+={0,2}$/.test(encoded)
    ? Buffer.from(encoded, "base64")
    : null;
  const canonical = key
    ? key.toString("base64").replace(/=+$/, "") === encoded.replace(/=+$/, "")
    : false;
  if (!key || key.length !== keyLength || !canonical) {
    throw new Error(`${name} must contain base64-encoded 32-byte keys`);
  }
  return key;
}

function validateKeyId(value: string, name: string) {
  if (!keyIdPattern.test(value) || value === legacyDataEncryptionKeyId) {
    throw new Error(`${name} must be a non-reserved lowercase key ID`);
  }
}

function decodeBase64Url(value: string, expectedLength?: number) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error("Unsupported encrypted payload");
  }
  const decoded = Buffer.from(value, "base64url");
  if (
    decoded.toString("base64url") !== value ||
    (expectedLength !== undefined && decoded.length !== expectedLength)
  ) {
    throw new Error("Unsupported encrypted payload");
  }
  return decoded;
}

function assertKeyLength(key: Buffer) {
  if (key.length !== keyLength) {
    throw new Error("Data encryption key must contain exactly 32 bytes");
  }
}

function aadFor(keyId: string) {
  return Buffer.from(`callassist:${keyringVersion}:${keyId}`, "utf8");
}
