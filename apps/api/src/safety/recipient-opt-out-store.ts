import { createHmac, randomBytes } from "node:crypto";
import { parseDataEncryptionKey, type DataEncryptionMaterial } from "../security/encryption";

export const recipientContactStatuses = ["ringing", "in-progress", "completed", "busy", "no-answer"] as const;
export function provesRecipientContact(provider: string, providerCallId: string | null, status: string) {
  return provider === "twilio" && Boolean(providerCallId) && recipientContactStatuses.some(value => value === status);
}
export function recipientContactHashKey(material?: DataEncryptionMaterial): Buffer {
  const configured = process.env.RECIPIENT_CONTACT_HASH_KEY?.trim();
  if (configured) return parseDataEncryptionKey(configured);
  if (process.env.NODE_ENV === "production") throw new Error("RECIPIENT_CONTACT_HASH_KEY is required");
  return material ? Buffer.isBuffer(material) ? material : material.keys.get(material.activeKeyId)! : randomBytes(32);
}
export function recipientContactHash(phone: string, key: Buffer) {
  return createHmac("sha256", key).update(`recipient-contact:v1:${phone}`).digest("hex");
}
export type OptOutChallengeInput = { phoneE164: string; tokenHash: string };
export interface RecipientOptOutStore {
  backfill(): Promise<void>;
  reserve(input: OptOutChallengeInput): Promise<boolean>;
  activate(input: OptOutChallengeInput): Promise<void>;
  claim(input: OptOutChallengeInput): Promise<string | null>;
  finish(input: OptOutChallengeInput, claimId: string, approved: boolean): Promise<boolean>;
}
export const recipientOptOutReason = "Recipient confirmed public opt-out by SMS";
