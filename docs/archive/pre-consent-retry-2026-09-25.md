# Connected telephone leg without recipient consent

During local acceptance on 25 September, the recipient declined an incoming call.
Twilio nevertheless reported `ringing`, then `in-progress`, then `completed` with
46 seconds of connected duration. The app retained two assistant consent prompts,
no recipient transcript, no consent grant, no recording and no main conversation.
The reserved application credit was refunded. No native Live conversation or
Responses delegation started: the pilot's shared Realtime consent controller was
the only voice stage reached.

The provider's `answeredBy` field was empty; AMD was not requested. A voicemail or
operator service is a plausible explanation, not a confirmed classification. A
generated assistant transcript is not evidence that a person heard that speech.
Twilio's [Call resource](https://www.twilio.com/docs/voice/api/call-resource)
explicitly allows completed calls answered by a person, IVR or voicemail. Provider
charges for the connection remain separate from returning an application credit.

## Correction

- The live activity banner describes a telephone connection without naming the
  recipient as the person who answered. Updated copy covers all seven locales.
- Repeat also covers a settled `completed` leg with lifecycle
  `consent_not_received`. It does not reinterpret this as `no-answer` or erase the
  original evidence. Explicit refusal, consent granted, a started conversation,
  substantive answer, recording or an unsettled provider attempt disallow reuse.
- Reuse creates one fresh review draft per source attempt, without another compiler
  request or automatic dialing. The existing authorization, admission and immutable
  snapshot checks apply on its eventual start. Original consent/transcript state
  does not transfer, and late source callbacks cannot modify the new draft.

Contracts cover connected/pre-consent eligibility and inconsistent evidence. Memory
and PostgreSQL integration tests cover concurrent reuse, no compiler request, fresh
review, no auto-start, late callbacks and rejection of granted/declined consent.

## Options not enabled by this correction

[Twilio AMD](https://www.twilio.com/docs/voice/answering-machine-detection) can add
human/machine/unknown classification. Synchronous detection delays TwiML while it
classifies; asynchronous detection allows the call to proceed. Neither guarantees
correct classification or replaces consent. It needs separate timing, failure,
language and provider-cost acceptance before enabling it.

A mandatory keypad confirmation would reduce ordinary voicemail false acceptance
but adds friction for every recipient. The current voice consent plus keypad
fallback remains unchanged. No new call or provider setting was changed by this
investigation; only read-only provider inspection was performed.
