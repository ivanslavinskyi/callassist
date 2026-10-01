# Live consent stabilization — 29 September 2026

Status: implemented locally; automated verification passed; real handset acceptance is pending.
Rollback baseline: commit `4e0b6a5` (`Stabilize unified Live call runtime`).

## Why this change exists

The real call `e96efb8c-dc4e-4189-a333-59d8fb2daddc`, attempt
`e3918a1e-5f21-4c6a-a77b-71810dca5030`, completed its task conversation correctly but
failed to accept repeated natural Russian permission. The recipient said variants of
"разрешаю" several times; the flow repeated the disclosure and eventually required DTMF.

The durable evidence showed two protocol problems, not a Russian phrase-recognition problem:

1. GPT-Live could initiate consent delegation from its prompt while the application also sent
   `response.create` after transcript settlement. Those two owners raced.
2. A nested `response.created` cleared every pending `response.create`, function outputs were not
   correlated with errors, and an old unsettled run could block a newer answer indefinitely.

The old playback boundary also discarded all input before the final disclosure mark. That was safe
but unnatural: a recipient who understood the mandatory information and answered while the short
permission question was still ending had to repeat the answer.

## Accepted contract

The application owns privacy state and the start of recording. GPT-Live owns listening and ordinary
conversation. The Responses backend owns only semantic classification of the recipient's complete,
settled answer.

The invariant is:

1. Play a mandatory, exact localized segment containing AI identity, represented person, recording
   and automatic transcription.
2. A real, uncleared Twilio mark proves that mandatory segment played. A duration estimate never
   authorizes recording.
3. Play a separate short localized permission question.
4. If the recipient begins after the mandatory audio ended but before its mark arrives, retain the
   transcript as a provisional candidate. Apply it only after the real mark.
5. If the recipient interrupts before the mandatory segment ended, clear playback and replay only
   that mandatory segment. Do not replay the already-heard full introduction after a later answer.
6. After 900 ms of transcript/acoustic quiet, the application sends one `response.create` for the
   current answer revision. GPT-Live is explicitly instructed not to initiate consent delegation.
7. Consent delegation uses only `report_consent` and `tool_choice: "required"`. The model interprets
   meaning in the call language; the application has no affirmative/negative word lists.
8. Recording starts only after the application accepts `affirmative`. Silence, a playback estimate,
   a Live acknowledgment, willingness to talk, or DTMF before the bounded fallback cannot start it.

This follows the current OpenAI Live contract: the application configures Responses delegation,
`tool_choice: "required"` requires a tool when that delegated response runs, function calls arrive
through nested lifecycle events, and every function output is followed by `response.create`.
`response.item.create` has no separate success acknowledgment, so its `event_id`, later lifecycle
events and errors are tracked separately. Sources:

- https://developers.openai.com/api/docs/guides/live-delegation
- https://developers.openai.com/api/docs/guides/live-conversations
- https://developers.openai.com/api/docs/guides/live-prompting

## Localized mandatory segments

The same typed `Record<CallLocale, TwilioCopy>` covers every persisted call locale. The short question
is intentionally separate so an early natural answer does not require replaying identity and privacy
information.

| Locale | Mandatory segment | Short question |
| --- | --- | --- |
| `de-CH`, `de-DE` | `Guten Tag, ich bin … und rufe im Auftrag von … an. Mit Ihrer Zustimmung wird dieses Gespräch aufgenommen und automatisch transkribiert.` | `Sind Sie damit einverstanden?` |
| `fr-CH` | `Bonjour, je suis … et j’appelle au nom de …. Avec votre accord, cette conversation sera enregistrée et transcrite automatiquement.` | `Est-ce que vous m’y autorisez ?` |
| `it-CH` | `Buongiorno, sono … e chiamo per conto di …. Con il suo consenso, questa conversazione verrà registrata e trascritta automaticamente.` | `È d’accordo?` |
| `en-GB`, `en-US` | `Hello, I’m an AI assistant calling on behalf of …. With your permission, this conversation will be recorded and automatically transcribed.` | `Do you consent?` |
| `ru-RU` | `Добрый день, я … и звоню от имени …. С вашего разрешения этот разговор будет записан и автоматически расшифрован.` | `Вы разрешаете?` |

Names and grammatical gender remain runtime data. These strings are synthesized exactly; the model
does not paraphrase them.

## Protocol recovery

- Only the application's settled-answer scheduler starts consent work.
- Pending work blocks only the same current consent answer/configuration revision. A stale run cannot
  wedge a corrected answer.
- A `response.created` consumes only a known consent request or a continuation in the same delegation;
  an unrelated native task delegation does not clear it.
- `response.item.create` is tracked by `event_id` without inventing a success timeout. The next
  continuation start clears it; an explicit rejection is retried once.
- A provider/contract failure is not converted immediately into semantic `unclear`. The same settled
  answer is retried once. Only bounded exhaustion advances to the existing clarification/DTMF path.
- Safe error fields remain in durable `realtime.error` telemetry. Provider messages and recipient
  words are excluded.

## Deliberately not added

- no language-specific consent dictionaries, regexes or deterministic phrase lists;
- no second ASR or consent-classifier service;
- no scenario-specific call-plan branches;
- no recording before verified mandatory playback;
- no replay of the full identity/privacy segment after it has already completed;
- no new database state machine or migration.

## Automated evidence

- `unified-live-call.test.ts`: disclosure interruption, provisional early answers, corrections,
  semantic uncertainty, provider failure recovery, DTMF and the post-consent task lifecycle.
- Early semantic permission is exercised for all seven call locales: `de-CH`, `de-DE`, `fr-CH`,
  `it-CH`, `en-GB`, `en-US`, and `ru-RU`.
- `twilio-copy.test.ts`: complete typed locale coverage and separation of mandatory text/question.
- `openai-live-bridge.test.ts`: command-scoped errors, bounded retry and nonfatal unattributed errors.

At implementation time, the three focused suites passed 141 tests, the telemetry contract suite
passed 6 tests, and API/contracts TypeScript checking passed.

## Manual handset acceptance

Before calling this revision stable, test at least:

1. Listen to the full mandatory segment, say a natural affirmative once during the short question,
   and verify that the question/disclosure is not repeated.
2. Interrupt the mandatory segment, then stop; verify only the mandatory segment restarts and no
   recording begins early.
3. Say a natural negative/correction such as "yes, but do not record" and verify no recording.
4. Give an unclear question, then a clear spoken affirmative; verify DTMF is not required.
5. Complete a normal task and closing; verify the already-stable conversation behavior is unchanged.

Inspect `realtime.error`, provider-operation outcomes, consent method, recording start time, transcript
source and playback marks after the call. Promote this candidate to the stable checkpoint only after
that real call passes.
