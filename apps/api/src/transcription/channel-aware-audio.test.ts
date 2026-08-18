import { describe, expect, it } from "vitest";
import {
  extractChannelUtterances,
  mergeChannelTranscriptSegments
} from "./channel-aware-audio";

describe("channel-aware audio", () => {
  it("assigns outbound Twilio channels to deterministic roles", () => {
    const wave = stereoWave(8_000, 3, [
      { channel: 1, start: 0.3, end: 0.9 },
      { channel: 0, start: 1.3, end: 1.8 },
      { channel: 1, start: 2.2, end: 2.7 }
    ]);

    const utterances = extractChannelUtterances(wave);

    expect(utterances.map(({ role }) => role)).toEqual([
      "assistant",
      "recipient",
      "assistant"
    ]);
    expect(utterances[0].startSeconds).toBeLessThan(0.3);
    expect(utterances[0].endSeconds).toBeGreaterThan(0.9);
    expect(utterances.every(({ wavBytes }) => ascii(wavBytes, 0, 4) === "RIFF"))
      .toBe(true);
  });

  it("returns no structured utterances for mono audio", () => {
    expect(extractChannelUtterances(monoWave(8_000, 1))).toEqual([]);
  });

  it("merges only nearby adjacent segments of the same known role", () => {
    expect(mergeChannelTranscriptSegments([
      { role: "assistant", text: "Guten", startSeconds: 1, endSeconds: 1.4 },
      { role: "assistant", text: "Tag", startSeconds: 1.6, endSeconds: 2 },
      { role: "recipient", text: "Hallo", startSeconds: 2.1, endSeconds: 2.5 }
    ])).toEqual([
      { role: "assistant", text: "Guten Tag", startSeconds: 1, endSeconds: 2 },
      { role: "recipient", text: "Hallo", startSeconds: 2.1, endSeconds: 2.5 }
    ]);
  });
});

function stereoWave(
  sampleRate: number,
  durationSeconds: number,
  ranges: Array<{ channel: 0 | 1; start: number; end: number }>
) {
  const frames = sampleRate * durationSeconds;
  const channels = [new Int16Array(frames), new Int16Array(frames)];
  for (const range of ranges) {
    for (
      let frame = Math.floor(range.start * sampleRate);
      frame < Math.floor(range.end * sampleRate);
      frame += 1
    ) {
      channels[range.channel][frame] = Math.round(
        8_000 * Math.sin(2 * Math.PI * 220 * frame / sampleRate)
      );
    }
  }
  return pcmWave(sampleRate, channels);
}

function monoWave(sampleRate: number, durationSeconds: number) {
  return pcmWave(sampleRate, [new Int16Array(sampleRate * durationSeconds)]);
}

function pcmWave(sampleRate: number, channels: Int16Array[]) {
  const frameCount = channels[0].length;
  const bytes = new Uint8Array(44 + frameCount * channels.length * 2);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels.length, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels.length * 2, true);
  view.setUint16(32, channels.length * 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, bytes.byteLength - 44, true);
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channels.length; channel += 1) {
      view.setInt16(
        44 + (frame * channels.length + channel) * 2,
        channels[channel][frame],
        true
      );
    }
  }
  return bytes;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
