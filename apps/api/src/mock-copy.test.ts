import { describe, expect, it } from "vitest";
import { getMockCopy } from "./mock-copy";

describe("getMockCopy", () => {
  it("uses the represented person supplied by the call brief", () => {
    const greeting = getMockCopy("en-GB", "Nina Keller").greeting;
    expect(greeting).toContain("Nina Keller");
    expect(greeting).not.toContain("Ivan Slavinskyi");
  });
});
