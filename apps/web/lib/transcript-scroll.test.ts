import { describe, expect, it } from "vitest";
import { isNearTranscriptBottom } from "./transcript-scroll";

describe("live transcript following", () => {
  it("continues following while the viewport is near the bottom", () => {
    expect(isNearTranscriptBottom({ scrollHeight: 1000, scrollTop: 560, clientHeight: 400 })).toBe(true);
  });

  it("pauses following when the operator scrolls up", () => {
    expect(isNearTranscriptBottom({ scrollHeight: 1000, scrollTop: 400, clientHeight: 400 })).toBe(false);
  });
});
