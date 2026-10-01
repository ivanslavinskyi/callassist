# Consistent short assistance disclosure implementation plan

Date: 30 September 2026. Branch: `codex/live-unified-runtime`.
Status: implemented with the combined v4 repair; see the [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md). Local activation and pending handset acceptance are recorded there. This plan replaces the separate post-consent explanation recovery
proposed in the [assistance reason audit](live-assistance-reason-audit-2026-09-30.md).
Its incident evidence remains valid until the new behavior is implemented and tested.

The [combined runtime stabilization and disclosure plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md)
is now the implementation entry point after the latest v3 handset failure. This
document remains the detailed disclosure/localization/snapshot specification;
backend recovery and protected action playback follow the combined plan.

## Approved behavior and wording

If the user selects a reason, disclose it in the first introduction, before asking
the recipient to permit recording and automatic transcription. Default `none`
discloses no reason. The explanation belongs to the person represented in this call,
not the AI or the called recipient; it must not add a diagnosis, severity,
nationality, presumed native language or new personal details.

The Russian language-barrier wording approved by the owner is:

> Здравствуйте, я ИИ-ассистент, звоню от имени Ивана Иванова из-за языкового барьера. Разрешаете запись и автоматическую расшифровку разговора?

The analogous speech-impairment wording is:

> Здравствуйте, я ИИ-ассистент, звоню от имени Ивана Иванова из-за нарушений речи. Разрешаете запись и автоматическую расшифровку разговора?

With `none`:

> Здравствуйте, я ИИ-ассистент, звоню от имени Ивана Иванова. Разрешаете запись и автоматическую расшифровку разговора?

These examples illustrate natural Russian; the application preserves the approved
represented-person full name verbatim rather than inventing or automatically declining
names. Use both filled call-form fields, `representedPersonFirstName` and
`representedPersonLastName`, combined by the existing
`formatPersonName(firstName, lastName)`. Profile values may prefill the form, but the
submitted, server-normalized and approved call values are authoritative: do not
reload the profile, shorten the identity to the first name, infer a surname through
the LLM or silently omit a missing surname. Both name fields are already required
by the call-brief schema. Freeze their combined full name in the approved script.
No retention period, task agenda, keypad instruction or extra personal persona
is added. Shprohli remains the assistant identity for both voices; the short initial
script does not add another name announcement. Existing pronunciation instructions
still apply if the assistant subsequently gives its brand name.

## One shared deterministic source

Add a browser-safe helper in `packages/contracts/src/initial-disclosure.ts`, exported
from `index.ts`. Its inputs are the call locale, represented-person full name
assembled from both normalized call-form fields, voice
gender and `AssistanceReason`. Its output is a versioned, complete script containing
identification, the optional reason and the permission question. Proposed revision:
`assistance-inline-v1`. Generate no part of this text through the plan LLM, dynamic
translation, native Live output or a second consent classifier.

Use complete locale templates, not universal string concatenation: German word order
and French/Italian articles differ. Keep AI-role grammatical agreement where the
current templates distinguish female and male voices. The approved Russian
`ИИ-ассистент` wording can serve both voices; voice selection does not change the
reason or assistant identity. Both German locales may share
a template; both English locales may share wording. All seven call-locale keys must
still be explicit and exhaustively typed.

| Call locale | Reason content for speech impairment | Reason content for language barrier | Permission question |
| --- | --- | --- | --- |
| `ru-RU` | из-за нарушений речи | из-за языкового барьера | Разрешаете запись и автоматическую расшифровку разговора? |
| `de-CH` | wegen einer Sprechbeeinträchtigung | wegen einer Sprachbarriere | Darf ich das Gespräch aufnehmen und automatisch transkribieren? |
| `de-DE` | wegen einer Sprechbeeinträchtigung | wegen einer Sprachbarriere | Darf ich das Gespräch aufnehmen und automatisch transkribieren? |
| `fr-CH` | en raison de difficultés d’élocution | en raison d’une barrière linguistique | Puis-je enregistrer et transcrire automatiquement cet appel ? |
| `it-CH` | a causa di difficoltà nel parlare | a causa di una barriera linguistica | Posso registrare e trascrivere automaticamente questa chiamata? |
| `en-GB` | because of a speech impairment | because of a language barrier | May I record and automatically transcribe this call? |
| `en-US` | because of a speech impairment | because of a language barrier | May I record and automatically transcribe this call? |

Non-Russian wording is a proposed implementation baseline, not an assertion of native
speaker/audio acceptance. The first sentence must also explicitly identify the AI
assistant and represented person. For example, German places the selected reason
before `im Auftrag von {representedPerson} an`, not after a completed sentence.

Freeze the complete script for each new approved execution snapshot in an optional
`runtime.initialDisclosure` object with `version`, `text` and `assistanceReason`.
The existing plan locale supplies its language. Generate it server-side from the
normalized user settings; ignore any client-supplied script or version. Preview and
snapshot generation must call the same helper. Preserve the snapshot schema's
existing required version and all booking authority/hash invariants.

Retain `runtime.assistanceDisclosure` for legacy readers; the new Live path must not
play it after recording. Do not rewrite existing approved snapshots, review receipts
or compilation hashes. If a bound historical snapshot lacks `initialDisclosure`, use
its approved assistance text as a standalone sentence between identity and the full
permission question, with a distinct legacy adapter revision. Do not classify that
text into a reason enum, translate it, or substitute a mutable current brief's reason.
This compatibility wording can be longer than the new templates. Resolve it once
at a new legacy admission and reuse exactly that resolved script. For already-completed
historical attempts without frozen script data, do not present a newly generated
intro as what actually played: use available verified application-script evidence,
or show that the exact historical introduction is unavailable. Keep the existing
transcript accessible. Unknown/malformed new revisions fail preparation rather
than silently omitting permission operations or the selected reason.

## Live playback and consent transition

The accepted short script puts the recording/transcription notice **inside its final
question**. Therefore the full script, including that question, must be one required
playback unit. An identity/reason-only mark cannot authorize consent.

In `UnifiedLiveCall`, render this complete unit once through the existing
`renderSpeech`/PCMU path using the approved voice and call locale. Cache it in the
existing per-call memory cache. Send one generation-bound Twilio playback mark for
the full unit. This uses the current TTS provider/model; it adds no synthesis request
and reduces the initial two renders to one. Live keeps listening but does not speak
or repeat the script independently.

Remove the automatic initial second permission-question playback. `clarification`
and the existing contextual consent prompts remain available after an unclear answer
or a question, but must never become redundant initial playback. A clarification
asks about recording and automatic transcription, without restarting the reason
announcement merely because the answer was unclear.

Keep the existing semantic consent tool and classifier model. Provide it the exact
application-owned script and its question meaning, not just an assumption that a
disclosure was given. A contextual yes/no answers permission for **both** operations.
Praise of assistance, a question about the reason, or willingness to discuss the
task alone is not affirmative recording consent. Distinguish an objection/correction
about the explanation from refusal to record or a request to end the call. Use
conversation meaning, with no language-specific keyword lists or guessed personal
facts. The required playback/input-start boundary still rejects premature answers;
legitimate overlapping answers may be considered provisionally only after the full
mandatory content boundary and may never start recording before the actual mark.

Short energy bursts do not clear/replay the unit. A sustained interruption invalidates
that playback generation and its mark; replay the full cached unit after quiet only
within the existing maximum of three attempts and fixed 60-second total consent
deadline. The added reason cannot reset the budget. Use actual rendered duration for
playback bounds, never text-length estimates as proof of completion. Sustained noise
can still trigger the energy heuristic; bounded retries do not prove acoustic quality.

After full valid playback and accepted consent, start recording. If startup succeeds,
establish transcript admission and enable the task immediately. Remove the selected
reason's post-consent `#say(..., beginTask)` gate and associated dependence on
controlled Live output; do not introduce another reason-specific opening/recovery
state. Preserve appointment authority, playback evidence and bounded closing, but
follow the combined plan's rendered protected-action playback instead of retaining
the defective exact-Live-speech commitment gate. Ordinary conversation and normal
authorized farewell remain native Live speech. Preserve settled recipient input
across the transition.

For `none` and both reasons, the sequence is identical:

`complete initial script → actual playback mark → accepted semantic/keypad consent → recording startup → transcript admission → task backend`

Existing refusal, recording-failure, AMD/voicemail and hangup paths remain bounded.
No reason is independently disclosed to an answering machine or during an unadmitted
stream. A recipient refusal no longer implies the reason was not spoken: the owner
explicitly requested moving that disclosure before recipient consent. Tests and
documentation must reflect that change rather than preserve the old assertion.

## Native transcript admission and shared context

Introduce a recording-admission method/state in `LiveConversation`, separate from
`configureBackend`. Call it immediately after successful recording startup, before
any recipient fragment can become persistable. Preserve the trusted recording-start
timestamp fence and apply it regardless of backend state, including final fragment
drain. With no recording admission, never save/publish recipient fragments. Do not
use a model decision or estimated playback duration as recording admission. Validate
the boundary; no production fallback to an unbounded zero timestamp.

This closes the reproduced delayed-pre-recording admission gap independently of the
removal of `opening`. Retain accepted consent as durable decision evidence rather
than saving pre-recording recipient answer audio/text. Any deterministic application
script retained in the existing encrypted transcript is separate from native recipient
capture and must not be mislabeled as recorded native audio.

After consent, `executionData`/`liveExecutionContext` and managed backend instructions
receive the same approved assistance information, its represented-person ownership
and `alreadyDisclosed=true` only after a valid full mark. Historical snapshots may
provide approved text with an unknown enum; do not infer one. This supports later
questions without inventing details or repeating the introduction. Language-barrier
selection does not enable language switching or change the approved fallback locale.

## Multilingual interface and review

UI locales are `de`, `fr`, `it`, `rm`, `en`, `ru`, `uk`. Call locales are the seven
regional locales listed above; these are different capability sets. Rumantsch and
Ukrainian interfaces must not imply those languages are available for the voice call.

Update the creation/edit form, compilation review and call details consistently:

- Keep `none` as the default and preserve only the two existing reason options.
- For both nonempty choices, explain in the UI language that the reason is spoken
  at the start of the call, **before** the recipient agrees to recording.
- Show the complete initial script, including its permission question, in the call
  language with the corresponding `lang` attribute. Label that language in the UI
  language. For example, Russian UI plus a German call shows Russian controls and
  warning, with the actual German script; do not silently replace it with Russian.
- The approved-attempt detail view uses frozen snapshot text; draft/form preview
  uses the same helper. Changing call language, reason, first name, surname or voice refreshes the
  preview and uses existing edit/review invalidation rules, without adding a new
  approval workflow or asking the user twice for the same disclosure choice.
- Treat the compiled task opening as a suggested task-stage introduction, not the
  actual initial disclosure. Render the new preview outside model-generated plan
  prose and translation artifacts; the plan LLM cannot rewrite it.

The current public `CallSnapshot` does not expose the execution snapshot. Add only
the minimal owner-visible initial-script projection needed by the detail view:
bound `callAttemptId`, script version, call locale and text. Read it from the bound
attempt's frozen field, not current draft settings, and match it to the displayed
attempt. Do not expose the whole execution snapshot or borrow the latest attempt's
text for an older result. Legacy absence remains explicit. Pass the draft preview
as a separate property/slot to `CompilationReview`; shared demo plan cards do not
need an invented recipient or reason.

Use the existing EN/DE message definitions and all five additional resource catalogs
(`fr`, `it`, `rm`, `ru`, `uk`), or an exhaustively typed locale dictionary consistent
with existing patterns. If source phrases change, update resource keys and values
together. Tests must catch missing translations and English fallback for the new
warning/preview labels. Preserve stored drafts and reason enum compatibility.

## Runtime boundaries and diagnostics

The current active driver is Live with fallback=false. Scope the new builder/admission
path to Live and its matching UI preview. `getTwilioCopy` is also used by Realtime,
whose opening still includes `assistanceDisclosure`: changing that shared function
globally would disclose the reason twice there. Keep the legacy Realtime adapter
explicitly separate, or migrate its caller and opening together if a later task
authorizes that. Test that this Live release opens no Realtime socket and never falls
back to its voice/consent implementation. Do not treat an unused compatibility adapter
as a second runtime in the active call.

Tag the implementation candidate `live-managed-v4` and its script revision; keep
historical v1/v2/v3 telemetry readable. Record only bounded technical evidence in
events/logs: script revision, playback generation/attempt, full/cleared mark,
consent decision and recording-admission state. No reason enum, reason text, name,
diagnosis or pre-consent speech in technical metadata. The approved snapshot/script
continues to use existing encrypted storage and owner-visible controls.

## Implementation order and release checks

Execute these steps within the combined plan's backend ownership, protected action
playback, status-only recovery and terminal-decision changes; disclosure alone does
not resolve the latest handset incident.

1. Save the current v3 source/runtime baseline and manifest. Add the shared helper,
   complete templates, optional snapshot field and legacy resolver with tests.
2. Update all UI locales, complete preview and review/detail presentation. Verify
   exact shared text and frozen historical-attempt display.
3. Render the full initial script as one required playback unit; remove initial
   duplicate question and the post-consent reason gate. Update semantic context and
   independent recording/transcript admission together.
4. Update Live/backend approved assistance context, content-free diagnostics,
   version compatibility and old tests whose before/after-consent assumptions changed.
5. Run focused acceptance below, relevant database tests, types and builds. Save a
   candidate manifest and final implementation record. Update the runtime guide and
   audit with actual status, preserving historical incident findings.
6. Restart the local API only after a no-active-call preflight; retain Live,
   fallback=false and agent hangup=true. Check local health/UI, public gateway,
   source hashes and new readiness/script tags. Then report readiness for the
   owner's handset call; make no outbound call automatically.

Automated acceptance must cover:

- **42 script combinations:** 7 call locales × 3 reasons × 2 voice genders. One
  permission question with both operations, preserved first name and surname, no invented reason,
  AI identification, correct grammar and preview/runtime equality.
- Full-name sourcing: edited call-form values override profile-prefilled values;
  both first-name and surname edits refresh the preview; compound names remain
  intact; the approved attempt uses its frozen full name after later profile/form
  changes. Reject missing required name fields rather than using first name alone.
- All **7 UI locales**, including Russian UI/German call, Rumantsch UI/English call
  and Ukrainian UI/Russian call; correct warning and call-language labels.
- Full script playback and one initial question; early yes after identity/reason
  alone; uncleared current mark versus old/cleared marks; short noise and sustained
  interruption; maximum attempts and total deadline.
- Contextual yes/no, refusal, reason questions/corrections, unclear and overlapping
  answers, keypad fallback, recording-start failure, disconnect and nonhuman admission.
- Convert the five private audit diagnostics into desired-behavior regressions:
  no stalled post-consent reason gate and no saved pre-recording fragments for any
  reason. Exercise fragments arriving during recording startup, backend activation
  and final drain; include a verified post-admission fragment as the positive control.
- Old/new snapshot persistence and export, immutable old hashes, optional-field
  compatibility, exactly one durable consent/recording operation, no duplicate cause
  announcement after consent and no Realtime connection.
- Appointment authorization/status reconciliation, weekdays, substantive interruption,
  refusal and playback-confirmed closing retain their current guards.

Do not claim full-suite success if the previously observed parallel text-job lease
instability recurs: report the failure and isolated retest separately. A copy-only
edit is not a reason to expand this task into unrelated worker repairs.

Handset acceptance must verify actual full wording in at least Russian and German,
both reasons and a `none` control, interruption/noise behavior, prompt task transition,
correct treatment of reason questions and natural hangup. Static tests do not prove
native pronunciation or provider timing. No stable-call claim precedes that evidence.

Rollback restores the saved v3 sources/runtime configuration without resetting
unrelated branch work. New snapshot fields are optional and old snapshots are not
rewritten. Document the final field schema and compatibility behavior before local
activation; no destructive data migration, production deployment or Git push belongs
to this plan.
