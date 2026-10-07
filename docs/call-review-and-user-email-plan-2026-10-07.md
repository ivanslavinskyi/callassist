# Call review and user result email implementation

Approved 2026-10-07. This change fixes landing demo contrast, makes call approval
actions discoverable on every screen size, and emails owners the result of a
conversation. Production deployment is separate from implementation.

## Agreed behavior

1. Keep the demo's light visual palette self-contained. Nested plan and result
   components must inherit compatible foreground, background, border and focus
   tokens in either outer theme.
2. Present the approval screen with a short objective and important conditions,
   explicit approval guidance, and expandable full details. Keep actions visible
   in a compact sticky desktop sidebar and a mobile bottom bar. Preserve plan
   revision and translation evidence, blocking states, expiration checks and the
   final confirmation dialog. Reserve space for the bar and device safe area.
3. Send a separate owner result email after a conversation, independently of
   superadmin notification settings. Reuse the existing branded email shell,
   including the opening logo, typography and footer. Include recipient/date,
   compact AI assessment, a result-page link and the complete original transcript
   in the email body. No transcript attachment and no silent truncation; retain the
   existing inline logo used by the shared email shell.
4. Freeze the UI language when the call is created. Subject, static labels,
   assessment status labels, CTA and footer use this snapshot, even if the user
   subsequently changes UI/account language. Preserve generated assessment prose
   exactly as stored (including the original prompt language); preserve the
   transcript in the original conversation language. No extra LLM calls or
   translations to compose an email.

## Delivery and data rules

- Bind every delivery to its owner and exact call attempt, approved compilation,
  transcript revision and assessment evidence. A later attempt must not replace
  the result of the emailed attempt.
- Enqueue durably on terminal attempt events and wait for original transcript and
  assessment publication. Reuse existing background generation; closing the
  browser must not affect delivery.
- Confirmed conversations qualify regardless of goal success. No-answer, busy,
  voicemail-only and consent-refused attempts do not qualify. After bounded
  assessment waiting (five minutes), an available post-consent two-party dialogue
  can produce an email explicitly stating that the AI assessment is unavailable.
  Do not invent a goal outcome or treat connection alone as a conversation.
- Recheck readiness when late evidence arrives, with a bounded delivery lifetime.
  One delivery per attempt and owner, encrypted frozen payload, leases, bounded
  exponential retries and provider idempotency within the existing 20-hour retry
  window. No historical bulk mail on installation.
- Check active ownership, verified destination email and source availability before
  dispatch. Cancel/redact queued data when the call/account is deleted or the
  destination changes. Include stored ciphertext in key rotation.
- Preserve the requested internal result URL through login, validate the return
  target, and retain normal owner authorization. Public transcript URLs are not
  introduced.
- Existing calls without a creation-language snapshot use an explicit stable
  migration fallback; new calls always capture the actual creation UI locale.

## Implementation sequence

1. Demo token isolation and approval presentation/actions with seven-locale copy.
2. Creation-language snapshot and schema migration; owner report and branded email.
3. Durable notification delivery and lifecycle wiring; authenticated return URL.
4. Focused component/domain tests, isolated database delivery tests, locale checks,
   typecheck, lint and build. Document actual verification and any limitations.

## Acceptance checks

- Demo plan, expanded details and result remain readable in both themes.
- Approval/edit actions are discoverable at 320, 375, 390, 768, 1024 and 1440 px;
  long copy, short viewport, zoom, safe area and keyboard focus remain usable.
- Original/translated approval, stale plans, blocking states, expiration and repeat
  submission retain their existing safeguards.
- RU creation UI + UK prompt/result prose + DE call produces RU static email copy,
  unchanged UK assessment prose and unchanged DE transcript after account/UI changes.
- Entire transcript survives HTML escaping and text rendering, including long turns.
- Duplicate events, two workers, restart and uncertain provider responses do not
  duplicate mail. Delayed/missing evidence, deleted data and changed email are tested.
- Superadmin mail, credits and existing call assessment behavior remain covered.

## Verification record

Implemented 2026-10-07. The initial Windows control-tool limitation was resolved
for verification by running headless Edge against the local app and a harness that
mounts the actual approval component with the app's compiled styles.

- Web: 72 test files / 405 tests passed; contracts: 25 files / 254 tests passed.
- API regression run: 9 files / 145 tests passed, including admin notification,
  owner notification, authentication, repeat-call and assessment coverage.
- Final owner-delivery suite: 19 tests passed after adding missing-conversation
  and source-redaction cases; language publication/recompilation integration passed.
- API and web production builds passed. API/web TypeScript, web ESLint, public
  copy consistency and Git whitespace checks passed.
- Browser: light/dark at 320, 375, 390, 768, 1024 and 1440 px; seven UI languages
  at 320 px; short landscape viewport; collapsed/expanded plan, sticky actions,
  blocked/busy states and confirmation gate. Inspected mobile/desktop screenshots.
- Actual local mock flow: registered and verified a temporary FR-account user,
  created a call with RU UI, confirmed the saved RU snapshot, opened the real
  mobile approval page, tested the confirmation dialog, signed out and signed
  back in from the result URL. The original RU result URL was restored.
- That full-flow check exposed overlap with the privacy notice. The notice now
  moves above the mobile action bar, with clearance restored on unmount/resize.
  The repeated full-flow check passed with the notice still visible.
- Inspected a branded mobile email preview containing RU template copy, UK saved
  assessment and DE original transcript; logo loaded and there was no overflow.
  Transcript content has no file attachment; the shared inline CID logo remains.

The initial browser checks used web port 3002 / API port 4002 with memory storage
and mock providers. Delivery integration tests used disposable isolated PostgreSQL
databases. Later on 2026-10-07, at the user's request, the local web moved to
http://localhost:3000 and the API to port 4000 with the working PostgreSQL database,
Twilio/Live, existing OpenAI/Resend configuration and an external `all` worker.
Migration `0109` was applied locally after a database backup. A temporary tunnel
exposes only webhook port 4001. API/database/worker readiness and signed/unsigned
empty webhook probes passed without creating a call. Current process/tunnel details
are recorded in ignored local operations material, not this source specification.

These checks did not initiate a real call or provider email. Real mailbox delivery
and client rendering remain a supervised release smoke check. Local superadmin
credential diagnosis is still open; no password reset or successful login is claimed.
Production has not been changed. CI results must be checked for the eventual pushed
commit; earlier local checks are not evidence of that CI run.

Before push, the existing CI dependency-audit failure was addressed by pinning
`sharp` to `0.35.5` in the API, workspace override and lockfile, following
[GHSA-wq5f-xc86-pv6w](https://github.com/advisories/GHSA-wq5f-xc86-pv6w).
Frozen-lockfile installation and dependency audit passed with no known
vulnerabilities. OG rendering/API/database regression tests passed (3 files,
10 tests); the schema catalog check confirmed 109 migrations. Maintained document
links, public-copy consistency, license and whitespace checks passed.

Deployment must apply `0109_user_call_notifications.sql` before starting the new
API/background worker. The migration freezes legacy call locales with the stated
fallback and does not enqueue historical calls. New completions use the existing
email-provider configuration; there is no new provider secret or admin-email flag.
