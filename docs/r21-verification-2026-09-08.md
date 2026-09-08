# R21 verification — 2026-09-08

Implementation: [plan](small-improvements-implementation-plan-2026-09-08.md).
Status: implemented locally; signed-in browser checks and one authorized Russian
live hangup drill passed. Production rollout and the broader voice matrix remain separate.

## Implemented

- Supplied SVG geometry, dark `#222B25` and emerald `#138553`; light tile preserves
  contrast on dark browser chrome. SVG, multi-size ICO (16/32/48), Apple PNG (180).
  Regenerate with `node scripts/generate-favicons.mjs` using the installed Next sharp.
- Current profile first/last names initialize new plans in editable inputs. No
  unlock button. Existing plan values win; account profile and immutable execution
  snapshots are not changed by editing these fields.
- Opt-in Realtime `end_call`, separate farewell, playback mark correlation,
  speech interruption and stale-turn rejection, bounded fallback and durable
  recovery on the exact attempt. Existing TwiML Hangup and provider reconciliation
  finish the line without the user Stop transition. Forward migration 0062 extends
  the database event vocabulary; existing immutable events are not rewritten.

## Local checks

- Final full API suite: 461 tests passed, including PostgreSQL integration, migration
  0062 and restart recovery after an ambiguous Twilio response.
- Web: 120 tests passed. Contracts: 74 tests passed. Combined: 655 passing tests.
- TypeScript: contracts, API and web pass. Web ESLint passes.
- Production builds: contracts, API and Next.js pass; Next build includes lint/type
  checking. API was rebuilt after the final code and migration changes.
- Public copy consistency check passes. `git diff --check` passes.
- HTTP verification against the production web server: `/favicon.ico`, `/icon.svg`,
  `/apple-icon.png` return 200 with icon/SVG/PNG MIME types and no locale redirect.
  EN/DE login HTML contains the generated icon links and Apple 180×180 metadata.
  Rendered Apple icon was visually inspected.

## Local tooling notes

The installed workspace has a package-manager lookup problem in Turbo and plugin
resolution trouble in ESLint. Checks ran through the installed Node entrypoints
without dependency changes or disabling rules. For lint/Next build, `NODE_PATH`
pointed to the installed `eslint-config-next` package's `node_modules` directory.
API tests receive only `TEST_DATABASE_URL` from the local env and use the dedicated
`*_test` database. Application credentials were not written into evidence.

One earlier repository-only test run crossed an hourly webhook bucket boundary:
two timestamps ten seconds apart fell in different buckets, violating an existing
fixed row-count expectation. The full suite subsequently passed; this is a known
time-dependent test limitation, not an observed R21 runtime defect.

The new PostgreSQL recovery exercise initially shared queued jobs with other test
fixtures. It now uses the existing disposable isolated-database helper, so its real
worker cannot consume unrelated fixture jobs. The final full suite passes.

Running a QA production web server and the main dev server against the same `.next`
directory caused an HTTP 500. QA now uses `NEXT_DIST_DIR=.next-r21` consistently for
build/start; the main web was restarted with the default `.next`. Both returned 200.

## Provider/browser acceptance

The signed-in new-call form populated both names from the current profile. A manual
first-name edit survived unrelated form updates, then was restored before review.
The reviewed plan retained the represented names. No profile edit or unlock button
was involved.

One reviewed Russian test plan was started through the ordinary approval UI using
an existing verified account. The user explicitly confirmed recipient consent for
the AI call and recording, and separately authorized the temporary scoped Twilio
tunnel. Migration 0062 was applied to the local application DB before the call.

Observed sequence: `conversation.hangup requested` → `playback_complete` → durable
recovery `scheduled` → `conversation.ended: agent_hangup` → Twilio `completed`.
The playback mark arrived 7.812 seconds after the request, including queued audio;
provider completion followed it by 0.429 seconds. No hangup fallback was used.
The recipient confirmed that the farewell played fully and the line ended without
manually hanging up. Recording (30 seconds) and final ASR completed successfully.
Usage records exist for Realtime, telephony and transcription; one provider-reported
Twilio connectivity cost was recorded. This does not independently audit every
provider invoice or establish that the semantic call objective was fulfilled.

No recipient number, provider IDs, credentials, transcript text or tunnel URL belong
in committed evidence. The QA API used the flag explicitly; the repository default
remains false and the main environment has not been switched on or deployed.
After acceptance, the temporary QA API/web and scoped tunnel were stopped. The
main local web and API were restarted, and the result page was reopened on port 3000.

The plan calls for broader locale/interruption/refusal live scenarios. Local fake
socket/timer tests establish deterministic protocol behavior; they do not establish
real model decisions, audio timing, production readiness or R08 voice safety.

## Tablet navigation follow-up

The expanded menu was clipped by the legacy `overflow-x: auto` on `.topbar-actions`.
The current theme now explicitly uses `overflow: visible` on that container while
retaining scrolling inside the dropdown. Reproduced at 900px before the fix and
visually verified afterwards; links receive pointer input at 390, 768 and 1022px.
Toggle, Escape with focus return, outside click and link navigation close the menu.
The desktop More dropdown also works at 1280px. `git diff --check` passes.
