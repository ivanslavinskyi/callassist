import { describe, expect, it } from "vitest";
import {
  mergeIntervals,
  speechIntervalsFromSilence
} from "./ffmpeg-audio-segmenter";

describe("post-call voice activity segmentation", () => {
  it("derives speech from ffmpeg silence events", () => {
    const output = [
      "silence_start: 0",
      "silence_end: 1.8 | silence_duration: 1.8",
      "silence_start: 4.2",
      "silence_end: 8.4 | silence_duration: 4.2",
      "silence_start: 8.9",
      "silence_end: 10 | silence_duration: 1.1"
    ].join("\n");
    expect(speechIntervalsFromSilence(output, 12)).toEqual([
      { start: 1.8, end: 4.2 },
      { start: 8.4, end: 8.9 },
      { start: 10, end: 12 }
    ]);
  });

  it("merges natural pauses but preserves separate turns", () => {
    expect(
      mergeIntervals(
        [
          { start: 1, end: 2 },
          { start: 2.5, end: 4 },
          { start: 7, end: 8 }
        ],
        1.2
      )
    ).toEqual([
      { start: 1, end: 4 },
      { start: 7, end: 8 }
    ]);
  });
});
