# Post-stabilization Live call review — 30 September 2026

Status update: this call predates the subsequent [Shprohli identity implementation](live-brand-identity-2026-09-30.md).
The personal-name leak documented below is fixed in the new local candidate. Its
pronunciation and the remaining acoustic observations still need handset acceptance.

## Scope and evidence

Reviewed the latest local Twilio attempt after the orchestration stabilization:
`2b93690c-cae3-4ec6-bb14-7f760b67fe69`, brief
`d2d3c55b-4834-49e3-b4cc-95bca0a96be6`, on `codex/live-unified-runtime`.
The approved task was one Russian information question about dinner preferences.
The connected call ran from 12:36:18 to 12:37:21 Zurich (10:36:18–10:37:21 UTC).

Evidence: attempt-scoped database events, provider operation/result ledger, immutable
approved execution snapshot, saved native transcript, recording metadata, durable jobs,
assessment and API PID 1050228 log. Private extracts are ignored local artifacts in
`.tools/post-stabilization-last-call.private.json` and its diagnostic scripts/logs.
No provider audio was independently listened to during this review. Transcript timing
does not prove exact acoustic playback timing. Source hashes of all seven runtime
source files matched `.tools/live-orchestration-candidate-20260930/manifest.json`
before this documentation update. No runtime code or configuration changed here.

## Findings

The information task and application hangup succeeded. This call does not establish
full handset acceptance: there was no appointment action or reciprocal farewell.

There is no evidence of a Realtime session in this attempt. One `live_conversation`
operation used `gpt-live-1`; startup, consent and task voice diagnostics retained the
same Live session ID and confirmed `cedar`. Readiness reported `live-managed-v2`.
All nine `live_delegation` operations used `gpt-6-luna` and succeeded. The two
`gpt-4o-mini-tts` operations rendered the mandatory disclosure and permission question,
as designed. No Realtime conversation/ASR operation, provider failure, timeout or
unsettled operation was present. Event names `realtime.ready` and `realtime.voice`
remain historical shared telemetry names; they do not identify a Realtime connection.

The spoken personal name is a confirmed legacy identity leak into Live, not evidence
of a second runtime. The immutable execution snapshot contains `agentName: Sebastian`.
The current path is:

1. `apps/web/components/create-call-form.tsx` presents voice only but maps male voice
   to the legacy `sebastian` profile, and female voice to `anna`.
2. `packages/contracts/src/call-brief.ts` normalizes `agentName` from that profile's
   `displayName`; `createApprovedExecutionSnapshot` copies the name into `runtime`.
3. `apps/api/src/voice/live-conversation.ts::buildLiveInstructions` begins with
   `You are ${runtime.agentName}, an AI telephone assistant ...`.

The web-only `ASSISTANT_DISPLAY_NAME = "SHPROHLI"` changes transcript/export labels,
not the model's identity. Removing the visible name selector did not finish the runtime
identity change. The saved opening explicitly contains the Russian personal name.

The persisted first assistant sentence starts with `зовут`, missing its opening word.
The native transcript is nevertheless marked `completed`. A race at task admission or
the recording-boundary filter is plausible: natural audio outside the task phase is
discarded, and native transcript deltas starting before recording are discarded even
if delivered later. The current completeness guard tracks interrupted task playback
and controlled speech failure, not every discarded opening fragment. This evidence
does not establish whether the recipient heard a clipped opening, whether the recording
lost it, or whether only native transcription omitted it. Preserve this distinction.

Conversation quality also remains imperfect. The assistant's `Иван, угу` overlaps the
recipient's answer according to native timing. After the complete answer, it says
`Я вас понял. Одну минуту, пожалуйста.` despite a simple information task. Backend
reasoning reports `continue`, then calls `end_call` in the continuation. That extra
decision hop and processing filler are avoidable candidates for improvement; this
call contains no long stall or repeated delegation loop.

## Observed sequencing

All timestamps below are UTC on 30 September; add two hours for Zurich.

| Evidence | Time | Interpretation |
| --- | --- | --- |
| Mandatory disclosure played mark | 10:36:31.206 | Application received actual playback acknowledgement. |
| Permission question played mark | 10:36:32.919 | Separate question finished before the semantic decision. |
| `consent.granted` | 10:36:38.200 | Backend affirmative voice decision; pre-consent speech was not retained for independent review. |
| `recording.started` | 10:36:38.576 | Recording begins after authorization. |
| `conversation.started` / first audio | 10:36:38.627 / 38.668 | Application enables task; first output follows in 41 ms. |
| Final recipient answer ends, native timing | 10:37:06.996 | Dinner preference obtained. |
| Acknowledgement begins, native timing | 10:37:07.796 | 0.8 seconds after the answer. |
| Final result/closing begins, native timing | 10:37:11.596 | 4.6 seconds after the answer; 2 seconds after the filler ends. |
| Hangup requested / `end_call` accepted | 10:37:12.246 / 12.253 | Objective-resolved closing authorized. |
| Closing text ends, native timing | 10:37:17.796 | Text timing is not an acoustic playback mark. |
| `conversation.hangup: playback_complete` | 10:37:21.321 | Played closing triggers hangup, within the independent closing bound. |
| `conversation.ended: agent_hangup` | 10:37:21.345 | Application terminates the conversation. |
| Twilio `completed` | 10:37:21.833 | Provider confirms call termination; connected duration 63 seconds. |

Two `Live task decision requested` recovery logs cover answer revisions 4 and 5.
The final substantive dinner answer receives native delegation. No rejected tools,
closing interruption, closing deadline or infrastructure failure appears. The assessment
reports a confirmed conversation and achieved goal. The saved result matches the
recipient's answer; no appointment action, invented follow-up or callback was recorded.
The two-channel recording is available for 43 seconds. All three attempt-scoped durable
jobs succeeded and the connected call's credit was settled.

## Minimal follow-up

1. Make the Live instruction identity follow the product's fixed assistant identity,
   independent of legacy profile names in stored briefs and approved snapshots. Keep
   approved represented-person/recipient names and voice selection intact. Test both
   genders and historical profile IDs; do not rewrite historical approved hashes merely
   to remove a runtime persona.
2. Verify the opening against audio and task-admission timing. If confirmed, enforce
   silence until recording/task admission and make discarded task-opening fragments
   visible in capture diagnostics/completeness. Do not retain pre-consent speech to
   compensate for a boundary defect.
3. Tighten the shared semantic task-decision and backchannel contract: finish resolved
   tasks directly, acknowledge briefly, and avoid processing announcements or speaking
   over substantive recipient answers. Preserve valid waiting, clarification and
   uncertainty for every policy-allowed task; use no scenario-specific word lists.

The remaining handset acceptance must still include appointment corrections, missing
facts, recipient speech during backend execution, and a reciprocal farewell after an
authorized closing. The identity defect is proven; the opening clipping mechanism and
acoustic overlap need audio evidence before treating their causes as established.
