import { describe, expect, it } from "vitest";
import { formatCallTime } from "./call-time";

describe("localized call time", () => {
  const now = new Date("2026-08-17T12:00:00.000Z");
  it("formats recent calls relatively", () => {
    expect(formatCallTime("2026-08-17T10:00:00.000Z", "en", now).relative).toBe("2 hours ago");
  });
  it("uses the selected UI locale", () => {
    expect(formatCallTime("2026-08-16T12:00:00.000Z", "de", now).relative).toBe("gestern");
  });
});
