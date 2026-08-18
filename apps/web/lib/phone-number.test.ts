import { describe, expect, it } from "vitest";
import { isE164PhoneNumber, normalizePhoneNumber } from "./phone-number";

describe("phone number input", () => {
  it.each([
    ["+41 71 000 00 00", "+41710000000"],
    ["(41) 71-000-00-00", "+41710000000"],
    ["+1 (212) 555-0100", "+12125550100"]
  ])("normalizes %s", (input, expected) => {
    expect(normalizePhoneNumber(input)).toBe(expected);
  });

  it("validates the shared E.164 boundary", () => {
    expect(isE164PhoneNumber("+41710000000")).toBe(true);
    expect(isE164PhoneNumber("+0123456789")).toBe(false);
    expect(isE164PhoneNumber("+4171")).toBe(false);
  });
});
