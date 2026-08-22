import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  dataEncryptionActiveKeyId,
  decryptJson,
  encryptedPayloadKeyId,
  encryptJson,
  parseDataEncryptionKey,
  parseDataEncryptionKeyring
} from "./encryption";

describe("private fact encryption", () => {
  it("round-trips JSON without leaving plaintext in the payload", () => {
    const key = randomBytes(32);
    const facts = ["email: private@example.com", "date of birth: 1990-01-01"];
    const encrypted = encryptJson(facts, key);

    expect(encrypted).not.toContain("private@example.com");
    expect(decryptJson(encrypted, key)).toEqual(facts);
  });

  it("requires a 32-byte base64 key", () => {
    expect(() => parseDataEncryptionKey(undefined)).toThrow(
      "DATA_ENCRYPTION_KEY"
    );
    expect(() => parseDataEncryptionKey("dG9vLXNob3J0")).toThrow("32-byte");
  });

  it("writes authenticated v2 key IDs and keeps legacy v1 readable", () => {
    const legacyKey = randomBytes(32);
    const activeKey = randomBytes(32);
    const keyring = parseDataEncryptionKeyring({
      NODE_ENV: "production",
      DATA_ENCRYPTION_ACTIVE_KEY_ID: "primary-2026-08",
      DATA_ENCRYPTION_KEY: activeKey.toString("base64"),
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({
        "primary-2026-01": legacyKey.toString("base64")
      }),
      DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "primary-2026-01"
    });
    const legacy = encryptJson({ private: "legacy" }, legacyKey);
    const current = encryptJson({ private: "current" }, keyring);

    expect(dataEncryptionActiveKeyId(keyring)).toBe("primary-2026-08");
    expect(encryptedPayloadKeyId(legacy)).toBe("legacy-v1");
    expect(encryptedPayloadKeyId(current)).toBe("primary-2026-08");
    expect(decryptJson(legacy, keyring)).toEqual({ private: "legacy" });
    expect(decryptJson(current, keyring)).toEqual({ private: "current" });
  });

  it("authenticates the v2 key ID as additional data", () => {
    const key = randomBytes(32);
    const keyring = {
      activeKeyId: "active-1",
      legacyV1KeyId: "active-1",
      keys: new Map([
        ["active-1", key],
        ["alias-1", key]
      ])
    };
    const encrypted = encryptJson("private", keyring);
    const tampered = encrypted.replace("v2:active-1:", "v2:alias-1:");

    expect(() => decryptJson(tampered, keyring)).toThrow();
  });

  it("rejects ambiguous or unsafe keyring configuration", () => {
    const key = randomBytes(32).toString("base64");
    expect(() => parseDataEncryptionKeyring({
      NODE_ENV: "production",
      DATA_ENCRYPTION_KEY: key
    })).toThrow("DATA_ENCRYPTION_ACTIVE_KEY_ID");
    expect(() => parseDataEncryptionKeyring({
      DATA_ENCRYPTION_KEY: key,
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({ old: key })
    })).toThrow("must not be reused");
  });
});
