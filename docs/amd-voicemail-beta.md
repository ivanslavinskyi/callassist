# AMD and voicemail beta

Implemented on `feat/gpt-live-pilot`. Real-call acceptance and production rollout
are separate gates; implementation does not certify carrier detection accuracy.
The agreed scope is in [the beta plan](amd-voicemail-beta-plan-2026-09-25.md).

Owner acceptance, 26 September: local testing reported successful, with improved
Live dialogue quality. Merge/push and production Live with fallback disabled are
authorized. This report does not establish separate measured results for every
AMD scenario; production cutover and verification remain pending.

## Call flow

Every newly approved Twilio call uses synchronous AMD before Media Streams,
OpenAI sessions, consent speech or recording. The immutable v3 execution snapshot
contains `twilio-sync-beep-v1`, the voicemail action and the exact neutral text.
The review screen displays that text in the call language. The consent announcement
still identifies the represented caller by name when a human answer is detected.

| Approved policy | Twilio configuration | Result | Application action |
| --- | --- | --- | --- |
| End without a message | `Enable`, `AsyncAmd=false` | `human` | Consent, recording, opening, selected voice runtime |
| End without a message | `Enable` | `machine_start` | Silent hangup; automatic answer, no claim of a voicemail inbox |
| Neutral message | `DetectMessageEnd` | `human` | Normal consent flow |
| Neutral message | `DetectMessageEnd` | `machine_end_beep` | One fixed `<Say>`, signed completion redirect, hangup |
| Neutral message | `DetectMessageEnd` | `machine_end_silence` | Voicemail detected, message not attempted |
| Neutral message | `DetectMessageEnd` | `machine_end_other` | Automatic answer, silent hangup |
| Either | Either | `fax`, `unknown`, invalid/missing result | Silent hangup; separate result and diagnostics |

The AMD timeout is 30 seconds. A durable job checks the same attempt 80 seconds
after reservation, allowing for ringing, AMD and the short fixed message. It also
closes an admitted human connection if no Media Stream arrived. An admitted stream
uses the existing consent and maximum-call-duration controls. A failed AMD stage
cannot activate Realtime fallback.

Voice/status/completion callbacks and Media Streams bind to the attempt, snapshot
hash and provider CallSid. Callback signature validation remains mandatory;
a supplied AccountSid must match the configured account. An early voice callback
can atomically bind the reserved attempt before the create-call REST response.
Speech claims, classification and AMD/TTS operation records commit together.
Duplicate callbacks never issue the same message again. A lost TwiML response can
therefore mean no message; automatic delivery retry is intentionally absent.

The completion redirect confirms only that Twilio passed the `<Say>` instruction.
It does not prove that voicemail saved it or that anyone heard it. Without the
redirect, terminal playback is shown as unconfirmed (or interrupted after Stop).
Late completion may refine that fact but cannot reopen audio or charge another
credit. `SipResponseCode` is diagnostic, never proof of an intentional rejection.

No greeting audio is stored and no application recording starts before consent.
Live PCMU transport, Responses delegation, appointment authorization and the
post-call transcription pipeline are unchanged. Pending consent/opening marks
are invalidated by `clear`; repeated prompts use distinct mark generations.

## UI, review and accounting

The call page, history and admin use the same lifecycle results, with all seven UI
locales. Automated calls without transcripts show the result and approved template
instead of empty transcript tabs; existing feedback remains accessible. A repeat
creates a fresh review draft, preserving the plan without a new compiler request.
The previous automated result/message status is shown before approving a repeat.
Consent, AMD permission, playback claims and tool results are never copied.

Previously approved, unstarted v1/v2 plans are copied to a new review revision on
the next approval/start request, without invoking an LLM. The old approval remains
immutable. Existing in-flight old attempts can finish under their old snapshot.

`answering_detection` and `voicemail_tts` are separate append-only provider
operations. Their costs are public-list-price estimates: AMD $0.0075/request;
Polly Standard $0.0008 per started 100-character block of the fixed template.
Issuing TwiML is not a provider invoice or delivery receipt. Actual account-level
Usage API categories `answering-machine-detection` and `amazon-polly` remain
separate from connectivity and Media Streams; parent/child totals are not added.
Call admission reserves an additional USD 0.01 for these two potential add-ons.
Unknown/incomplete provider usage retains a reserve, rather than becoming zero.
A voicemail message alone does not consume a conversation credit.

The only database change is additive migration `0084_answering_detection.sql`:
new event/operation/job CHECK values and a unique per-attempt add-on index.
No audio, phone number, names or task text are added to AMD telemetry. The existing
export, call ownership and deletion machinery includes the new call events.

## Local acceptance and deployment

1. Apply migrations before starting the new API, gateway and worker. Use the same
   revision on all processes; keep old binaries from handling new v3 calls.
2. Keep production `VOICE_RUNTIME_DRIVER=realtime` until acceptance and approval.
   Local Live acceptance uses `VOICE_RUNTIME_DRIVER=live` and
   `VOICE_RUNTIME_LIVE_FALLBACK=false` on the gateway. Realtime rollback changes
   the driver, retaining AMD and the new schema; do not downgrade the binaries.
3. Start the local app and HTTPS tunnel as described in [the Live pilot guide](gpt-live-pilot.md).
   Never reset the development DB for testing; use a dedicated local `*_test` DB
   and a consenting test recipient. Provider secrets stay in local environment.
4. Use `pnpm --filter @callassist/api drill:voice-runtime` with `VOICE_SMOKE_MODE=prepare`,
   then review the plan in the UI. `start` requires the reviewed hash/revision
   and the explicit real-call drill opt-in. See the existing drill environment
   variables in the Live guide. Set voicemail policy in the reviewed plan.
5. After the call, set `VOICE_SMOKE_MODE=verify`, the call ID, driver and one of
   `VOICE_SMOKE_SCENARIO=human|voicemail_silent|voicemail_message|unknown|fax|no_answer`.
   Human acceptance requires actual AMD admission, consent, native Live evidence
   when selected, provider usage, post-call transcription and retention completion.
   Non-human profiles require terminal provider state, refunded credit and no
   OpenAI, recording or tool side effects. Message acceptance requires exactly
   one TTS operation and the signed playback-completion fact.
6. Manually check fast human speech, delayed greeting, refusal, silence, beep,
   long greeting, Stop during detection/message, repeated callbacks, interrupted
   closing and repeat review. Repeat the human/silent/message cases for both
   drivers. Carrier AMD can misclassify; document observed results rather than
   inventing a test that bypasses the carrier.
7. Only after manual acceptance and the owner's approval merge/deploy. New
   automated checks do not replace these real-call gates.

## Implementation validation — 26 September 2026

- Full `pnpm test`: 195 files / 1,648 tests passed (API 1,221; web 291;
  contracts 136). PostgreSQL integration tests used a separate local database,
  including concurrent claims from two connections and genuine legacy v2 approval
  refresh without an LLM. No DB tests were skipped.
- `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm copy:check` and
  `git diff --check` passed. After the final retry correction, the API build and
  full test suite were repeated. The migration catalog contains 84 entries.
- Local development migration 0084 applied with zero active calls, intact old
  migration checksums and no reset. API readiness returned 200. Live is running
  with startup fallback disabled. Public ingress returns 404 for private API
  routes and 403 for unsigned Twilio callbacks. Login/registration pages rendered
  in the browser; authenticated call/admin screens remain in manual acceptance.
- Self-review covered callback binding/signatures, atomic speech admission,
  duplicate/lost/late callbacks, Stop and deadline races, playback marks cleared
  by interruption, immutable approvals, privacy and unknown usage. It caught and
  fixed retry eligibility for busy/no-answer with pending AMD. New add-on costs
  remain estimates; a returned conversation credit does not erase provider costs.
- No new real call was placed for this implementation. Carrier false-human
  detection, human greeting latency, actual voicemail playback, both voice
  runtimes and authenticated desktop/mobile UI still require the acceptance
  matrix above. Existing text fixtures reject greeting phrases containing
  yes/okay; they cannot prove that a carrier will classify audio correctly.
  Production defaults are unchanged; merge/deploy requires owner approval.

## Official references checked 26 September 2026

- [Twilio AMD protocol and parameters](https://www.twilio.com/docs/voice/answering-machine-detection)
- [AMD limitations and tuning](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices)
- [Twilio Say voices](https://www.twilio.com/docs/voice/twiml/say/text-speech)
- [Twilio list pricing](https://www.twilio.com/en-us/voice/pricing/us)
- [Call resource and callback fields](https://www.twilio.com/docs/voice/api/call-resource)
- [Usage categories](https://www.twilio.com/docs/usage/api/usage-record)

The templates and voice/language pairs are versioned application policy. Changing
either requires a new policy/SKU version and new review; never silently change
previously approved message text or historical pricing.
