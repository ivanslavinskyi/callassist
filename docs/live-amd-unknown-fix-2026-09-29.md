# Inconclusive AMD correction — 29 September 2026

## Observed failure

Local real call attempt `67b89cac-ca91-41fb-a809-b0c7f87cee53` reached the handset and
started the application-rendered disclosure. The stream was admitted at 15:41:15.512 CEST
and disclosure playback started at 15:41:15.585. While the recipient listened silently,
Twilio completed asynchronous AMD at 15:41:20.547 with `AnsweredBy=unknown` and a reported
detection duration of 5,418 ms. The v2 application policy mapped every result except
`human` to `hang_up`, dispatched termination at 15:41:20.624 and lost the stream at
15:41:21.069. The provider leg itself, tunnel and signed callbacks were healthy.

`unknown` is not an automated-answer classification. It means the provider lacked enough
evidence within its thresholds; initial silence is a documented cause. In this call the
silence was normal human behavior while listening to the disclosure. The active UI's
generic machine phase made the result look stronger than the underlying evidence.

## Implemented contract

New approvals use `twilio-async-live-inconclusive-v3`:

| AMD result | Pre-consent action |
| --- | --- |
| `human` | Continue disclosure and semantic consent |
| `unknown` | Continue disclosure and semantic consent; do not record or expose task context |
| Explicit `machine_start` / compatible `machine_end_*` | Apply the approved voicemail action |
| `fax` | End the call |
| Invalid or missing result at the bounded deadline | Fail closed and end the call |

This is not a second classifier and does not tune carrier thresholds. It changes one
decision boundary: inconclusive evidence cannot terminate an already valid consent path.
The existing disclosure playback mark, semantic consent, recording admission and task
context gates remain authoritative. A real machine classified `unknown` may hear the
disclosure and consent prompt, which was already an accepted product tradeoff; it cannot
reach recording or the task without accepted semantic consent.

Policy semantics remain reproducible. Readers and Async AMD accept the preceding
`twilio-async-live-beep-v2`, but v2 keeps its terminal `unknown` behavior. Reapprove or
repeat a plan to obtain v3; no database migration is required.

## Automated and manual verification

Regression coverage now includes `unknown` during unacknowledged disclosure playback,
asserting no clear/hangup dispatch, an unchanged open Twilio stream and successful later
consent. It also covers pre-stream admission, prepared Live adoption, both runtime adapters,
provider async compatibility for v2/v3 and explicit machine/fax termination.

Before manual testing, restart the API/webhook process (and a separate worker if used) and
approve a new or repeated plan. Answer the handset and remain silent through the disclosure.
If AMD reports `unknown`, the call must stay connected and wait for a natural semantic
consent answer. Verify one recording start after affirmative consent, no task context before
it, and no `actionDispatched` answering event. Then separately recheck explicit voicemail
and fax behavior; this human-path fix does not certify carrier classification accuracy.

References: [Twilio AMD](https://www.twilio.com/docs/voice/answering-machine-detection),
[AMD FAQ and best practices](https://www.twilio.com/docs/voice/answering-machine-detection-faq-best-practices),
[Call resource parameters](https://www.twilio.com/docs/voice/api/call-resource).
