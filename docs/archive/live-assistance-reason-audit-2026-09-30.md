# Assistance reason audit — 30 September 2026

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Branch: `codex/live-unified-runtime`, active local candidate `live-managed-v3`, API
PID 24724. Requested separate verification of `speech_impairment` and
`language_barrier`. Production sources and running processes were not changed by
this audit. Test fixtures now accept the complete `AssistanceReason` contract;
regressions cover both reasons, `none`, seven call locales and both voice profiles.

The next release now follows the
[combined runtime stabilization and disclosure plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md),
which includes these two unfixed admission/opening defects and the subsequent
post-v3 handset failure. That handset call selected `none`; it does not establish
either assistance-specific defect as its cause.

## Confirmed normal behavior

The user setting is normalized by server-owned templates in
`packages/contracts/src/call-brief.ts`. The compiler receives its enum; the approved
runtime snapshot retains the localized `assistanceDisclosure` text. The call uses
that snapshot text rather than a new model-generated reason.

The sequence is mandatory AI/recording/transcription disclosure, semantic consent,
successful recording startup, selected assistance explanation, then task backend
admission. The reason is separate from the legal disclosure. Refusal or recording
startup failure does not authorize speaking it. `none` produces no assistance
explanation and admits the task directly after recording. One native Live session
and the approved male/female voice are retained.

Russian texts currently are:

- Speech impairment: «В этом разговоре я помогаю из-за нарушения речи.»
- Language barrier: «В этом разговоре я помогаю из-за языкового барьера.»

Templates name no diagnosis, severity or specific foreign language. They are generic
about whose difficulty is involved; Live's separate representation instruction assigns
the represented person's needs/constraints to that person, not the AI or recipient.
Selecting a reason does not imply an additional diagnosis or authorization.

Language barrier does not change the language policy. The selected call locale still
governs the explanation, task and canonical protected speech. Native conversation
may switch only to the separately authorized fallback locale on explicit request;
input validation requires that fallback to differ from the primary locale. A reason
alone does not enable switching or establish the represented person's native language.
No guarantee of model compliance or actual spoken pronunciation is inferred from
prompt/static tests.

## Two reproduced orchestration defects

**P1 — delayed pre-recording text can be saved during the assistance opening.**
`UnifiedLiveCall.#grant` sets `#consented=true` after recording startup, then keeps
phase `opening` until the reason's controlled playback mark. The timestamp boundary
in `LiveConversation.#transcript` is conditional on `#backendEnabled`, which is not
enabled until that opening ends. An input transcript fragment that started before
the recording boundary but arrives during this interval passes the lifecycle's
post-consent persistence guard. Identical synthetic old fragments are rejected with
`none` and saved with either selected reason. This proves a native text admission
gap, not that Twilio began recording without consent or that an actual call leaked
text. A later boundary cannot remove already-persisted fragments.

**P1 — interrupting the reason can terminate an otherwise admitted call.**
The reason uses `#say(runtime.assistanceDisclosure, beginTask)`, so task admission
waits for complete controlled text and a real mark. If Live emits only the opening
prefix, the recipient substantively interrupts, and the assistant output does not
resume, `LiveControlledSpeech` reaches `LIVE_SPEECH_OUTPUT_STALLED`. The generic
failure callback closes with `openai_error`, phase `opening`, instead of recovering
the explanation. This was reproduced for both reasons after valid consent and
recording startup. It is distinct from replay of the mandatory consent disclaimer.

These are stage/boundary bugs in application orchestration. The reproduction neither
invokes Realtime nor demonstrates a provider outage. It does not prove that they
caused any earlier real call failure.
The same opening gate and backend-dependent timestamp guard are present in the
saved pre-v3 `.tools/live-incident-baseline-20260930` sources; the latest recovery
changes did not remove this older admission coupling.

## Minimal follow-up change

Superseded design: the owner subsequently selected disclosure of the reason in the
short initial introduction. The [consistent implementation plan](live-inline-assistance-disclosure-plan-2026-09-30.md)
replaces item 2 below with removal of the post-consent reason gate. It retains the
independent transcript-admission fix and shared approved context. No fix has yet been
activated; the findings and diagnostic evidence here remain historical facts.

1. Establish native transcript admission immediately after successful recording
   startup, before any optional explanation. Separate that admission/boundary from
   task/backend admission and apply it throughout opening, task and final fragment
   drain. Preserve the observed start timestamp fence for late pre-consent speech.
   With no confirmed recording admission, save no recipient fragments.
2. Give the assistance explanation its own bounded interruption/recovery lifecycle.
   Preserve the settled recipient answer and the approved explanation content;
   an incomplete opening after interruption must not take the generic fatal speech
   path immediately. Resume/replay only within a current playback generation after
   quiet, with a fixed attempt/deadline bound and explicit delivery evidence. Keep
   actual playback verification; do not simply label clipped text as delivered or
   discard the selected explanation. The earlier approved simplification plan
   requires its content once. Do not enable appointment commitments prematurely.
3. Supply Live and its backend the same approved assistance text/owner as structured
   context for later questions. Currently executionData/liveExecutionContext do not
   carry an explicit assistance field; the speech directive/native dialogue supplies
   it indirectly. Treat the approved text as the limit of disclosure and infer no
   medical details, nationality or language from it. This is hardening, not a
   reproduced misunderstanding by the provider.

The form preview correctly shows either explanation. Its additional sharing warning
currently appears only for speech impairment. Displaying that warning for both
nonempty reasons would make the form consistent; it is a secondary UI refinement.

## Evidence and status

- API normal/regression scope: **199 tests passed** across four suites, including
  **42 locale/reason/voice combinations** and refusal/recording-failure checks.
- Contracts scope: **25 tests passed**; API type checking passed.
- Private diagnostics: **5 tests passed**, asserting the observed defects and the
  `none` control. These are not fixed-behavior acceptance tests. Sources/runner/log
  are `.tools/assistance-audit-cases.txt`, `build-assistance-audit.mjs`,
  `assistance-audit-vitest.config.mjs`, `assistance-boundary-diagnostics.log`.
  Normal results: `.tools/assistance-runtime-tests.log` and
  `.tools/assistance-contracts-tests.log`.

All checks use fake time, sockets and generated PCMU; they make no provider request,
start no real call and mutate no application database. There was no handset/audio
inspection in this audit. The active v3 production-source manifest still matches;
these two defects have **not been fixed** by adding tests. The previous readiness
claim must therefore be qualified: clean assistance playback passes, but selected
reason interruption and delayed-fragment privacy acceptance remain open.
