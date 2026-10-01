# Live semantic consent and controlled speech — 27 September 2026

> Historical checkpoint, not the current runtime specification. As of 28 September,
> consent uses native `report_consent`, and `end_call` carries a reason without a
> scripted recap. See the [current runtime](live-unified-runtime.md) and
> [real-call review](live-call-review-2026-09-28.md). Results and pending items below
> describe the implementation at this report's date.


Branch: `codex/live-unified-runtime`. Local change; production untouched.

## Incident evidence

The local call beginning at 14:54 UTC played two disclosures. Consent was granted
at 14:54:35.030, recording began at 14:54:35.332 and the application ended the
conversation as `openai_error` at 14:54:36.931. The resulting recording was two
seconds long; both post-call transcription attempts reported empty audio. No
`end_call` or correlated rejected Live command explains this termination.

The recipient reported saying «разрешаю» before the repeated disclosure. The old
Live path used the legacy exact-phrase classifier, which does not accept that
word. Recipient pre-consent text was deliberately not persisted, so the historical
ASR rendering cannot be independently reconstructed.

The controlled-speech gate also aborted on any partial transcript that was not
an exact character prefix of its instruction, including plausible Latin/Cyrillic
name variants. This is a reproducible code defect and a plausible cause of the
early opening failure, not a proven reconstruction of this particular call.
Previously the gate did not log its failure reason; new content-free diagnostics
distinguish semantic failure, deadlines, limits and missing playback acknowledgments.

## Implementation

- Keep one native Live session/voice, original PCMU and native transcripts.
- Classify the complete consent reply against the actual spoken question through
  a silent structured Responses request using the configured delegation model
  (default GPT-6 Luna). Natural unconditional agreement is affirmative. Refusal of
  either recording or transcription is negative. Conditions, questions, unfinished
  answers, uncertainty and instructions aimed at the classifier are unclear.
- Live itself still cannot start recording or authorize actions. Only the
  application accepts the classification after verified disclosure playback.
  Recording must start successfully before task context/tools become available.
- Any new speech/transcript correction, DTMF, timeout, phase change or disconnect
  invalidates the in-flight result. Late permission cannot open the recording gate.
  Unavailability leads to clarification and existing keypad recovery, never an
  assumption of permission. Bound requests, response time, answer length and retries.
- Exact controlled text keeps the existing fast path. Settled variants are checked
  for complete equivalent meaning, allowing spelling/transliteration/paraphrase but
  preserving names, facts, AI identity and recording/transcription permissions.
  Partial text waits. Changed meaning or unverifiable content cannot advance the
  lifecycle. Ordinary conversation does not undergo this fixed-utterance check.
- Neither silence nor Responses completion substitutes for Twilio playback marks.
  Verification results are generation fenced; interruption still clears playback.
  This remains a transition gate, not a pre-playback content filter or a guarantee
  of exact speech. Post-consent recap factuality remains the backend's responsibility.
- Store no pre-consent recipient text or model explanations in logs/DB. Requests
  use `store=false`, which is not a zero-retention promise. Ledger stages
  `live_consent_classification` and `live_speech_classification` retain provider
  identifiers, numeric usage and outcomes. Unknown usage is not treated as zero.
  No schema, default runtime, old Realtime, AMD or post-call pipeline changes.

## Checks and manual acceptance

The full existing test suite passed, including isolated PostgreSQL integration
tests. After the final cancellation-budget/diagnostic changes, all 148 voice tests
passed again. Final workspace typecheck, lint and build passed (9 tasks), as did
`git diff --check`. The local API was restarted with live/fallback=false after
verifying no calls were active. API readiness and the local UI both returned 200.

Synthetic paid provider probes (no customer data or phone calls):

```powershell
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/probe-live-semantics.mts
node --use-system-ca --import ./apps/api/node_modules/tsx/dist/loader.mjs apps/api/scripts/probe-live-controlled-speech.mts
```

The semantic probe passed 36/36 cases across all seven call locales, including
colloquial Swiss German, Russian «разрешаю» and «конечно, без проблем», conditional
permission, negatives, incomplete answers, instruction injection and speech meaning
changes. Typical classification time in this run was approximately one second;
this adds latency before recording and when a controlled utterance needs semantic
verification. Initial ambiguous «я ещё не сказала “разрешаю”» was classified unclear,
which is the correct no-permission outcome; the corpus expectation was corrected
from negative to unclear without changing classifier policy.

A separate real native Live session completed all three synthetic controlled
utterances with actual PCMU and native output transcripts, totaling 22 billable
seconds. That run used the exact-text fast path. Semantic spelling variants are
covered by the real text probe and controlled-speech tests. Twilio marks in this
probe are simulated after audio duration; it is not a real telephone acceptance test.

Before rollout repeat the same telephone interview: natural agreement on the first
question; then separate negative/conditional consent tests; a corrected answer;
the full questionnaire; concise final recap; correction during recap; and completed
goodbye followed by hangup. Confirm transcript/consent timeline and ledger costs.
The historical abrupt termination is not declared fully diagnosed merely because
the new tests pass. New diagnostic codes must be checked if it recurs.

### Local call-start limit discovered during acceptance

Subsequent start requests returned HTTP 429 before creating an attempt: the local
beta recipient cap was two calls per rolling 24 hours and both had been used.
Through the existing audited beta-controls service, the local database was set to
10 starts/hour, 20/day and 10/recipient/24h for manual tests. Budget, suppression,
concurrency protections, history and production defaults remain unchanged. The
previous settings are backed up in the ignored local runtime directory. Failed
launches now focus and reveal the existing localized error instead of leaving it
above the automatically scrolled transcript. No new call was placed by this check.
