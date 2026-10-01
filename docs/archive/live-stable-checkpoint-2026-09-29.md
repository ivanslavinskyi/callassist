# Stable local Live checkpoint — 29 September 2026

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Status: accepted as the stable local implementation baseline after a real handset call.
This is implementation and local acceptance evidence, not a production deployment claim.

## Accepted call

- Call brief: `d92905bf-9d1c-4989-8d19-3d5bcc583336`
- Attempt: `d09dca49-047c-4907-a4d7-2c203d129e1a`
- Runtime: `live`, fallback disabled, `gpt-live-1`, confirmed `cedar` voice
- Call locale: `ru-RU`; detected original task language: `ru`
- Provider/call/attempt status: `completed`; no failure code
- One Live session remained continuous through startup, consent and conversation
- AMD resolved `human` in 3,057 ms after stream admission and did not revoke the active call
- Disclosure started before consent; voice consent was accepted and recording started afterwards
- First task-stage audio arrived 714 ms after the conversation transition
- `end_call` was accepted with `objective_resolved`; hangup followed the playback-complete mark
- Final transcript: `live_native`, `completed`, one immutable revision, four segments
- Final assessment: conversation `confirmed`, goal `achieved`
- Recording: stereo, 29 seconds, available under the selected seven-day retention policy
- Credit: one reservation and one charge; no refund

All nine call-bound provider operations completed successfully: the Twilio leg, Live session,
disclosure synthesis, AMD, four Live delegations and the summary. There was no `realtime.error`,
provider failure, emergency closing or unexpected session replacement. The only pending work at
inspection time was the scheduled seven-day retention job and Twilio price reconciliation; the
latter was waiting for the provider's delayed final price, not retrying a call failure.

The saved transcript matches the observed conversation: the assistant naturally asked the approved
dinner question on behalf of the represented person, captured the recipient's answer, acknowledged
it briefly, summarized the answer and ended politely. Pre-consent speech is intentionally absent
from the saved transcript.

## Stable runtime boundary

This checkpoint accepts the following behavior as the baseline:

- application-owned exact disclosure playback with a real Twilio playback mark;
- Live-native semantic consent after the completed disclosure, without word lists;
- asynchronous AMD that cannot revoke an admitted, consented conversation;
- one continuous Live session and native Responses delegation for the task;
- command-scoped Live error recovery with one retry only after an explicit rejection;
- no blind retry after an ambiguous acknowledgement timeout;
- no global hangup for late or uncorrelated Live errors;
- bounded failure speech only after current output drains and never over recipient speech;
- playback-confirmed natural closing and native-first saved transcripts;
- bounded `realtime.error` telemetry enabled by migration 0089, without provider messages or
  conversation text.

The result page offers transcript translation only when the model-detected language of the original
user task differs from the normalized call language. It does not offer a Russian-to-Russian (or
equivalent regional-tag) translation and does not run a second language detector.

## Verification at acceptance

- 129 focused Live/voice tests passed.
- 144 contract tests passed.
- API and contracts typechecks and builds passed.
- All 322 web tests, web lint, web typecheck and the production web build passed.
- Migration catalog is contiguous through `0089_realtime_error_telemetry.sql`; 0089 is applied
  locally and database readiness passed.
- Local API, web server and Twilio-only Cloudflare tunnel were running for the accepted call.

Any later change to disclosure/consent ordering, AMD admission, Live command error policy, closing,
native transcript selection or prompt/call-language translation gating must preserve this evidence
as an explicit regression baseline.

## Later consent candidate

The [consent stabilization candidate](live-consent-stabilization-2026-09-29.md) changes the
disclosure/consent boundary after this checkpoint. It is implemented and automatically verified but
is not part of this accepted stable baseline until a new real handset call passes. Use this checkpoint
and commit `4e0b6a5` as the rollback reference if that acceptance fails.
