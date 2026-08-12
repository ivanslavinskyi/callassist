import type {
  FinalTranscriptSegment,
  TranscriptSegment
} from "@callassist/contracts";

export type FinalTranscriptTiming = {
  recordingStartedAt: string | null;
  durationSeconds?: number | null;
};

type WordToken = {
  normalized: string;
  start: number;
  end: number;
};

type StructuralEvent = {
  role: "assistant" | "recipient";
  text: string;
  eventSeconds: number;
  estimatedStartSeconds: number;
};

const wordPattern = /[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)?/gu;
const maximumAlignmentCells = 4_000_000;
const minimumMatchedTokenRatio = 0.35;

/**
 * Adds a conservative visual role/time scaffold to recording-derived text.
 * Live words are used only for deterministic alignment and are never copied
 * into the returned segments.
 */
export function structureFinalTranscript(
  recordingText: string,
  liveTranscript: TranscriptSegment[],
  timing: FinalTranscriptTiming
): FinalTranscriptSegment[] {
  const structuralEvents = buildStructuralEvents(liveTranscript, timing);
  const recordingTokens = tokenize(recordingText);
  const liveTokens = structuralEvents.flatMap((event, eventIndex) =>
    tokenize(event.text).map((token) => ({ ...token, eventIndex }))
  );

  if (
    recordingTokens.length === 0 ||
    liveTokens.length === 0 ||
    recordingTokens.length * liveTokens.length > maximumAlignmentCells
  ) {
    return [];
  }

  const tokenAssignments = alignTokens(recordingTokens, liveTokens);
  const matchedTokens = tokenAssignments.filter(
    (eventIndex) => eventIndex !== null
  ).length;
  if (
    matchedTokens < Math.min(4, recordingTokens.length) ||
    matchedTokens / recordingTokens.length < minimumMatchedTokenRatio
  ) {
    return [];
  }

  fillSafeAssignmentGaps(
    tokenAssignments,
    recordingTokens,
    liveTokens,
    structuralEvents
  );
  const groups = groupRecordingText(
    recordingText,
    recordingTokens,
    tokenAssignments
  );
  return addRolesAndTimestamps(groups, structuralEvents, timing.durationSeconds);
}

function buildStructuralEvents(
  liveTranscript: TranscriptSegment[],
  timing: FinalTranscriptTiming
) {
  if (!timing.recordingStartedAt) return [];
  const recordingStart = Date.parse(timing.recordingStartedAt);
  if (!Number.isFinite(recordingStart)) return [];

  const afterRecordingStart = liveTranscript
    .filter((segment) => segment.final && segment.text.trim())
    .map((segment) => ({
      segment,
      createdAt: Date.parse(segment.createdAt)
    }))
    .filter(
      ({ segment, createdAt }) =>
        Number.isFinite(createdAt) &&
        createdAt >= recordingStart &&
        (segment.role === "assistant" || segment.role === "recipient")
    )
    .sort((left, right) => left.createdAt - right.createdAt);

  // The synthetic DTMF consent event is stored immediately after recording
  // starts. The first assistant event marks the beginning of recorded speech.
  const firstAssistant = afterRecordingStart.findIndex(
    ({ segment }) => segment.role === "assistant"
  );
  if (firstAssistant < 0) return [];

  const events: StructuralEvent[] = afterRecordingStart
    .slice(firstAssistant)
    .map(({ segment, createdAt }) => ({
      role: segment.role as "assistant" | "recipient",
      text: segment.text,
      eventSeconds: Math.max(0, (createdAt - recordingStart) / 1_000),
      estimatedStartSeconds: 0
    }));

  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    const previous = events[index - 1];
    if (event.role === "recipient" && previous) {
      const midpoint = (previous.eventSeconds + event.eventSeconds) / 2;
      const previousSpeechEnd =
        previous.estimatedStartSeconds +
        Math.max(
          0.4,
          tokenize(previous.text).length /
            (previous.role === "assistant" ? 2.4 : 2.1)
        );
      event.estimatedStartSeconds = Math.min(
        event.eventSeconds,
        Math.max(midpoint, previousSpeechEnd)
      );
    } else {
      event.estimatedStartSeconds = event.eventSeconds;
    }
  }
  return events;
}

function tokenize(text: string): WordToken[] {
  return [...text.matchAll(wordPattern)].map((match) => ({
    normalized: normalizeWord(match[0]),
    start: match.index,
    end: match.index + match[0].length
  }));
}

function normalizeWord(word: string) {
  return word
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("und");
}

function alignTokens(
  recordingTokens: WordToken[],
  liveTokens: Array<WordToken & { eventIndex: number }>
) {
  const rows = Array.from(
    { length: recordingTokens.length + 1 },
    () => new Uint16Array(liveTokens.length + 1)
  );
  for (let recordingIndex = 1; recordingIndex <= recordingTokens.length; recordingIndex += 1) {
    for (let liveIndex = 1; liveIndex <= liveTokens.length; liveIndex += 1) {
      rows[recordingIndex][liveIndex] =
        recordingTokens[recordingIndex - 1].normalized ===
        liveTokens[liveIndex - 1].normalized
          ? rows[recordingIndex - 1][liveIndex - 1] + 1
          : Math.max(
              rows[recordingIndex - 1][liveIndex],
              rows[recordingIndex][liveIndex - 1]
            );
    }
  }

  const assignments: Array<number | null> = Array(recordingTokens.length).fill(
    null
  );
  let recordingIndex = recordingTokens.length;
  let liveIndex = liveTokens.length;
  while (recordingIndex > 0 && liveIndex > 0) {
    if (
      recordingTokens[recordingIndex - 1].normalized ===
      liveTokens[liveIndex - 1].normalized
    ) {
      assignments[recordingIndex - 1] = liveTokens[liveIndex - 1].eventIndex;
      recordingIndex -= 1;
      liveIndex -= 1;
    } else if (
      rows[recordingIndex - 1][liveIndex] >=
      rows[recordingIndex][liveIndex - 1]
    ) {
      recordingIndex -= 1;
    } else {
      liveIndex -= 1;
    }
  }
  return assignments;
}

function fillSafeAssignmentGaps(
  assignments: Array<number | null>,
  recordingTokens: WordToken[],
  liveTokens: Array<WordToken & { eventIndex: number }>,
  events: StructuralEvent[]
) {
  let start = 0;
  while (start < assignments.length) {
    if (assignments[start] !== null) {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < assignments.length && assignments[end + 1] === null) {
      end += 1;
    }

    const previous = start > 0 ? assignments[start - 1] : null;
    const next = end + 1 < assignments.length ? assignments[end + 1] : null;
    const safeEvent = safeGapEvent(
      previous,
      next,
      recordingTokens.slice(start, end + 1),
      liveTokens,
      events
    );
    if (safeEvent !== null) {
      for (let index = start; index <= end; index += 1) {
        assignments[index] = safeEvent;
      }
    }
    start = end + 1;
  }
}

function safeGapEvent(
  previous: number | null,
  next: number | null,
  gapTokens: WordToken[],
  liveTokens: Array<WordToken & { eventIndex: number }>,
  events: StructuralEvent[]
) {
  if (previous !== null && previous === next) return previous;
  if (previous === null && next !== null) return next;
  if (next === null && previous !== null) return previous;
  if (previous === null || next === null) return null;

  if (
    events[previous].role !== events[next].role &&
    gapTokens.length <= 2
  ) {
    return next;
  }

  const lower = Math.min(previous, next);
  const upper = Math.max(previous, next);
  const candidates = [...new Set(
    liveTokens
      .filter(({ eventIndex }) => eventIndex > lower && eventIndex < upper)
      .map(({ eventIndex }) => eventIndex)
  )];
  if (candidates.length === 0) {
    return events[previous].role === events[next].role ? previous : null;
  }

  const candidateRoles = new Set(candidates.map((index) => events[index].role));
  if (candidateRoles.size !== 1) return null;
  const gapWords = new Set(gapTokens.map((token) => token.normalized));
  const candidateWithOverlap = candidates.find((eventIndex) =>
    liveTokens.some(
      (token) =>
        token.eventIndex === eventIndex && gapWords.has(token.normalized)
    )
  );
  return candidateWithOverlap ?? null;
}

function groupRecordingText(
  recordingText: string,
  tokens: WordToken[],
  assignments: Array<number | null>
) {
  const groups: Array<{ eventIndex: number | null; text: string }> = [];
  let groupStart = 0;
  let eventIndex = assignments[0];
  for (let tokenIndex = 1; tokenIndex <= tokens.length; tokenIndex += 1) {
    const nextEvent = tokenIndex < tokens.length ? assignments[tokenIndex] : null;
    if (tokenIndex < tokens.length && nextEvent === eventIndex) continue;
    const characterStart = groupStart === 0 ? 0 : tokens[groupStart].start;
    const characterEnd =
      tokenIndex < tokens.length ? tokens[tokenIndex].start : recordingText.length;
    const text = recordingText.slice(characterStart, characterEnd).trim();
    if (text) groups.push({ eventIndex, text });
    groupStart = tokenIndex;
    eventIndex = nextEvent;
  }
  return groups;
}

function addRolesAndTimestamps(
  groups: Array<{ eventIndex: number | null; text: string }>,
  events: StructuralEvent[],
  durationSeconds?: number | null
) {
  const segments: FinalTranscriptSegment[] = groups.map((group, index) => {
    const event = group.eventIndex === null ? null : events[group.eventIndex];
    const previousEvent = findGroupEvent(groups, events, index, -1);
    const nextEvent = findGroupEvent(groups, events, index, 1);
    const estimatedSpeechDuration = Math.max(
      0.4,
      tokenize(group.text).length / (event?.role === "assistant" ? 2.4 : 2.1)
    );
    let startSeconds = event?.estimatedStartSeconds;
    if (startSeconds === undefined) {
      startSeconds = previousEvent
        ? previousEvent.estimatedStartSeconds + 0.2
        : nextEvent?.estimatedStartSeconds ?? 0;
    }
    startSeconds = clampTime(startSeconds, durationSeconds);
    const naturalEnd = startSeconds + estimatedSpeechDuration;
    const nextStart = nextEvent?.estimatedStartSeconds;
    const endSeconds = clampTime(
      Math.max(
        startSeconds + 0.2,
        nextStart === undefined ? naturalEnd : Math.min(naturalEnd, nextStart)
      ),
      durationSeconds
    );
    return {
      role: event?.role ?? "unknown",
      text: group.text,
      startSeconds: roundTime(startSeconds),
      endSeconds: roundTime(Math.max(startSeconds, endSeconds))
    };
  });

  return mergeAdjacentSegments(segments);
}

function findGroupEvent(
  groups: Array<{ eventIndex: number | null }>,
  events: StructuralEvent[],
  from: number,
  direction: -1 | 1
) {
  for (
    let index = from + direction;
    index >= 0 && index < groups.length;
    index += direction
  ) {
    const eventIndex = groups[index].eventIndex;
    if (eventIndex !== null) return events[eventIndex];
  }
  return null;
}

function mergeAdjacentSegments(segments: FinalTranscriptSegment[]) {
  const merged: FinalTranscriptSegment[] = [];
  for (const segment of segments) {
    const previous = merged.at(-1);
    if (previous?.role === segment.role) {
      previous.text = `${previous.text} ${segment.text}`.replace(/\s+/g, " ");
      previous.endSeconds = Math.max(previous.endSeconds, segment.endSeconds);
      continue;
    }
    merged.push({ ...segment });
  }
  return merged;
}

function clampTime(value: number, durationSeconds?: number | null) {
  if (!durationSeconds || durationSeconds <= 0) return Math.max(0, value);
  return Math.min(durationSeconds, Math.max(0, value));
}

function roundTime(value: number) {
  return Math.round(value * 100) / 100;
}
