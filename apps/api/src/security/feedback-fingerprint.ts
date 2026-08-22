import type { OwnerCallFeedbackInput } from "@callassist/contracts";
import { createHmac } from "node:crypto";
import {
  dataEncryptionActiveKeyId,
  dataEncryptionKeyForId,
  legacyDataEncryptionKeyId,
  type DataEncryptionMaterial
} from "./encryption";

export function createCallFeedbackFingerprint(
  input: OwnerCallFeedbackInput,
  encryptionKey: DataEncryptionMaterial,
  keyId = dataEncryptionActiveKeyId(encryptionKey)
) {
  const dataKey = dataEncryptionKeyForId(encryptionKey, keyId);
  const fingerprintKey = keyId === legacyDataEncryptionKeyId
    ? dataKey
    : createHmac("sha256", dataKey)
        .update("callassist:feedback-fingerprint:v2")
        .digest();
  return createHmac("sha256", fingerprintKey)
    .update(JSON.stringify({
      goalResult: input.goalResult,
      transcriptQuality: input.transcriptQuality,
      comment: input.comment?.trim() || null
    }))
    .digest("hex");
}
