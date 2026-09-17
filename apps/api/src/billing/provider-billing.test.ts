import { describe, expect, it, vi, afterEach } from "vitest";
import { adminOperationsWindowBounds } from "@callassist/contracts";
import { decimalMicros, fetchOpenAIBilling, fetchTwilioBilling, twilioBillingComponents } from "./provider-billing";

afterEach(() => vi.unstubAllGlobals());
describe("provider billing reconciliation", () => {
  it("keeps overlapping Twilio parents and children out of the component sum", () => {
    const parts = twilioBillingComponents(5974220, new Map(Object.entries({
      "calls": 4241400, "calls-outbound": 4144600, "calls-media-stream-minutes": 96800,
      sms: 380600, "sms-outbound": 380600, "authy-sms-outbound": 380600,
      "authy-phone-verifications": 200000, phonenumbers: 1150000, recordingstorage: 2220
    })));
    expect(parts.reduce((sum, row) => sum + row.amountMicros, 0)).toBe(5974220);
    expect(parts.some(row => row.key === "authy-sms-outbound")).toBe(false);
  });
  it("preserves sub-cent costs, credit signs and unclassified adjustments", () => {
    expect(decimalMicros("0.002220")).toBe(2220);
    expect(decimalMicros("-0.180200")).toBe(-180200);
    expect(twilioBillingComponents(1, new Map([["sms", 2]]))).toContainEqual({ key: "other_or_adjustments", amountMicros: -1 });
    expect(() => decimalMicros(null)).toThrow();
  });
  it("uses UTC calendar months across year boundaries", () => {
    expect(adminOperationsWindowBounds("previous_month", new Date("2026-01-01T00:00:00Z"))).toEqual({ from: "2025-12-01T00:00:00.000Z", to: "2026-01-01T00:00:00.000Z" });
  });
  it("rejects pagination outside the provider origin before sending credentials", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ usage_records: [], next_page_uri: "https://example.invalid/steal" }) });
    vi.stubGlobal("fetch", fetch);
    await expect(fetchTwilioBilling("ACtest", "secret", "2026-09-01", "2026-09-17")).rejects.toThrow("BILLING_PAGE_INVALID");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("filters OpenAI costs to an explicitly configured project and follows pages", async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ start_time: Date.parse("2026-09-01T00:00:00Z") / 1000,
      results: [{ project_id: "proj_test", line_item: "text", amount: { value: 0.00222, currency: "usd" } }] }], has_more: true, next_page: "second" }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ data: [], has_more: false }) });
    vi.stubGlobal("fetch", fetch);
    const snapshots = await fetchOpenAIBilling("admin-key", "proj_test", "2026-09-01", "2026-09-17");
    expect(snapshots[0]).toMatchObject({ totalMicros: 2220, scopeKey: "proj_test", source: "costs_api" });
    expect(String(fetch.mock.calls[0]![0])).toContain("project_ids%5B%5D=proj_test");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
