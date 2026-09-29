import { afterEach, expect, it, vi } from "vitest";
import { LiveControlledSpeech } from "./live-controlled-speech";
import { speech } from "./voice-test-helpers";
import type { SemanticDecision } from "./live-semantic-gate";
afterEach(() => vi.useRealTimers());
it("withholds critical PCMU until text verification, then requires the matching playback mark", async () => {
  vi.useFakeTimers();
  const release = vi.fn(), played = vi.fn(), fail = vi.fn();
  const gate = new LiveControlledSpeech("Please confirm Tuesday.", release, played, fail, async () => "equivalent", true);
  gate.audio(speech); gate.transcript("Please confirm Tuesday.");
  expect(release).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(501);
  expect(release).toHaveBeenCalledExactlyOnceWith([speech], gate.mark);
  // Late provider text after the sealed playback boundary was not part of verified speech.
  expect(gate.transcript("An unrelated claim after the checked utterance.")).toBe(false);
  expect(played).not.toHaveBeenCalled(); gate.acknowledge(gate.mark); expect(played).toHaveBeenCalledOnce();
});
it.each(["different", "cancel"])("never releases critical audio after %s", async result => {
  vi.useFakeTimers();
  const release = vi.fn(), played = vi.fn(), fail = vi.fn();
  let resolve!: (decision: SemanticDecision) => void;
  const gate = new LiveControlledSpeech("Please confirm Tuesday.", release, played, fail,
    () => new Promise(done => { resolve = done; }), true);
  gate.audio(speech); gate.transcript("I have booked Wednesday.");
  await vi.advanceTimersByTimeAsync(501);
  if (result === "cancel") gate.cancel();
  resolve(result === "cancel" ? "equivalent" : "different"); await Promise.resolve();
  expect(release).not.toHaveBeenCalled(); expect(played).not.toHaveBeenCalled();
  expect(gate.acknowledge(gate.mark)).toBe(false);
});
function setup() {
  vi.useFakeTimers();
  const release = vi.fn(), played = vi.fn(), fail = vi.fn();
  const verify = vi.fn(async (): Promise<SemanticDecision> => "equivalent");
  const gate = new LiveControlledSpeech("Elena, may I continue?", release, played, fail, verify);
  gate.audio(speech);
  return { release, played, fail, verify, gate };
}
it("does not abort on partial transliterated text, or complete until all meaning is verified", async () => {
  const h = setup(); h.verify.mockResolvedValueOnce("incomplete");
  h.gate.transcript("Елена,"); await vi.advanceTimersByTimeAsync(501);
  expect(h.fail).not.toHaveBeenCalled(); expect(h.gate.textComplete).toBe(false);
  expect(h.release).not.toHaveBeenCalledWith([], h.gate.mark);
  h.gate.transcript(" may I continue?"); await vi.advanceTimersByTimeAsync(501);
  expect(h.release).toHaveBeenCalledWith([], h.gate.mark);
  expect(h.played).not.toHaveBeenCalled();
  expect(h.gate.acknowledge("other")).toBe(false);
  expect(h.gate.acknowledge(h.gate.mark)).toBe(true);
  expect(h.played).toHaveBeenCalledOnce();
});
it.each(["cancel", "new_text", "new_audio"])("fences late semantic equivalence after %s", async event => {
  const h = setup(); let resolve!: (decision: SemanticDecision) => void;
  h.verify.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  h.gate.transcript("Елена, may I continue?"); await vi.advanceTimersByTimeAsync(501);
  if (event === "cancel") h.gate.cancel();
  if (event === "new_text") h.gate.transcript(" I booked it already.");
  if (event === "new_audio") h.gate.audio(speech);
  resolve("equivalent"); await Promise.resolve();
  expect(h.release).not.toHaveBeenCalledWith([], h.gate.mark); expect(h.played).not.toHaveBeenCalled();
  h.gate.cancel();
});
it("requires mark acknowledgement even on exact text and diagnoses its timeout", async () => {
  const h = setup(); h.gate.transcript("Elena, may I continue?"); await vi.advanceTimersByTimeAsync(501);
  expect(h.verify).not.toHaveBeenCalled(); await vi.advanceTimersByTimeAsync(3_001);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_PLAYBACK_TIMEOUT"); expect(h.played).not.toHaveBeenCalled();
});
it("does not wait indefinitely for an incomplete transcript", async () => {
  const h = setup(); h.gate.transcript("Elena,"); await vi.advanceTimersByTimeAsync(25_001);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_DEADLINE");
});
it("bounds paid semantic checks during repeatedly interrupted output", async () => {
  const h = setup(); h.verify.mockResolvedValue("incomplete");
  for (let index = 0; index < 9; index++) {
    h.gate.transcript(" Елена"); await vi.advanceTimersByTimeAsync(501);
  }
  expect(h.verify).toHaveBeenCalledTimes(8);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_VERIFICATION_LIMIT");
});
it("recognizes complete required streaming suffix without approving prefixes of buffered commitments", async () => {
  const h = setup(); h.gate.transcript("Thank you. Elena, may I continue?");
  await vi.advanceTimersByTimeAsync(501);
  expect(h.verify).not.toHaveBeenCalled(); expect(h.release).toHaveBeenCalledWith([], h.gate.mark);
  h.gate.cancel();
  const release = vi.fn(), fail = vi.fn();
  const protectedGate = new LiveControlledSpeech("Please confirm Tuesday.", release, vi.fn(), fail, async () => "different", true);
  protectedGate.audio(speech); protectedGate.transcript("Wednesday is booked. Please confirm Tuesday.");
  await vi.advanceTimersByTimeAsync(501);
  expect(release).not.toHaveBeenCalled(); expect(fail).toHaveBeenCalled();
});
