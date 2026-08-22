import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { parseDataEncryptionKeyring } from "./encryption";
import { createCallFeedbackFingerprint } from "./feedback-fingerprint";

const feedback = {
  goalResult: "partly" as const,
  transcriptQuality: "some_errors" as const,
  comment: "  private feedback  ",
  idempotencyKey: "149b56b0-1dbc-48ad-a834-ccb690544487"
};

describe("call feedback fingerprint key separation", () => {
  it("preserves the legacy fingerprint and derives v2 keys by key ID", () => {
    const oldKey = randomBytes(32);
    const activeKey = randomBytes(32);
    const legacyExpected = createHmac("sha256", oldKey)
      .update(JSON.stringify({
        goalResult: "partly",
        transcriptQuality: "some_errors",
        comment: "private feedback"
      }))
      .digest("hex");
    const keyring = parseDataEncryptionKeyring({
      NODE_ENV: "production",
      DATA_ENCRYPTION_ACTIVE_KEY_ID: "active-2",
      DATA_ENCRYPTION_KEY: activeKey.toString("base64"),
      DATA_ENCRYPTION_PREVIOUS_KEYS: JSON.stringify({
        "active-1": oldKey.toString("base64")
      }),
      DATA_ENCRYPTION_LEGACY_V1_KEY_ID: "active-1"
    });

    expect(createCallFeedbackFingerprint(feedback, oldKey)).toBe(legacyExpected);
    expect(createCallFeedbackFingerprint(feedback, keyring, "legacy-v1"))
      .toBe(legacyExpected);
    expect(createCallFeedbackFingerprint(feedback, keyring, "active-2"))
      .not.toBe(legacyExpected);
  });
});
