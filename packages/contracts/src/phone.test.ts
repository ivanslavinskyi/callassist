import { describe, expect, it } from "vitest";
import {
  isSwissDestinationPhone,
  normalizeSwissDestinationPhone,
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
