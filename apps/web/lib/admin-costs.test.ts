import { describe, expect, it } from "vitest";
import { formatAdminMoney, expenseCategory } from "./admin-costs";

describe("admin expense money", () => {
  it("keeps live sessions and answering operations reachable in the request drilldown", () => {
    expect(expenseCategory("realtime_session")).toBe("realtime");
    expect(expenseCategory("answering_detection")).toBe("twilio");
    expect(expenseCategory("voicemail_tts")).toBe("twilio");
  });
  it("distinguishes unknown, zero, sub-cent expenses and exact detail amounts", () => {
    expect(formatAdminMoney(null)).toBe("—");
    expect(formatAdminMoney(0)).toBe("$0.00");
    expect(formatAdminMoney(2220)).toBe("<$0.01");
    expect(formatAdminMoney(2220, "en", true)).toBe("$0.002220");
    expect(formatAdminMoney(5974220)).toBe("$5.97");
    expect(formatAdminMoney(-10000)).toBe("-$0.01");
  });
});
