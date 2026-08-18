import type { FinalTranscriptSegment } from "@callassist/contracts";

export type ChannelUtterance = {
  role: "assistant" | "recipient";
  startSeconds: number;
  endSeconds: number;
  wavBytes: Uint8Array;
};

type ParsedWave = {
  channelCount: number;
  sampleRate: number;
  samples: Int16Array[];
};

const frameMilliseconds = 20;
// Telephone VAD often misses quiet consonants at both edges of short replies.
// A generous bounded pad preserves "Ja"/"Nein" without changing channel role.
const speechPaddingMilliseconds = 700;
const activityMergeGapMilliseconds = 1_400;
const displayMergeGapMilliseconds = 480;
const minimumSpeechMilliseconds = 180;

/**
 * Twilio two-party dual-channel recordings place the parent/called party on
 * channel 0 and the child/CallAssist leg on channel 1 for our outbound calls.
 * The channel, never recognized wording, is the authority for the role.
 */
const roleByChannel = ["recipient", "assistant"] as const;

export function extractChannelUtterances(bytes: Uint8Array) {
  const wave = parseWave(bytes);
  if (wave.channelCount !== 2) return [];

  const ranges = wave.samples
    .flatMap((samples, channel) =>
      detectSpeechRanges(samples, wave.sampleRate).map((range) => ({
        channel,
        ...range
      }))
    )
    .sort((left, right) => left.start - right.start);
  const merged: typeof ranges = [];
  const maximumGap = Math.round(
    wave.sampleRate * activityMergeGapMilliseconds / 1_000
  );
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (
      previous?.channel === range.channel &&
      range.start - previous.end <= maximumGap
    ) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }

  const padding = Math.round(wave.sampleRate * speechPaddingMilliseconds / 1_000);
  return merged.map((range) => {
    const start = Math.max(0, range.start - padding);
    const end = Math.min(wave.samples[range.channel].length, range.end + padding);
    return {
      role: roleByChannel[range.channel],
      startSeconds: start / wave.sampleRate,
      endSeconds: end / wave.sampleRate,
      wavBytes: encodeMonoPcmWave(
        wave.samples[range.channel].subarray(start, end),
        wave.sampleRate
      )
    };
  });
}

export function mergeChannelTranscriptSegments(
  segments: FinalTranscriptSegment[]
) {
  const merged: FinalTranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (
      previous?.role === segment.role &&
      segment.startSeconds - previous.endSeconds <= displayMergeGapMilliseconds / 1_000
    ) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, " ");
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
    } else {
      merged.push({ ...segment });
    }
  }
  return merged;
}

function parseWave(bytes: Uint8Array): ParsedWave {
  if (bytes.byteLength < 44) throw new Error("WAV_INVALID");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (ascii(bytes, 0, 4) !== "RIFF" || ascii(bytes, 8, 4) !== "WAVE") {
    throw new Error("WAV_INVALID");
  }

  let format = 0;
  let channelCount = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataOffset = 0;
  let dataLength = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const id = ascii(bytes, offset, 4);
    const length = view.getUint32(offset + 4, true);
    const payload = offset + 8;
    if (payload + length > bytes.byteLength) throw new Error("WAV_INVALID");
    if (id === "fmt ") {
      if (length < 16) throw new Error("WAV_INVALID");
      format = view.getUint16(payload, true);
      channelCount = view.getUint16(payload + 2, true);
      sampleRate = view.getUint32(payload + 4, true);
      bitsPerSample = view.getUint16(payload + 14, true);
    } else if (id === "data") {
      dataOffset = payload;
      dataLength = length;
    }
    offset = payload + length + (length % 2);
  }

  if (
    channelCount < 1 ||
    channelCount > 2 ||
    sampleRate < 8_000 ||
    !dataOffset ||
    !dataLength ||
    !((format === 1 && bitsPerSample === 16) ||
      (format === 7 && bitsPerSample === 8))
  ) {
    throw new Error("WAV_UNSUPPORTED");
  }

  const bytesPerSample = bitsPerSample / 8;
  const frameCount = Math.floor(dataLength / bytesPerSample / channelCount);
  const samples = Array.from(
    { length: channelCount },
    () => new Int16Array(frameCount)
  );
  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const offset = dataOffset + (frame * channelCount + channel) * bytesPerSample;
      samples[channel][frame] =
        format === 1 ? view.getInt16(offset, true) : decodeMuLaw(bytes[offset]);
    }
  }
  return { channelCount, sampleRate, samples };
}

function detectSpeechRanges(samples: Int16Array, sampleRate: number) {
  const frameSize = Math.max(1, Math.round(sampleRate * frameMilliseconds / 1_000));
  const energies: number[] = [];
  for (let start = 0; start < samples.length; start += frameSize) {
    let sumSquares = 0;
    let peak = 0;
    const end = Math.min(samples.length, start + frameSize);
    for (let index = start; index < end; index += 1) {
      const sample = samples[index];
      sumSquares += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    energies.push(Math.max(Math.sqrt(sumSquares / Math.max(1, end - start)), peak / 3));
  }

  const sorted = [...energies].sort((left, right) => left - right);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.2)] ?? 0;
  const threshold = Math.max(220, noiseFloor * 4.5);
  const active = energies.map((energy) => energy >= threshold);
  const minimumFrames = Math.ceil(minimumSpeechMilliseconds / frameMilliseconds);

  const raw: Array<{ start: number; end: number }> = [];
  for (let index = 0; index < active.length; ) {
    if (!active[index]) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < active.length && active[index]) index += 1;
    if (index - start >= minimumFrames) raw.push({ start, end: index });
  }

  return raw.map(({ start, end }) => ({
    start: start * frameSize,
    end: Math.min(samples.length, end * frameSize)
  }));
}

function encodeMonoPcmWave(samples: Int16Array, sampleRate: number) {
  const bytes = new Uint8Array(44 + samples.byteLength);
  const view = new DataView(bytes.buffer);
  writeAscii(bytes, 0, "RIFF");
  view.setUint32(4, bytes.byteLength - 8, true);
  writeAscii(bytes, 8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(bytes, 36, "data");
  view.setUint32(40, samples.byteLength, true);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  const gain = peak > 0 ? Math.min(8, 24_000 / peak) : 1;
  for (let index = 0; index < samples.length; index += 1) {
    const normalized = Math.max(
      -32_768,
      Math.min(32_767, Math.round(samples[index] * gain))
    );
    view.setInt16(44 + index * 2, normalized, true);
  }
  return bytes;
}

function decodeMuLaw(value: number) {
  const inverted = ~value & 0xff;
  const sign = inverted & 0x80;
  const exponent = (inverted >> 4) & 0x07;
  const mantissa = inverted & 0x0f;
  const magnitude = ((mantissa << 3) + 0x84) << exponent;
  return sign ? 0x84 - magnitude : magnitude - 0x84;
}

function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.subarray(offset, offset + length));
}

function writeAscii(bytes: Uint8Array, offset: number, value: string) {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index);
  }
}
