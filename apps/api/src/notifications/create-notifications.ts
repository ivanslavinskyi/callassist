import type { CallRepository } from "../storage/call-repository";
import { createEmailProviderFromEnv } from "../auth/create-email-provider";
import { emailBrandingFromEnv } from "../auth/email-branding";
import { parseDataEncryptionKeyring } from "../security/encryption";
import { SuperadminNotifications } from "./superadmin-notifications";

export function createNotificationsFromEnv(calls: CallRepository, keepAlive=false) {
  if ((process.env.STORAGE_DRIVER?.trim() || "memory") !== "postgres") return undefined;
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required for notifications");
  return new SuperadminNotifications(process.env.DATABASE_URL,parseDataEncryptionKeyring(process.env),
    createEmailProviderFromEnv(calls.betaControls),emailBrandingFromEnv(),calls,{keepAlive});
}
