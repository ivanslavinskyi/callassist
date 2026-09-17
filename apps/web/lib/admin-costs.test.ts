import { describe, expect, it } from "vitest";
import { formatAdminMoney } from "./admin-costs";

describe("admin expense money", () => {
  it("distinguishes unknown, zero, sub-cent expenses and exact detail amounts", () => {
    expect(formatAdminMoney(null)).toBe("—");
    expect(formatAdminMoney(0)).toBe("$0.00");
    expect(formatAdminMoney(2220)).toBe("<$0.01");
    expect(formatAdminMoney(2220, "en", true)).toBe("$0.002220");
    expect(formatAdminMoney(5974220)).toBe("$5.97");
    expect(formatAdminMoney(-10000)).toBe("-$0.01");
  });
});
