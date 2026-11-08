import { afterEach, expect, it, vi } from "vitest";
import { LiveNativeClosing, closingEvidence } from "./live-native-closing";
import { speech, silence } from "./voice-test-helpers";

afterEach(() => vi.useRealTimers());
it("compares closing words independently of ASR sentence punctuation without losing numbers or negation",()=>{
  expect(closingEvidence("Ja Pizza Margherita Danke Auf Wiederhören")).toBe(closingEvidence("Ja. Pizza. Margherita. Danke. Auf Wiederhören."));
  expect(closingEvidence("It is not booked.")).not.toBe(closingEvidence("It is booked."));
  expect(closingEvidence("At 15:30.")).not.toBe(closingEvidence("At 15:00."));
  expect(closingEvidence("Price 1.5")).not.toBe(closingEvidence("Price 15"));
  expect(closingEvidence("Slavinskyi")).not.toBe(closingEvidence("Slavinsky"));
});
function fixture() {
  vi.useFakeTimers();
  const ports = { mark: vi.fn(), drained: vi.fn(), failed: vi.fn() };
  return { ports, closing: new LiveNativeClosing(ports) };
}
it("requires new voiced audio, captions, quiet tail, a real mark and a final guard", async () => {
  const { closing, ports } = fixture();
  closing.request(); closing.caption("Goodbye.");
  for (let i = 0; i < 100; i++) closing.audio(silence);
  await vi.advanceTimersByTimeAsync(2_000); expect(ports.mark).not.toHaveBeenCalled();
  closing.audio(speech);
  await vi.advanceTimersByTimeAsync(1_499); expect(ports.mark).not.toHaveBeenCalled();
  closing.audio(silence);
  await vi.advanceTimersByTimeAsync(1); expect(ports.mark).toHaveBeenCalledOnce();
  closing.acknowledge(ports.mark.mock.calls[0][0]);
  await vi.advanceTimersByTimeAsync(349); expect(ports.drained).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1); expect(ports.drained).toHaveBeenCalledOnce();
});
it.each(["audio", "caption", "input", "clear"])("revokes the pending mark on %s", async kind => {
  const { closing, ports } = fixture(); closing.request(); closing.audio(speech); closing.caption("Goodbye.");
  await vi.advanceTimersByTimeAsync(1_500);
  const mark = ports.mark.mock.calls[0][0];
  if (kind === "audio") closing.audio(speech);
  if (kind === "caption") closing.caption("One more thing.");
  if (kind === "input") closing.activity("started");
  if (kind === "clear") closing.cancel();
  closing.acknowledge(mark); await vi.advanceTimersByTimeAsync(500);
  expect(ports.drained).not.toHaveBeenCalled();
});
it("ignores a cleared mark even after a new closing request", async () => {
  const { closing, ports } = fixture(); closing.request(); closing.audio(speech); closing.caption("Bye.");
  await vi.advanceTimersByTimeAsync(1_500); const old = ports.mark.mock.calls[0][0];
  closing.cancel(); closing.request(); closing.audio(speech); closing.caption("Bye again.");
  await vi.advanceTimersByTimeAsync(1_500); closing.acknowledge(old);
  await vi.advanceTimersByTimeAsync(350); expect(ports.drained).not.toHaveBeenCalled();
  closing.acknowledge(ports.mark.mock.calls[1][0]); await vi.advanceTimersByTimeAsync(350);
  expect(ports.drained).toHaveBeenCalledOnce();
});
it("does not treat a silent or unacknowledged timeout as successful playback", async () => {
  const { closing, ports } = fixture(); closing.request();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(ports.failed).toHaveBeenCalledWith("LIVE_NATIVE_CLOSING_TIMEOUT");
  expect(ports.drained).not.toHaveBeenCalled();
});
it("revokes a mark acknowledged immediately before late recipient activity", async () => {
  const { closing, ports } = fixture(); closing.request(); closing.audio(speech); closing.caption("Bye.");
  await vi.advanceTimersByTimeAsync(1_500); closing.acknowledge(ports.mark.mock.calls[0][0]);
  await vi.advanceTimersByTimeAsync(300); closing.activity("started");
  await vi.advanceTimersByTimeAsync(100); expect(ports.drained).not.toHaveBeenCalled();
});
