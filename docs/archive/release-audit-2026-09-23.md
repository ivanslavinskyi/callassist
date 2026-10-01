# Predeployment audit — 23 September 2026

Scope: repository code, dependency graph, local checks and current documentation.
Baseline: `ee34a42d049e72b9eb9e1739df37b5d89afc7769` on `main`; fixes below are
subsequent working-tree changes. This is a bounded engineering audit, not a claim
that every code path has been inspected or that production is approved.

The baseline [GitHub CI run](https://github.com/ivanslavinskyi/callassist/actions/runs/35866143366)
passed, including frozen install, tests, re-encryption, disposable backup/restore
and builds. That run does not cover the subsequent fixes in this report.
The [release roadmap](mvp-plan.md) remains the single backlog. Public release is
still **NO-GO** pending the external deployment/provider/operational gates below.

## Findings and remediation

### A01 — bundled OG renderer security issue: fixed

The API used `@vercel/og` 0.8.6, whose distributed Node bundle contains Satori
0.16.0. The upstream [Satori advisory GHSA-wx4j-mvgx-mqwp](https://github.com/vercel/satori/security/advisories/GHSA-wx4j-mvgx-mqwp)
identifies improper SVG escaping before 0.33.5. A clean package-manager audit did
not report this embedded copy. A transitive override alone cannot replace bundled
code. In this application, rendering is behind content-role authorization,
bounded slogans and a fixed template; arbitrary anonymous SVG rendering or code
execution was not demonstrated.

The renderer now uses Satori **0.33.5 directly**, followed by existing sharp
**0.35.4** for PNG output. This also avoids a Node ESM packaging failure in the
tested `@vercel/og` 1.0.3 wrapper. Template version is v3 and seven bundled fallback
PNGs were regenerated. Existing published images remain immutable and valid.
Seven-language rendering, local-only font/image assets, crops, authorization,
publication and PostgreSQL persistence pass their existing tests. DE/RU PNGs were
also inspected visually; this is not a fresh browser/device audit.

Next.js and its ESLint config were updated from 15.5.25 to **15.5.26**. The
[22 September Next.js notice](https://nextjs.org/blog/nextjs-security-update-september-22-2026)
explicitly describes the 15.x change as hardening; its critical RCE applies to
16.2.0–16.3.5, not this repository's Next.js 15 branch.

### A02 — development dependencies missing from the CI audit: fixed

The initial full audit reported seven package findings: four high, two moderate,
one low. The previous command checked production dependencies only and failed
only at high severity. The findings were in development/build tooling:

| Package | Remediation | Advisory |
| --- | --- | --- |
| brace-expansion 1.x | Scoped override to 1.1.18 | [unbounded expansion](https://github.com/advisories/GHSA-mh99-v99m-4gvg), [incomplete mitigation](https://github.com/advisories/GHSA-rgw5-rvv9-x895) |
| js-yaml 4.x | Updated `@eslint/eslintrc` 3.3.7 resolves patched 4.3.2 | [omap CPU use](https://github.com/advisories/GHSA-5p4m-2wfm-xmqj), [merge CPU use](https://github.com/advisories/GHSA-2883-xcg3-v3hh) |
| Vitest / @vitest/mocker | Vitest 4.1.11 in all three packages | [file read via redirect mock](https://github.com/advisories/GHSA-82fw-gwwq-j7x9) |
| tsup's esbuild | Scoped override to 0.28.1 | [Windows development-server file read](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr) |

These findings are not evidence of an exposed production endpoint. Normal tests
use `vitest run`, not a public mock-development server. The earlier fflate fix
remains in the lockfile. `security:audit` now checks **all dependencies, low severity
and above**, and the CI step names that scope explicitly. Final audit has zero
reported findings. Dependency metadata is time-sensitive; repeat on the release commit.

### A03 — telemetry export cursor validation: fixed

The previous regex accepted 36 hyphens or hexadecimal characters without UUID
separators. Such a cursor reached a PostgreSQL UUID cast and raised a server error.
Non-string/normalized-invalid timestamps were also accepted. Regression tests
reproduced these failures before the fix. Cursors are now bounded, base64url-shaped,
and validate UUID plus canonical UTC timestamp before querying the database;
invalid input returns `400 EXPORT_INVALID_CURSOR`.

This endpoint remains authenticated, superadmin-only, rate-limited and owner-scoped.
The defect was input validation, not a demonstrated authorization bypass.

### A04 — export pagination could omit rows: fixed

The cursor previously serialized `created_at` through JavaScript Date, losing
PostgreSQL microseconds. At a page boundary, remaining exports within that
millisecond could disappear from the next page. A fixture with 21 rows reproduced
the omission (20 returned across pages).

The cursor now preserves six fractional digits. Its SQL parameter is bound as text
before the database timestamp cast, avoiding postgres.js's Date serialization and
its second precision loss. Existing three-digit cursors remain accepted. The
regression now returns all 21 unique rows and checks owner isolation.

### A05 — stalled recording download could hold work indefinitely: fixed

Twilio SDK operations already had a timeout, but the separate recording `fetch`
did not. It is used for playback and final transcription. A stalled response/body
could hold that operation without an application deadline.

Recording downloads now have one **30-second total deadline**, shared by response
headers, response body and the optional dual-channel-to-mono fallback. Rejected
response bodies are cancelled before retry/error. Regression tests simulate stalled
headers and body without provider traffic; existing dual/mono paths still pass.
This does not substitute for a real provider outage drill.

### A06 — current documentation contradicted implemented state: fixed

Current references now use migration **0080**, **20 ciphertext columns** and
**seven UI locales**. Recovery instructions explain feedback rotation after privacy
redaction. Account documentation includes inline contact forms and focus behavior;
OG documentation includes separate generated/upload input lifecycles and the
patched renderer. Deployment and CI instructions distinguish current local checks,
the baseline CI run and target-host acceptance. Dated historical delivery reports
retain their original evidence.

## Verification

- Full local suite after dependency/OG/cursor fixes: **1,510 tests / 183 files**
  (API 1,112/111; web 276/54; contracts 122/18). Test results were not cached.
- Subsequent recording-deadline change: **26 telephony tests passed**, including
  two new stalled-download regressions. This is a targeted follow-up, not an
  additional full-suite count.
- Full lint/typecheck passed after dependency updates; final API typecheck also
  passed after the recording-deadline change. The web build runs lint/typecheck.
- Final production build passed for **contracts, API/worker and web** (Next.js
  15.5.26). The isolated build's temporary TypeScript path changes were restored;
  no generated build output is part of the patch.
- Migration catalog validates all **80** entries. Isolated tests cover migration
  replay, cutover, ownership/roles, origin checks, limits, deletion, rotation,
  export revocation and notification lifecycle.
- Populated-fixture re-encryption: **20 families, 247 ciphertexts, 2 feedback
  fingerprints verified; zero remaining non-active ciphertexts/fingerprints**.
- OG rendering/upload/publication tests: **10 passed**; telemetry export regression
  suite: **18 passed**. These are subsets/targeted runs, not added to the full total.
- Frozen install passed; final audit covers 657 dependencies with zero reported
  vulnerabilities. Public-copy consistency passed (782 files). All local links in
  the 12 checked current documents resolve. A limited scan of 847 tracked text files
  found no candidate private keys or common OpenAI/AWS/GitHub token patterns;
  `.env.example` is the only tracked environment file. This is not a complete
  secret or Git-history audit.

An initial local full run exceeded a ten-second deadline in the email-verification
PostgreSQL fixture while building/migrating temporary databases under load. The
unchanged scenario passed the targeted and subsequent full runs. No test was skipped,
no assertion weakened and no timeout increased to hide that failure.

Local verification uses Windows/Node 24.9 and isolated PostgreSQL 17 on port 55433.
The source's Node 22.19 Linux CI is a separate environment. Build output was isolated
from the running web development server. No real SMS, email, telephone calls, paid
AI requests, CMS publications, target-host migrations or deployment were performed.
Already-running development processes were not restarted by this audit; restart
them to load the patched runtime dependencies. A dependency install alone does not
replace code already loaded in a Node process.

## Review boundaries and remaining release gates

Manual review sampled API ownership and role guards, mutation origins/cookies,
Twilio signature/media-token boundaries, upload decoding/limits, export SQL and
privacy fencing, encryption inventory and configuration validation. Automated
checks exercise the broader existing suite. This audit is not an external penetration
test, exhaustive secret-history scan, legal sign-off or full assistive-technology test.

- **B06:** actual VPS topology, private database, DNS/TLS, trusted proxy addresses,
  cookie/SSR/SSE/WebSocket behavior, runtime flags and API/worker parity remain to be
  verified on `shprohli.ch`. Apply all migrations through 0080 on that target.
- **B03/B04/B05/B09:** finish supervised provider/contact-change/recovery/opt-out,
  budget-exhaustion, stop and outage scenarios on the release candidate.
- **B07/B10:** verify target CMS revisions, seven locales including editorial RM
  review, social-card delivery and device/keyboard/screen-reader acceptance.
- **B08/B11/B12:** staff access protection, support owners, managed backup/restore,
  key custody, deletion/suppression replay, alerts and rollback need external evidence.
  Account security notices remain best effort without a durable outbox, as already
  documented; registration/call admin notifications use their separate queue.
- Before release, commit the final patch and preserve **its own** successful CI run.
  A passing run for `ee34a42` cannot certify the later dependency/code changes.
