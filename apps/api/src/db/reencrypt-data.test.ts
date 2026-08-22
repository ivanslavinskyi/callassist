import { describe, expect, it } from "vitest";
import {
  assertReencryptionConfirmation,
  parseReencryptionBatchSize
} from "./reencrypt-data";

describe("data re-encryption command boundary", () => {
  it("requires the exact active key ID as confirmation", () => {
    expect(() => assertReencryptionConfirmation("active-2", "active-2"))
      .not.toThrow();
    expect(() => assertReencryptionConfirmation("active-1", "active-2"))
      .toThrow("must equal the active key ID");
  });

  it("bounds the committed batch size", () => {
    expect(parseReencryptionBatchSize(undefined)).toBe(100);
    expect(parseReencryptionBatchSize("1")).toBe(1);
    expect(parseReencryptionBatchSize("500")).toBe(500);
    expect(() => parseReencryptionBatchSize("0")).toThrow("1..500");
    expect(() => parseReencryptionBatchSize("501")).toThrow("1..500");
  });
});
