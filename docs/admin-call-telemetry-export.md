# Admin call telemetry export

Implemented locally on 2026-09-22. This document describes the shipped source code,
not a production deployment. The earlier [research and proposal](admin-call-telemetry-export-proposal-2026-09-22.md)
records the investigation and future instrumentation work.

Updated 2026-09-23: list cursors validate UUIDs and canonical UTC timestamps before
querying PostgreSQL. Invalid cursors return `400 EXPORT_INVALID_CURSOR`. Pagination
retains PostgreSQL microseconds both in the cursor and in its bound SQL parameter,
so records sharing a millisecond are not skipped. Existing millisecond cursors
remain accepted. See the [audit and regression evidence](release-audit-2026-09-23.md).

## Using the feature

Open **Admin → Calls → Export telemetry** as an active, verified superadmin.
Choose Today, Yesterday, Last 7 days, Last 30 days, Previous month or Custom dates,
enter the reason for accessing call content, and select **Create export**. The panel
shows the queue, progress, result size, selected call count and expiration time.
You can leave the page while the worker runs. Download ZIP when ready, or remove
the file early. Only the requesting superadmin can list or download their exports.
The panel reports a missing/stale worker heartbeat.

Dates use **Europe/Zurich**, including daylight-saving changes. Custom end dates
are inclusive in the form and become exclusive midnight bounds in the archive.
Today and Last 7/30 days end at request time; the latter include today and the
preceding 6/29 calendar days. Previous month means the complete calendar month.
Custom ranges are limited to 31 calendar days. Call-table filters are independent.

Selection uses **attempt start time**, not brief creation time, and preparation
request creation time. An older brief dialled today is included. Failed preparations
without a brief are included. All retained history associated with the selected
briefs/preparations is exported, even when it falls outside the period.
`selectedInPeriod` distinguishes selected attempts from contextual attempts.

## Archive contract

The download is a streamed ZIP, compressed with fflate, containing:

- `manifest.json`: format/generator version, requested period, snapshot time,
  generation, source counts, source-file SHA-256 checksums and completeness warnings.
- `summary.json`: selection counts, attempt statuses, pending processing counts,
  provider-reported cost totals by currency and an explanation of cost scope.
- `schema.json`: record envelope, explicit source-field lists and numeric policy.
- `README.txt`: interpretation and privacy notes.
- `data/<source>.jsonl`: 36 source files, including empty files. Each UTF-8 line
  contains one JSON object with `schemaVersion`, `recordType` and `data`.

Source groups:

| Group | Included retained data |
| --- | --- |
| Calls and execution | Briefs, all associated attempts, event timeline, execution snapshots, compilation revisions/approvals, review policies/receipts and language contexts |
| Transcripts | Live segments, final transcript state, all final revisions and retained ASR chunks |
| Results | Text artifacts and chunks, assessments, outcome revisions, feedback revisions and comments |
| Preparation | Requests, original encrypted input after decryption, language preferences, failures, pending states and associated operations |
| Providers and costs | Operations, parent links, request/response IDs, results, original usage, supplements, effective usage, cost records and versioned calculated costs |
| Processing and accounting | Durable jobs and attempts, job admin events, credit transactions, beta spend reservations and approval requests |
| Access and deletion | Allowlisted call audit metadata, sensitive access records, deletion evidence and tombstones |
| Recording/billing context | Recording/consent/retention metadata and provider billing snapshots covering overlapping UTC days |

The authoritative field inventory is
[`sources.ts`](../apps/api/src/telemetry-export/sources.ts); direct column references
make schema drift fail instead of silently omitting a source. Source ciphertext is
decrypted using the application's keyring; exported field names drop `_ciphertext`.
Monetary micros are decimal strings, and unknown values remain `null`.
Provider effective usage is an alternative to original usage, not an additional
charge. Calculated costs identify the pricing version and missing/unpriced metrics.
Provider account billing is context and must not be added to call costs.

The archive contains personal call content. It excludes audio bytes, credentials,
authentication/session tables, arbitrary provider response strings and unapproved
audit metadata. `raw_usage`/`raw_cost` retain numeric trees and allowlisted enum
strings. It makes no provider requests and does not rerun ASR, assessment or calls.

Historical live segments have no stored attempt association and explicitly carry
`attribution: legacy_unattributed`, `attemptId: null`. Full SSE/websocket frames,
historical runtime prompts and unrecorded model settings cannot be reconstructed.
Per-session runtime descriptors and future live-segment attribution remain the
separate follow-up described in the proposal. Pending processing is a snapshot;
create a new export after it completes to obtain the resulting data.

## Reliability and privacy

A dedicated PostgreSQL queue runs alongside the call worker, with at most one
archive builder globally. It does not occupy the sequential ASR/call-job queue.
Each build uses one read-only REPEATABLE READ transaction; its snapshot is captured
when processing starts, rather than when the export is requested.

The producer reads source cursors and flushes encrypted compressed parts of at most
1 MiB to PostgreSQL. Neither the server nor the browser accumulates the entire ZIP.
No plaintext archive is written to a server temporary directory. SHA-256 is checked
for each part and for the entire file; incomplete/corrupt archives are not marked
ready. The implementation is deliberately PostgreSQL-only; memory mode reports
the feature as unavailable.

| Bound | Value |
| --- | --- |
| Calendar interval | At most 31 days |
| Selected briefs / preparations / attempts | At most 10,000 each; related contextual history is also bounded by records/bytes/time |
| JSON records / single encoded record | 1,000,000 / 16 MiB |
| Encoded JSON content | 250 MiB before compression |
| Snapshot transaction / worker lease | 60 / 120 seconds |
| Build attempts | At most 3 generations; transient failures automatically retry after 10 seconds |
| Active build requests | One per requesting superadmin; one running globally |
| Queued, running or unexpired ready requests | At most 4 globally |
| New requests | At most 10 per actor per hour |
| Download HTTP rate | 6 per actor and 30 per IP per minute |
| Other export endpoint HTTP rate | 120 per actor and 240 per IP per minute |
| Ready-file lifetime | 24 hours after publication |

Limits fail the whole build with an actionable message; files are not silently
truncated. When a lease expires, the next worker clears its old parts and retries
within the generation limit. Publication requires the matching generation, live
lease token, unchanged privacy revision and an authorized actor. Retried HTTP
creation uses an idempotency key and rejects changed parameters under the same key.

Export mutation routes reuse sensitive-admin authorization and Origin checks;
all routes require superadmin, current session/onboarding and ownership. Downloads
recheck the session and actor before each part, and responses use `private, no-store`.
Audit records capture requests, build transitions, revocation and download lifecycle.
`download_completed` means the server finished sending the response, not that the
recipient saved it to disk. Already delivered bytes cannot be recalled.

**Conservative revocation is global.** A call-content deletion, a new account
deletion request, or any user role/status change revokes all queued/running/ready
exports and deletes stored parts in the same database transaction. This intentionally
includes exports whose source membership has not yet been captured, closing that
race. A new export can then read the surviving data. Deleted or pending-deletion
content is excluded; minimal tombstones and safe timeline/deletion facts remain.
Revocation and publication lock the privacy epoch before export rows; the publisher
does not acquire locks on source user/call rows.

Cleanup runs in the export worker, removes expired/orphaned parts, and expires queued
requests older than 24 hours. The download endpoint enforces expiration even while
the worker is offline. Physical cleanup resumes when the worker is restarted.
Disabling the feature prevents new access and pauses cleanup; it does not erase
existing database parts. Audit records remain immutable and contain no transcript.

## Deployment and operations

1. Install the lockfile dependencies; API now directly depends on `fflate@0.8.3`.
2. Apply migration `0079_admin_telemetry_exports.sql` with the normal migration runner
   (`corepack pnpm db:migrate`) before starting the new API/worker. The code uses
   PostgreSQL 17's `transaction_timeout`, matching the project's PostgreSQL image.
3. Build API and web. Deploy both API and worker from the same revision and with
   the same `DATABASE_URL` and encryption keyring. The parts column is included in
   the existing key-rotation and recovery inventories.
4. With `STORAGE_DRIVER=postgres`, export is enabled unless
   `ADMIN_TELEMETRY_EXPORT_ENABLED=false`. Set it consistently on API and worker.
   `DURABLE_WORKER_MODE=embedded` starts the consumer in the API; `external` requires
   the dedicated worker process. Restart the applicable processes after migration.
5. Verify the heartbeat in Admin → Calls, create a small export, download and unzip
   it, inspect manifest counts, then remove the file. No provider calls are needed.

Source indexes added by the migration improve period selection. Their creation
uses the normal transactional migration runner; schedule migration during low
traffic for a large existing database. Do not roll back the schema while the new
processes are running. For a feature rollback, disable the flag on both processes
and retain the migration and encryption inventory.

After restoring a backup for actual service activation, invalidate restored exports
before exposing the API, as well as following the existing source-data deletion
replay procedure. A restore can otherwise resurrect an unexpired archive. With all
application processes stopped and the restored target verified, use one transaction:

```sql
BEGIN;
UPDATE admin_telemetry_privacy_epoch
SET revision = revision + 1, worker_seen_at = NULL WHERE id = true;
INSERT INTO admin_telemetry_export_events(export_id, action, generation, code)
SELECT id, 'revoked', generation, 'EXPORT_PRIVACY_CHANGED'
FROM admin_telemetry_exports WHERE status IN ('queued', 'running', 'ready');
UPDATE admin_telemetry_exports
SET status = 'revoked', phase = 'revoked', failure_code = 'EXPORT_PRIVACY_CHANGED',
    lease_token = NULL, lease_until = NULL, updated_at = now()
WHERE status IN ('queued', 'running', 'ready');
DELETE FROM admin_telemetry_export_parts;
COMMIT;
```

A read-only diagnostic can inspect `status`, `phase`, `failure_code`, `generation`,
`lease_until`, `expires_at` and the singleton `worker_seen_at`; do not log ciphertext
or decrypted exports. Over-limit exports should be split into shorter periods.
Source-decryption errors need key/data investigation, not partial download.

## Verification

The final API regression run passed **84 tests in 6 files**. After tightening the
download completion audit, the **12 export integration tests** passed again,
including a corrupted HTTP download that must not record successful completion.
API typechecking/build and web production build (including lint and type validation)
passed. The existing admin telemetry, deletion and account-export regressions also
passed in the earlier targeted run. Next's ESLint plugin resolution was made explicit
for pnpm's dependency layout; no lint rules were disabled.

Automated checks use disposable PostgreSQL databases and mock providers. Coverage
includes all 36 source queries against the full migration catalog, Unicode/multiline
text, immutable revisions, old briefs dialled in the selected period, orphan failed
preparations, snapshot consistency, idempotency, authorization/Origin/ownership,
streamed HTTP ZIPs, session revocation, multi-part files, checksums/corruption, expiry,
worker competition/recovery, in-flight deletion/role changes, pending account deletion,
empty exports, admission limits, DST/leap-year periods and key rotation.

Browser checks used a separate fixture API/database, with desktop and 390 px mobile
layouts. Creation moved through Queued to Ready; downloads reached the completion
audit; an overlong custom range showed the expected error. No real user content was
exported and no paid provider calls were made. These checks do not establish a
production-sized performance benchmark.

The deployment step has not been applied to the normal application database by
this implementation task. Test fixtures apply migration 0079 in isolation.
