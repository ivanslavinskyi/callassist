// These are scheduling hints, never evidence or authorization to disconnect.
// Unknown expressions/languages retain the quiet-episode fallback.
export const NATIVE_COMPLETION_TIMING = { farewellQuietMs: 400, quietEpisodeMs: 6000, actionBoundaryMs: 2000 } as const;
export function hasNativeFarewellCue(text: string) {
  const tail = text.normalize("NFC").slice(-320);
  return /(?:^|[^\p{L}])(?:good[ -]?bye|bye(?:[ -]bye)?|auf\s+wiederh[öo]ren|auf\s+wiedersehen|tsch[üu]ss|au\s+revoir|bonne\s+journ[ée]e|arrivederci|buona\s+giornata|a\s+revair|sin\s+seveser|до\s+свидания|до\s+побачення|на\s+все\s+добре)[\s.!…,;:'"’”\])]*$/iu.test(tail);
}

export const NATIVE_CLOSING_REVIEW = `Silent closing recovery. The conversation became quiet, but no end_call is accepted. A pause or farewell hint is NOT permission to end the call. Review the approved task, current action state and latest observed transcript.
Call end_call only if Live has ALREADY spoken the main outcome (or honest inability), thanks and goodbye, and no substantive question or correction remains. Use the actual closingQuote and latest recipientQuote, even after a reciprocal goodbye. Preserve appointment result requirements.
If Live asked a question, is awaiting an answer, has not finished its conclusion, or the task is still open, return no tool call and no spoken message. Do not supply a script, repeat any request or farewell, acknowledge this review, or start other task work. A recording/conversation refusal retains priority stop_and_discard. This review itself grants no action or disconnection permission.`;
