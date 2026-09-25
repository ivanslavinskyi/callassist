# SHPROHLI architecture

Updated 2026-09-25 for parallel voice runtimes, registration policy, phone parsing,
unanswered-call retries and localized call UX. Source migrations run through 0083.
Remaining work and release decisions live in the [roadmap](mvp-plan.md);
[dated audits and verification](README.md) retain the evidence available at their dates.

The immutable-plan, provider-cost and staged database-cutover implementation is
recorded in [the delivery roadmap](approved-call-plan-cost-security-roadmap.md).
This architecture includes the integration of that mainline work with the audit fixes.

## Runtime and repository boundaries

The [call lifecycle/history checkpoint](call-lifecycle-history-2026-09-15.md) adds a shared latest-attempt read projection from durable events and the immutable credit ledger. Transport completion, no answer, consent refusal, missing consent and a confirmed conversation are distinct. Customer history is `/[locale]/app/history`; New call retains five recent calls. Admin lists and metrics use the same evidence, while goal feedback remains separate.

### Voice runtime selection

`VoiceRuntime` and its factory select `OpenAIRealtimeBridge` or `OpenAILiveBridge`
from `VOICE_RUNTIME_DRIVER`; absent means `realtime`, invalid values fail startup.
The Live pilot keeps the existing Realtime consent/opening/farewell controller and
uses native Live for the main full-duplex conversation after opening playback.
Responses delegation defaults to GPT-6 Luna with `parallel_tool_calls=false`.
Twilio `mark`/`clear`, speech epochs and immutable approved execution snapshots
remain application-owned. A model result never proves an external action completed.
Native Live transcripts and duration plus delegated token usage feed existing
transcript/ledger paths; recording-based post-call ASR is unchanged. Startup fallback
can resume the prepared Realtime session, but failure after Live starts ends the
conversation rather than replaying actions. See [protocol, billing and acceptance](gpt-live-pilot.md).

### Retry and call-page behavior

`POST /api/call-briefs/:id/repeat` clones a definitively unanswered, settled attempt
into one new draft per source attempt. Ownership, lifecycle evidence and source
availability are checked transactionally. It copies the validated compilation and
ready review translations, clears approval and compiler-operation identity, and
requires a fresh review receipt and execution snapshot. Consent, tool decisions,
results, transcripts and feedback are not copied. Unchanged edits do not recompile;
task changes do. Expired appointment windows require edits before a new start.
Current email, destination, credit, quota and spending checks apply at admission.

History/recent rows use `sourceObjective` from the original compiler response, or
retained source-language text for older records, with UI truncation and no list-time
LLM calls. Call pages expose New call/History on mobile. Saved feedback becomes
read-only with explicit Edit/Save/Cancel; failed requests preserve the draft and
idempotency key. All new customer flows support DE/FR/IT/RM/EN/RU/UK.

### Profile defaults and controlled call completion

New call forms receive only the current account's ID and first/last names from the
server. Names remain directly editable for this call; stored plan inputs take precedence
over profile defaults. Initialization is one-time and keyed by account, so rerenders
do not overwrite edits. Recompilation/approval still creates immutable snapshots.
Root App Router icon assets use the supplied portal geometry with `#222B25` and
`#138553`; metadata resources bypass locale redirects.

With `REALTIME_AGENT_HANGUP_ENABLED=true`, the bridge exposes `end_call` only after
consent and opening playback. The function's validated reason requests a separate
farewell audio response. A controller correlates response IDs, speech epochs and
playback generations: a completed generation is not itself proof of playback.
Only its matching Twilio mark causes normal hangup. Speech invalidates the pending
mark before `clear` and truncates the model audio history. An interrupted-closing
context invalidates the old end request. After the new recipient turn, a text-only
structured decision in the same Realtime session selects `end`, `answer`, `wait`
or `clarify`; its result is fenced to the current speech epoch/generation.
New questions receive a response, a reciprocal farewell requests a fresh closing,
and a request to wait does not authorize hangup. This is model interpretation with
deterministic lifecycle guards, not a guarantee of understanding every utterance.
Late, duplicated or cancelled responses cannot finish a different turn.

Before closing the stream (which continues existing TwiML to Hangup), the service
advances the existing attempt-bound `provider_call_reconciliation` job to two
seconds from now. The durable worker checks the provider state and stops that same
leg if needed. Retries check status again after ambiguous errors; provider callbacks
and reconciliation retain the existing status, credits, cost and ASR paths.
Migration 0062 adds the hangup event to the database vocabulary; no alternate
`stopped` transition was added. A transport `completed`
status does not prove that the business objective succeeded.

Generation has a 10-second watchdog; playback uses queued PCMU duration plus a
2-second allowance, capped at 15 seconds from the farewell request. Persistence
has a 2-second bridge deadline; on failure, the stream closes and the existing
maximum-duration recovery remains the last bound. Twilio REST requests time out
after 10 seconds. Recording downloads have a separate 30-second total deadline,
including response headers, body and the legacy mono fallback. `conversation.hangup` records bounded phase/reason/trigger facts,
with normal or fallback reasons in `conversation.ended`. Feature flag rollback
requires an API restart and leaves consent/error paths and queued recovery intact.

Migration 0068 adds `conversation.tool_result`: bounded tool/phase/decision metadata,
without spoken text or tool arguments. Runtime instructions separate silent control
operations from speech: no server/tool narration or invented reasons for constraints.
The approved opening introduces the caller and purpose once; new compiler instructions
do not rewrite an already approved opening. Recipient-first hangup is a normal outcome.

Initial evidence is in [R21 verification](r21-verification-2026-09-08.md);
later changes and acceptance limits are in [conversation stabilization](call-conversation-result-stabilization-plan-2026-09-10.md)
and [the 2026-09-11 verification](call-result-live-fixes-2026-09-11.md).
Live-provider acceptance is recorded separately and this addition does not close R08.

The pnpm/Turbo monorepo has three packages:

| Package | Responsibility | Main sources |
| --- | --- | --- |
| `@callassist/web` | Next.js 15 App Router, React 19, customer/admin UI, SSR session guards, SEO | [app](../apps/web/app), [components](../apps/web/components), [lib](../apps/web/lib) |
| `@callassist/api` | Fastify 5, application services, Twilio ingress, Realtime/Live runtimes, SQL repositories, workers | [API entry](../apps/api/src/index.ts), [worker entry](../apps/api/src/worker.ts), [routes](../apps/api/src/app.ts) |
| `@callassist/contracts` | Zod 4 schemas, public/domain DTOs and controlled vocabularies | [exports](../packages/contracts/src/index.ts) |

```text
Browser -- HTTP / credentialed SSE --> main Fastify API (0.0.0.0:4000)
Next.js SSR -- forwarded Cookie ----> private main-API origin
                                         |
                                     PostgreSQL
                          state / ledger / audit / durable leases
                             |                        |
                     LISTEN / NOTIFY          dedicated worker
                     invalidation only        compilation / transcription
                             |                retention / reconciliation / text artifacts
                         API instances        account-deletion loop

Twilio PSTN <--> Media Stream <--> Twilio listener (127.0.0.1:4001)
                                      | same API process
                                      +--> Realtime or native Live/Responses conversation
                                      +--> isolated consent-recognition session

Twilio consented WAV --> worker download --> channel utterances --> final ASR
                                            mono/unsupported --> full-file ASR
```

The two Fastify listeners share `CallService` and the API process. The Twilio listener
exposes signed voice/status/recording callbacks and the Media Stream WebSocket, no
application API or health routes. A reverse proxy must be able to reach its loopback
bind; a separate container cannot reach it through another container's loopback.
No production deployment manifest currently resolves that topology.

`DURABLE_WORKER_MODE=embedded` runs workers inside the API for development.
`external` makes the API enqueue creation/recompilation preparations and durable call work; the
standalone worker owns startup recovery, seeding, polling, leases and heartbeats.
`AccountDeletionService` uses a separate leased request/attempt store in the same
worker process; it is separate from the seven `durable_jobs` types. Production requires external
mode. [Configuration and endpoints](runtime-reference.md) describe the actual inputs.

## Browser, session and role boundaries

Customer/public routes live under `/de`, `/fr`, `/it`, `/rm`, `/en`, `/ru` and `/uk`: Landing, content slugs,
register/verify/login/recover, onboarding, opt-out, redeem, `/app`, `/app/account`,
`/app/history`, and `/app/calls/[id]`. Admin is primarily English under `/admin`, with separate console
and preview route groups. Removed localized admin and old call routes have no
compatibility redirects. See [admin architecture](admin-interface-architecture.md).

Account email and phone editors expand inside their own profile row, with one
contact editor open at a time. Opening/OTP transitions focus the editable input;
closing or saving returns focus to its trigger and success is announced beside
the updated row. Requests in flight disable switching to another profile editor.

The URL selects customer UI locale; middleware negotiates absent locales from a
browser cookie, `Accept-Language`, then English. Account language preferences have
their own PATCH API. UI, editorial content, call locale and text-processing languages
use separate registries. DE/FR/IT/RM/EN/RU/UK UI catalogues are enabled; adding another UI
catalogue does not add a call voice or enable an untested translation direction.
CMS supports separately published localizations and identifies the actual fallback
locale in rendered content. Call-language option names use the UI locale.

Public call choices are `de-CH`, `fr-CH`, `it-CH`, `en-GB`; `ru-RU` is visible only
to superadmins. German, French and Italian labels have no country suffix in the supported
UI locales. Historical `de-DE`/`en-US` remain in persisted contracts, but editable
forms normalize them to `de-CH`/`en-GB`, including fallback choices. A duplicate
fallback is removed; immutable plans and history retain the original locale.

The public landing replaces the old problem section with the approved EN/DE founder
story and supplied portrait. It is a frontend-only rendering option at the existing
section position: CMS structure/publication and admin draft preview stay unchanged.
Hero, final and demo-result CTAs share `LandingPrimaryAction`: guests use the CMS
registration action, authenticated roles go to `/{locale}/app`. The existing app
guard routes content editors to `/admin/content` and enforces onboarding for others;
there is no extra content-management CTA. See [delivery evidence](delivery-2026-09-16.md).

Each preparation captures a language context separately from the executable plan:
detected input language, detection status (`detected`, `mixed`, `undetermined`), selected
task content language, selection source and revision. There is no numeric confidence
field. An explicit task choice wins; otherwise an existing context is preserved.
For a new automatic task, resolution is supported detection, account fallback,
supported UI hint, then English. Changing the
UI never rewrites an approved plan, translation or result. Unsaved call inputs survive
UI navigation in an account-scoped in-memory draft store; raw drafts are not put in
browser persistent storage. The task content language is editable before approval
and frozen afterwards. The form selects only the call language; a collapsed correction
beside the plan changes the task language before approval. Summary and transcript
translation use the saved task language, without separate target selectors. The
API still models artifact target language separately; the simplified UI does not
collapse these domain concepts. Original and translated views remain available.

Authentication uses scrypt password hashes and random opaque session tokens. Only
token hashes are stored; the browser receives an HttpOnly, SameSite=Lax cookie.
Production adds Secure and the host-only name `__Host-callassist_session`; development
uses `callassist_session`. Session listing exposes at most 50 categorized
browser/platform summaries, not tokens or raw User-Agent. Current, selected and all
sessions can be revoked. Suspension revokes sessions atomically; unsuspension does
not revive them. Expired/revoked/suspended/deleted identities cannot authenticate new
requests. Established SSE streams revalidate durable authorization before each
frame and heartbeat; revocation also closes existing connections (R19 implemented).

Next.js SSR forwards the cookie received by the web host to the private API. Deploy
web and browser-facing `/api` on the same public hostname: separate `www` and `api`
hostnames do not share this host-only cookie, even if CORS allows both. Internal
service origins can differ. Fastify uses explicit `TRUSTED_PROXY_CIDRS`; production
requires reviewed peers or `none`. The actual edge must strip spoofed headers and
isolate the API listener; see [deployment preflight](deployment-preflight.md).

A shell-scoped `SessionProvider` hydrates a minimal request-scoped, no-store SSR
snapshot from `/me`; there is no module-global user state. Client checks refresh on
pathname/focus/pageshow/visibility changes, deduplicate in-flight requests and reject
late responses after logout. Unknown/loading state disables landing actions; a failed
check exposes retry rather than guest registration. Identity changes clear displayed
credits. Authenticated login/register requests redirect through the existing app
guard. These UI decisions do not replace server-side role or session authorization.

| Role | Customer calls | Content/SEO | Operational admin | Sensitive call text |
| --- | --- | --- | --- | --- |
| `user` | Own calls | No | No | Own calls |
| `support` | Own calls under normal customer authorization | No | No | Own calls only |
| `content_editor` | Denied | Yes | No | No |
| `admin` | Own calls | Yes | Yes, scoped user controls | Own calls only |
| `superadmin` | Own calls | Yes | Yes | Separate reasoned, audited read |

Navigation is not authorization. Layouts, route helpers and API handlers enforce
session, current legal acceptance, role and resource ownership independently.
Normal call reads/mutations/SSE/media/retries derive the owner from the session and
return `CALL_NOT_FOUND` for foreign resources. Preparation IDs have their own
owner-scoped boundary. Nullable legacy call owners remain hidden pending a migration
policy. Signed provider callbacks use signature and provider/call identity instead
of browser sessions.

## Accounts and legal acceptance

Registration requires explicit first/last names and SMS phone verification; verification
grants three signup credits exactly once. Registration OTP is not login MFA.
Password recovery uses a non-enumerating start, a ten-minute/eight-attempt OTP challenge
and a separate fifteen-minute single-use hashed grant. Password reset atomically
revokes all sessions. Login rechecks the verified password hash under the repository
lock to prevent a stale-password session race.

Phone/email replacement requires the current password and a ten-minute/eight-attempt
challenge bound to the initiating session. The new contact remains pending until
verified; completion preserves that session, revokes others and invalidates unused
password recovery capabilities. Email uses Resend in production and an independent
HMAC key for codes. Failure to send the new-address OTP invalidates the challenge;
the old-address notice is best effort and only goes to a verified address. Completion
of email/phone changes and password recovery sends security notices to verified
addresses. Notification failure does not reverse a committed account change. There
is no durable notification outbox, so a crash or final delivery failure can lose a notice.
Registration policy is revisioned in beta settings: `onboarding=full|registration`
and `emailVerification=required|deferrable`, defaulting to full/required. Simplified
registration requires a Terms/AUP/Privacy checkbox that starts unchecked and records
accepted published revisions atomically with account admission. Stale documents roll back registration.
After SMS, unverified users always see the email screen. Deferrable mode adds an
explicit Later action before or after code sending. Deferral persists for the current
address, clears on address change/verification and never sets `email_verified_at`.
Required policy gates new call starts and is rechecked under the admission lock.
Full mode still requires onboarding after email verification or allowed deferral.
Migration 0082 stores deferral and Privacy revision evidence; 0083 stores retry provenance.
Initial email verification sets `email_verified_at`. Signup phone typos can be corrected using the registration password before
phone verification. The eventual OTP result is bound to the unchanged phone number.
A shared `libphonenumber-js/max` parser accepts national input using an explicit
country selector, or international `+`, `00` and bare country-code forms including
the supported optional trunk-zero variants. It stores canonical E.164, rejects
extensions/free-text extraction and never infers country from UI locale.
The account selector follows `SMS_ALLOWED_COUNTRIES`; SMS delivery is limited to
CH/UA by default, independently of Swiss-only call destinations. Replacement checks
occupied numbers (including unverified registrations) before sending an OTP; a conflict
after provider approval returns `PHONE_CHANGE_NOT_AVAILABLE`, not a wrong-code error.
All real SMS sends share phone/global budgets and carry an explicit communication locale.
Email templates use a bundled CID PNG logo, transparent table layout, and localized
Impressum/Support links only. `NEXT_PUBLIC_SITE_URL` must also reach the API for footer
links; production requires a public HTTPS origin. Future email languages use explicitly
labelled English legal pages until localized pages are published.
Name editing is an owner-scoped PATCH. See the current
[email/SMS implementation and acceptance](email-sms-implementation-2026-09-14.md).
See [recovery](password-recovery-policy.md), [phone change](phone-change-policy.md) and
[account profile](account-profile-improvement-plan.md).

Onboarding has **one required Terms/AUP checkbox** and informational consent,
retention, use-limit and credit text. The API still receives four legacy
`acknowledge* = true` compatibility fields. They are not four separately checked
user agreements. Immutable acceptance references the exact published Terms/AUP
revision IDs; material publication requires re-acceptance before call/credit/admin
access. Public content reads never expose drafts. Web public-content fetches use
60-second revalidation; publication is not an immediate cache-invalidation push.

## Call preparation and policy

1. The browser normalizes a brief and binds a UUID idempotency key to a fingerprint
   in owner-scoped session storage, without storing raw form text there.
2. `POST /api/call-preparations` validates ownership, field limits, Swiss destination,
   idempotency and rate limits. One transaction persists encrypted input and a
   `brief_compilation` job; the response is `202` with a `Location` header.
3. A worker compiles/moderates the request. Fenced publication inserts one brief,
   marks preparation `succeeded` and erases its input in one transaction. Failed or
   cancelled preparations also erase input. At-least-once execution converges on one
   call through the creation key. Status polling returns bounded progress or a
   controlled failure; a browser timeout does not cancel durable work.
   The browser waits up to eight minutes across recovery attempts and keeps a
   viewport-fixed status panel visible. No progress state implies approval or dialing.
4. Editing or clarifying an existing call also queues an idempotent encrypted
   preparation. The worker compiles the captured target revision; publication checks
   the immutable compilation ID, increments revision, resets approval and erases
   input atomically. Failure/stale publication leaves the previous revision intact;
   starting is blocked during active recompilation.
5. Approval and approve-and-start require the exact reviewed revision and snapshot
   hash. Append-only compilation/approval rows bind each attempt and stream token to
   that plan. There is no synchronous POST /api/call-briefs create endpoint.

For new and previously unapproved compilations, policy v2 additionally requires a
server-verified review receipt. It records either the original call-language plan
or the exact ready translation artifact/hash, together with selection revision.
The receipt is outside the execution hash and is immutable; each attempt captures
its ID and default content language. Repository transactions and a database trigger
enforce the receipt on every start. Migration 0066 grandfathers only exact approvals
already present at cutover as v1; recompilation creates v2. Displaying another language
does not modify the existing approval evidence.

The OpenAI compiler produces strict structured output: detected source language,
localized objective/opening/questions, task classification, allowed-fact translations,
success/unresolved/stop criteria, assumptions, risk signals and fixed clarification
codes. Source facts must round-trip exactly. Raw input and generated runtime text
are moderated separately. Deterministic policy decides review/clarification/blocking;
the model cannot approve itself. Formal addressing, captured spoken results and
voicemail without private details are explicit defaults.

Generation requests use compact JSON, low verbosity and a 20,000-token output
ceiling including reasoning. Incomplete Responses envelopes are rejected while
preserving their paid usage. With a real compiler and enabled text generation,
mock translation configuration is rejected; saved mock review artifacts cannot
be presented or approved as real translations. See the
[preparation checkpoint](plan-preparation-quality-2026-09-15.md).

Immutable call_compilations rows are the authoritative source for plans. The
canonical hash is revalidated at reads, approvals and attempt reservation. Realtime
receives an ApprovedExecutionSnapshot projection of the reviewed plan; raw authoring
fields are excluded. Full runtime text is moderated and protected identifiers must
be preserved. The legacy mutable reader/dual-write and media adapter are removed.
All user-provided facts in the approved plan are authorized for use when needed
during the call. Those facts alone do not authorize an appointment action. The
2026-09-10 extension adds explicit, versioned permission to either book or confirm
one appointment or personal meeting with the called recipient, for the approved purpose/service and inclusive
local start-time windows. Confirmation of an existing appointment requires exactly
one date and start time; only new bookings allow flexible windows. New bookings use the first offered matching slot, without
an earliest-available guarantee. Rescheduling, cancellation, payment, deposits and
new financial/cancellation terms remain outside that permission.
Compiler 5 interprets scheduling intent semantically and requires a quoted source
from the objective or a clarification answer for proposed authority. Context alone
does not grant it. A compiler-only calendar interpretation describes concrete dates,
ranges, relative days or the next calendar week, weekday/date exclusions and start
intervals. The server expands it against one trusted clock in the specified IANA
zone; the resulting windows are the persisted, reviewable authority. Calendar
explanations may reference excluded dates derived from that same finite domain;
this does not make those dates bookable. Other protected identifiers retain their
source checks. This is a model interpretation followed by user approval, not a
deterministic proof of natural-language meaning. Compiler 3 and 4 snapshots remain
readable with their original hashes; schema 4, policy 3 and execution 2 do not change.
One bounded regeneration can repair a malformed or inconsistent model plan. Genuine
missing constraints require clarification; an unrepaired integrity failure is shown
as a preparation error with a retry of the saved request.
The pure server `check_appointment` validator rejects mismatched or unconfirmed
details, invalid/past dates and nonexistent or ambiguous local times. Its success
permits an action; only the recipient's subsequent confirmation supports a booked
result. For a personal meeting this means the intended person's explicit agreement,
without requiring a provider or a calendar entry. Model assertions about service and recipient are not calendar verification;
there is no calendar API. Runtime integration is implemented; a supervised personal
meeting was confirmed in the [2026-09-11 audit](call-result-live-audit-2026-09-11.md).
This does not close the broader multilingual/adversarial voice acceptance in R08/R14.
Additional live permission prompts are not the product authorization model. Legacy approval
storage/routes remain for compatibility; R08 acceptance concerns adherence to the
preapproved facts and action limits, with adversarial and authorized live evidence.
Ordinary `end_call` is implemented behind the R21 flag described above.

Profiles are `sebastian`, `daniel`, `martin`, `anna`, `sofia`, `maria`; name/gender
snapshots are server-derived. Assistance reasons are `none` (default, no disclosure),
`speech_impairment` and `language_barrier`. Explicit represented-person first/last
names are required. New calls select `de-CH`, `de-DE`, `fr-CH`, `it-CH`, `en-GB` or
`ru-RU`. Historical `en-US` remains readable but is not a new choice. Swiss Standard
German does not imply dialect recognition.

`allowLanguageSwitch` permits one explicitly selected `fallbackLocale` different
from the primary call locale. That choice is captured in the execution snapshot and
constrains the Realtime prompt; it is not an independent detector or hard validator
of the spoken language. Unrestricted automatic language selection is not implemented.

## Consent, audio and transcription

Twilio creates calls with recording disabled and connects a signed Media Stream with
an attempt-scoped HMAC token bound to the approved snapshot hash. Two OpenAI sockets are opened. The **main audio
session** speaks the short AI identity/represented-person/recording question. The
separate text-output session recognizes recipient consent speech with automatic
response creation disabled. It does not generate the spoken disclosure. By the user's
decision on 2026-09-09, every localized spoken notice uses the previous short text:
AI identity, the represented person and the request to record and automatically
transcribe. It does not include the two added sentences about AI recognition of the
reply and audio retention. Public privacy/FAQ/onboarding copy still describes actual
processing and retention. Zero-day retention involves temporary recording after consent.

After the disclosure playback mark, recipient media can enter only the consent
recognizer. A deterministic locale-aware classifier returns affirmative, negative or
unclear. Recognized negatives take precedence. Affirmatives must match a complete
allow-listed phrase; questions, quotes, extra conditions and unrecognized suffixes
cannot grant consent. Regression fixtures include qualified EN/DE/RU refusals.

There is one clarification, then
DTMF fallback; `1` is accepted only in that fallback stage. Timeout or refusal ends
the call. The application does not persist the raw recognized consent phrase or
pre-consent audio; this makes no claim about provider-side retention.

On grant, the server closes the consent socket, persists consent method/locale/time
and starts dual-channel recording. Failure produces a same-voice notice and termination.
The main conversation receives recipient media only after recording startup **and**
the mandatory opening playback mark. Optional assistance disclosure occurs after
consent. The opening asks whether it is convenient to continue; later conversational
readiness and fact limits depend partly on model instructions. Realtime disconnects
end the call; reconnecting that model session is unsupported.

The final-transcription worker downloads authenticated Twilio media (browser playback
uses a separate owner-authorized proxy). For supported stereo WAV it extracts speech
regions: channel 1 recipient, channel 2 assistant. It transcribes assistant utterances
first, then recipient utterances using the nearest preceding recording-derived
assistant text as bounded context. Each phase has concurrency four. Roles/times come
from recording channels and local speech detection. Live transcript text/roles are
ignored by this path. Mono/unsupported/unextractable audio takes one whole-file
plain-text fallback with no invented speaker roles.

Runtime defaults are `gpt-4o-transcribe` for utterances and `gpt-transcribe` for fallback.
The transcriber class alone falls back to its full-file model if no utterance model is
passed; runtime wiring explicitly supplies the utterance model. Input is bounded to
25 MiB and requests to 180 seconds each. A failed/empty utterance fails the final
result; partial output is not published as completed. Legacy alignment utilities and
historical `unknown` segments remain readable but are not the production ASR path.
See [transcription](post-call-transcription-plan.md) and [channel decision](channel-aware-final-transcription-plan.md).

## Plan translations and result artifacts

`text_artifact_generation` runs in a separate durable worker loop, so translation
does not occupy the telephony/retention worker slot. Typed artifacts cover plan review,
clarification review, transcript translation and call summary. Dedupe binds call,
kind, immutable source identity/hash, target language and generator/model version.
Original final transcripts have encrypted immutable revisions and stable segment IDs.
Unsegmented historical text is split without losing characters; speaker/timing remain
unknown. Source ASR processing/failure does not expose an older revision as current.

Translations retain source segment IDs and times. Summaries use the original final
transcript plus the exact executed compilation (objective, success criteria and
questions). The only supported summary payload is strict `schemaVersion: 2`:

- `overview`: up to four compact material points, each referencing `findings` IDs;
- `findings`: neutral labels and results for the caller, with `reported`, `conditional`
  or `unknown` certainty and references to original source segments;
- `nextSteps`: concrete actions supported by source segments, omitted when none exist;
- `unresolved`: remaining limitations as text, not a separate source-bearing object.

The validator requires evidence for non-unknown findings and all next steps; it
checks references, not truth independently of the recording. Negative, partial,
conditional and conflicting answers are valid outcomes. The compact view has
expandable detail/evidence; if compaction is unavailable it shows validated findings.
Summary generation uses its own `summary-v3` namespace, separate from the
`text-processing-v2` translation/review generator; it does not retain a v1 summary
reader. Plan/approval/ciphertext version compatibility is a separate concern.

Results do not change technical call status or user feedback. The UI identifies
generated text, links evidence to the original and keeps the original readable when
processing fails or a direction is disabled. Clipboard copy and branded PDF download
use the displayed original/translated transcript with distinct labels and metadata;
there is no separate TXT download endpoint. Automatic summary enqueue is atomic with final
transcript completion when that direction is enabled; it never delays audio retention.

Validated chunks persist across retries. Storage caps each artifact at 24 provider
requests across at most three job generations (initial plus two manual retries),
with at most three automatic attempts for translations/reviews and two for summaries in each generation. Summary input is bounded
to eight source chunks; optional final compaction may fail without discarding the
validated detailed result. Request accounting spans generations and never resets on
manual retry. `queued`/`processing` derive from the durable job, including retry backoff;
PostgreSQL reads artifact and job progress in one snapshot. The public `retryable`
flag and retry command share budget/generation/permanent-error rules, with current
source and enabled-direction checks on mutation. Provider 429, timeout, 5xx, permanent
rejection and cancellation have distinct safe diagnostics; bounded `Retry-After`
schedules the job instead of occupying a worker. Summary requests default to 90 seconds,
translation/review to 45 seconds; see [configuration](runtime-reference.md).
Current-source checks and job ID/worker/generation/attempt leases fence
every publication. Owner deletion requests cancel text jobs and reject new provider
reservations or late completions before eventual content redaction. Feature and
direction switches stop new generation without removing retained ready results.

Audio retention is 0, 7 (default) or 30 days. The deletion deadline is assigned from
successful final-transcript completion, not the call-start timestamp; regeneration
updates that deadline. Zero-day audio becomes eligible immediately then. Failed
transcription can retain audio for retry. Retention work is durable and monitored, not a wall-clock guarantee during
provider/worker outages. Deletion of a terminal call deletes provider audio before
local redaction and fences content jobs. Account anonymization processes owned calls
before tombstoning identity and revoking sessions. Contact challenges are erased
atomically; startup/hourly maintenance enforces their 30-day limit. See [data lifecycle](data-deletion-policy.md).

## Credits, admission and abuse

The ledger grants `+3` on verification. Starting reserves `-1`; connection alone
does not settle it. Consented attempts hold the reservation for the final transcript
and the existing summary job. One canonical `summary-v3` request also grades the
substantive exchange and goal against the attempt's approved plan. Server checks
same attempt, compilation, source revision/hash, trusted recording consent, recipient
speaker, preceding assistant question/message and exact quote. A confirmed exchange
creates a zero-value `call_charge`; task success is a separate result. Negative facts,
lack of knowledge and referrals count as conversation; greetings, consent alone and
immediate refusal to talk do not. No answer/busy/no consent refunds immediately.
Uncertain evidence or terminal analysis failure refunds; unresolved reservations
expire five minutes after termination is processed. An independent worker sweep runs
even during slow provider work, and completion rechecks the deadline. Process outages
can delay refunds until recovery, but cannot authorize a charge after the deadline.

Migration 0074 stores a canonical assessment per attempt, including encrypted decision,
plan/source hashes, source revision, evaluator version, state/reason and deadline.
Assessment, generated summary and ledger settlement commit in one transaction. Reads
of assessment and settlement use one database snapshot. Uniqueness prevents duplicate
settlement; a late result can correct history while leaving an earlier refund intact.
Translated summaries reuse the canonical decision when available; a language requested
before it is ready can generate its text and enqueue the canonical job, but cannot
independently grade or debit. No per-reply realtime credit classifier remains.
Legacy v1 ledger evidence is still readable. User deletion redacts decision ciphertext;
account export and key rotation include it. Manual goal feedback and user/staff
classification remain independent of `lifecycle.assessment` and AI aggregate counts.
See [final assessment implementation and acceptance](post-call-assessment-diagnosis-2026-09-15.md).
PostgreSQL locks and unique constraints serialize starts, protect balances
and enforce one active attempt per user. Promo plaintext is stored only as a keyed
digest; redemption and manual reasoned grants are transactional/idempotent.

Admission checks active user, approved policy, CH number, global switch, recipient
suppression and quotas before reservation. PostgreSQL beta defaults: three starts/hour,
ten/UTC day per account, two/recipient/rolling 24 hours across all accounts, 420 seconds
maximum, one call/account and two globally. Open registration admits 30 accounts plus
additional one-use admin invitations. Admin System owns the versioned settings and
the rolling 24-hour USD budget; an unset amount blocks paid provider requests.
Call admission reserves full permitted duration; text, ASR, SMS and email reserve
separately against conservative allowances. API and worker serialize reservations
in PostgreSQL. Under the admission lock, eligible completed-operation reserves are
reconciled with reported charges and calculated usage; missing evidence keeps a
pending reserve. Moderation has no monetary allocation. Original reservation
history is preserved; migration 0072 indexes the attempt lookup. Unknown provider
termination retains the concurrency slot. See [current budget accounting](budget-accounting-2026-09-15.md)
and [beta controls](beta-controls-2026-09-14.md) for rollout boundaries.
Memory/test mode retains env-based call policy. Failed/refunded starts still consume abuse
quotas. Disabling outbound calls blocks new starts and does not stop active calls.
Admins can disable; only superadmins can resume. SMS-verified public opt-out and
reasoned staff/complaint suppression/lift are implemented; in-call spoken opt-out and
complaint queues are not.

Public SMS opt-out requires durable proof that Twilio reached the original
destination: provider ID plus ringing, in-progress, completed, busy or no-answer.
Queued/mock attempts and failure/cancellation without earlier contact do not qualify.
Migration 0075 captures the original destination HMAC and stores a separate contact
marker. Owner deletion removes the attempt fingerprint but preserves the independent
marker, with no expiry. Backfill uses trusted provider history and an unambiguous
original destination; ambiguous legacy rows need manual reconciliation.

A dedicated Verify Service is isolated from account verification. The public form
receives an opaque random challenge token for every valid request; only eligible,
successfully sent challenges can be confirmed. Tokens expire after ten minutes and
permit eight checks. A claim lease fences concurrent verification; suppression,
token consumption and audit commit atomically under the recipient lock. Shared
request/SMS/spending budgets still apply. Staff suppression needs no call history.
See [opt-out policy and rollout](recipient-opt-out.md).

Shared PostgreSQL rate limiting uses independent-key HMAC identifiers, atomic grouped
decisions, bounded fixed windows, expiry and a cardinality cap. `429` includes
`Retry-After`; store errors fail closed before sensitive work. Recovery's
eligibility-sensitive SMS decision preserves the generic response. Scope-only hourly
metrics have 30-day retention. [Rate-limit policy](rate-limit-policy.md) lists limits.

## Persistence and encryption

The current catalog extends from `0001` through
`0080_feedback_rotation_after_privacy_redaction.sql`. The catalog is contiguous/checksummed; advisory locking and
per-file transactions protect forward migration/replay. The legacy
`0013_final_transcript_quality.sql` tombstone is accepted only as a pre-catalog record.
Applied files must never be edited to resolve drift. Before 0061, populated databases
must pass the immutable cutover gate: backfill/classify through 0060, drain legacy
attempts/recompilations, verify zero blockers, then deploy the final cutover. The
migration runner enforces the gate; see the [rollout sequence](approved-call-plan-cost-security-roadmap.md#migration-and-rollout-sequence).

| Data family | Representation and protection |
| --- | --- |
| Users, sessions, recovery/contact challenges | Relational identity and capability lifecycle; password/session/grant hashes; pending replacement contacts remain plaintext |
| Call briefs and compilation | Searchable recipient/name/phone/profile fields; encrypted context/facts/assistance; immutable encrypted call_compilations and approval snapshots are authoritative |
| Preparation requests | Encrypted normalized input while pending; retained fingerprint/idempotency/status; erased input on terminal state |
| Attempts, recordings | Immutable approved execution snapshot/hash; provider IDs/status, consent/time/duration/channels/deadline; audio held at Twilio |
| Live transcript and approvals | Relational plaintext transcript and proposed disclosure text, access-controlled |
| Final transcript | Encrypted text/segments and resumable encrypted transcription chunks; model/status/error/usage metadata |
| Text results and review evidence | Encrypted immutable transcript revisions, generated payloads/chunks and review receipts; source hashes, language and lease/accounting metadata are separate |
| Language preferences and task context | Account UI/content preferences and captured preparation/call selection metadata, outside the execution hash |
| Provider accounting | Deduplicated operations, request results, raw usage and reported costs; versioned calculated rates separate from actual/fallback/unknown |
| Feedback/outcomes | Encrypted optional comment; immutable categorical ratings/outcomes and provenance |
| Credits/promos/suppression | Immutable ledger/redemptions, code HMACs, retained safety evidence; suppression phone/reason remain personal data |
| Recipient contact/opt-out | Stable independent-key phone HMAC plus last contact, retained after caller deletion; challenge token digests and phone HMACs expire after ten minutes and are cleaned on new requests |
| Content/editorial/onboarding | Private drafts, immutable publications/audit, localized slugs, legal revision acceptances |
| Jobs/operations/audit | Seven durable call-job types, separate deletion requests, leases/attempts/heartbeats, bounded technical and action events |

AES-256-GCM `v2` envelopes authenticate key ID as additional data; the keyring supports
an active write key, up to four decrypt-only previous keys and an explicit legacy `v1`
mapping. Rotation and restore verification share an inventory of twenty ciphertext
columns, including preparation/text payloads, final assessments, notification
payloads and temporary telemetry archive parts. An integration test
checks the inventory against the migrated schema and completes a queued preparation
after rotating and removing the old runtime key. See the [recovery runbook](database-recovery-and-secrets.md).

Immutable audit/financial/consent evidence is separate from removable call content.
Narrow privacy-redaction triggers allow feedback comments to be removed without
rewriting scores. Migration 0080 also permits the scoped ciphertext/fingerprint
rotation operation; redacted comments remain absent after rotation. “Encrypted private fields” does not mean full-database encryption
or anonymization of all evidence. Database/disk/backup encryption, retention schedules
and deletion replay are separate deployment obligations.

## Jobs, live state and operations

`brief_compilation`, `final_transcription`, `recording_retention`,
`provider_call_reconciliation`, `provider_call_cost_reconciliation`,
`provider_recording_reconciliation` and `text_artifact_generation` are the seven call
job types. Transactions enqueue; expiring leases, renewal and fencing prevent stale
workers from publishing; retries/backoff/dead letters retain immutable attempt
evidence. Provider operations may repeat after a crash. External execution is not
exactly-once. Erased failed preparation input makes manual preparation dead-letter
retry unavailable; the user needs a new request.

Signed callbacks are primary. Reconciliation recovers controlled status fields after
lost callbacks or restart. Recoverable Twilio attempts are not synthetically refunded
just because the API restarted; unrecoverable/mock calls fail closed.
PostgreSQL `LISTEN/NOTIFY` carries process and call UUID invalidations without call
content. API subscribers re-read snapshots; local draft deltas stay with the media
process. SSE uses response-lifecycle cleanup, five-second heartbeats and proxy
buffering headers; reconnect reads canonical state. Every send/heartbeat checks
durable session/account/role/onboarding/ownership; failed or two-second timed-out
checks close the connection. Idle revocation is bounded by five-second heartbeat plus
two-second lookup, subject to event-loop scheduling. Queues are capped at 64 frames.

`CallEvent` is an ephemeral SSE envelope; `DurableCallEvent` is the bounded append-only
technical timeline. Staff/action audit and superadmin sensitive-access evidence are
separate. Default Admin Calls omits recipient identity, call text and private comments.
Technical completion never implies semantic success: user feedback supplies goal
result and transcript-quality ratings with independent provenance.

Live transcript parts use session, role, response, item, output and content indices
as identity. Matching delta/final events replace only their own part; duplicate finals
and late deltas are ignored. `transcript.discarded` clears cancelled/empty/failed-ASR
partials. SSE finals enter the client immediately; an older HTTP snapshot cannot
remove them. Reconnect clears stale partials and refreshes canonical state; deletion
clears client text. Draft deltas are ephemeral, not a cross-instance replay log.

The call UI immediately reveals/focuses the transcript section on confirmed start,
before the API response. The call snapshot then determines dialing, connected or
approval feedback; SSE connectivity alone never establishes phone connection.
Lost updates show uncertainty and pause the animation. The large recipient status
becomes compact once transcript text arrives and disappears for terminal calls.
Status announcements are outside the transcript live region. Typed EN/DE copy,
theme tokens and reduced-motion rules are shared with preparation feedback;
[browser verification](workflow-feedback-2026-09-15.md) records its limits.

The browser follower separates user intent from scroll geometry. Frame-coalesced,
instant updates follow streaming text; wheel/key/touch/scrollbar interaction allows
reading history. Returning to the bottom or using the resume button restores following.
Resize/reflow and visibility changes are observed. The [11-check browser fixture](call-result-live-fixes-2026-09-11.md)
exercises the production controller; it does not replace full live/device acceptance.

Admin overview exposes 24-hour/7-day/30-day creation cohorts with explicit denominators,
sample counts and null/unavailable semantics. Optional versioned micro-dollar rates
produce bounded estimates, excluding compilation/consent-session request accounting
and invoice reconciliation. System shows DB/request-path state, configured providers,
jobs, external-worker heartbeats, webhook buckets, rate-limit aggregates and local
snapshot alerts. It does not probe upstream provider health or deliver notifications.

`/health/live` is process-only; `/health/ready` checks storage. Both are non-cacheable
on the main listener. Bounded body/time limits, unsafe-origin checks, secure cookies
and API/web headers exist. Web CSP permits inline scripts/styles for the current
Next.js implementation; it is not a nonce-based CSP. PII-safe logger configuration
and controlled telemetry are tested. Protected log storage, WAF, monitoring/paging,
named owners and exercised deployment recovery remain open.

Compiler attempts consume a cumulative preparation request budget across retries;
terminal failures do not retry. Completed ASR chunks are reused on retry, with usage
retained even when a request fails. Admin views expose per-call and failed-preparation
costs, raw usage and separate provider-reported/calculated/fallback/unknown amounts.
Public-rate assumptions live in the versioned provider-pricing-policy module.

## Recent admin and content subsystems

The [17–22 September delivery](delivery-2026-09-22.md) adds provider billing/usage
reconciliation (0076), durable superadmin email (0077), localized OG assets and
publication (0078), and telemetry export (0079). Notifications and exports have
independent bounded consumers alongside the call worker. Export reads one
REPEATABLE READ snapshot, streams encrypted database parts, and rechecks session,
role, expiry and privacy revision. Deletion/access changes globally revoke stored
archives; restored archives must be invalidated before reopening traffic. See
[export data boundaries](admin-call-telemetry-export.md).

UI/site/email use the seven-locale registry; the admin UI is primarily English; new registration-policy controls support all seven locales. CMS
completion preserves existing authored translations and legal acceptance IDs.
Analytics settings and privacy acknowledgement do not implicitly grant opt-in
consent; current policy and its release review are documented in
[localization and Analytics](localization-and-analytics.md). Homepage OG publication
is separate from CMS content caching, with immutable image URLs and bundled fallbacks.

## Verification and limits

The [verification index](README.md) separates dated test/build/migration/restore
evidence from current behavior. Latest call/result checks are in the
[2026-09-11 record](call-result-live-fixes-2026-09-11.md); no single old test count is
the current release gate. Turbo declares env/cache inputs, database tests
fail on missing configuration, and both production runtimes require the OpenAI compiler.

A clean build is not proof of browser accessibility, live provider
quality, secure deployment or legal readiness.

Deferred: browser softphone/native apps, teams, payments, external CRM/calendar/RAG,
unrestricted automatic language selection, model-session reconnect, transcript click-to-seek and
operator-corrected revisions, media CMS and indefinite audio retention. High-risk,
bulk/marketing/emergency calls are outside the current product boundary.
