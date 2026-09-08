import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentHangup, farewellInstructions, parseEndCallReason } from "./agent-hangup";

afterEach(() => vi.useRealTimers());
describe("AgentHangup", () => {
  function setup() {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const flow = new AgentHangup("attempt", terminate);
    flow.request("call", "objective_resolved");
    flow.bindResponse("response", 1);
    return { flow, terminate };
  }
  it("waits for the exact playback mark and terminates only once", () => {
    const { flow, terminate } = setup();
    flow.audio(8_000, "response");
    const mark = flow.responseDone("response", "completed")!;
    expect(terminate).not.toHaveBeenCalled();
    expect(flow.acknowledge("old-mark")).toBe(false);
    expect(flow.acknowledge(mark)).toBe(true);
    flow.acknowledge(mark);
    expect(terminate).toHaveBeenCalledExactlyOnceWith("objective_resolved", "playback_complete", 1);
  });
  it("invalidates cleared audio and duplicates before a fresh farewell", async () => {
    const { flow, terminate } = setup();
    flow.audio(8_000, "response");
    const stale = flow.responseDone("response", "completed")!;
    flow.interrupt();
    expect(flow.request("call", "objective_resolved")).toBe(false);
    flow.acknowledge(stale);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(terminate).not.toHaveBeenCalled();
    expect(flow.request("new-call", "recipient_requested_end")).toBe(true);
    expect(flow.bindResponse("stale", 1)).toBe(false);
    expect(flow.bindResponse("fresh", 2)).toBe(true);
  });
  it("bounds missing generation events", async () => {
    const { terminate } = setup();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(terminate).toHaveBeenCalledExactlyOnceWith("objective_resolved", "generation_timeout", 1);
  });
  it("includes previously queued summary audio in the playback deadline", async () => {
    vi.useFakeTimers();
    const terminate = vi.fn();
    const flow = new AgentHangup("attempt", terminate);
    flow.audio(40_000, "summary");
    flow.request("call", "objective_resolved");
    flow.bindResponse("farewell", 1);
    flow.audio(8_000, "farewell");
    flow.responseDone("farewell", "completed");
    await vi.advanceTimersByTimeAsync(7_999);
    expect(terminate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(terminate).toHaveBeenCalledExactlyOnceWith("objective_resolved", "playback_timeout", 1);
  });
  it.each(["cancelled", "failed", "incomplete", "completed"])("does not treat %s without audio as playback", status => {
    const { flow, terminate } = setup();
    expect(flow.responseDone("response", status)).toBeNull();
    expect(terminate).toHaveBeenCalledExactlyOnceWith("objective_resolved", "response_failed", 1);
  });
  it("clears all timers on socket closure", async () => {
    const { flow, terminate } = setup();
    flow.close();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(terminate).not.toHaveBeenCalled();
  });
  it.each(["null", "[]", "invalid", '{"reason":"unknown"}', '{"reason":"objective_resolved","providerCallId":"other"}'])("rejects malformed tool arguments %s", args => {
    expect(parseEndCallReason(args)).toBeNull();
  });
  it("accepts only the allowlisted reason", () => {
    expect(parseEndCallReason('{"reason":"recipient_requested_end"}')).toBe("recipient_requested_end");
  });
  it.each(["de-CH", "de-DE", "fr-CH", "it-CH", "en-GB", "en-US", "ru-RU"] as const)("has a bounded farewell for %s", locale => {
    const instructions = farewellInstructions(locale, false);
    expect(instructions).not.toContain("undefined");
    expect(instructions).toContain("Say exactly");
    expect(instructions.length).toBeLessThan(300);
  });
});
