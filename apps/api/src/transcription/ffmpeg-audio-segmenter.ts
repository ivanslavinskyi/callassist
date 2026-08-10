import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegPath from "ffmpeg-static";
import type { RecordingMedia } from "../telephony/telephony-provider";

const silenceThreshold = "-45dB";
const minimumSilenceSeconds = 0.12;
const mergeGapSeconds = 1.2;
const clipPaddingSeconds = 0.3;
const minimumClipSeconds = 2;

export type ChannelAudioSegment = {
  channel: number;
  bytes: Uint8Array;
  contentType: "audio/wav";
  fileName: string;
  startSeconds: number;
  endSeconds: number;
};

export interface RecordingAudioSegmenter {
  segment(media: RecordingMedia): Promise<ChannelAudioSegment[]>;
}

export class FfmpegRecordingAudioSegmenter
  implements RecordingAudioSegmenter
{
  readonly #ffmpegPath: string;

  constructor(binaryPath = ffmpegPath) {
    if (!binaryPath) throw new Error("FFMPEG_BINARY_NOT_AVAILABLE");
    this.#ffmpegPath = binaryPath;
  }

  async segment(media: RecordingMedia) {
    const directory = await mkdtemp(join(tmpdir(), "callassist-transcription-"));
    try {
      const inputPath = join(directory, "recording.mp3");
      await writeFile(inputPath, media.bytes, { mode: 0o600 });
      const channelPaths = await this.#splitChannels(
        inputPath,
        directory,
        media.channels === 2 ? 2 : 1
      );
      const results = await Promise.all(
        channelPaths.map((channelPath, index) =>
          this.#segmentChannel(channelPath, directory, index + 1)
        )
      );
      return results.flat().sort((left, right) =>
        left.startSeconds === right.startSeconds
          ? left.channel - right.channel
          : left.startSeconds - right.startSeconds
      );
    } finally {
      await rm(directory, { force: true, recursive: true }).catch(() => undefined);
    }
  }

  async #splitChannels(inputPath: string, directory: string, channels: 1 | 2) {
    if (channels === 1) {
      const outputPath = join(directory, "channel-1.wav");
      await this.#run([
        "-hide_banner",
        "-loglevel",
        "error",
        "-nostdin",
        "-y",
        "-i",
        inputPath,
        "-ar",
        "16000",
        "-ac",
        "1",
        "-c:a",
        "pcm_s16le",
        outputPath
      ]);
      return [outputPath];
    }

    const leftPath = join(directory, "channel-1.wav");
    const rightPath = join(directory, "channel-2.wav");
    await this.#run([
      "-hide_banner",
      "-loglevel",
      "error",
      "-nostdin",
      "-y",
      "-i",
      inputPath,
      "-filter_complex",
      "[0:a]channelsplit=channel_layout=stereo[channel1][channel2]",
      "-map",
      "[channel1]",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      leftPath,
      "-map",
      "[channel2]",
      "-ar",
      "16000",
      "-c:a",
      "pcm_s16le",
      rightPath
    ]);
    return [leftPath, rightPath];
  }

  async #segmentChannel(
    channelPath: string,
    directory: string,
    channel: number
  ) {
    const wav = await readFile(channelPath);
    const durationSeconds = wavDurationSeconds(wav);
    const stderr = await this.#run([
      "-hide_banner",
      "-nostdin",
      "-i",
      channelPath,
      "-af",
      `silencedetect=noise=${silenceThreshold}:d=${minimumSilenceSeconds}`,
      "-f",
      "null",
      "-"
    ]);
    const speechIntervals = mergeIntervals(
      speechIntervalsFromSilence(stderr, durationSeconds),
      mergeGapSeconds
    );

    return Promise.all(
      speechIntervals.map(async (interval, index) => {
        const clip = paddedClip(interval, durationSeconds);
        const outputPath = join(directory, `channel-${channel}-${index}.wav`);
        await this.#run([
          "-hide_banner",
          "-loglevel",
          "error",
          "-nostdin",
          "-y",
          "-ss",
          clip.start.toFixed(3),
          "-t",
          (clip.end - clip.start).toFixed(3),
          "-i",
          channelPath,
          "-af",
          "loudnorm=I=-18:TP=-1.5:LRA=11",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-c:a",
          "pcm_s16le",
          outputPath
        ]);
        return {
          channel,
          bytes: new Uint8Array(await readFile(outputPath)),
          contentType: "audio/wav" as const,
          fileName: `channel-${channel}-${index}.wav`,
          startSeconds: roundTime(interval.start),
          endSeconds: roundTime(interval.end)
        };
      })
    );
  }

  #run(arguments_: string[]) {
    return new Promise<string>((resolve, reject) => {
      const process = spawn(this.#ffmpegPath, arguments_, {
        stdio: ["ignore", "ignore", "pipe"],
        windowsHide: true
      });
      let stderr = "";
      process.stderr.setEncoding("utf8");
      process.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      process.once("error", reject);
      process.once("close", (code) => {
        if (code === 0) resolve(stderr);
        else reject(new Error(`FFMPEG_EXIT_${code}: ${stderr.slice(-1_000)}`));
      });
    });
  }
}

type Interval = { start: number; end: number };

export function speechIntervalsFromSilence(
  output: string,
  durationSeconds: number
) {
  const intervals: Interval[] = [];
  const expression = /silence_(start|end):\s*([0-9.]+)/g;
  let speechStart = 0;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(output))) {
    const time = Number(match[2]);
    if (!Number.isFinite(time)) continue;
    if (match[1] === "start") {
      if (time > speechStart) intervals.push({ start: speechStart, end: time });
    } else {
      speechStart = time;
    }
  }
  if (speechStart < durationSeconds) {
    intervals.push({ start: speechStart, end: durationSeconds });
  }
  return intervals.filter((interval) => interval.end - interval.start >= 0.1);
}

export function mergeIntervals(intervals: Interval[], maximumGap: number) {
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const previous = merged.at(-1);
    if (previous && interval.start - previous.end <= maximumGap) {
      previous.end = interval.end;
    } else {
      merged.push({ ...interval });
    }
  }
  return merged;
}

function paddedClip(interval: Interval, durationSeconds: number) {
  let start = Math.max(0, interval.start - clipPaddingSeconds);
  let end = Math.min(durationSeconds, interval.end + clipPaddingSeconds);
  if (end - start < minimumClipSeconds) {
    const expansion = (minimumClipSeconds - (end - start)) / 2;
    start = Math.max(0, start - expansion);
    end = Math.min(durationSeconds, end + expansion);
    if (end - start < minimumClipSeconds) {
      if (start === 0) end = Math.min(durationSeconds, minimumClipSeconds);
      else start = Math.max(0, durationSeconds - minimumClipSeconds);
    }
  }
  return { start, end };
}

function wavDurationSeconds(wav: Buffer) {
  if (wav.toString("ascii", 0, 4) !== "RIFF") {
    throw new Error("INVALID_WAV_HEADER");
  }
  let offset = 12;
  let byteRate = 0;
  let dataLength = 0;
  while (offset + 8 <= wav.length) {
    const id = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    if (id === "fmt " && size >= 16) byteRate = wav.readUInt32LE(offset + 16);
    if (id === "data") {
      dataLength = size;
      break;
    }
    offset += 8 + size + (size % 2);
  }
  if (!byteRate || !dataLength) throw new Error("INVALID_WAV_DATA");
  return dataLength / byteRate;
}

function roundTime(value: number) {
  return Math.round(value * 100) / 100;
}
