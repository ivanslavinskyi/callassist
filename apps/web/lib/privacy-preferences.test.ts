import { afterEach, expect, it, vi } from "vitest";
afterEach(() => vi.unstubAllGlobals());
it("persists acknowledgement independently from analytics consent and survives denied storage", async () => {
  vi.resetModules(); const store = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => store.set(key, value) });
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  const preferences = await import("./privacy-preferences");
  preferences.acknowledgePrivacyNotice();
  expect(preferences.readPrivacyPreferences()).toMatchObject({ version: 1, analyticsConsent: null, acknowledgedAt: expect.any(String) });
  vi.resetModules(); const restored = await import("./privacy-preferences");
  expect(restored.readPrivacyPreferences().acknowledgedAt).not.toBeNull();
  expect(restored.analyticsAllowed({ ...restored.defaultPrivacyPreferences, analyticsConsent: false })).toBe(false);
  vi.stubGlobal("localStorage", { getItem: () => { throw Error("Denied"); }, setItem: () => { throw Error("Denied"); } });
  restored.acknowledgePrivacyNotice();
  expect(restored.readPrivacyPreferences().acknowledgedAt).not.toBeNull();
});
