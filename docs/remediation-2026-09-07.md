# Repository blocker remediation — 2026-09-07

Scope: the working tree based on `96229ea`, following the
[original audit](project-audit-2026-09-07.md). Changes are not committed or deployed.
This record supersedes the original defect status for R01-R05/R18/R19; historical
audit observations remain intact. [Machine-readable evidence](remediation-evidence-2026-09-07.json)
contains aggregate results and a source fingerprint.

## Closed at the repository boundary

| Roadmap | Delivered behavior and evidence |
| --- | --- |
| R01 | Lockfile upgrades fast-uri to 3.1.7/4.1.4 and qs to 6.16.0. Fresh frozen installation in a separate source copy; production audit reports no known vulnerabilities, including moderate findings. No manifest widening or broad dependency upgrade. |
| R02 | Strict Turbo env declarations, env-file and web-origin cache inputs; uncached tests; uncached dev env pass-through. Missing/non-test database URLs fail instead of skipping; unavailable database fails. Eight PostgreSQL suites execute. Rotation/retention fixtures use their own temporary databases and require CREATEDB on the test role. API test processes are capped at four. Next imports only three web variables from root `.env`, preserving existing values and excluding other root secrets. |
| R03 | Rotation and restore share all nine ciphertext families. Integration test compares the inventory with migrated schema, rotates queued input, removes the old key, completes preparation and proves a no-op second rotation. Docker restore verifies nine encrypted samples, 49 migration checksums and all 51 table counts. |
| R04 | API and worker both require explicit `BRIEF_COMPILER_DRIVER=openai` in production. Worker tests reject mock, empty and missing values; API-only settings remain unnecessary in the worker. Both entrypoints still use the same compiler factory and model settings. Development inference/defaults remain unchanged. |
| R05 | Account anonymization deletes all phone/email-change challenge states in the same transaction under the user lock. Contact-free immutable events remain. The existing deletion worker cleans challenges older than 30 days and legacy deleted-user remnants on startup and hourly without user traffic. Isolated PostgreSQL tests cover historical states, racing creation, idle cleanup and immutable evidence. |
| R18 | Affirmative consent requires a complete allow-listed phrase. Qualified/conditional/unrecognized responses and quoted or questioned affirmations cannot grant consent. Negative matches retain precedence. Multilingual classifier tests and EN/DE/RU bridge regressions assert no recording, grant, conversation or private-audio forwarding for reproduced refusals. This deliberately routes more free-form answers to clarification/DTMF. |
| R19 | Each SSE event/heartbeat rechecks durable session/account, role, current acceptance and ownership. Authorization failure or a two-second lookup timeout destroys the stream. Five-second heartbeats bound idle revocation to seven seconds under a responsive event loop; pending frames are capped at 64 and backpressure closes the connection. Real HTTP tests use separate PostgreSQL repository connections for logout, revoke-all, password reset, suspension, expiry and idle revocation. Lookup failure/timeout/backpressure tests verify cleanup. |

## R06: tooling complete, live acceptance open

The runner now logs into an existing verified account. It does not register, send
Verify SMS or accept legal policies. Default `prepare` enqueues with a UUID header,
polls the asynchronous preparation, reads the resulting call and exits before
dialling. A separate `start` invocation requires that reviewed call UUID and the
recipient-authorization sentinel. This allows stopping the worker after preparation.
The eight-test non-billable harness passes. The [runbook](real-provider-drills.md)
documents the exact stages, failure boundaries and inspection sequence.

No real call, SMS, provider email or model request was made by this remediation.
Current live voice/consent/transcription/outage evidence is still required for R06.

## Verification

| Check | Result |
| --- | --- |
| Environment | Windows, Node 24.9.0, pnpm 10.12.4, PostgreSQL 17.10 in an isolated audit Docker container |
| Fresh source copy | No `.env`, `node_modules`, build output or test cache initially; frozen installation succeeds |
| Standard `pnpm test`, strict mode | **541 passed, 0 skipped**: API 363/54 files, web 108/25, contracts 70/14; eight database suites executed |
| Clean lint / typecheck / build | All three packages pass; Next production build completes |
| Missing TEST_DATABASE_URL | Root Turbo test invocation exits 1 with explicit required-URL error |
| Unavailable PostgreSQL | Root Turbo test invocation exits 1 with connection failure |
| Cache inputs | Changing each public API/site/private SSR origin changes web build hash; changing root `.env` also changes it |
| Web env loading | Synthetic root web setting loads; unrelated server-secret canary is not imported |
| Production dependency audit | Zero known vulnerabilities after frozen installation |
| Rotation | Old-key queued preparation completes with only new key; second rotation rewrites zero rows; schema inventory matches nine families |
| Restore | Docker pg_dump/pg_restore 17.10, 49 migrations, 51 tables/count checks, seven critical tables, nine encrypted samples; tool removes its disposable restore resources |

The first clean-copy run timed out in an existing five-second PostgreSQL credit
test while many test processes and lint ran concurrently. Limiting API test workers
to four removed that resource-pressure failure; the complete clean run then passed.
No timeout was relaxed and no test was skipped.

The source copy received a synthetic `.env` only **after** the clean suite/build,
for the separate env-loading/hash probe. The user's application container/database
was not used. The pre-existing audit container was restarted for these checks and
stopped afterwards; its data and the temporary verification copy are retained.

## Remaining release boundaries

Hosted Node 22/Linux CI and branch protection have not been exercised here.
Deployment, production backup/deletion replay, live providers, browser/device
accessibility, independent privacy/legal approval and operational ownership remain
open. R07 notice/copy approval and R08 enforceable Realtime safety are the next
repository/product release gates. Public-beta recommendation remains **NO-GO**.
