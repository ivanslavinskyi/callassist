import { afterEach, expect, it, vi } from "vitest";
import { LiveControlledSpeech } from "./live-controlled-speech";
import { silence, speech } from "./voice-test-helpers";
import type { SemanticDecision } from "./live-semantic-gate";
afterEach(() => vi.useRealTimers());
it("holds an already verified commitment through energy-only input until quiet, without replaying it", async () => {
  vi.useFakeTimers();
  const release = vi.fn(), played = vi.fn(), fail = vi.fn();
  const gate = new LiveControlledSpeech("Please confirm Tuesday.", release, played, fail, async () => "equivalent", true);
  gate.audio(speech); gate.transcript("Please confirm Tuesday."); gate.inputActivity("started");
  await vi.advanceTimersByTimeAsync(600);
  expect(release).not.toHaveBeenCalled(); expect(fail).not.toHaveBeenCalled();
  gate.inputActivity("stopped"); await vi.advanceTimersByTimeAsync(501);
  expect(release).toHaveBeenCalledExactlyOnceWith([speech], gate.mark);
  gate.acknowledge(gate.mark); expect(played).toHaveBeenCalledOnce();
});
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
it("never accepts a playback mark after Twilio cleared the controlled utterance", async () => {
  const h = setup();
  h.gate.transcript("Elena, may I continue?");
  await vi.advanceTimersByTimeAsync(501);
  h.gate.playbackCleared();
  expect(h.gate.acknowledge(h.gate.mark)).toBe(false);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_PLAYBACK_CLEARED");
  expect(h.played).not.toHaveBeenCalled();
});
it("recovers an incomplete exact prefix after Live output becomes idle", async () => {
  const h = setup(); h.gate.transcript("Elena,");
  await vi.advanceTimersByTimeAsync(1_199); expect(h.fail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_OUTPUT_STALLED");
});
it("treats every output audio delta as progress while an incomplete utterance is pending", async () => {
  const h = setup(); h.gate.transcript("Elena,");
  await vi.advanceTimersByTimeAsync(1_000); h.gate.audio(silence);
  await vi.advanceTimersByTimeAsync(1_000); expect(h.fail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(201);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_OUTPUT_STALLED");
});
it("does not recover stalled output while the recipient is speaking", async () => {
  const h = setup(); h.gate.transcript("Elena,"); h.gate.inputActivity("started");
  await vi.advanceTimersByTimeAsync(5_000); expect(h.fail).not.toHaveBeenCalled();
  h.gate.inputActivity("stopped");
  await vi.advanceTimersByTimeAsync(1_199); expect(h.fail).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2);
  expect(h.fail).toHaveBeenCalledWith("LIVE_SPEECH_OUTPUT_STALLED");
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

it("requires the whole generated utterance for a dynamic disclosure", async () => {
  vi.useFakeTimers();
  const release = vi.fn(), fail = vi.fn();
  const gate = new LiveControlledSpeech("Nina Keller, may I continue?", release, vi.fn(), fail,
    async () => "different", false, undefined, true);
  gate.audio(speech);
  gate.transcript("Unapproved preface. Nina Keller, may I continue?");
  await vi.advanceTimersByTimeAsync(501);
  // Dynamic disclosure audio is intentionally streamed for natural latency.
  // The accepted compromise is that a mismatch blocks the consent transition;
  // already-played audio cannot be recalled.
  expect(release).toHaveBeenCalledWith([speech], null);
  expect(release).not.toHaveBeenCalledWith([], gate.mark);
  expect(fail).toHaveBeenCalledWith("LIVE_SPEECH_MEANING_UNVERIFIED");
});
