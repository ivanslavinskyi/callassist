# Native Live stabilization — 27 September 2026

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Approved scope: restore natural conversation on `codex/live-unified-runtime`.
Keep one GPT-Live-1 voice session, PCMU, application consent/authorization,
Twilio playback control, and the existing post-call assessment/transcription.

## Evidence

The local interview call ended at 14:18:59 UTC after `invalid_request_error`.
No `end_call` was accepted. The original command and detailed cause were not
retained, so a concurrency error is a hypothesis, not a verified provider cause.
The call made 26 backend requests, with repeated pairs after recipient answers.
Both transcripts contain internal waiting statements spoken by the assistant.
The unified conversation path omitted parts of the production speaking prompt.

## Implementation

1. Restore shared conversation instructions after consent: one short question,
   no automatic paraphrase after every answer, no spoken backend status.
2. Let Live initiate spoken-turn delegation. Recipient evidence may update backend
   context but must not itself launch another response. Explicit continuation is
   reserved for tool outputs and verified keypad input.
3. Keep closing evidence, corrections, consent and appointment checks application
   owned. The final concise recap remains followed by playback-confirmed goodbye.
4. Correlate errors to bounded, content-free command metadata. Recover only from
   a rejected redundant response request while another response is actually
   running, with no action replay. Unknown or essential-command failures remain
   failures; do not silently infer completion or activate another voice runtime.
5. Exercise consent boundary, native delegation, interruptions, stale tools,
   provider errors, closing and usage. Run the full repository checks and a real
   provider probe. Repeating the interview by phone remains the acceptance test.

No changes to billing criteria, transcript source selection or database schema.

## Validation

- Full suite: 1,742 tests across 201 files passed, including isolated PostgreSQL
  integration tests. Consent boundary is exercised for all seven call locales.
- Typecheck, lint and build passed. The synthetic Live/Responses provider probe returned
  one ordinary question per answer and one end_call after the final answer.
- Recovered command errors do not replay tools or invent final usage. Unknown,
  essential and repeated rejections terminate as provider failures; unconfirmed
  usage stays unconfirmed. Logs retain command IDs/types and a message fingerprint,
  never command contents or raw provider messages.
- The exact cause of the earlier invalid_request_error remains unknown. This
  change removes duplicate scheduling but does not claim that historical cause
  has been reproduced. Consent latency and voice quality need the same real
  interview repeated on this revision before production deployment.
- Local API restarted with live/fallback=false after checking that no calls were
  active. Production has not been changed.
