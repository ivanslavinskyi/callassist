import { describe, expect, it } from "vitest";
import { callActivityPhase } from "./call-activity";

describe("call activity feedback", () => {
  it("shows request progress before a provider response without claiming the phone is ringing", () => {
    expect(callActivityPhase("review_required", true, "connected")).toBe("starting");
    expect(callActivityPhase("ready", true, "reconnecting")).toBe("starting");
  });
  it("uses phone status, rather than the live-update connection, to indicate a call", () => {
    expect(callActivityPhase("ready", false, "connected")).toBeNull();
    expect(callActivityPhase("review_required", false, "connected")).toBeNull();
    expect(callActivityPhase("dialing", false, "connected")).toBe("dialing");
    expect(callActivityPhase("in_progress", false, "connected")).toBe("connected");
    expect(callActivityPhase("awaiting_approval", false, "connected")).toBe("approval");
  });
  it("stops claiming live activity when updates are unavailable", () => {
    expect(callActivityPhase("dialing", false, "connecting")).toBe("reconnecting");
    expect(callActivityPhase("in_progress", false, "reconnecting")).toBe("reconnecting");
  });
  it.each(["completed", "stopped", "failed"] as const)("removes activity for %s even while the start response is pending", (status) => {
    expect(callActivityPhase(status, true, "connected")).toBeNull();
    expect(callActivityPhase(status, false, "reconnecting")).toBeNull();
  });
  it("returns to the plan when the start request fails", () => {
    expect(callActivityPhase("review_required", false, "connected")).toBeNull();
    expect(callActivityPhase("blocked", false, "connected")).toBeNull();
  });
});
