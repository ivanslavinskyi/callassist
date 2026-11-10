# Native call checks, quiet delegation and analysis progress

Approved scope: minimal changes to existing checks and runtime boundaries; no new model stages, polling loops or scenario-specific orchestration.

## Plan

1. Preserve explicit, unambiguous numeric limits in the existing preparation and combined fidelity audit. Reuse the existing action-boundary terms validator; retain semantic interpretation of conditions that cannot faithfully be represented as a single numeric limit. Do not add routine recipient questions.
2. Discourage delegation-only filler and speech after farewell in the existing instructions. Preserve continuous native output, recipient interruption and corrections. Backend occupancy must not mute speech or remove evidence. Keep playback acknowledgment before disconnecting.
3. Display an expressive indeterminate analysis progress bar while the result is pending. Do not invent percentages or backend stages. Support all interface languages and reduced motion; remove the indicator when analysis settles.
4. Add focused regressions for numeric limits, quiet delegation/closing and analysis states. Run relevant tests and API/web type checks, review the resulting diff and record validation here.

## Acceptance

- Explicit numeric limits cannot silently remain only in prose; ambiguous and conditional alternatives retain their original meaning.
- Existing action validation rejects over-limit or unsupported numeric evidence.
- Backend delegation does not clip useful speech or remove closing evidence; recipient corrections remain actionable and closing still drains playback. Filler suppression through instructions requires real-call evaluation.
- Pending result analysis visibly moves without suggesting a known completion percentage; settled results retain their existing presentation.
- No new external model calls, database migrations or automatic telephone calls.

## Status

Implemented and available in the local native_v2 runtime at http://localhost:3000/ru.

## Release consistency review, 10 November 2026

- Kept the runtime behavior accepted after the latest two calls; the subsequent latency suggestions remain proposals, not implementation.
- Verified pending/settled analysis and user/admin labels across all seven UI locales (de, fr, it, rm, en, ru, uk). The admin inspector uses the same lifecycle and assessment components; no API/storage contract or extra polling was added.
- Expanded deterministic closing/playback/hangup checks to all seven persisted call locales, including historical de-DE/en-US, and added Italian date-counteroffer coverage. UI locales and currently selectable voice locales remain separate. These tests do not claim acoustic/model acceptance in every language.
- Full frontend suite: 498 tests passed; contracts: 290 tests passed. The full API run passed 2,539 tests and exposed eight stale assertions in one preparation test file, all expecting the previous wording of the represented-person rule. Updated that assertion to the equivalent current instruction; all 73 tests in that file and the two expanded native-call suites then passed.
- API/web/contracts type checks, web lint, public-copy/license/dependency checks, all three production builds, and the built native/managed runtime activation/rollback check passed. Database checks used isolated disposable test databases; no provider traffic or changes to saved calls/plans.
- The public appointment demo now consistently uses 24 November 2026 in the request, approved date window, dialogue and findings, in all seven UI locales and derived PDFs. The scenario is application-owned; CMS controls its visibility/title. No data migration is required. The updated Russian date was observed in the local browser; further Computer Use was stopped by the user.
- Commit/push and CI verification follow these local checks; CI outcome is recorded by the corresponding GitHub run.

## Implementation and validation

- Existing compiler and combined fidelity audit now explicitly preserve common, unambiguous total-price ceilings in the structured limit. Backend instructions require observed numeric evidence for that existing validator. Complex or alternative-specific conditions retain semantic interpretation; no extra model stage was introduced.
- The initial native v2 delegation mute was removed after the real-call regression below. Continuous speech and transcripts remain intact while backend work runs. The existing instructions discourage filler; playback acknowledgment and hangup timing remain unchanged.
- Both pending-result presentations use a localized, accessible indeterminate progress bar, with reduced-motion styling and no fictitious percentage. Browser inspection verified the rendered component and active CSS animation in full and compact presentations.
- API: 492 tests passed across native-live-v2, native-live-stability, unified-live-call, native-appointment-call, native-terms-evidence, execution-fidelity and native-closing-evidence.
- Web: 23 tests passed across call-analysis-progress, current-call-snapshot and call-status. API and web TypeScript checks passed; git diff --check passed.
- Local API and worker restarted only after confirming zero active calls, preparations and jobs. Web, API readiness, workers and existing webhook gateway checks passed. No runtime profile change, database migration or telephone call was performed.

Remaining empirical validation: a fresh prepared task and real test call are needed to confirm model extraction and audible behavior with the provider. Existing approved plans are not rewritten by this change; the audit still relies on the existing semantic model, while the numeric action check is deterministic once the structured limit is present.

## Real-call regression review, 10 November 2026

Local test call A, 10:46–10:48 Europe/Zurich. Reviewed stored execution data, protocol trace, tool results and transcript; the audio recording was not listened to.

- The call used the amended runtime source digest `7fcfafb6cdab77fb720df258b93da415c56e6fd866874cea65cfc89d90f7dc66`. Its structured limit was 100 CHF. `prepare_appointment` supplied 90 CHF and the literal provider quote, and the numeric validator accepted it before the commitment. Isolated replay of this exact authorization/proposal accepts 90 and 100, rejects 120 and an unknown price. These replays made no calls or database changes.
- The delegation mute was a regression: native output started the booking readback and final recap before backend continuation completion. The model retained the generated words while the application discarded parts of both audio and captions. Result recording first failed on the clipped readback, then repaired its quote. The final recap prefix was also clipped, including during automatic closing review. `end_call` at 10:47:59 was rejected with `closing_quote_not_observed`; there was no accepted terminal decision or application hangup. The stream stopped at 10:48:26, roughly 35 seconds after the recorded farewell.
- Removed the entire occupancy-based mute and caption deletion. New regressions require a conclusion overlapping delegation/review to remain audible and usable as closing evidence, successful playback-confirmed hangup, and cancellation on a recipient correction. No evidence checks were relaxed or new orchestration stages added. The original filler issue is addressed by instructions only; real-call confirmation is still required.
- The primary `CallResultPanel` still displayed `summaryLoading` text: the earlier progress integration missed this separate queued/processing artifact state. It now uses the same progress component, prioritizes an already-running analysis over capability loading, and shows an honest paused state when polling stops. Browser inspection used the actual result component with a synthetic processing artifact and application styles, without modifying stored calls.
- Follow-up validation: 68 API tests (native-live-v2, native-live-stability, live-native-closing, native-appointment-call), 11 web tests (call-result-panel, call-analysis-progress), API/web type checks and diff checks passed. A further real call has not been placed automatically.

## Preparation regression follow-up

A local test preparation completed its job but produced a blocked plan (`fact_integrity_failure`) after the existing three repairs: 10 provider requests, no provider HTTP error. Its final numeric ceiling was null despite the textual price condition. Exact historical audit verdicts were not retained in the diagnostic metadata.

With the user's explicit permission, an isolated reproduction sent the saved task to the configured models without writing a plan or making a phone call. It exposed an inconsistency: the auditor rejected CHF normalization and the configured Europe/Zurich default as additions; the next generation removed the numeric ceiling. A language repair also introduced an unrequested earliest-slot preference, which the audit correctly rejected.

Changes within the existing preparation stages:

- Share the existing currency-alias conventions and default time zone between generator and auditor. Explicit different currencies/zones still prevail; a bare number does not acquire a currency.
- Map audit feedback about canonical appointment authority to the generator's `nativeAppointmentInterpretation.authorization` schema, with specific guidance for the existing numeric limit field.
- Retain deduplicated audit constraints across the existing bounded repair loop, so language fixes do not discard prior semantic corrections. No additional stage, retry allowance, model change or relaxed price check.
- Keep historical native_actions/native_progressive preparation instructions byte-for-byte unchanged.

Validation: 376 tests passed across preparation and numeric terms evidence, plus API type checking. The first real-model reproduction after aligning conventions passed its first generation/audit with a structured 100 CHF limit and `ready_for_review`. After isolating historical profiles, one diagnostic run returned `OPENAI_RESPONSE_INVALID` after another repair; its exact failure details were not captured. A subsequent run of the final code passed in about 17 seconds with one generation, one clean audit and two moderation requests. These are diagnostic runs, not a measured reliability guarantee. There were no persisted changes or phone calls. The previously blocked card is retained for the user to retry normally.

## Latest call review, 11:19–11:23 Europe/Zurich

Local test call B used current source digest `0252aadeaa480313e94b1dc5058d3cc90f068fff1cac5c933bb1ae8d25d54f4a`. Evidence: stored execution plan, full protocol/tool trace, transcript timestamps, read-only database timing and the actual Chrome call page. Audio was not listened to.

- The plan has a 100 CHF ceiling. The first `prepare_appointment` supplied and validated 90 CHF with the observed price quote. This call tests an allowed price, not rejection of an excessive price. The removed occupancy mute is absent from this trace.
- The Monday-to-Tuesday correction did not reconcile the journal. Two declined-result attempts had `detailsMatch: false`, which the server rejects. The tool description describes this field as confirmation of the requested details, although refusal also requires true. Repeated evidence repairs then copied a corrupted ASR phrase incorrectly, including a different Unicode character. Three quote failures and one stale request compounded the delay.
- The backend subsequently tried checking Tuesday while Monday remained unresolved, then used `confirm_existing` instead of the authorized `book` operation. Neither passed. It acknowledged the clear later rejection of Monday in prose without recording the rejection. The saved action stayed uncertain on Monday while Live announced success on Tuesday. The actual page shows that same discrepancy.
- There were 27 backend response generations and 13 function calls, of which nine were rejected. Several conversational gaps were roughly 14–20 seconds. The backend also spent approximately 11.5 and 13.5 seconds on individual responses. No transport failure is needed to explain the observed stalls. These traces do not establish that today's prompt change caused all of them; the problematic result guards and recovery contract already existed.
- No `end_call` was attempted. Automatic farewell review returned an empty message. Its instructions forbid continuing task work or speaking if the task is unresolved, while successful closing requires a confirmed journal. Live had already announced success, so uncertainty was not honestly recapped either. The stream stopped about 34 seconds after the final farewell, without an application hangup.
- Post-call analysis ran from approximately 10:23:31 UTC to 10:23:47 UTC. It produced a partial goal assessment. The missing progress indicator concerns this post-call interval. The running frontend served CSS with no `.call-analysis-track` or `call-analysis-sweep` despite those rules existing in source. Earlier synthetic UI checks therefore did not establish that the real local app shipped the styles.

Local frontend remediation: after verifying zero active calls, preparations and jobs, restarted only Next using the separate `.next-roles-20261110` build directory, preserving the old directory. An HTTP read of the served global stylesheet now confirms both the track and animation rules. No call, saved plan, runtime profile or backend implementation was changed in this review. A real pending-state transition has not been observed after this restart; the existing browser page needs refreshed assets.

Recommended bounded follow-up, without another orchestration stage:

1. Make the existing result-tool contract consistent for confirmed versus declined outcomes, and return actionable repair guidance for a declined result. Preserve subject, proposal and latest-evidence binding; do not simply remove the guard.
2. Use short exact observed evidence spans for corrections, reconcile the old rejected proposal before validating a replacement, and distinguish informational `status_check` from the committing `confirm_existing` operation. A known answer must update the journal rather than generate another spoken clarification.
3. Resolve the existing closing recovery dead end: unresolved results must permit an honest inability conclusion and `cannot_proceed`, without claiming success, repeating a delivered farewell or relying on unconditional silence-based hangup. Keep playback and recipient-correction safeguards.
4. Validate this exact counteroffer-and-confirmation sequence, including noisy ASR, through existing functions and then an explicitly authorized real call. For the frontend, verify the full pending-to-ready view against the app's served assets, not only static markup or a synthetic standalone preview.

## Bounded correction implementation

Implemented within the existing native tools and recovery callbacks:

- Clarified the result schema: `detailsMatch` binds either confirmation or rejection to the current proposal. Speaker-specific quote descriptions prohibit combining the assistant's question with the recipient's answer. Short literal spans can avoid irrelevant recognition noise while retaining meaningful corrections. A declined-result rejection now returns specific repair guidance; observed evidence, latest-reply binding, price and calendar checks remain enforced. Declines also reject evidence wholly preceding the quoted request.
- Distinguished approved alternatives from individual offered dates and `status_check` from committing attendance. A rejected proposal's state update now explicitly permits preparing another authorized offer instead of incorrectly treating rejection as another unfinished authorization. Existing answers resolve the journal before another question is considered.
- Removed the broad instruction to wait silently during delegation. Live may make ordinary useful replies and collect missing details without a backend request; the existing price check still runs before commitment. Internal tool announcements remain discouraged.
- Once result recording has been attempted, its existing backend continuation owns argument repair; the missing-result reminder no longer duplicates it. A quiet closing review deferred behind active backend work is suppressed when that work settles, rather than immediately starting another response over the same quiet text. New speech retains the language-independent fallback; actual farewell and confirmed-action recovery remain available. A farewell takes precedence over an unresolved-action reminder.
- Closing reuses the recorded result and calls `end_call` directly. The existing recovery prompt can end a finished conversation with `cannot_proceed` while preserving an unresolved journal. No automatic success, unconditional silence-based hangup, new model, tool, database schema or orchestration stage was added. Playback drainage and recipient-correction checks are unchanged.
- The analysis sweep now remains inside its track throughout the animation. It is visible continuously, still indeterminate, with the existing reduced-motion behavior.

Validation:

- Four-language counteroffer tests verify rejection, an authorized replacement date, confirmation and price enforcement. An integrated lifecycle test verifies a replacement date followed by exactly one playback-confirmed hangup and no extra automatic reviews. Additional tests cover failed-result repair, unresolved closing, duplicate quiet reviews, unknown farewell wording and recipient interruptions.
- 136 tests passed across seven focused API files; the final recovery adjustment also passed 406 tests across native v2, stability and unified-call suites (these runs overlap). Thirty web tests and API/web TypeScript checks passed.
- A browser fixture mounted the actual result/lifecycle components and hooks with fictional data and loaded CSS from the running localhost server. Both progress indicators were visible, their computed transforms changed from about 228px to 20px, and both disappeared on the ready transition while the result appeared. This validates UI states and the served styles; it does not simulate network timing of a real telephone call.
- Automatic approval review rejected sending the real call transcript to OpenAI. The model diagnostic was rewritten to construct an entirely fictional consultation from repository fixtures; no saved calls, tasks or transcripts are read. Early runs exposed mixed-speaker quotes, a redundant confirmation at closing and a selected alternative incorrectly listed as unavailable. The tool descriptions and closing instructions above address those findings. A subsequent full diagnostic passed date replacement, confirmation, closing and uncertain closing without rejected tools in seven standalone model requests. This is backend decision evidence, not an audible voice-quality or latency guarantee.
- Local API, worker and frontend are restarted only after idle checks. Frontend uses its separate build directory; HTTP checks verify the actual served track and 1.4-second alternating animation. No telephone calls are placed by verification.

OpenAI implementation reference: [Delegation and tools in GPT-Live](https://developers.openai.com/api/docs/guides/live-delegation). The managed function-output continuation is preserved; latency reductions target redundant work and retries within the existing flow.

Final verification also passed ordinary closing without the automatic-review prompt, in addition to uncertain-closing recovery. Both fictional GPT-Live admission probes (ordinary and multilingual context) were accepted, with zero phone calls. The final local API source digest is `0d6ad9fc83a2f5c32b0aca70a39d4b5264f934a9d81c5b4be22a2ec948ce2e1f`; API readiness and workers are ready. Model diagnostics required a PEM export of roots already trusted by Windows; TLS verification stayed enabled, and the final local API/worker inherited that trust bundle. The generated Next type-path edits were restored so the diagnostic build directory is not a product configuration change.
