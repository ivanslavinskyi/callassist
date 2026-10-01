# Live orchestration stabilization on 30 September 2026

The owner approved stabilization after reviewing the three latest handset calls on
`codex/live-unified-runtime`. The application must provide bounded progress across
all supported task classes without weakening consent, appointment authority or
playback evidence. Handset acceptance of the implementation remains pending.

This document records the earlier approved v2 stabilization. The later
[post-v3 handset review](live-post-v3-call-review-2026-09-30.md) and
[combined stabilization/disclosure plan](live-runtime-stabilization-and-disclosure-plan-2026-09-30.md)
are the current acceptance evidence and next implementation entry point; the
historical findings and implementation record below remain unchanged.

## Evidence before implementation

All three calls used local API PID 23600 and the latest consent candidate. Evidence
comes from read-only PostgreSQL inspection, native transcripts, API logs, provider
operations and read-only Twilio GET requests. Audio was not independently listened
to and complete provider WebSocket frames are unavailable.

| Attempt | Task | Twilio duration | Observed outcome |
| --- | --- | --- | --- |
| `fa77a518-1f71-4a34-8975-4403b7021000` | Russian information request | 59 seconds | Consent after clarification; end_call accepted; playback confirmed; application hangup |
| `fd029f9a-6b7d-4d39-9e93-eeae96846967` | German information request | 95 seconds | Farewell ended at 09:52:52.909 Zurich; no end_call or task delegation; stream stopped 34.8 seconds later |
| `cd927175-cbdc-44d6-9881-25b13c5aa4d6` | Authorized appointment booking | 201 seconds | Three rejected request_appointment calls; no voice action journal entry; two accepted closings revoked by later recipient speech; stream stopped |

The appointment backend took 3.5–7.3 seconds on individual requests, followed by
2.1–2.7 second action-text checks and one six-second classifier failure. Speech
arriving during these checks made requests stale. Reciprocal farewells revoked
closing just like material corrections. The application had no common task-turn
recovery; the existing test explicitly required no response when native delegation
was absent and manually injected end_call afterwards.

All three recordings started after accepted voice consent. Consent took approximately
28.4, 20.4 and 16.1 seconds from disclosure start; these intervals include recipient
behavior. Pre-consent words are not retained, so the correctness of the first
Russian unclear classification cannot be reconstructed. Each call had an
invalid_request_error with command null. A local test reproduced premature loss of
command correlation; the exact historical provider error causes remain unknown.
Ledger LIVE_DELEGATION_INTERRUPTED records alone do not prove a network interruption.

## Implementation contract

1. One application recovery processes a settled answer that native delegation did
   not cover. Only one recovery is in flight for a given answer/revision. Announced
   native work, pending tool results and continuations suppress duplicates. A
   backend decision explicitly continues, waits, authorizes closing
   or resumes a materially changed conversation. Waiting is bounded; filler speech
   does not reset progress.
2. Acoustic interruption stops playback immediately. Only semantic interpretation
   of the complete recipient answer revokes authorized closing. Reciprocal farewell
   preserves it. Cleared marks never authorize hangup. Repeated closing input does
   not restart the absolute closing deadline.
3. Commands, delegation IDs, response IDs, tool calls and revisions remain linked.
   Late errors remain attributable without repeating already-applied effects.
   Stale responses cannot apply effects or leave bookkeeping permanently pending.
4. Appointment commitments are rendered from validated structured authority and
   proposal data. The model does not generate an arbitrary commitment sentence.
   Recording, exact proposal validation, journal-before-playback, single action,
   playback proof and subsequent recipient confirmation remain required. Missing
   facts and conditional agreement remain unresolved outcomes.

This contract applies to information requests, receipt confirmations, appointment
coordination, document requirements and neutral messages, in all supported call
locales. It adds no scenario or affirmative/farewell word lists and does not expand
the application's permitted operations.

## Recovery baseline

The accepted historical handset checkpoint remains commit `4e0b6a5`. The immediate
pre-implementation source, including the uncommitted consent candidate, is saved
locally in `.tools/live-stabilization-baseline-20260930/`, with file SHA256 manifest
and the preexisting Git diff. Restore the required files from that snapshot rather
than resetting the branch and losing the earlier consent changes.

Private evidence is retained locally in `.tools/latest-three-20260930.private.json`,
`.tools/latest-three-supplement.private.json` and the diagnostic test/log files.
These snapshots are ignored and are not part of published repository documentation.

The implemented source is also saved in
`.tools/live-orchestration-candidate-20260930/manifest.json` with SHA256 hashes.
Candidate calls emit `realtime.ready.runtimeVersion=live-managed-v2`; historical
`live-managed-v1` events remain readable. This marker identifies the runtime family;
the source manifest identifies this exact candidate.

## Verification and handset acceptance

Before implementation, 136 existing tests passed while four isolated diagnostic
tests reproduced the defects. These passing reproductions established failures,
not a fix. Final verification below combines the full API run with the affected
suite reruns and isolated database verification; it is not one uninterrupted run.

Implemented checks:

- 272 focused Live/Realtime tests passed, including canonical appointment copy and
  reciprocal farewell handling in all seven locales. The PostgreSQL voice suite is
  checked separately with the other database integrations.
- 145 contracts tests passed. API and web TypeScript checks passed; API and
  contracts builds passed; migration catalog check passed (89 files through 0089).
- The initial full API run passed 1427 tests, skipped 47 database tests and failed
  two old disclosure-wording assertions. Six database suite imports lacked an
  explicit TEST_DATABASE_URL. The two wording assertions were corrected and the
  complete affected voice/Realtime suites rerun as above.
- A separate run of all 32 PostgreSQL integration files passed 20 files but failed
  12 under concurrent machine load (setup/test deadlines and associated follow-on
  failures). A sequential rerun of all 12 failed files in a new isolated local test
  database passed all 143 tests, with 120-second setup and 30-second test bounds.
  The timestamp assertion and deletion-race failure also passed unchanged. Across
  the two database runs, all 32 integration files / 226 tests have passing results.
  The candidate therefore has passing coverage for 1476 API tests (1250 other tests
  and 226 PostgreSQL integration tests) and 145 contracts tests. No application
  schema, database code or test timeout configuration was changed to obtain this;
  the longer limits apply only to the local rerun command.

Local API PID 1050228 started on 30 September at 12:01:19 Zurich with Live,
fallback=false, embedded worker and automatic hangup enabled. Both listeners are
loopback-only. Readiness and liveness passed; the existing public tunnel reaches the
webhook gateway (unsigned voice POST 403, private health GET 404). The existing web
process was retained and `/ru` returned HTTP 200. Active call count was zero before restart. No production
deployment or real outgoing test call was made by this implementation task.
The actual runtime/log paths are in `.tools/runtime/stabilization-state.json`;
the older `.tools/local-runtime/state.json` is stale and must not drive a restart.

## Interpreting the next call

1. Confirm `live-managed-v2` and the matching API log before diagnosing the call.
2. A settled task answer has a 600 ms settlement window followed by 1200 ms native
   delegation grace. If no native work covers it, the log must show exactly one
   `Live task decision requested` for its answer/configuration revision. An active
   native response or tool continuation is a valid reason to defer that request.
3. `report_task_state` outcomes appear in durable `conversation.tool_result`
   telemetry. `keep_closing` must preserve closing; only `resume_conversation`
   produces a semantic interruption event. A cleared old mark must never produce
   `playback_complete` or a successful hangup.
4. Ordinary task waiting has a 45-second bound per settled recipient turn; filler
   and duplicate state reports cannot restart it. Backend start/command waits are
   bounded at 15 seconds, Responses execution at 30 seconds, and appointment reply
   wait at 45 seconds after delivered playback. An authorized closing has an
   independent 30-second absolute deadline that reciprocal speech cannot extend.
   Deadline failure closes the stream with `LIVE_CLOSING_DEADLINE`, without falsely
   reporting played farewell or successful application hangup.
5. An appointment journal row must precede playback. The sequence is `sending`,
   then `delivered` only on its actual played mark, then `confirmed` only after a
   later exact recipient confirmation. Interrupted playback becomes `uncertain`;
   silence, conditional agreement, missing facts and unrelated yes never establish
   success. No repeated request may create a second action.
6. Late command errors must retain command type, phase and client event ID where
   the provider supplies a correlatable ID. An error without an ID remains
   unattributed; do not infer its cause from `invalid_request_error` alone. A
   timed-out stale response must be settled in the provider ledger, not left open.

The next handset check must cover an information answer followed by reciprocal
farewell and an appointment conversation with corrections, missing information and
recipient speech during backend work. Inspect actual hangup, cleared versus played
marks, rejected tools, voice-action state and recording timestamps. An uncertain
appointment must never appear as confirmed. A successful test call does not establish
a universal production success rate.

Protocol references checked during diagnosis: [OpenAI Live delegation and tools](https://developers.openai.com/api/docs/guides/live-delegation)
and [Live session management](https://developers.openai.com/api/docs/guides/live-conversations).
