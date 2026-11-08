# Task input, audio retention and test scenario implementation plan

**Status:** implemented and verified locally on the current branch; controlled telephone acceptance remains.\
**Source reviewed:** 2026-11-08, working tree on `codex/live-audit-validation-2026-11-05`.\
**Primary runtime:** local native v2, integrity preparation policy, compiler 13,
plan schema 9, approval 8 and summary-v8.\
**Priority:** preserve natural conversation, existing authority boundaries and history.

This plan covers facts entered in any task field, the role of context, a 30-day
audio default with a simpler form, and administrator-managed scenario buttons for
selected testing accounts. It incorporates the requirement that administrators can
add scenarios and that buttons above the objective field insert the selected text.
It does not activate the experimental runtime in production.

**Reading this record:** the recommendations and investigation below preserve the
design baseline before implementation. Statements such as “not an existing feature”
refer to that baseline. Use [Task information and testing](../task-input-and-testing.md)
for current contracts and [the implementation record](../reports/task-input-testing-implementation-2026-11-08.md)
for delivered changes, verification and remaining telephone acceptance. The delivery
checkpoint at the end of this plan records implementation decisions.

## 1. Recommended decisions

| Area | Recommendation |
| --- | --- |
| Input format | Support facts in objective, context or the optional facts list; users need not reorganize a valid task |
| Authority | Keep booking/confirmation/rescheduling/cancellation authority grounded in the objective or a clarification answer; context can supply conditions and factual details |
| Context | Keep an optional background field; explain that relevant supplied information can be shared, subject to explicit restrictions |
| Native behavior | Preserve complete startup sources; ordinary factual replies require no application lookup or additional permission tool |
| Review | Make original supplied information inspectable alongside the compiled plan, without implying that `approvedFacts` is the complete disclosure boundary |
| Audio | Fresh calls default to 30 days; remove the selector, retain clear retention information and manual deletion; preserve existing choices and deadlines |
| Tester access | Add an independently assigned capability, displayed as “Tester,” rather than another value in the mutually exclusive role enum |
| Superadmin access | Superadmins have scenario access automatically; no separate grant is required |
| Transcript PDF | Show a separate AI task assessment block on the first page, before the transcript, using the saved result for the exported source revision; show pending, unavailable and partial analysis explicitly |
| Scenario catalog | Persist editable, versioned scenarios in the backend; manage them in the admin console; serve active scenarios to authorized testers |
| Button behavior | Insert only the scenario's objective text into the editable draft; handle an occupied field explicitly and support undo |
| Runtime/cost | Templates use the ordinary preparation, approval and calling pipeline; no special Live prompt, extra model stage or automatic call |

The capability choice is an architectural recommendation, not an existing feature.
Superadmin-only assignment and server-side access checks fit the application's
current role boundaries and OWASP's recommendations on least privilege and checking
authorization on every request. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html)

## 2. Verified current behavior

### 2.1 Information in the objective

The objective is free text, not an imperative-only parser. Preparation receives the
full string. Compiler instructions explicitly preserve supplied facts from the
objective, context and clarification answers as well as the dedicated facts list.
Facts such as a date of birth, contact number, address, previous visit or insurance
reference may therefore be included in a normal task paragraph.

The dedicated `approvedFacts` array is narrower: it is constructed from
`rawBrief.allowedFacts`, with ordered source-text checks. Facts written elsewhere
do not automatically become entries in that array. They may appear in the compiled
background or other plan fields and remain in the original task sources.

Approval v8 freezes the complete original objective, context, facts, clarification
answers and delivery instruction. `nativeV2Session` sends those sources to Live in
the startup input and includes them in backend instructions. Therefore a detail
outside `allowedFacts` is not automatically unavailable to either model.

Live can answer an ordinary request for a supplied value without calling the
backend. Appointment authorization/result tools still apply when making or
confirming a commitment. The post-call schema-9 evaluator also receives the original
task sources, so evaluation is not restricted to the dedicated facts array.

Examples of intended behavior:

| Recipient question | Expected use of supplied information |
| --- | --- |
| “What is the patient's date of birth?” | Answer the represented patient's supplied date, regardless of input field |
| “Has this person visited us before?” | Use the supplied visit history; do not infer it from an address or account age |
| “Which number can we use?” | Use the task's identified contact number; the structured destination phone remains the number being called |
| “What is the insurance reference?” | Preserve the supplied identifier and leading zeros; clarify uncertainty instead of inventing or silently correcting it |
| “Can you provide a value that was not supplied?” | State that it is unavailable or clarify what can proceed; no user-profile lookup tool exists for arbitrary missing facts |

These are intended model behaviors, not a guarantee of correct acoustic reading of
every arbitrary format. No real-model medical administration conversation was run
in this review. Names, dates, identifiers and the correct subject need explicit
acceptance coverage.

### 2.2 Information in context

`context` is ordinary task background. It is available from startup; it is not a
private note hidden from the called party. Existing compiler/shared instructions
allow task-relevant supplied information to be disclosed when needed. Explicit
instructions to withhold a value or disclose it only under a condition remain binding.

Context can hold a previous exchange, factual details, preferences and restrictions.
It is distinct from `contextAppendix`: the latter is a compiler-produced index of
optional reference sections, retrieved through `get_task_context` when present.
The raw context is still included in primary sources; an appendix does not create
an unlimited input channel or automatically remove the raw text from startup.

There is one deliberate asymmetry: context and facts cannot independently grant
appointment action authority. The appointment compiler accepts an authority quote
only from `objective` or a clarification answer. Requirements may reference any of
objective, context, facts and clarification answers. Thus “book an appointment” in
the objective plus “Tuesday only” in context is supported; an informational
objective with a booking command only in context must not silently gain permission.
The exact model outcome of the latter depends on compilation: it may produce an
informational plan, request clarification or fail validation. A clear missing-authority
explanation is preferable to leaving this difference unexplained.

### 2.3 Current limits

| Boundary | Current limit |
| --- | --- |
| New objective | 10–4,000 JavaScript string units after trimming |
| New context | 4,000 JavaScript string units after trimming |
| Dedicated facts | Up to 40 nonempty lines, each at most 300 string units |
| Clarification answers | Up to 10, each at most 1,000 string units |
| Combined task text | Warning at 6,000; hard limit 8,000 normalized Unicode code points across objective/context/facts/clarifications/delivery |
| Historical stored context | Readable up to 12,000 characters; not the new-entry allowance |
| Native startup allocation | 120,000 UTF-8 bytes for the serialized task; separate instruction/output guards and provider admission still apply |

Individual limits are not additive allowances. A selected template must be checked
against the existing context and facts too. Do not truncate user data to fit.

### 2.4 Evidence and relevant files

| Boundary | Source |
| --- | --- |
| Input limits, defaults, immutable task sources | [call-brief.ts](../../packages/contracts/src/call-brief.ts), [live-task.ts](../../packages/contracts/src/live-task.ts) |
| Disclosure policy shared by compiler/managed paths | [supplied-information.ts](../../apps/api/src/voice/supplied-information.ts) |
| Compiler instructions and fact guards | [compiler-instructions.ts](../../apps/api/src/brief-compiler/compiler-instructions.ts), [brief-compiler.ts](../../apps/api/src/brief-compiler/brief-compiler.ts) |
| Action authority and requirement source validation | [native-appointment-compilation.ts](../../apps/api/src/brief-compiler/native-appointment-compilation.ts) |
| Native Live and backend startup | [live-task-context.ts](../../apps/api/src/voice/live-task-context.ts) |
| Result input assembly | [text-artifact-service.ts](../../apps/api/src/text-processing/text-artifact-service.ts), [summary-source.ts](../../apps/api/src/text-processing/summary-source.ts) |
| Form and plan presentation | [create-call-form.tsx](../../apps/web/components/create-call-form.tsx), [call-plan-presentation.tsx](../../apps/web/components/call-plan-presentation.tsx) |
| Draft isolation | [call-draft-store.ts](../../apps/web/lib/call-draft-store.ts) |
| Recording scheduling and stored objective | [postgres-call-repository.ts](../../apps/api/src/storage/postgres-call-repository.ts), [call-repository.ts](../../apps/api/src/storage/call-repository.ts) |
| Encryption/rotation inventory | [encrypted-columns.ts](../../apps/api/src/db/encrypted-columns.ts) |
| Account roles and administration | [account.ts](../../packages/contracts/src/account.ts), [postgres-auth-repository.ts](../../apps/api/src/auth/postgres-auth-repository.ts), [admin-users-console.tsx](../../apps/web/components/admin-users-console.tsx) |
| Retention copy | [seed-content.ts](../../apps/api/src/content/seed-content.ts), [form messages](../../apps/web/lib/i18n/messages.ts) |

## 3. Findings and limits

| ID | Finding | Consequence / response |
| --- | --- | --- |
| F1 | Native v2 uses a separate concise prompt; it does not interpolate the full shared supplied-information policy used by the compiler and managed runtime | It says sources contain approved facts, but equal disclosure treatment across fields is less explicit. Add a concise versioned rule and behavioral tests |
| F2 | Explicit facts have one-to-one integrity checks; protected objective identifiers must appear in compiled execution text; arbitrary context identifiers have no equivalent presence requirement | A context detail can be absent from the compiled preview while still present in startup sources. Verify the complete source path and improve review; do not force every background detail into spoken plan text |
| F3 | The form labels only the facts section as information the assistant may share | Users may mistake context for private notes or think facts elsewhere are ignored. Clarify all three field roles |
| F4 | `call_briefs.objective` stores `compiled.localizedObjective` as a plaintext projection; context, facts, compilation and snapshots use ciphertext columns | If the generated objective includes personal facts, they can appear in this projection. This is a code-path exposure, not evidence that a particular user's information leaked. Treat free-text objectives as potentially sensitive |
| F5 | UI, contract and SQL creation defaults are 7 days; the selector offers 0/7/30. Published-content seeds still describe selectable retention and older zero-day behavior | Removing one select is insufficient; defaults, compatible readers, deadlines and published copy must be updated together |
| F6 | Roles are `user`, `admin`, `superadmin`, `content_editor`, `support`; several admin/credit paths specifically allow ordinary targets with `role='user'` | Adding `tester` can change visibility and credit administration. An orthogonal capability avoids these unrelated changes |
| F7 | No administrator-managed tester scenario catalog exists | Add a small persistent catalog and UI flow, not a special conversation runtime |
| F8 | A template origin and an executed test run are different facts | Preserve template revision/edited status when useful, and keep tester call expenses in ordinary accounting |

F2 was reproduced locally: a synthetic date of birth placed in each of the three
fields reached both Live and backend. Removing it from the compiled plan caused
`fact_integrity_failure` for objective/facts, but still passed for context. Original
context retention mitigates the runtime loss; the test does not demonstrate that
Live forgot the value. A context-only authority quote was rejected as expected.

## 4. Workstream A — consistent task information

### A1. Define and document field semantics

Keep one full approved source bundle. The objective describes the requested action
and may contain supporting information. Context supplies background, restrictions
and correspondence. Facts are a convenient optional list. All are available for
task-relevant answers; explicit disclosure restrictions apply across the bundle.

Recommended form guidance, localized in all seven UI languages:

- Objective: describe the task; supporting facts may be included here.
- Context: optional details and constraints that help conduct the conversation;
  relevant information can be shared unless explicitly restricted.
- Facts: optional additional facts, one per line; information already entered above
  need not be repeated.

Preserve all submitted values and field provenance. Do not automatically move text
between fields, infer a new medical profile, or reinterpret a contact number as the
destination being called. Distinguish the account owner, represented person,
recipient and additional people mentioned in the task.

### A2. Align concise Live/backend instructions

Add a short common rule to the new native prompt version: supplied facts in all
primary task fields are available for relevant answers; preserve exact values and
subject; honor restrictions; ask about material contradictions rather than guessing.
Clarify that personal information alone does not require a new permission tool.
Ordinary fact replies remain native. The backend receives detailed action/evidence
rules only where needed. The opening and closing must not enumerate personal data.

Do not mutate previously pinned compiler policy text or snapshot hashes. If compiler
instructions or validation semantics change, add a new supported policy/compiler
version and keep historical variants unchanged. Update native configuration identity
for changed Live/backend instructions and exercise descriptor mismatch tests.

This preserves OpenAI's recommended split: concise conversation instructions,
detailed backend procedures and application-owned action authorization.
[GPT-Live prompting](https://developers.openai.com/api/docs/guides/live-prompting),
[delegation](https://developers.openai.com/api/docs/guides/live-delegation)

### A3. Validate the correct boundary

Add regression coverage for identical source information in every field, both before
and after approval. Verify byte-for-byte source values in startup/backend inputs
and full native result context. Retain existing explicit-fact and invented-identifier
guards. Verify that context-derived action conditions survive in the approved
authority and result criteria.

Do not mechanically require every context token to appear in the compiled spoken
plan: quotations, historical references and optional details need not be recited or
duplicated into a bounded summary. For secondary facts, complete immutable sources
and inspectable review are the required preservation boundary. For essential action
conditions, require faithful compiled authority as well.

If behavioral tests expose lost essential facts or wrong-person assignment, extend
the existing compiler output with bounded source references in the same preparation
request. Any such extension needs a separately versioned contract and exact-source
validation. Do not add another extraction model call or build a broad medical-data
schema as a prerequisite for this feature.

When a requested action cannot be authorized from the objective/clarifications,
surface an actionable preparation explanation. Keep quoted correspondence from
granting authority merely because it contains an imperative. Preserve genuine
missing-information clarification instead of labelling it a safety violation.

### A4. Review and result consistency

Add an expandable “Provided information” view of the original approved objective,
context and facts. Use exact existing sources and their labels; no additional LLM
call or hidden normalization is needed. Keep the concise compiled plan as the
primary review. Do not label the existing `approvedFacts` list as all information
Live can access or disclose.

Check that DOB, contact, address, visit history and insurance are supporting data,
not automatically mandatory questions or success criteria. If a booking succeeds
without the recipient requesting insurance, unused insurance data must not make
the task partially achieved. Conversely, a source-authored required condition must
remain part of assessment. Short spoken closing remains the main result for the
represented person, thanks and goodbye.

### A5. Protect free-text objective projections

Introduce an encrypted objective projection, or derive the full objective from an
already encrypted authoritative source, for owner-authorized reads. Prefer a
dedicated encrypted projection if history pagination would otherwise require
decrypting complete compilations for every row. Inventory every reader before
choosing the implementation.

Use an additive migration and a resumable, verified backfill. Preserve existing
plaintext for compatibility only during the bounded migration window, then replace
it with a non-sensitive placeholder after encrypted parity checks. Do not rely on
regex redaction or an LLM-generated short title to guarantee removal of personal data.
Recheck admin list/detail access, account export, telemetry export, rotation,
restore and deletion. Do not rewrite original compilation/approval hashes.

This storage hardening can be isolated from conversational changes. Demonstrations
before it is complete should use a controlled synthetic task corpus; completion
of the plan requires the storage boundary to be addressed for real free-form data.

## 5. Workstream B — 30-day audio default and simpler UI

### B1. Separate new-input defaults from historical readers

| Case | Proposed behavior |
| --- | --- |
| Fresh form / new input omits retention | 30 days |
| Existing approved snapshot or stored record | Preserve its saved 0/7/30 value and hash |
| Existing deadline / queued retention job | Preserve it; do not extend retention retrospectively |
| Editing or repeating a call with an explicit previous choice | Preserve that explicit choice; display the actual period without a selector |
| Older client explicitly supplies 0 or 7 | Continue honoring the supported value; “default 30” does not mean silently override a shorter request |
| Refusal, manual deletion or account/call deletion | Existing deletion behavior takes precedence over retention |

Introduce a single creation-policy constant used by fresh UI/server input paths.
Keep legacy parsing behavior separate: changing a shared `.default(7)` to 30 can
alter old missing-field normalization and hashes. Update the SQL insert default
through a new migration; keep the 0/7/30 constraint for compatibility. Exercise
creation, preparation, retries, edits, direct API/service callers and idempotency.

### B2. Remove the selector, retain useful information

Replace the select with compact informational copy: audio is retained for 30 days
and can be deleted earlier. For historical/inherited choices, display the actual
policy. Keep the manual recording-delete action and the recording's exact expiry
on the result view. Explain that deleting audio does not by itself delete retained
transcripts/results. Avoid displaying technical storage/provider details in the form.

Update all seven UI locales and the applicable content revisions for privacy/help/
onboarding text. Seed edits alone do not update an existing published database.
Use the existing controlled content update mechanism and preserve custom published
edits. Keep managed affirmative consent and local declarative recording copy scoped
to their actual runtime; changing retention does not change recording admission.

### B3. Preserve retention and export semantics

The current worker schedules retention from recording availability and uses
`COALESCE(delete_after, ...)`. It currently reads the brief's retention value at the
recording callback. Pin the policy for an attempt/recording from the execution
snapshot so delayed callbacks cannot apply a later mutable brief value; use the
documented historical fallback only when no snapshot exists.

Retain independent scheduling from summary/ASR completion, provider-deletion retries,
late-write privacy fencing and export revocation. Archive expiry must remain bounded
by the earliest included recording deadline. Never resurrect deleted audio.

Thirty-day storage does not create more model requests. It increases the retained
audio footprint relative to seven days for otherwise identical traffic. Measure
recording inventory and reconcile provider storage billing separately; do not invent
a per-call storage estimate or double-count account billing.

## 6. Workstream C — tester access and administrator-managed scenarios

### C1. Capability and authorization

Keep existing account roles. Add a persisted tester capability with default disabled,
revision and assignment/revocation audit. Display a “Tester” badge in account
administration. Only an active superadmin assigns or revokes it. Existing admins
retain ordinary user/credit visibility because a tester's base role remains `user`.
Staff can be granted the capability without replacing their operational role.

Expose a server-derived effective capability to the authenticated frontend. Check
current account status and capability when reading the catalog. Missing legacy
fields mean no access. Revocation takes effect on subsequent server requests; clear
cached catalog data on account change/sign-out. A previously inserted text remains
an ordinary user draft; removing template access need not erase authored text.

Use expected-revision mutation and database authorization checks, following existing
admin patterns. Record actor, target, old/new state and timestamp. Include access
state in account export and apply account deletion/anonymization rules. Do not grant
staff pages, wider languages, bypassed verification, extra credit or new tool authority
through this capability. Use existing credit/admission controls for a hackathon budget.

### C2. Persistent catalog

Create a small catalog with stable scenario IDs and immutable content revisions.
Suggested fields, all new and subject to implementation contract review:

| Field | Purpose |
| --- | --- |
| `id` | Stable catalog identity |
| `revision` | Optimistic concurrency and immutable selection provenance |
| `title` | Short button label; proposed maximum 80 characters |
| `objectiveText` | Plain task text, validated against the current 4,000-unit objective limit |
| `contentLocale` | Explicit authored language, distinct from spoken call locale |
| `status` | Draft, active or archived |
| `sortOrder` | Deterministic button ordering |
| `createdBy` / `updatedBy` / timestamps | Administrative provenance |

The initial editor needs title, objective text, language, order and active state.
Saving a change appends a revision; activation selects that revision atomically.
Archiving removes a scenario from future selection while preserving references
from earlier drafts/calls. Already inserted text never changes when an administrator
edits a template. Avoid hard deletion of referenced revisions.

Scenario content is plain text, without HTML, executable expressions or injected
system instructions. It enters the same untrusted user-task channel as manually
typed text and never modifies model/tool configuration. The runtime receives only
the selected task, not the catalog or other scenario descriptions.

Use existing locale conventions for interface labels. Authored scenario content
retains its language; optional localized variants can share one stable ID. If a
fallback language is shown, label it rather than silently generating a translation.
An initial catalog does not require new translation-model requests or a template
variable engine. Relative natural-language dates are preferable to soon-expiring
hardcoded dates; exact existing appointments still require actual details.

### C3. Admin and tester API

Proposed endpoints (not existing routes):

| Endpoint | Access / behavior |
| --- | --- |
| `PUT /api/admin/users/:id/testing-access` | Superadmin; expected revision; assign/revoke |
| `GET /api/admin/testing/scenarios` | Superadmin; bounded list including inactive revisions/status |
| `POST /api/admin/testing/scenarios` | Superadmin; create validated draft |
| `PUT /api/admin/testing/scenarios/:id` | Superadmin; expected revision; edit, activate, reorder or archive |
| `GET /api/testing/scenarios` | Active account with tester capability; active entries only, private caching policy |

“In the admin console” does not mean every admin role can mutate templates. The
recommended first release uses superadmin-only catalog management, which can later
be broadened through an explicit permission. Handle 401/403/409 and validation errors
with clear UI messages. No anonymous template endpoint or client-only access gate.

### C4. Scenario buttons above the objective

Load the permitted catalog once when rendering the creation form. Place title
buttons immediately above the objective textarea. Use the existing form state and
in-memory account-scoped draft store; do not persist task data in localStorage.

1. Clicking a button in an empty objective inserts its text and updates the counter.
2. If the objective contains text, show the replacement and explicit replace/cancel
   choices; retain one-step undo. Do not concatenate two scenarios automatically.
3. Write only the objective. Destination, represented identity, language, context
   and existing facts keep their own fields and remain visible for review.
4. Recalculate the combined input budget; show conflicts/oversize before preparation
   and never truncate values. Existing context/facts can make a valid template too large.
5. Disable template replacement during an in-flight preparation. Subsequent edits
   use the normal revision/idempotency behavior; a late old response cannot restore
   an obsolete draft or approval.
6. Keep task text editable. A click does not prepare a plan, spend model budget,
   approve a task or start a call. Existing explicit user actions continue to do so.

Support keyboard activation, mobile wrapping and an accessible insertion/undo
announcement. Keep template details and catalog maintenance out of the caller's
ordinary task flow. Clinical demo templates must distinguish synthetic information
from real supplied patient facts; do not prefill fictitious insurance data as though
it belonged to the signed-in user. Enter the intended controlled destination explicitly.

### C5. Scenario provenance and expenses

Capture scenario ID/revision and a server-derived comparison of inserted versus
submitted objective when creating a preparation, if the user retains scenario
provenance. Treat client metadata as untrusted and never use it to grant authority.
Keep the submitted task itself authoritative; record edits honestly rather than
claiming exact execution of a stock scenario. Other fields also affect outcomes.
Store this attribution alongside preparation/attempt records, outside existing
immutable raw-brief and approval hash payloads. An optional metadata field must not
change historical hashes through a new default.

Freeze the tester classification at preparation/attempt time for later filtering;
do not reclassify historical calls from the user's current capability. Extend
telemetry/export and expense filtering with bounded metadata, not duplicated task
text. New tables require source-inventory, account-export and deletion decisions.

A tester's real call still incurs ordinary application provider/telephony expenses
and consumes its configured credits. A scenario label is a cohort, not a second
charge or a budget exemption. It is distinct from the separate diagnostic-project
ledger used by paid synthetic provider probes. Existing totals must remain unchanged
when the tester filter is absent.

## 7. Suggested initial scenario set

Administrators control the final content. Start with a small set whose purpose is
clear and whose outcome can be checked:

| Button title | Task characteristics |
| --- | --- |
| Ask a simple question | One factual question; meaningful positive or negative answer |
| Ask the price, then book | Unknown prerequisite first; explicit price limit and permitted time windows |
| Appointment with supplied details | Subject-labelled DOB/contact/visit history; share only as relevant |
| Confirm an existing appointment | Exact known date/time; no new booking authority |
| Reschedule | Exact existing appointment plus replacement windows and old-slot disposition |
| Cancel | Exact appointment; no replacement booking |
| Pass on a message | Brief approved message; no invented callback or external delivery |

Keep negative testing in a separate controlled checklist: refusal/discard,
answering machine/retry, interruption, contradictions, missing information,
unmet booking conditions and recipient hangup. A scenario preset does not force
the other party to follow a script or guarantee a model outcome.

## 8. Verification matrix

| Area | Required cases / evidence |
| --- | --- |
| Field placement | Same DOB, phone, address, insurance reference and visit history in objective, context, facts, mixed and repeated placements |
| Formats | Paragraph, bullets, labelled lines, mixed source/call languages, leading zeros, spaced identifiers, ambiguous dates and Unicode limits |
| Subject | Account owner versus represented adult/child; recipient address versus patient address; call destination versus contact number |
| Restrictions | Share only when asked, withhold entirely, contradictory values, correction versus quoted historical correspondence |
| Authority | Booking request in objective + bounds in context succeeds; quoted/context-only action cannot silently grant authority |
| Conversation | Answer known details directly; no extra lookup/tool/permission for ordinary facts; concise opening and closing; no repeated known question |
| Assessment | Successful booking remains achieved when optional personal facts were unused; required conditions still count; recipient hangup still yields a result |
| Review/history | Original sources inspectable; existing approval/hash and archived reader fixtures unchanged |
| Retention | Fresh default 30; explicit 0/7 preserved; old omitted-field reader stable; delayed/duplicate callbacks, inherited/repeated calls and immutable deadlines |
| Deletion/export | Manual delete, refusal, provider retry, expired recording, stale archive and account deletion outrank retention |
| Tester permissions | Active superadmin grant/revoke; other roles denied mutation; non-tester direct API denied; staff/user administration and credits unchanged |
| Catalog | Create/edit/activate/archive/order; concurrent revision conflict; old selection unchanged; inactive entry unavailable to new selection |
| Form | Empty/occupied objective, undo, keyboard/mobile, combined budget, account switching, late preparation response and editable template text |
| Accounting | Ordinary versus tester cohorts reconcile to unchanged totals; no costs on catalog reads/clicks; no conflation with diagnostic-project probes |

Separate automated guarantees from model acceptance. Offline tests can prove source
transport, contracts, authorization and state transitions. They cannot prove that
Live pronounces every identifier correctly or that the compiler interprets every
paragraph. Run paired model tests with synthetic data and an explicit request/cost
budget, followed by controlled phone acceptance. Measure task correctness, first
response/closing behavior, repeated questions, backend calls and cost together.

## 9. Delivery sequence and rollback

| Stage | Deliverable | Exit criterion |
| --- | --- | --- |
| 0 | Freeze baseline and add field-placement/authority regression fixtures | Current supported behavior reproduced; gaps distinguished from model hypotheses |
| 1 | Source semantics, concise versioned prompts and clearer input/review copy | Complete sources in every profile; unchanged authority; no extra ordinary-turn backend request |
| 2 | Objective projection protection | Migration/read parity, rotation/export/deletion and archived-hash checks pass |
| 3 | Fresh 30-day default, selector removal and content revisions | Historical shorter choices/deadlines preserved; retention/export tests pass |
| 4 | Tester capability and persistent admin catalog | Server access checks, revisions and admin/credit regression tests pass |
| 5 | Objective buttons, undo and test provenance | No automatic preparation/call, no draft loss, correct expense/export grouping |
| 6 | Budgeted model and controlled telephone acceptance | Representative field placements and all chosen demonstration scenarios pass |

Keep storage, retention, catalog/UI and prompt changes independently reviewable.
Do not combine them with a new speech transport, automatic orchestration or calendar
integration. The optional encrypted source-reference extension in A3 is conditional
on evidence; it is not a required second extraction pipeline.

Rollback disables scenario visibility/capability and selects the previous preparation
policy for new work. Existing jobs/approvals keep their versions. Do not roll back
by deleting action/history rows, restoring deleted audio, changing applied migration
checksums, extending old deadlines or altering a live attempt's frozen descriptor.

For the hackathon, first use the current local runtime and controlled recipients.
A shared/public demonstration environment needs its own deployment and operational
decision: adding testers does not remove the native-v2 production guard. This plan
does not silently authorize public-beta activation.

## 10. Review evidence from this planning pass

- Source-path probe used synthetic data and the deterministic compiler; all three
  field placements reached approval v8, startup Live input and backend instructions.
- The probe reproduced the compiled-context omission asymmetry and rejected
  context-only action authority. It did not call a model or database.
- Existing focused API suites passed: 40 tests in 4 files (`brief-compiler`,
  `native-preparation`, `compiler-instructions`, `live-native-profiles`).
- The installed Vitest runner was invoked directly after Corepack could not resolve
  the package registry; no dependency update was performed.
- Local evidence is in ignored `.tools/task-input-audit-20261108.mts` and `.json`.
  These are reproducible investigation artifacts, not committed customer fixtures.
- No application behavior, account role, database, retention policy, provider request
  or live service was changed. This file records the proposed implementation.


## 11. Implementation checkpoint

The approved work is implemented, including automatic scenario access for
superadmins and the separately requested first-page PDF task assessment. The
[maintained feature reference](../task-input-and-testing.md) is normative for
the final contracts and boundaries; the [verification record](../reports/task-input-testing-implementation-2026-11-08.md)
records evidence and remaining telephone acceptance. Sections 2–10 preserve the
original investigation and recommended design, including its then-current state.

Implementation choices:

- Keep compiler 13 and approval 8 unchanged; version the added Live/backend
  information rule as `live-native-context-2026-11-08`.
- Use an independent grant, not a new mutually exclusive account role.
- Bound the whole catalog to 100 scenarios and return the complete authorized
  list; no silent pagination truncation. Archived revisions remain available to
  validate an already inserted draft. Concurrent saves require expected revision.
- Use PUT for full scenario replacement. Initial example content remains under
  administrator control; no real personal information is seeded.
- Store provenance outside task/approval hashes. Add cohort totals and filters
  to the existing expense explorer; preserve unattributed historical operations
  as unclassified and keep provider-project reconciliation independent.
- Preserve original summary evidence in the PDF. Show a short saved overview,
  explicit status and partial-analysis notice before the conversation. No export
  causes a model call.
- The optional second source-extraction pipeline in A3 was not introduced: the
  complete original source bundle already supplies this information to Live.
  Statistical model behavior and acoustic acceptance still need controlled calls.
