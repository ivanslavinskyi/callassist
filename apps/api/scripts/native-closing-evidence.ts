/** Probe actors only acknowledge the farewell; they never reopen the task.
 * This is an offline acceptance check, not a production speech filter. */
export function assessProbeClosing(text: string) {
  const farewells = text.match(/\b(?:good[ -]?bye|auf\s+wiederh[öo]ren)\b|до\s+свидания/giu) ?? [];
  const internalSpeech = /\bend[ _]call\b|\bexact\s+quote\s*:|\bclosingQuote\b|\brecipientQuote\b|SpawnThinking/iu.test(text);
  return { farewellCount: farewells.length, internalSpeech, clean: !internalSpeech && farewells.length <= 1 };
}
