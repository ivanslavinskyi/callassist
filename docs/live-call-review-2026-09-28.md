# Live consent and closing: local call review, 28 September 2026

Branch: `codex/live-unified-runtime`. Current implementation:
[unified Live runtime](live-unified-runtime.md). This is local real-call evidence,
not a production deployment or an acceptance rate across scenarios/languages.

## Scope and evidence

Latest call at review time:

- Call brief: `8b13cb16-d9a6-44dc-9f75-4df59872229e`.
- Attempt: `61118399-afd5-4f66-b27c-56dfe58eab26`.
- 28 September, 09:11:01–09:11:58 UTC / 11:11:01–11:11:58 Europe/Zurich.
- German (`de-CH`) information request: ask the recipient's lunch preference.
- Local API used Live with fallback disabled; `realtime.ready` records
  `gpt-live-1` and `runtimeVersion=live-managed-v1`.

Reviewed durable lifecycle events, content-free API consent logs, provider-operation
results, native transcript fragments, the separately generated recording-based final
transcript, the approved execution plan and the final assessment. Audio was not
independently listened to during this review. No extra call, transcription request,
recording download, runtime change or production action was performed for this review.
Personal names and phone numbers are omitted here.

## Observed sequence

Times below are UTC; add two hours for Zurich on this date.

| Time | Evidence | Meaning |
| --- | --- | --- |
| 09:11:05.167 | `realtime.ready` | Prepared Live session ready before human admission |
| 09:11:09.135 | `connection.confirmed` | Telephone connected; this alone is not consent |
| 09:11:14.107 | AMD `human`, 4,935 ms | Human answering decision |
| 09:11:14.860 | `streamAdmitted=true` | Signed stream admitted |
| 09:11:16.693 | `disclosure.started` | First disclosure audio |
| 09:11:28.661 | Log: `affirmative`, `stage=initial` | Native consent decision accepted on the first question |
| 09:11:28.662 | `consent.granted`, `method=voice` | Voice consent persisted; no keypad grant |
| 09:11:29.004 | `recording.started` | Recording began 342 ms after consent |
| 09:11:29.033 | `conversation.started` | Recording startup succeeded and opening phase began |
| 09:11:49.304 | Hangup requested, `objective_resolved` | Application accepted the backend completion decision |
| 09:11:57.774 | Hangup `playback_complete` | Matching farewell playback acknowledged |
| 09:11:57.810 | `conversation.ended=agent_hangup` | Normal application-initiated end |
| 09:11:58.107 | Provider `completed` | Telephone leg ended |
| 09:12:05.947 | `transcription.completed` | Recording-derived final transcript ready |
| 09:12:12.141 | `credit.settled=charge` | Normal charge; the completed assessment supports an achieved task result |

The record contains one disclosure start and no consent failure or repeated consent
question. Consent-stage text is deliberately not retained, so this review cannot quote
the exact spoken permission. The saved later “Ja” is a readiness answer after recording
started, not evidence of the original consent wording.

Three `live_delegation` operations succeeded: the consent decision (774 ms), its
continuation (639 ms), and task completion (1,390 ms). The single
`live_closing_classification` succeeded in 1,635 ms. There were no separate
`live_consent_classification` operations, no failed provider operations in this call's
ledger, and no recorded fallback or `openai_error` ending. The 30-second, two-channel
recording and final summary both completed successfully.

## Conversation and comparison

Both the native transcript and recording-derived ASR contain the task answer
“Ich möchte Pizza.” The assistant's final recorded passage is:

> Einen Moment bitte. Alles klar. Ich habe notiert, Pizza zum Mittagessen.
> Danke, auf Wiederhören.

The approved plan still prohibits ordering or making further agreements. The assistant
did not recite that prohibition, promise to place an order, or claim an order had been
completed. It stated the lunch preference once in its closing and said goodbye once.
The earlier unnecessary sentence about not placing orders is absent in both transcript
sources. The final assessment marks the information-request goal achieved, citing the
actual question and answer; it lists no next steps or unresolved items.

This supports the user's report that the latest call is better: first-question voice
consent, a useful task answer and one natural closing all worked together through the
real telephone path. Successful transport completion alone was not used to infer success.

## Remaining observations and limits

- “Einen Moment bitte” remains an unnecessary filler before the closing. It precedes
  the completion delegation and adds no useful outcome information. The architecture
  avoids a forced recap, but does not guarantee that Live never produces filler.
- Pickup-to-disclosure was about 7.56 seconds, including 4.94 seconds of synchronous
  AMD. Prewarming succeeded but does not eliminate the answering-detection delay.
- Native fragment order puts the readiness “Ja” after the next question; channel-based
  final ASR places it with the readiness exchange, with overlapping time ranges. Native
  transcript fragments should not be treated as exact turn boundaries.
- This was an uncomplicated information request. It does not validate interrupted
  consent/farewell, background speech, all supported languages, appointment actions,
  voicemail or every provider-failure path.

## Implementation and verification boundary

Current consent is `report_consent({ decision: affirmative | negative | unclear })`
through managed Responses delegation. Only the app starts recording, after disclosure
verification/playback and a current affirmative result. Corrected or stale decisions
cannot acquire fresh evidence by continuing an old delegation. Task tools and execution
context remain unavailable until recording and opening playback succeed. Unclear
decisions use controlled localized clarification and optional keypad recovery; spoken
agreement remains available at each stage.

Current closing is `end_call({ reason })`. Live chooses the wording; the application
checks state/evidence, verifies semantic farewell completion and waits for the matching
uncleared playback mark. An interruption cancels the closing and requires fresh
authorization. No scenario-specific phrase rule was added for this lunch call.

The preceding implementation checkpoint passed 161 focused voice/accounting tests and
API TypeScript checking. Real API synthetic probes covered “Ja, gerne”, “Ja”, refusal,
unclear followed by spoken yes, and a full information call through simulated hangup.
Those are dated checks, not a new full-workspace run during this documentation update.
This review only read call evidence and synchronized documentation; broader release
acceptance and production rollout remain separate.
