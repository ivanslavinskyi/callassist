import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAnalyticsSettings } from "@callassist/contracts";
import { defaultPrivacyPreferences } from "./privacy-preferences";

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());
function browser() {
  const scripts = new Map<string, { id: string; src: string; remove: () => void }>();
  const appendChild = vi.fn((script) => scripts.set(script.id, script));
  const host = { location: { origin: "https://shprohli.ch" }, dataLayer: [] as IArguments[] };
  vi.stubGlobal("window", host);
  vi.stubGlobal("document", { head: { appendChild }, getElementById: (id: string) => scripts.get(id),
    createElement: () => { const script = { id: "", src: "", remove: () => scripts.delete(script.id) }; return script; } });
  return { host, scripts, appendChild };
}
describe("analytics policy and SPA tracking", () => {
  it("loads nothing when disabled, missing, invalid or refused", async () => {
    const { appendChild } = browser(); const { configureAnalytics } = await import("./analytics");
    for (const settings of [defaultAnalyticsSettings, { enabled: true, measurementId: "" }, { enabled: true, measurementId: "G-<script>" }]) configureAnalytics(settings, defaultPrivacyPreferences);
    configureAnalytics({ enabled: true, measurementId: "G-TEST1234" }, { ...defaultPrivacyPreferences, analyticsConsent: false });
    expect(appendChild).not.toHaveBeenCalled();
  });
  it("initializes once, deduplicates renders, redacts identifiers and stops after disable", async () => {
    const { host, scripts, appendChild } = browser(); const { configureAnalytics, trackPageView } = await import("./analytics");
    const settings = { enabled: true, measurementId: "G-TEST1234" };
    configureAnalytics(settings, defaultPrivacyPreferences); trackPageView("/fr");
    configureAnalytics(settings, defaultPrivacyPreferences); trackPageView("/fr");
    trackPageView("/fr/app/calls/private-id?token=secret#private"); trackPageView("/admin/users");
    expect(appendChild).toHaveBeenCalledTimes(1);
    const events = host.dataLayer.map(args => Array.from(args));
    expect(events.filter(args => args[0] === "config")).toHaveLength(1);
    expect(events.filter(args => args[0] === "event")).toHaveLength(2);
    expect(JSON.stringify(events)).toContain("/fr/app/calls/detail");
    expect(JSON.stringify(events)).not.toMatch(/private-id|secret|admin\/users/);
    configureAnalytics(defaultAnalyticsSettings, defaultPrivacyPreferences); trackPageView("/it");
    expect(scripts.size).toBe(0);
    expect(host.dataLayer).toHaveLength(events.length);
    expect(host).toHaveProperty("ga-disable-G-TEST1234", true);
  });
});
