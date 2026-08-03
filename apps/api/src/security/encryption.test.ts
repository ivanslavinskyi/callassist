import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  decryptJson,
  encryptJson,
  parseDataEncryptionKey
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
});
