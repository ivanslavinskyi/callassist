import { describe, expect, it } from "vitest";
import { accountPhoneSchema } from "./account";
import {
  isSwissDestinationPhone,
  normalizeSwissDestinationPhone,
  parseAccountPhoneNumber,
  swissDestinationPhoneSchema
} from "./phone";

describe("Swiss destination phone policy", () => {
  it.each([
    ["+41 52 368 66 88", "+41523686688"],
    ["052 368 66 88", "+41523686688"],
    ["0041 52 368 66 88", "+41523686688"],
    ["41 52 368 66 88", "+41523686688"]
  ])("normalizes %s to canonical E.164", (input, expected) => {
    expect(normalizeSwissDestinationPhone(input)).toBe(expected);
    expect(swissDestinationPhoneSchema.parse(input)).toBe(expected);
  });

  it.each([
    "+442079460000",
    "+4232301111",
    "+4171",
    "+41000000000",
    "112",
    "not a phone number"
  ])("rejects non-Swiss or invalid destination %s", (input) => {
    expect(isSwissDestinationPhone(input)).toBe(false);
    expect(swissDestinationPhoneSchema.safeParse(input).success).toBe(false);
  });
});

describe("account phone normalization", () => {
  it.each([
    ["CH", ["0790000001", "41790000001", "+41790000001", "0041790000001", "410790000001", "+410790000001"], "+41790000001"],
    ["UA", ["0671234567", "380671234567", "+380671234567", "00380671234567", "3800671234567", "+3800671234567"], "+380671234567"]
  ] as const)("normalizes equivalent %s prefixes without changing subscriber digits", (country, variants, expected) => {
    for (const input of variants) expect(parseAccountPhoneNumber(input, country)).toBe(expected);
  });
  it.each(["+999123456789", "Call +41790000001", "+41790000001 ext 123", "+41+766058786"])("rejects invalid account number %s before registration", value => {
    expect(accountPhoneSchema.safeParse(value).success).toBe(false);
  });
  it("uses the selected country only for national numbers", () => {
    expect(parseAccountPhoneNumber("0671234567", "CH")).toBeNull();
    expect(parseAccountPhoneNumber("+380671234567", "CH")).toBe("+380671234567");
    expect(parseAccountPhoneNumber("0790000001", "invalid")).toBeNull();
  });
  it.each([
    ["+380671234567", "+380671234567"],
    ["+380 (67) 123-45-67", "+380671234567"],
    ["00380 67 123 45 67", "+380671234567"],
    ["079 123 45 67", "+41791234567"]
  ])("normalizes account contact %s", (input, expected) => {
    expect(accountPhoneSchema.parse(input)).toBe(expected);
  });

  it("keeps Ukrainian account contacts separate from call destinations", () => {
    expect(accountPhoneSchema.safeParse("+380671234567").success).toBe(true);
    expect(swissDestinationPhoneSchema.safeParse("+380671234567").success).toBe(false);
  });
});
