/** Probe actors only acknowledge the farewell; they never reopen the task.
 * This is an offline acceptance check, not a production speech filter. */
export function assessProbeClosing(text: string) {
  const farewells = text.match(/\b(?:good[ -]?bye|auf\s+wiederh[öo]ren)\b|до\s+свидания/giu) ?? [];
  const internalSpeech = /\bend[ _]call\b|\bexact\s+quote\s*:|\bclosingQuote\b|\brecipientQuote\b|SpawnThinking/iu.test(text);
  // Probe recipients never reopen the task. Any new words after the farewell
  // are a regression, including polite filler without an internal tool name.
  const farewell = /\b(?:good[ -]?bye|auf\s+wiederh[öo]ren)\b|до\s+свидания/iu.exec(text);
  const trailingSpeech = !!farewell && /[\p{L}\p{N}]/u.test(text.slice(farewell.index + farewell[0].length));
  return { farewellCount: farewells.length, internalSpeech, clean: !internalSpeech && !trailingSpeech && farewells.length <= 1 };
}
