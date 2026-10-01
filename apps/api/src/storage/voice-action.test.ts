import { describe, expect, it } from "vitest";
import { voiceActionTransitionAllowed as allowed } from "./voice-action";

describe("one appointment recovery bounds", () => {
  it("retries a never-transmitted request once, then only checks status", () => {
    const previous = { kind: "request" as const, status: "not_sent" as const, attempt: 1 };
    expect(allowed("uncertain", "sending", previous, { ...previous, attempt: 2 })).toBe(true);
    expect(allowed("uncertain", "sending", { ...previous, attempt: 2 }, { ...previous, attempt: 3 })).toBe(false);
    expect(allowed("uncertain", "sending", { ...previous, attempt: 2 }, { ...previous, kind: "status_check", attempt: 3 })).toBe(true);
    expect(allowed("uncertain", "sending", { ...previous, attempt: 3 }, { ...previous, kind: "status_check", attempt: 4 })).toBe(false);
  });
  it("never rebooks possibly heard or legacy uncertain requests", () => {
    const retry = { kind: "request" as const, status: "not_sent" as const, attempt: 2 };
    expect(allowed("uncertain", "sending", undefined, retry)).toBe(false);
    expect(allowed("uncertain", "sending", undefined, { ...retry, kind: "status_check" })).toBe(true);
    expect(allowed("uncertain", "sending", { ...retry, status: "unacknowledged", attempt: 1 }, retry)).toBe(false);
    expect(allowed("uncertain", "confirmed", undefined, undefined)).toBe(false);
  });
  it("requires verified playback without silently changing the attempt", () => {
    const before = { kind: "status_check" as const, status: "not_sent" as const, attempt: 2 };
    expect(allowed("sending", "delivered", before, { ...before, status: "unacknowledged" })).toBe(false);
    expect(allowed("sending", "delivered", before, { ...before, status: "played", attempt: 3 })).toBe(false);
    expect(allowed("sending", "delivered", before, { ...before, status: "played" })).toBe(true);
    expect(allowed("delivered", "confirmed", before)).toBe(false);
    expect(allowed("delivered", "confirmed", { ...before, status: "played" })).toBe(true);
  });
});
