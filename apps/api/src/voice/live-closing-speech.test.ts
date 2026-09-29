import { afterEach, expect, it, vi } from "vitest";
import { LiveClosingSpeech } from "./live-closing-speech";
import { silence, speech } from "./voice-test-helpers";

const gates: LiveClosingSpeech[] = [];
afterEach(() => { gates.splice(0).forEach(gate => gate.cancel()); vi.useRealTimers(); });

function harness(ready = true) {
  vi.useFakeTimers();
  const release = vi.fn(), mark = vi.fn(), played = vi.fn(), fail = vi.fn();
  const gate = new LiveClosingSpeech(release, mark, played, fail);
  gates.push(gate);
  if (ready) gate.backendCompleted();
  const say = (text = "The appointment is confirmed for Tuesday. Thank you, goodbye.") => {
    gate.transcript(text);
    gate.audio(speech);
  };
  return { gate, release, mark, played, fail, say };
}

it("streams Live's closing and requires its exact playback mark", async () => {
  const h = harness();
  h.say();
  expect(h.release).toHaveBeenCalledWith(speech);
  expect(h.gate.acknowledge("invented")).toBe(false);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(h.mark).toHaveBeenCalledOnce();
  expect(h.played).not.toHaveBeenCalled();
  expect(h.gate.acknowledge(h.mark.mock.calls[0][0])).toBe(true);
  expect(h.gate.acknowledge(h.mark.mock.calls[0][0])).toBe(false);
  expect(h.played).toHaveBeenCalledOnce();
});

it("requires both voiced audio and transcript before issuing a mark", async () => {
  const silent = harness();
  silent.gate.transcript("Goodbye.");
  silent.gate.audio(silence);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(silent.mark).not.toHaveBeenCalled();

  silent.gate.audio(speech);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(silent.mark).toHaveBeenCalledOnce();

  const audioOnly = harness();
  audioOnly.gate.audio(speech);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(audioOnly.mark).not.toHaveBeenCalled();
});

it("waits for backend completion before treating output as the terminal turn", async () => {
  const h = harness(false);
  h.say("Understood.");
  await vi.advanceTimersByTimeAsync(2_000);
  expect(h.mark).not.toHaveBeenCalled();
  h.gate.backendCompleted();
  await vi.advanceTimersByTimeAsync(1_001);
  expect(h.mark).toHaveBeenCalledOnce();
});

it("ignores continuous silence packets when detecting the end of closing speech", async () => {
  const h = harness();
  h.say();
  for (let index = 0; index < 60; index++) {
    h.gate.audio(silence);
    await vi.advanceTimersByTimeAsync(20);
  }
  expect(h.mark).toHaveBeenCalledOnce();
});

it.each(["audio", "text"])("invalidates an issued mark and requires a fresh one when later %s arrives", async kind => {
  const h = harness();
  h.say();
  await vi.advanceTimersByTimeAsync(1_001);
  const old = h.mark.mock.calls[0][0];
  if (kind === "audio") h.gate.audio(speech);
  else h.gate.transcript(" One more relevant detail.");
  expect(h.gate.acknowledge(old)).toBe(false);
  await vi.advanceTimersByTimeAsync(1_001);
  expect(h.mark).toHaveBeenCalledTimes(2);
  const fresh = h.mark.mock.calls[1][0];
  expect(fresh).not.toBe(old);
  expect(h.gate.acknowledge(fresh)).toBe(true);
  expect(h.played).toHaveBeenCalledOnce();
});

it("rejects marks from a cancelled closing", async () => {
  const h = harness();
  h.say();
  await vi.advanceTimersByTimeAsync(1_001);
  const pending = h.mark.mock.calls[0][0];
  h.gate.cancel();
  expect(h.gate.acknowledge(pending)).toBe(false);
  expect(h.played).not.toHaveBeenCalled();
});

it("invalidates cleared playback and reports recovery without changing task semantics", async () => {
  const h = harness();
  h.say();
  await vi.advanceTimersByTimeAsync(1_001);
  const pending = h.mark.mock.calls[0][0];
  h.gate.playbackCleared();
  expect(h.gate.acknowledge(pending)).toBe(false);
  expect(h.fail).toHaveBeenCalledWith("LIVE_CLOSING_PLAYBACK_CLEARED");
  expect(h.played).not.toHaveBeenCalled();
});

it("bounds missing playback acknowledgement and never reports success", async () => {
  const h = harness();
  h.say();
  await vi.advanceTimersByTimeAsync(4_100);
  expect(h.fail).toHaveBeenCalledWith("LIVE_CLOSING_PLAYBACK_TIMEOUT");
  expect(h.played).not.toHaveBeenCalled();
});

it("fails when an authorized closing never produces usable output", async () => {
  const h = harness();
  await vi.advanceTimersByTimeAsync(3_001);
  expect(h.fail).toHaveBeenCalledWith("LIVE_CLOSING_NO_PROGRESS");
  expect(h.mark).not.toHaveBeenCalled();
});
