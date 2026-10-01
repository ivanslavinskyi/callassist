# Appointment calendar weekdays — decision and implementation, 30 September 2026

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Branch: `codex/live-unified-runtime`. The owner approved adding weekdays to the
appointment/meeting plan and to Live speech. This extends the existing Shprohli
identity and orchestration candidate; it does not replace either runtime.

## Decision and calendar authority

The brief compiler's LLM interprets the requested schedule: explicit dates, periods,
weekday inclusions/exclusions and clock bounds. `resolveAppointmentSchedule` then
expands/checks the approved ISO-date windows. A weekday is a deterministic attribute
of that resulting Gregorian date, not another fact for the model to invent.

The implementation adds a display/context projection. Authorization schemas, stored
plans, approval hashes, proposals and voice-action state remain unchanged. There is
no database migration, extra model call, new tool, broader booking authority or date
inference from arbitrary prose. Existing approved plans gain weekday labels without
being recompiled or rewritten. Calendar labels cannot authorize an appointment when
the plan has no structured appointment permission.

## Implemented data flow

`packages/contracts/src/calendar-date.ts::calendarDateDetails` validates a canonical
ISO calendar date and returns `date`, ISO Monday=1..Sunday=7 `weekdayIso`, localized
`weekdayLabel` and `dateLabel`. It formats a Gregorian UTC date ordinal, not the
appointment's physical instant. Host/browser zones cannot shift this calendar day.
The approved IANA zone still governs clock time, relative-date interpretation and the
existing DST/nonexistent/ambiguous-time validator.

`CallPlanPresentation` uses the numeric date label on the current UI locale, keeping
the ISO date in the `<time>` attribute and preserving each start-time window. For
example, `2026-10-01` appears as `Donnerstag, 01.10.2026` in German. The screenshot's
dates are Thursday 1 October, Saturday 3 October, Sunday 4 October, Monday 5 October,
Tuesday 6 October and Wednesday 7 October 2026. The UI and call language are independent.

`executionData` adds `appointmentCalendar` alongside the unmodified authorization.
This deduplicates dates, not clock windows. Both the managed reasoning backend and
Live's bounded `session.thinking.append` task sections receive the same computed
annotations in the call locale. The section remains behind existing consent/task
admission. Up to 31 dates use the existing 1200-byte chunking mechanism.

The canonical `appointmentRequestCopy` uses the same long weekday/date label for
both `book` and `confirm_existing`. This exact request is journaled and spoken through
the existing controlled-playback path after proposal validation. The request/reply
and confirmation tool results also include computed `appointmentDetails` for the
chosen date, start time and zone. Confirmation retains `source=recipient_report` and
`externallyVerified=false`; metadata is not evidence of booking success.

Live and backend instructions require weekday, full date and time at the first
concrete proposal and final confirmation, allowing shorter references later. They
require clarification when a weekday-only reply is ambiguous or a weekday/date/time/
zone conflicts, rather than silently picking a date. These are semantic conversation
rules, not new phrase lists or a deterministic speech-content verifier. Arbitrary
LLM-authored plan prose is not rewritten to append guessed weekdays. The programmatic
labels and canonical protected request are deterministic; ordinary wording remains
Live's responsibility.

## Verification and recovery evidence

Fresh checks passed on 30 September:

- 378 API tests across thirteen suites: all non-database voice suites, appointment
  schedule expansion and proposal authorization.
- All 185 contracts tests, including date/weekday localization and calendar validation.
- 31 web tests across three suites, including plan rendering in all seven UI locales.

API and web TypeScript checks, contracts and API builds, and `git diff --check` also
passed. This change did not require a database migration.

Coverage includes all seven call locales, the screenshot dates, leap dates, month/year
and DST boundaries, invalid dates, host zones UTC-10/UTC+14, repeated-date windows,
31-date bounded chunks, unchanged snapshots/authority, absence of booking permission,
both booking operations and computed labels in the forwarded confirmation result.
No external call was made by these tests. Private logs are `.tools/live-weekdays-*.log`.

The pre-change baseline is `.tools/live-weekdays-baseline-20260930/manifest.json` and
preserves the previous brand/orchestration work. The activation source manifest and
current process/log/tunnel information are recorded separately under `.tools`.

## Local activation

The API restarted at 17:16 Zurich on 30 September and became ready at 17:16:11.
The running candidate is `live-managed-v2`, identity `shprohli-v1`, calendar projection
`appointment-weekdays-v1`; Live fallback is disabled and automatic hangup is enabled.
The web app and existing tunnel were retained. All fourteen production-source hashes
match `.tools/live-weekdays-candidate-20260930/manifest.json`. Current process IDs,
logs, candidate manifest and tunnel URL are in `.tools/runtime/stabilization-state.json`.

API readiness/liveness and `http://localhost:3000/ru` returned 200. Through the public
Twilio gateway, `/health/ready` returned the expected 404 and an unsigned POST to
`/webhooks/twilio/voice` returned the expected 403. No active calls existed before
the restart. These checks confirm local readiness and gateway routing/signature
enforcement; they do not replace an actual signed Twilio call and handset acceptance.
No outbound call or production deployment was performed.

## Handset acceptance

After activation, refresh an existing appointment plan: it should show localized
weekdays without changing its authorized windows or requiring another approval.
During a call, offer a concrete date, reply using its weekday, and confirm the selected
date/time. Verify that the exact booking request includes the correct weekday, that
ambiguous/conflicting replies trigger clarification, and that one later exact
confirmation leads to one recorded arrangement and a played farewell before hangup.
Repeat with `confirm_existing` and another call language. Refusal, corrections and
uncertainty retain the existing behavior. Natural phrasing and semantic ambiguity
handling still require a real handset test.
