# Call lifecycle, history and admin metrics — 2026-09-15

> This records the first lifecycle/history checkpoint. Its initial accounting-derived
> conversation result was subsequently replaced by [canonical final assessment](post-call-assessment-diagnosis-2026-09-15.md).
> Migration 0074, pending assessment, independent AI goal/user-feedback statistics
> and late-result handling supersede the original limitation described below.


## Problem and behavior

**Subsequent finding:** a real completed task exposed a gap between provisional
credit qualification and final-transcript evidence. The status projection below
does not yet resolve that gap. See the [diagnosis and proposed assessment flow](post-call-assessment-diagnosis-2026-09-15.md);
the credit/result acceptance gate remains open.

The customer UI previously translated the orchestration state `completed` as
“Call completed”, even when no conversation took place. Twilio's `completed`
means that a connection ended; voicemail and automated systems can also answer.
It does not prove a human answer, consent, task response or goal achievement.
See [Twilio status definitions](https://help.twilio.com/hc/en-us/articles/223132547-What-are-the-Possible-Call-Statuses-and-What-do-They-Mean-).

The shared `deriveCallLifecycle` projection now supplies customer list/detail,
admin list/Inspector and operations-result counters. It uses the latest attempt's
durable events and immutable credit settlement, without changing orchestration
states, existing history or the credit-charging policy.

| Evidence | Displayed result |
| --- | --- |
| Applied provider `no-answer`, no confirmed connection | No answer |
| Applied provider `busy`, no confirmed connection | Line busy |
| Applied provider `canceled`, no confirmed connection | Canceled before connection |
| Explicit negative consent | Conversation declined |
| Confirmed phone connection, no confirmed consent | Ended before consent |
| Consent granted, no confirmed substantive task answer | No confirmed task answer |
| Consent and `substantive_answer_v1` evidence / qualified ledger charge | Conversation took place |
| Application stop without a confirmed task answer | Call stopped |
| Provider, recognition, recording-start or conversation transport failure | Technical problem |
| Legacy terminal record without sufficient evidence | Call ended |

A conversation does not automatically mean the task succeeded. Goal feedback
and its user/staff provenance remain separate. Transcription processing failures
remain artifact failures; they do not erase evidence that a conversation occurred.
Current UI copy is EN/DE. Call/content languages retain their existing independent
policies; new interface locales must add these messages with the other UI copy.

## Evidence and reliability

`call_events` already records provider state, connection, disclosure, consent,
conversation, recording and transcription stages. New migration
`0073_call_stop_telemetry.sql` permits `call.stop` with bounded `actor`
(`user`/`system`) and `phase` (`requested`/`succeeded`/`failed`). The duration
timer identifies itself as the system. A request is recorded before the provider
stop; success identifies an application stop only when the stopped transition
was applied. A racing provider completion does not establish who disconnected.
If writing telemetry fails, the provider stop still proceeds; missing attribution
remains unknown rather than preventing cancellation.

Existing assistant hangup events can identify application-controlled endings.
`socket_closed`, `stream_stopped` or provider completion alone do **not** identify
the person who hung up. Remote party attribution remains unknown without a
specific signal. Twilio documents separate
[Voice Insights disconnection evidence](https://www.twilio.com/docs/voice/voice-insights/frequently-asked-questions).
Answering-machine detection and Insights retrieval were not enabled by this change.

Late events from earlier attempts and unapplied provider callbacks cannot replace
the current result. A stream-close failure cannot erase an explicit refusal.
Connection time is shown only when the in-progress event supplies it; a completed
callback does not invent an earlier pickup timestamp.

The credit ledger is authoritative when settlement telemetry is delayed or missing.
Qualification commits before its secondary event, so the read projection also
checks the latest attempt's immutable `credit_transactions.qualification`.
This closes the crash window without changing write-lock ordering or charging twice.
Old charges without substantive-answer evidence do not establish a conversation.

Reads are batched by call ID after existing ownership/deletion filters. New public
fields contain bounded facts/timestamps, not provider IDs, transcript text or raw
event payloads. Admin sensitive-content access remains separately audited.

## Navigation and statistics

- New call remains at `/[locale]/app`, with up to five recent calls.
- Full history is `/[locale]/app/history`, with recipient search, state filtering
  and cursor pagination. It inherits authentication/onboarding checks and noindex.
- Header navigation and the detail breadcrumb use the separate route. Legacy
  `/app#history` bookmarks redirect to it while preserving the query.
- Detail shows the result explanation, credit settlement and expandable events.
  Missing end-party evidence is explicit.
- Admin list and Inspector use the same labels, including distinct consent labels.
  Operations adds a result breakdown; connection/consent/error counts use the latest
  attempt. No answer, busy and ordinary refusal are not technical failures.
- The older outcome-metrics endpoint also derives technical failures from events,
  instead of trusting historical technical snapshots. Recorded outcome revisions
  remain immutable. Spending/duration usage still includes all relevant attempts;
  the latest-attempt result breakdown does not redefine billing cohorts.

## Local verification and rollout boundary

The existing reported call was read without sending another call: provider
connection confirmed, consent not confirmed, no substantive-answer evidence,
credit returned. Customer detail/history and admin projection agreed. The exact
recipient and private call text are deliberately omitted from this record.

Migration 0073 was applied locally after confirming zero active calls, attempts and
preparations. API was restarted preserving the configured providers and tunnel;
`/health/ready` returned ready. Unauthenticated history redirects to login.

Automated verification covers distinct outcomes, explicit refusal, stale/earlier
attempt events, missing settlement telemetry, memory/PostgreSQL parity, ownership,
admin counts, stop actors and stale browser reads. Browser checks use fictional,
isolated fixtures with all provider requests blocked: EN/DE desktop/mobile,
light/dark surfaces, search, pagination, detail events and the admin call list.

Final checks: **961 API tests / 91 files** on a fresh isolated PostgreSQL database,
**114 contract tests / 17 files**, **219 web tests / 44 files** — **1,294 passed**.
API and web production builds, web lint and TypeScript checks passed. The builds
use an isolated Next output directory so the running local test app is preserved.

This checkpoint does not prove real-provider voicemail classification or remote
hangup attribution. No real calls/SMS/email were sent. Full provider, accessibility
and deployment acceptance remain in [B09/B10/B06](mvp-plan.md); NO-GO is unchanged.
