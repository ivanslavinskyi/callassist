// These are scheduling hints, never evidence or authorization to disconnect.
// Unknown expressions/languages retain the quiet-episode fallback.
export const NATIVE_COMPLETION_TIMING = { farewellQuietMs: 400, quietEpisodeMs: 6000, actionBoundaryMs: 2000 } as const;
export function hasNativeFarewellCue(text: string) {
  const tail = text.normalize("NFC").slice(-320);
  return /(?:^|[^\p{L}])(?:good[ -]?bye|bye(?:[ -]bye)?|auf\s+wiederh[öo]ren|auf\s+wiedersehen|tsch[üu]ss|au\s+revoir|bonne\s+journ[ée]e|arrivederci|buona\s+giornata|a\s+revair|sin\s+seveser|до\s+свидания|до\s+побачення|на\s+все\s+добре)[\s.!…,;:'"’”\])]*$/iu.test(tail);
}

export const NATIVE_CLOSING_REVIEW = `Closing recovery from the approved task, current action state and latest observed conversation. Silence alone is not permission to disconnect. Reuse recorded results; do not call appointment tools again merely to close.
If the task is resolved or its inability honestly explained, goodbye has been spoken and no substantive question/correction remains, call end_call with a literal observed closingQuote and the latest recipientQuote. A missing or imperfect recap or thanks is not unfinished task work and must not delay disconnection. After goodbye, do not return facts or commentary merely to improve the conclusion or repeat an answer already obtained. A reciprocal goodbye needs an updated decision, not more speech. After accepted end_call return no text.
Only BEFORE any spoken farewell, if all applicable answers and required action results are available, return the concise verified outcome and that no task question remains. Live chooses its conclusion; provide no script, tool acknowledgment or command to repeat speech. Do not call end_call before the spoken farewell.
If a substantive answer or required result is still missing, return no tool call or message; do not mistake a pause or partial answer for completion. If an unsupported success claim misleads the recipient, return only the material discrepancy for correction before closing. A finished conversation with an honestly stated unconfirmed action may use cannot_proceed; objective_resolved still requires confirmed journal state or the existing validated no-action branch. Do not reopen finished task work or fabricate success. Refusal of conversation/recording/transcription retains priority stop_and_discard.`;
