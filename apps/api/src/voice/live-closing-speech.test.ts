import { afterEach, expect, it, vi } from "vitest";
import { LiveClosingSpeech } from "./live-closing-speech";
import type { SemanticDecision } from "./live-semantic-gate";
import { silence, speech } from "./voice-test-helpers";

const gates: LiveClosingSpeech[] = [];
afterEach(() => { gates.splice(0).forEach(gate => gate.cancel()); vi.useRealTimers(); });
function harness(ready = true) {
  vi.useFakeTimers();
  const release = vi.fn(), mark = vi.fn(), played = vi.fn(), fail = vi.fn();
  const verify = vi.fn<(text: string, signal: AbortSignal) => Promise<SemanticDecision>>(async () => "equivalent");
  const gate = new LiveClosingSpeech(release, mark, played, fail, verify); gates.push(gate);
  if (ready) gate.backendCompleted();
  const say = (text = "Thank you. Goodbye.") => { gate.transcript(text); gate.audio(speech); };
  return { gate, release, mark, played, fail, verify, say };
}
it("streams Live's own words, requires semantic completion and the exact playback mark", async () => {
  const h = harness(); h.say();
  expect(h.release).toHaveBeenCalledWith(speech);
  expect(h.gate.acknowledge("invented")).toBe(false);
  await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledWith("Thank you. Goodbye.", expect.any(AbortSignal));
  expect(h.played).not.toHaveBeenCalled();
  expect(h.gate.acknowledge(h.mark.mock.calls[0][0])).toBe(true);
  expect(h.gate.acknowledge(h.mark.mock.calls[0][0])).toBe(false);
  expect(h.played).toHaveBeenCalledOnce();
});
it.each(["incomplete", "different", "unclear"] as const)("silence cannot authorize hangup after %s", async decision => {
  const h = harness(); h.verify.mockResolvedValue(decision); h.say("Let me explain the next step.");
  await vi.advanceTimersByTimeAsync(701);
  expect(h.mark).not.toHaveBeenCalled(); expect(h.played).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(h.fail).toHaveBeenCalledWith({ incomplete: "LIVE_CLOSING_NO_PROGRESS", different: "LIVE_CLOSING_CONTINUING", unclear: "LIVE_CLOSING_UNCLEAR" }[decision]);
});
it("silence or text alone cannot authorize playback completion", async () => {
  const h = harness(); h.gate.audio(silence); h.gate.transcript("Goodbye.");
  await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).not.toHaveBeenCalled(); expect(h.mark).not.toHaveBeenCalled();
});
it("ignores continuous silence packets when detecting a candidate farewell", async () => {
  const h = harness(); h.say();
  for (let i = 0; i < 40; i++) { h.gate.audio(silence); await vi.advanceTimersByTimeAsync(20); }
  expect(h.mark).toHaveBeenCalledOnce(); expect(h.verify).toHaveBeenCalledOnce();
});
it.each(["audio", "text"])("invalidates an issued mark when later %s arrives", async kind => {
  const h = harness(); h.say(); await vi.advanceTimersByTimeAsync(701);
  const old = h.mark.mock.calls[0][0];
  if (kind === "audio") h.gate.audio(speech); else h.gate.transcript(" One more thing.");
  expect(h.gate.acknowledge(old)).toBe(false);
  h.verify.mockResolvedValue("incomplete"); await vi.advanceTimersByTimeAsync(701);
  expect(h.mark).toHaveBeenCalledOnce(); expect(h.played).not.toHaveBeenCalled();
});
it.each(["interrupt", "new_speech"])("ignores an in-flight positive classification after %s", async change => {
  const h = harness(); let resolve!: (decision: SemanticDecision) => void;
  h.verify.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  h.say(); await vi.advanceTimersByTimeAsync(701);
  if (change === "interrupt") h.gate.cancel(); else h.gate.audio(speech);
  resolve("equivalent"); await Promise.resolve();
  expect(h.verify.mock.calls[0][1].aborted).toBe(true);
  expect(h.mark).not.toHaveBeenCalled(); expect(h.played).not.toHaveBeenCalled();
});
it("requires a fresh mark after resumed speech and rejects marks from cancelled closings", async () => {
  const h = harness(); h.say(); await vi.advanceTimersByTimeAsync(701);
  const old = h.mark.mock.calls[0][0]; h.say(" Take care."); await vi.advanceTimersByTimeAsync(701);
  const fresh = h.mark.mock.calls[1][0]; expect(fresh).not.toBe(old);
  expect(h.gate.acknowledge(old)).toBe(false); h.gate.cancel();
  expect(h.gate.acknowledge(fresh)).toBe(false); expect(h.played).not.toHaveBeenCalled();
});
it("bounds missing playback acknowledgement and never reports success", async () => {
  const h = harness(); h.say(); await vi.advanceTimersByTimeAsync(4_000);
  expect(h.fail).toHaveBeenCalledWith("LIVE_CLOSING_PLAYBACK_TIMEOUT");
  expect(h.played).not.toHaveBeenCalled();
});

it("does not classify a pre-result acknowledgment until the closing continuation completes", async () => {
  const h = harness(false); h.say("Understood.");
  await vi.advanceTimersByTimeAsync(1_000);
  expect(h.verify).not.toHaveBeenCalled();
  h.gate.backendCompleted(); h.say(" Goodbye.");
  await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledOnce(); expect(h.mark).toHaveBeenCalledOnce();
});
it("waits for changed text after incomplete speech instead of checking it repeatedly", async () => {
  const h = harness(); h.verify.mockResolvedValue("incomplete"); h.say("Thanks.");
  await vi.advanceTimersByTimeAsync(701);
  h.gate.audio(speech); await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledOnce();
  h.verify.mockResolvedValue("equivalent"); h.say(" Goodbye.");
  await vi.advanceTimersByTimeAsync(701);
  expect(h.mark).toHaveBeenCalledOnce();
});
it("allows at most two checks including cancelled work and never overlaps them", async () => {
  const h = harness(); let resolve!: (decision: SemanticDecision) => void;
  h.verify.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  h.say(); await vi.advanceTimersByTimeAsync(701);
  h.say(" Take care."); await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledOnce();
  resolve("equivalent"); await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledTimes(2);
  h.say(" Goodbye."); await vi.advanceTimersByTimeAsync(701);
  expect(h.verify).toHaveBeenCalledTimes(2);
  expect(h.fail).toHaveBeenCalledWith("LIVE_CLOSING_VERIFICATION_LIMIT");
});
