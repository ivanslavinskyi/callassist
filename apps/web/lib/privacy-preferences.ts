/** Versioned policy boundary; acknowledgement is not an opt-in consent decision. */
export const privacyStorageKey = "callassist_privacy_preferences";
export type PrivacyPreferences = { version: 1; acknowledgedAt: string | null; analyticsConsent: boolean | null };
export const defaultPrivacyPreferences: PrivacyPreferences = { version: 1, acknowledgedAt: null, analyticsConsent: null };
let memory = defaultPrivacyPreferences;
export function readPrivacyPreferences(): PrivacyPreferences {
  try {
    const parsed = JSON.parse(localStorage.getItem(privacyStorageKey) ?? "null") as PrivacyPreferences | null;
    return parsed?.version === 1 && (parsed.acknowledgedAt === null || typeof parsed.acknowledgedAt === "string") &&
      [null, true, false].includes(parsed.analyticsConsent) ? parsed : memory;
  } catch { return memory; }
}
export function acknowledgePrivacyNotice() {
  memory = { ...readPrivacyPreferences(), version: 1, acknowledgedAt: new Date().toISOString() };
  try { localStorage.setItem(privacyStorageKey, JSON.stringify(memory)); } catch { /* Keep acknowledgement in this tab. */ }
  window.dispatchEvent(new Event("callassist:privacy-changed"));
}
export function analyticsAllowed(preferences: PrivacyPreferences): boolean {
  // Current policy allows statistics unless explicitly refused. A future opt-in
  // policy can require analyticsConsent === true here, without changing the UI/settings.
  return preferences.analyticsConsent !== false;
}
