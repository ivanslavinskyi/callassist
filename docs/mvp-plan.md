# Public MVP Roadmap

## Current status

CallAssist already has a working supervised-call foundation:

- a Next.js operator console and shared API contracts;
- PostgreSQL persistence, encrypted private fields, and audit events;
- outbound Twilio calls with signed webhooks and a bidirectional Media Stream;
- a same-voice AI disclosure and DTMF consent flow;
- recording disabled before consent and dual-channel recording after consent;
- an OpenAI Realtime conversation in the selected call language;
- a live draft transcript and a separate recording-based final transcript;
- immediate, 7-day, and 30-day audio retention controls.

The product is still a supervised technical MVP. The multilingual brief compiler now
uses explicit product defaults, separates non-blocking assumptions from fixed-code
blocking issues, supports editing and re-compiling the same brief, and provides a
compact approve-and-call review. The next milestone is to validate this boundary on
representative multilingual and adversarial briefs before public registration.

## Product principles

1. CallAssist is an accessibility and language-barrier product, not only a tool
   for users with speech impairments.
2. The interface language, the language in which the user writes the brief, and
   the call language are independent settings. A permitted fallback call language
   is a fourth, explicit setting.
3. Free-form user input is untrusted source material. It must not be passed
   directly to Realtime or post-call transcription in the public product.
4. The system must preserve the user's intent while applying documented safe defaults
   for ordinary preferences. Clarification is required only when a fixed blocking issue
   can materially change the task or its permitted scope.
5. A model may classify and propose, but it may not authorize itself. Safety and
   disclosure boundaries are enforced by deterministic server-side policy.
6. The user must be able to review what the assistant will do, what it may disclose,
   and what it must not do before approving a call.
7. Live transcription is an operational draft. The final transcript is derived
   independently from consent-gated audio and may explicitly mark uncertain turns.
8. Public release starts with narrowly defined, low-risk call types and expands
   only after evaluation.

## Target brief lifecycle

```text
RawCallBrief (any language)
  -> field validation and input moderation
  -> multilingual Brief Compiler
  -> product-specific risk classification
  -> deterministic Policy Gate
       -> assumptions (non-blocking defaults)
       -> needs_clarification (fixed blocking codes only)
       -> blocked
       -> ready_for_review
  -> compact user preview with optional technical details
  -> edit/recompile the same versioned brief when needed
  -> explicit approve-and-call action
  -> immutable CompiledCallBrief
       -> Realtime conversation
       -> bounded ASR hints
       -> audit trail and structured call outcome
```

The raw brief remains available for user review and audit, but only the approved,
versioned `CompiledCallBrief` is allowed to enter the call runtime.

## 0. Product scope, policy, and evaluation specification

- [ ] Define the first low-risk call categories, starting with information requests,
      receipt confirmations, appointment coordination, document requirements, and
      neutral message delivery.
- [ ] Define prohibited or human-review-only categories, including legal, financial,
      medical, contractual, coercive, deceptive, and impersonation scenarios.
- [x] Define the AI identity disclosure, recording boundary, basic fact allow-list,
      and stop criteria.
- [ ] Define product-specific abuse categories: harassment, disguised insults,
      threats, manipulation, identity misrepresentation, repeated unwanted calls,
      prompt injection, and attempts to obtain or expose unrelated private data.
- [ ] Define a jurisdiction and provider compliance checklist for AI disclosure,
      recording consent, retention, outbound calling, and recipient opt-out.
- [ ] Build a versioned evaluation corpus covering every supported call language,
      different source languages, accents, Swiss German, code-switching, noise,
      interruptions, wrong numbers, voicemail, unclear answers, and adversarial briefs.
- [ ] Establish release metrics for semantic preservation, task success, hallucinated
      facts, correct refusal, false-positive blocking, end-of-turn latency, live ASR,
      final ASR, and unresolved-answer handling.

## 1. Existing supervised-call foundation

- [x] Create, list, start, stop, and monitor `CallBrief` records.
- [x] Select the call language, optional fallback locale, language-switch permission,
      and one of six server-owned assistant profiles.
- [x] Require one of two deterministic assistance reasons (`speech_impairment` or
      `language_barrier`) and generate the localized disclosure server-side.
- [x] Stream UI events over SSE and publish role-labelled transcript segments.
- [x] Place and stop Twilio calls and synchronize provider statuses.
- [x] Verify Twilio HTTP and Media Stream requests.
- [x] Require DTMF consent before recipient media reaches OpenAI or recording starts.
- [x] Start a dual-channel recording only after consent and process recording callbacks.
- [x] Keep one selected Realtime voice across disclosure and conversation.
- [x] Separate the live draft, final transcript, and temporary consent-gated audio.
- [x] Encrypt private context, approved facts, transcript turns, and audit-sensitive data.
- [ ] Validate disconnect recovery, callback reordering, and provider failure behaviour
      across repeated real calls.

## 2. Brief Compiler and policy boundary — current hardening milestone

- [x] Introduce separate `RawCallBrief`, `CompiledCallBrief`, and `PolicyDecision`
      contracts with schema and policy versioning.
- [x] Validate field types, length, phone number, selected locales, identities, and
      allowed facts before invoking a model.
- [x] Add general input/output moderation plus a CallAssist-specific risk classifier.
- [x] Compile free-form input into a strict structured output containing:
      task type, localized objective, ordered questions, conditional follow-ups,
      success criteria, unresolved criteria, stop conditions, approved facts,
      prohibited commitments, tone/register, and named entities.
- [x] Return `needs_clarification`, `blocked`, or `ready_for_review`; apply safe
      defaults for ordinary preferences but never guess a material fact or silently
      rewrite an unsafe objective into an executable one.
- [x] Enforce a deterministic server policy after compilation. The compiler cannot
      override prohibited scenarios, disclosure rules, identity rules, or call limits.
- [x] Restrict assistant identity to a safe six-profile allow-list and derive its
      display name and voice gender server-side.
- [x] Block misleading affiliation or impersonation in represented-person and brief
      content through compilation and policy checks.
- [x] Separate non-blocking assumptions from fixed-code blocking issues. Tone,
      addressing, spoken-answer capture, refusal handling, and safe voicemail behaviour
      have documented product defaults and cannot become arbitrary model blockers.
      Formal addressing is the default; automatic relationship-based and informal
      addressing require an explicit operator choice.
- [x] Show a compact pre-call review with the call-language plan and hide policy,
      guardrail, schema, and snapshot metadata under optional technical details.
- [x] Allow the operator to edit and recompile the same brief or answer a fixed-code
      clarification inline. Each replacement increments the encrypted compilation
      revision and writes an audit event without exposing source text.
- [x] Combine explicit approval and call start into one operator action while retaining
      the server-side approval timestamp and immutable approved snapshot.
- [x] Remove all demonstration recipient, phone, objective, and approved-fact values
      from the live form; examples are placeholders only.
- [x] Add an offline multilingual policy-eval corpus covering routine questions,
      personal and organisational addressing, external delivery, scheduling,
      missing references, conflicting instructions, sensitive disclosure, high-stakes
      requests, harassment, and prompt injection. Live model/audio evals remain pending.
- [x] Stop passing raw objective/context text to Realtime and transcription for all
      newly compiled briefs.
- [ ] Generate ASR hints only from bounded names, organisations, dates, addresses,
      and relevant literal terms in the compiled brief.

## 3. Conversation and transcription quality

- [ ] Add structured call outcomes: `resolved`, `partially_resolved`, `unresolved`,
      `wrong_recipient`, `voicemail`, `declined`, and `technical_failure`.
- [ ] Add explicit uncertainty to final transcript turns instead of presenting every
      ASR result as equally reliable.
- [ ] Validate final ASR output against the selected language and retry suspicious
      turns with a call-language-only prompt and a longer audio context.
- [ ] Benchmark isolated turns, overlapping context windows, full per-speaker channels,
      and alternative transcription models on the same evaluation corpus.
- [ ] Preserve short legitimate answers while ignoring empty/noise-only segments.
- [ ] Measure Realtime understanding separately from live transcript accuracy and
      post-call transcript accuracy.
- [ ] Test Swiss Standard German, Swiss German dialects, supported languages,
      non-native accents, code-switching, packet loss, noise, and interruptions.
- [ ] Add an operator-visible uncertain state and direct audio verification for
      critical details such as names, dates, amounts, addresses, and commitments.
- [ ] Add regression tests that ensure source-language text cannot bias ASR output.

## 4. Accounts, data ownership, and abuse prevention

- [ ] Add users, secure authentication, session management, account recovery, and
      verified contact details.
- [ ] Add `user_id` ownership and authorization checks to every call, transcript,
      recording, approval, export, and audit operation before accepting public data.
- [ ] Define tenant-safe database access and tests that prevent cross-user reads.
- [ ] Add per-user call, duration, concurrency, destination-country, and cost limits.
- [ ] Add global and per-user recipient opt-out/do-not-call controls.
- [ ] Stop repeated calls after rejection, opt-out, excessive failures, or complaints.
- [ ] Add abuse reports, administrative suspension, policy-decision review, and a
      minimal support workflow.
- [ ] Add user-facing data export, transcript deletion, recording deletion, and
      account deletion.
- [ ] Send a stable privacy-preserving safety identifier with model requests once
      user identities exist.

## 5. Multilingual product experience and landing page

- [ ] Introduce an i18n framework before adding more authenticated screens.
- [ ] Keep UI locale, source/authoring language, call locale, and optional fallback
      locale separate throughout contracts, storage, analytics, and the interface.
- [ ] Move all interface copy, validation errors, email copy, status labels, exports,
      and accessibility text into locale catalogues.
- [ ] Add language selection, localized routing, locale persistence, and fallback
      behaviour for missing translations.
- [ ] Build an accessible onboarding flow that explains the call, consent, recording,
      retention, limitations, and allowed use cases in the user's interface language.
- [ ] Build a concise public landing page with the product promise, supported use
      cases, limitations, privacy model, example workflow, and beta entry point.
- [ ] Publish localized documentation, privacy information, terms of use, acceptable
      use policy, subprocessors, retention rules, and contact/complaint channels.

## 6. Production infrastructure and operational readiness

- [ ] Add Redis/BullMQ or an equivalent durable job system for post-call processing,
      retries, retention deletion, timeouts, and scheduled maintenance.
- [ ] Make provider webhooks and background jobs idempotent across restarts and
      multiple API instances.
- [ ] Deploy the isolated Twilio webhook/Media Stream gateway separately from the
      authenticated application API.
- [ ] Add production secrets management, database migrations, TLS, backup, restore,
      and disaster-recovery procedures.
- [ ] Add PII-safe structured logging, traces, health checks, error monitoring,
      provider alerts, latency metrics, and cost alerts.
- [ ] Verify encryption, retention, deletion, export, backup expiry, and the complete
      audit trail in the deployed environment.
- [ ] Add rate limiting, request-size limits, CSRF/session protections, secure headers,
      dependency scanning, and a production security review.
- [ ] Define incident response, abuse response, support ownership, and a rollback plan.

## 7. Release sequence

- [ ] Run internal dogfooding against the versioned evaluation corpus.
- [ ] Run an invite-only alpha with fixed call credits, supported destinations, and
      low-risk use cases only.
- [ ] Review failed calls, policy decisions, ASR uncertainty, complaints, deletion,
      and provider costs during the alpha.
- [ ] Run multilingual safety red-teaming and resolve all release-blocking findings.
- [ ] Complete the legal/privacy review for the initial launch jurisdictions.
- [ ] Launch a limited public beta with quotas, abuse controls, monitoring, support,
      and an emergency disable switch.
- [ ] Expand languages, destinations, use cases, and autonomy only after measured
      quality and safety thresholds are met.

## Public beta launch gates

Public beta is blocked until all of the following are true:

- raw free-form input can no longer reach the call runtime or ASR directly;
- every call uses an approved, versioned compiled brief and policy decision;
- cross-user authorization and encrypted data boundaries have automated tests;
- recipient consent, opt-out, retention, deletion, and complaint flows work end to end;
- transcription uncertainty is visible and critical facts can be checked against audio;
- durable retries, monitoring, cost controls, backups, and rollback are operational;
- the multilingual quality and adversarial evaluation suite meets defined thresholds;
- no unresolved critical security, safety, provider-policy, or launch-jurisdiction issue remains.

## Deferred until after the public MVP

- unattended high-risk legal, financial, medical, immigration, employment, or
  contractual negotiations;
- automatic bulk calling and marketing campaigns;
- unrestricted custom agent identities;
- automatic language switching without explicit user permission;
- CRM, calendar, email, and messaging integrations that create external side effects;
- indefinite audio retention;
- native mobile applications and PWA hardening beyond the responsive web experience.
