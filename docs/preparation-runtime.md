# Call-plan preparation runtime

**Source reviewed:** 2026-11-11, current working tree. This describes code, not the
state or measured capacity of a deployed server. See the [native runtime](native-live-runtime.md)
for startup context, conversation and action boundaries. Dated preparation plans
and measurements are [historical evidence](archive/README.md). Host configuration
and rollout procedures live only in the ignored `docs/local-operations/` directory.

## Immutable policy and operator controls

Native holistic revision, 11 November 2026: policy
`preparation-live-holistic-2026-11-11` selects `brief-compiler-17`, plan schema 11
and the existing approval 10. The progressive instruction remains: resolve prerequisites
before dependent actions, reveal constraints when relevant, and avoid a spoken agenda.
Live and its backend receive the complete approved localized plan; original sources
remain in preparation, audit and post-call assessment only.
`CALL_RUNTIME_PROFILE=native_v2` selects this holistic policy through the audited
`runtime:configure --apply` command. Startup checks that the saved policy matches.
Historical jobs retain their pinned policy. The unprofiled in-memory default remains
`preparation-live-native-v2-2026-11-06`; the historical SQL seed uses the managed policy.
Neither default is a substitute for explicit deployment activation. The public settings
API has no `promptVersion` setter. See [runtime profiles](runtime-profiles.md) and
[dated evidence](reports/native-live-integrity-2026-11-08.md).

| Prompt policy suffix | Compiler | Plan schema | Native approval |
| --- | --- | --- | --- |
| `live-native-v2-2026-11-06` (unprofiled memory default) | `brief-compiler-10` | 8 | 7 |
| `live-native-actions-2026-11-06` | `brief-compiler-11` | 9 | 8 |
| `live-native-progressive-2026-11-07` | `brief-compiler-12` | 9 | 8 |
| `live-native-integrity-2026-11-08` | `brief-compiler-13` | 9 | 8 |
| `live-native-roles-2026-11-09` | `brief-compiler-14` | 9 | 8 |
| `live-native-task-2026-11-09` (historical) | `brief-compiler-15` | 10 | 9 |
| `live-plan-only-2026-11-10` (historical) | `brief-compiler-16` | 10 | 10 |
| `live-holistic-2026-11-11` (named native profile) | `brief-compiler-17` | 11 | 10 |

All policy IDs in the table start with `preparation-`. The earlier
`preparation-2026-10-05` policy uses compiler 6 / schema 4. Historical readers
support earlier schemas through explicit compatibility contracts; reading an old
plan does not silently upgrade its authority or make it eligible for native v2.
Sources: [policy contract](../packages/contracts/src/preparation-policy.ts) and
[compiler selection](../apps/api/src/brief-compiler/brief-compiler.ts).

## Holistic preparation (current native profile)

The canonical plan is the single task authority for Live and its reasoning backend.
All its human-language content is in the selected call language, including objectives,
facts, question purposes, conditions, criteria, native descriptions and the full
appendix. Input language and UI language do not change that contract. Names and exact
identifiers are preserved. A translated review is a separate display artifact bound
to the canonical revision/hash; approving it never replaces the execution plan.

The generator writes a compact task with plain localized facts and optional typed
appointment proposals. It does not write source quotations, named-entity proofs,
task-evidence paths, application settings or stable requirement IDs. The application
supplies trusted settings and parties, resolves relative calendars using one frozen
reference time and assembles the exact approval-10 execution context. Structural,
size and native authority invariants remain deterministic.

The existing `language_audit` stage reviews that complete context against the original
task. Its only output is `accept`, `revise` or `clarify`, plus a bounded message. It
checks material fidelity, language, roles, permissions and completeness. First-person
source text belongs to the principal by default; generated assistant speech must
attribute those facts correctly. No language-specific extraction or literal citation
matching gates run on this policy.

There is one shared recovery: regenerate an invalid candidate, correct a semantic
finding using the actual rejected candidate, or repeat an invalid audit against the
unchanged context. There are at most two candidates and two audits, within existing
provider, deadline and cost limits. Input/output moderation and bounded transport
retry remain; no new model stage or voice-stage request is added.

Approval 10, native action evidence and terminal decision contracts are unchanged.
The conversation follow-up uses voice identity `live-plan-only-2026-11-11`; it keeps
full approved startup context and the existing action-boundary tools. Summary source 3 carries source-free appointment
authority for schema 11. Readers retain historical contracts and snapshot hashes;
historical pinned policies retain their earlier validation paths.

Migration `0116` adds independent preparation validation events. Safe metadata exposes
stage/code, correlation IDs, attempts, policy/model/build and hashes. Private evidence
contains supplied sources, usable/partial model output, schema errors, rejected
candidates and exact audited contexts; opaque provider reasoning is not retained.
Evidence is encrypted and bounded to 256 KiB per event, 1 MiB and 100 events per
preparation, with explicit truncation. Retention is 30 days; cancellation removes
private evidence and account/call deletion purges it. Stale worker writes cannot
recreate deleted evidence. Diagnostic failure never replaces the preparation result.

The existing admin inspector shows safe events. Its private access/export action
requires a superadmin, an explicit reason, an audited access record and a no-store
response. Telemetry exports include available evidence; ordinary logs retain only
fixed safe codes and correlation IDs. Preparation observability includes outcomes by
policy, cause and recovery use. See the [implementation plan](plans/preparation-audit-simplification-2026-11-11.md)
and [validation evidence](reports/preparation-holistic-validation-2026-11-11.md).

## User-facing errors and historical validation

Preparation failures expose an optional typed `issue`: reason kind/code, known
source/category, affected fields, retryability and next action. All seven UI locales
explain policy restrictions, unsupported actions, missing input and technical failures.
Unknown model refusals do not invent a safety category; output moderation is a generated
plan failure, not an accusation about the user's request. Legacy records without a
specific cause retain a general explanation. The optional field has no default and
does not change historical compilation hashes.

`GET /api/admin/system/preparation` reads settings; `PUT` changes generation profile
and capacity using the existing policy. It cannot change the prompt policy version.
Only a current, active superadmin can mutate it; origin/session checks, database
authorization, expected revision and an audit record apply; the comment is optional.
A conflict returns 409. Reads are private/no-store. A lost response requires refresh
before another save.

The admin System panel selects `gpt-5.6`, `gpt-5.6-terra` or `gpt-6-luna` and
Standard/Fast for **generation**. Audit and review stay on `gpt-5.6:default`.
All supported model/tier combinations can be selected by a superadmin in every
environment, without an evaluation report or admission step. The historical
`approvedProfiles`/report fields and optional evidence endpoint are retained for
compatibility and history only; they never gate selection. Saving makes no paid
provider request. The former `PREPARATION_LOCAL_TESTING` bypass has been removed;
the old environment variable has no effect. Evaluations remain an optional tool,
and switching a profile is not proof of model quality or provider availability.
New preparations use the selected profile; existing ones retain their snapshot.

Recipient integrity is independent of whether the label names a person, practice
or organisation. Raw identity and snapshots retain the original spelling. Speech
comparison accepts complete-token Unicode/case/diacritic normalization and the
existing deterministic Cyrillic transliteration. Inflected Cyrillic forms must be
attested in the user's source. It does not guess translations, abbreviations or
approximate spellings. Postal addresses and protected identifiers retain their
strict checks. Unknown transformations still require repair/review.

For native schemas 9 and 10, a primary identity may be preserved in a source-verified
`person`, `organisation` or `location` entry in `namedEntities` instead of being
repeated in the task prose. Both recipient and represented-person labels must
still be preserved in full, using the comparison rules above. Every declared
identity remains subject to source validation; this exception does not satisfy
address or protected-reference checks. Approval snapshots build the canonical
parties from the original form fields, and Live receives those parties and the
represented person's opening identity separately from the task. This applies to
the general profile and every native appointment operation. Historical managed
validation, including its intermediate schema 8, is unchanged. See the
[identity regression tests](../apps/api/src/brief-compiler/native-identity-integrity.test.ts).
Existing rejected revisions remain immutable; retry preparation after deploying
the fix to produce a new revision under the corrected validation.

Compilers 14 and 15 distinguish the principal who commissioned the call, the recipient
heard on incoming audio, and the subject of each fact. Matching names do not merge
these roles. A preference or result can concern the recipient, principal or a third
party; preserving the spelling of both names does not establish correct attribution.
The compiler preserves that relation across the objective, questions and criteria.

The existing audit request now checks language and fidelity to the original task
for the role-fidelity policy. It receives labelled parties, original task sources and
the execution plan. Language checks apply to execution fields, not source-language
input. Semantic findings identify actual plan paths and bounded reason codes;
malformed or incomplete audit responses fail closed. Repairs share the existing
request budget, deadline and bounded audit-repair allowance. The historical telemetry
stage remains `language_audit`; the new response format is `execution_fidelity_audit`.
Earlier pinned policies retain their language-only audit. Successful new preparation
still uses one generation and one audit, in addition to input/output moderation.
No per-turn model request, transcript guard or speech gate is added to Live.

Protected-reference extraction is heuristic. The October implementation evidence
records a `finish-by-16:30` false-positive case; that dated observation is not a
fresh reproduction against the integrity compiler. Model selection alone does not
guarantee absence of validation repairs.

## Native task compilation and user-facing errors

The integrity compiler preserves original objective, context, facts, clarification
answers and delivery instruction. It derives general or appointment capability
from approved authority. Appointment profiles are `book`, `confirm_existing`,
`reschedule` and `cancel`; conditional alternatives remain ordered and permission
must not be inferred from untrusted recipient text. The conversation resolves an
unknown prerequisite before pursuing a dependent action, discloses constraints when
relevant and reuses known answers. Full primary context is supplied to Live at
startup; optional appendix sections are indexed for retrieval. Preparation produces
authority and context, not a script that Live must recite.

Relevant facts may be supplied in any primary field. Context provides background,
conditions and factual values; appointment action authority must be grounded in the
objective or clarification answers. Explicit withholding and conditional disclosure
remain binding. The review page exposes the original sources, and `approvedFacts`
is not the complete disclosure boundary. Required destination and identity inputs
remain separate. See [task information](task-input-and-testing.md#task-information).

The optional v2 request-envelope field `testScenario: { id, revision }` records
scenario origin outside the brief and approval hashes. Scenario text goes through
the same validation, moderation, compilation, review and approval as manual input.
Effective tester access is captured even when no scenario is selected. The catalog
adds no compilation stage and no ordinary-turn model lookup. The 8 November catalog
change used `live-native-context-2026-11-08` without changing its compiler policy,
schema or approval format. The earlier role-fidelity release,
`live-native-context-2026-11-09` with compiler 14, used schema 9 / approval 8.
The subsequent historical task-boundary release used `live-native-task-2026-11-09`,
`preparation-live-native-task-2026-11-09`, compiler 15, schema 10 and approval 9.
Compiler 16 retains that task schema and audit while removing raw sources from
approval 10; see the plan-only boundary below. Optional prohibitions, task-specific stopping conditions and unresolved
criteria may be empty. Product controls remain enforced outside these lists.
The compiler supplies audit-only `taskEvidence` for criteria, restrictions and
follow-up conditions. Local validation checks complete/unique target coverage,
source paths and exact source substrings; the existing combined audit checks
semantic support, explicit restriction coverage, internal-instruction leakage and
conditional branch applicability. A matching substring alone is not semantic proof.
Evidence is included in the compilation hash but excluded from execution plans,
Live prompts and translated review fields. Empty sections are omitted from review.
Explicit user restrictions remain visible even when similar to system rules.

Current plan-only model output places `sources` beside each criterion/restriction
(`{text,sources}`) and follow-up (`{condition,question,sources}`). The API constructs
canonical `taskEvidence` indexes from those items before validation. The model no
longer maintains a second target list, so duplicate or missing cross-references
cannot arise from indexing mistakes. No sources are guessed or filled in. Exact
quotes and semantic support still pass the existing checks. This is a provider
transport change only; stored plans, review/execution shapes and historical policy
formats are unchanged. Repair feedback uses the new item paths.

The same plan-only audit constrains returned paths with enums of existing fields.
Language findings use exact spoken-field paths. Semantic findings can name fields
through three path components; deeper calendar/authority details are reported on
their containing item or section. All underlying content remains in the audit.
Evidence mismatches point to the supported task field, not the provenance table.
This bounds the schema without enumerating every calendar leaf or accepting guessed
paths. A nonconforming, truncated or malformed provider response still fails closed.
Neither change adds a model request, parser-repair model or retry allowance.

Plan-only generation also supplies `namedEntities[].source`: an exact original
name plus its source field, alongside the localized `value`. The optional stored
field preserves historical source-free schema-10 records without adding defaults
or rewriting their hashes. New generated entries explicitly use an object for
person/organisation/location provenance; other labels may also carry an exact
source term. Date/reference entries normally use null. A provided quote is always
validated; dates retain their existing calendar checks.
Local validation checks the quoted source and preserves literal identifiers,
numbered labels and postal addresses. A source match only admits the candidate
to the existing combined audit: that audit must verify identity equivalence,
branch/role preservation and all entity mentions in the executable prose,
including entities omitted from metadata. No city alias dictionary, fuzzy name
acceptance, extra model stage or additional repair allowance is introduced.
Source provenance is hashed with the compilation and excluded from execution and
translated review prose. Deploy updated readers with the writer: older binaries
that strip the new source field cannot verify hashes of newly sourced plans.

Bounded `validationFindings` on new compilations retain attempt, local/audit stage,
field and reason, plus entity source/value when available. These non-authoritative
diagnostics live with encrypted compilation content, not content-free operational
logs, and are excluded from approval hashes and execution. Entity repairs receive
the specific mismatch instead of only a generic fact-integrity error. Historical
plans and approvals are not repaired in place; a new preparation is required.

The successful preparation path retains generation plus one combined audit and
the existing moderation requests; repair limits, deadlines and Live autonomy are
unchanged. Historical policy prompts, approvals and their schemas remain supported.
Activate the saved policy with `runtime:configure --apply` while API/workers are
stopped and work is drained; prepare a fresh plan to exercise the new format.

`taskEvidence` covers every success/unresolved criterion, task restriction,
stopping condition and conditional-follow-up condition. Each entry names its
target field and quotes the relevant objective, context, delivery instruction,
allowed fact or clarification answer. The local check verifies source paths,
exact substrings and complete/unique target coverage. The combined model audit
checks whether that evidence supports the meaning after corrections; it also
checks that genuine user restrictions have not disappeared. Role or quote-handling
instructions invented by the compiler are repaired in the task content, not added
as a new prohibition. An inapplicable conditional branch is not a missing answer.

Generation, audit and repair still use the existing provider-operation reservation,
completion and usage hooks. The combined audit retains stage `language_audit` for
accounting/diagnostic compatibility; semantic repair records `repairKind=integrity`.
Source evidence adds request/output tokens, not another model stage. Actual usage,
missing-usage handling, pricing and user-credit rules are unchanged. Full compilation
evidence is available in authorized diagnostics and telemetry exports, while the
ordinary admin timeline remains minimized. See the
[release record](reports/native-task-boundary-2026-11-09.md) for the regressions.

New objective and context fields each allow 4,000 JavaScript string units after
trimming. The shared aggregate counts normalized Unicode code points: warning at
6,000 and rejection above 8,000 across objective, context, facts, clarification
answers and delivery instruction. Field maxima are not additive allowances. Old
stored context can still be read up to 12,000 characters. See the
[complete limits table](native-live-runtime.md#input-and-allocation-limits).

The optional typed preparation `issue` preserves a machine-readable reason and
localized presentation without changing historical hashes when absent. Distinguish
policy rejection, unsupported actions, missing information and technical failure.
Only a known source/category may be shown as such; an unspecified provider refusal
must not be assigned an invented safety reason. A generated-plan moderation failure
does not imply that the user's original request violated policy. `retryable` and
`nextAction` drive recovery; `affectedFields` can be empty when no field is known.
All seven UI locales provide explanatory copy. Old errors without detailed provenance
retain a generic explanation. Input and output moderation, local validation and
user review remain separate boundaries.

Sources: [compiler instructions](../apps/api/src/brief-compiler/compiler-instructions.ts),
[native authority compilation](../apps/api/src/brief-compiler/native-appointment-compilation.ts),
[issue contract](../packages/contracts/src/preparation-issue.ts),
[localized messages](../apps/web/lib/i18n/preparation-issue-messages.ts).

## Account phone policy

`registration.swissPhonesOnly` controls registration, unverified phone correction,
verification/resend and account phone changes. The API checks it before provider
IO; PostgreSQL mutation transactions lock current policy before account/challenge
rows and revalidate before persisting changes. Existing verified accounts retain
login and recovery. UI country selection and explanatory/error copy follow this
policy in all seven locales. An old settings client omitting the new field preserves
the current value. Migration 0108 preserves existing behaviour; production rollout
explicitly enables this setting through the audited policy before reopening traffic.

## Preparation snapshots

Each preparation snapshots policy revision, stage models and tiers, prompt/pricing
versions, request/output limits and the absolute deadline. Retries and review use
that snapshot. Old rows have `runtime_policy_source=legacy_unknown`: the migration's
compatibility baseline is **not evidence of their historical model/tier**. New rows
are `pinned`. Ledger request and actual response fields remain authoritative.

The snapshot defaults are 120 seconds including queue, 35 seconds per generation
request, at most 12 provider requests across durable attempts, and 20,000 output
tokens. The process preparation timeout can impose a smaller ceiling. Moderation,
language audit, local validation and user approval remain mandatory. Unsupported
prompt/generator versions must be rejected rather than silently replayed differently.

The preparation deadline ends at plan publication/failure; automatic review
translation is a separate durable job with its own timeout and retry budget.
Pinning the review profile does not give it the same absolute deadline. Browser
submission recovery currently waits up to eight minutes. The desired 10–15 second
target and 30-second total ceiling are not implemented end-to-end. Neither more
workers nor the padding guard proves that target or model quality.

## Scheduling and isolation

| Role | Durable jobs / services | Default call SQL pool |
|---|---|---:|
| `preparation` | brief compilation; separate review text lanes | 4 |
| `operations` | answer detection timeout, provider call reconciliation, live transcript finalization | 3 |
| `background` | final transcription, recording retention/reconciliation, provider cost reconciliation, other text; exports, notifications, deletion and billing | 6 |
| `all` | legacy combined local/single-worker mode | 6 |

`WORKER_ROLE` selects a role. `PREPARATION_WORKER_SLOTS` defaults to 2 for a prep
process, 1 otherwise; `REVIEW_WORKER_SLOTS` defaults to 1. Both are bounded.
`CALL_REPOSITORY_POOL_MAX` controls that pool only, not every connection in a
process. Prep creates no auth/export/notification/billing dependencies. Background
also budgets auth 5, notifications 3, export 3+1 and billing 1; listeners and other
configured clients must be counted separately. API defaults to a call pool of 6.
Its testing store has a separate PostgreSQL pool capped at 3; role workers do not
instantiate that store. Catalog access occurs outside the voice conversation path.

The immutable job `work_class` routes review separately from background text.
New role processes never run global call recovery on startup. Operations seed
idempotent reconciliation jobs; a provider state or fenced runtime timeout must
justify a call transition. Legacy `all` retains its old recovery behavior and must
not run alongside role workers.

Claims and capacity changes serialize on one short database transaction. No
transaction is held across provider HTTP. Global defaults: four active preparations,
two reviews, four provider requests, forty queued/running preparations, at most two
waiting and one active preparation per user. The next preparation is chosen by
its user's least recent start, then oldest eligible job. Idempotent replay never
consumes an extra queue place. Reducing capacity affects new claims and lets current
work drain. Full queues return localized 429 with Retry-After and preserve the draft.

Every claim has a fresh owner UUID plus generation/attempt fencing; ownership is
never reused after a capacity deferral. Renew, result publication and terminal job
updates validate ownership and expiry. Role workers use database time for leases.
Lease loss aborts provider IO. Admission deferral consumes no worker retry attempt;
any already issued requests still count against the persisted request budget.
An expired queued preparation is failed and its encrypted input cleared.

Shutdown stops claims, retains the draining heartbeat, waits up to 30 seconds,
aborts remaining requests, and bounds the worker drain at 35 seconds. The process
has a 45-second final shutdown bound. A local abort cannot prove remote billing
stopped; unknown operations retain their permit until expiry and are never called free.

## Shared provider and monetary budgets

`providerRequestsPerMinute` (default 100), `providerTokensPerMinute` (2,000,000) and
`voiceReservePercent` (25) are application allocations. They are **not discovered
provider quotas**: configure them to the project's actual shared limits before
increasing concurrency. Preparations and text workers share one conservative
quota scope across all supported models and both tiers. This safely combines
potentially shared model families, at the cost of sometimes underusing independent
quotas. Usage outside this application is not accounted for by this database.

Admission reserves request count and a conservative UTF-8 byte/output token bound
for a rolling minute. Completed/error/unknown requests do not refund that window.
The voice percentage is excluded from the available preparation allocation.
Voice requests outside the gateway are not forcibly throttled by it; their observed
usage, configured quota and possibly a separate provider project remain necessary.
429, Retry-After and exhausted request/token reset headers create a shared cooldown.
Waiting is scheduled in the durable queue, never a sleeping SQL transaction.

Beta monetary admission reserves at least the full request estimate using the
chosen profile and versioned rates, alongside its existing configured reserve.
Requested tier and actual tier are separate. An actual Standard downgrade uses
Standard prices; missing/unknown usage or tier remains unknown, never zero.
Historic rate cards are immutable. New Fast requests fail closed after the current
promotion validity bound (2026-11-22 UTC) pending a reviewed new rate card.

Pricing references checked 2026-10-05: [Fast mode](https://developers.openai.com/api/docs/guides/fast-mode),
[Terra](https://developers.openai.com/api/docs/models/gpt-5.6-terra),
[Luna](https://developers.openai.com/api/docs/models/gpt-6-luna),
[official pricing](https://developers.openai.com/fr-FR/api/docs/pricing).

## Transport and diagnostics

Generation and audit request SSE. Only a completed, validated response reaches
publication; partial output is not shown as a finished plan. The parser handles
fragmentation, comments, UTF-8, EOF, failed/incomplete responses and bounded JSON
fallback. It bounds the total response to 8 MB and each buffered event to 2 MB.
Error and cancelled bodies are released. Reservation, body reading and accounting
are included in the preparation deadline; review also bounds those phases.

There are at most six checkpoint rows per operation: dispatch, headers, first
event, response created, first output, terminal. They contain offsets and bounded
IDs/tier only. No prompt, token delta, authorization header or error body is stored.
Checkpoint persistence is best effort and cannot trigger another paid request;
provider reservation and terminal accounting still fail closed for publication.
Existing transport v1 evidence remains compatible and absent evidence remains null.

The stream reader bounds consecutive JSON formatting whitespace outside quoted
strings to 256 characters, across event/chunk boundaries. Exceeding it cancels the
reader with `OPENAI_STREAM_PADDING`; whitespace and escapes inside strings are
preserved. Initial compilation may use its existing single schema repair with
explicit compact-output feedback. Repeated padding fails; deadlines and request
budgets never reset. Aborted padding retains its provider permit until expiry,
because cancellation does not prove remote work or billing stopped. Diagnostics
add optional numeric output-event/UTF-8-byte counts and first/last-output offsets,
without storing generated text. This is protection against a reproduced runaway
output pattern, not proof of a 30-second end-to-end latency guarantee.

The inspector and call export include checkpoints and requested/actual tier.
`GET /api/admin/system/preparation/runtime` returns fresh role heartbeats, queue
counts/ages and daily stage aggregates. Heartbeats include slots, active jobs,
draining state, RSS, heap, cumulative CPU and event-loop p99. Never sum RSS from
two heartbeats belonging to the same process's prep/review workers.

Detailed diagnostic metadata/checkpoints expire after 30 days; anonymous daily
aggregates after 90. Accounting is not deleted by this retention. Call/account
deletion clears details transactionally; insert guards prevent late metadata from
reappearing. The background role runs serialized hourly maintenance and startup
maintenance. `/health/workers` checks required fresh roles (or legacy all), rejecting
mixed modes; `/health/ready` continues to check API/database availability separately.

## Reproducible verification tools

From `apps/api`:

```text
node --import tsx scripts/test-isolated.ts
node --import tsx scripts/load-preparation.ts --processes=2 --slots=4 --users=10 --duration-seconds=60
node --import tsx scripts/evaluate-preparation.ts --full --repetitions=2
node --import tsx scripts/evaluate-preparation.ts --suite=roles --full --profiles=gpt-5.6:default --repetitions=2
```

The first two create and drop only their own randomly named test database using
`TEST_DATABASE_URL`. They never reset an existing application/developer database.
The load runner uses independent Node processes and mock provider latency. It saves
queue/end-to-end percentiles and runtime samples, never claims real voice capacity.
The normal test suite separately covers concurrent mock calls and preparation.

Evaluation uses 200 synthetic multilingual cases/variants (including a held-out
subset) and writes JSON, SHA-256 and a human-review worksheet. Default execution
is mock: its status disagreements and timings cannot approve model quality.
Live execution additionally requires `ALLOW_BILLABLE_EVAL=true`, explicit
`--live --budget-usd=<approved amount>`, API credentials and an intentionally chosen
profile list. Conservative preflight reservation stops the run before its bound;
failed/unknown requests are not refunded. Reports record corpus/prompt/pricing/code
versions, working-tree state, requests and unknown usage. Human checks cover facts,
constraints, authorization, language, clarification, refusals and injection.

The `roles` suite contains six synthetic scenarios across five locales with
`--full`: matching first names, different names, a third-party subject, a true
principal subject, two facts with different subjects, and an explicit correction.
It retains compiler 14's policy as its default. To evaluate the current plan-only
release on this corpus, pass `--prompt-version=preparation-live-plan-only-2026-11-10`. Use
`--prompt-version=preparation-live-native-integrity-2026-11-08` for a baseline on
the same corpus. Reports carry source-grounded subject expectations and fields to
review. `statusMismatches` is an automatic status screen; `criticalFailures: null`
and `semanticReview: required` deliberately leave semantic correctness unmeasured
until human review. Offline execution makes no provider request and cannot test
whether a model will actually detect the role error. These cases evaluate preparation,
not spoken Live behavior; representative live conversations must also check the
final spoken attribution, corrections and appointment readbacks.

`node scripts/preparation-capacity.mjs <measured-profile.json>` calculates the
tightest memory/CPU/connection envelope with at least 20% memory headroom. It does
not certify a maximum. The acceptance procedure still requires 60-minute steady
load, bursts, fault/restart/drain checks and concurrent representative real calls;
report the highest passed step and working reserve, not CPU count as worker count.

Hedging, parallel audit/moderation and persisted intermediate compilation candidates
remain the explicitly deferred optimizations from the original plan.

## Historical plan-only preparation (10 November 2026)

`preparation-live-plan-only-2026-11-10` pins compiler 16, compiled schema 10 and
approval 10. It preserves source text in compilation and post-call assessment,
but excludes it from all conversational runtime inputs. The existing combined
audit receives the full localized execution projection and verifies that no
necessary fact, correction, disclosure condition or conditional completion rule
relies on source text at execution. New preparation uses the same request/repair
budget. Historical policies retain their prompt versions. See
[native context](native-live-runtime.md#task-preparation-and-initial-context).
