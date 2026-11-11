# SHPROHLI

SHPROHLI helps people make everyday phone calls when speaking or the local language
is a barrier. Users prepare and approve a call plan, follow a conversation, and
receive a saved transcript with optional translation, summary and recording transcription.
After a qualifying conversation, the verified owner also receives a branded result
email with the saved AI assessment, full original transcript and authenticated call link.

The environment example selects the stable `CALL_RUNTIME_PROFILE=native_v2`.
Existing configurations without a profile retain managed GPT-Live (`live-managed-v9`)
as their default, with application-owned consent, recording and closing playback. Native v2
lets Live conduct the opening, conversation and brief closing, with full approved
task context available at startup. Responses delegation handles reasoning; the
application validates action authority, evidence, privacy and hangup. Native v2
supports general tasks and approved booking, confirmation, rescheduling and
cancellation. Native v2 was accepted as stable after local telephone testing on
8 November 2026. The 9 November task-boundary release adds source-grounded plan
constraints and silent closing delegation without extra Live orchestration. See
the [release record](docs/reports/native-task-boundary-2026-11-09.md) for verification
and the owner-reported production rollout; future deployments remain explicit operations.
Realtime and legacy hybrid remain
explicit compatibility paths. Repository checks do not establish the deployed version.
See the [native runtime specification](docs/native-live-runtime.md).
Use [runtime profiles](docs/runtime-profiles.md) to align voice and preparation without manual SQL.

The 11 November update uses compiler 17 / schema 11 and runtime
`live-plan-only-2026-11-11.2`: one holistic review in the existing audit stage,
encrypted preparation diagnostics, canonical call-language context and appointment
tools bound to approved authority. The user accepted the local correction. See the
[validation and acceptance record](docs/reports/preparation-holistic-validation-2026-11-11.md);
production activation remains separate.

## Develop

Requires Node.js >=22.19, Corepack/pnpm 10.12.4 and PostgreSQL 17 (Docker is provided).

    corepack pnpm install --frozen-lockfile
    corepack pnpm env:init
    corepack pnpm db:up
    corepack pnpm db:migrate
    corepack pnpm runtime:configure --apply
    corepack pnpm runtime:check
    corepack pnpm dev

Use an isolated development database and mock providers before opting into paid
provider requests. Configuration defaults and required secrets are documented in
[.env.example](.env.example). API and web are separate applications; see the
[engineer guide](docs/engineer-guide.md) for ownership, workflows and tests.

    corepack pnpm license:check
    corepack pnpm copy:check
    corepack pnpm db:migrate:check
    corepack pnpm lint
    corepack pnpm typecheck

Database tests require a dedicated test database. For a disposable full API run,
from apps/api use: node --import tsx scripts/test-isolated.ts --reporter=dot.
Do not point tests at a working or production database. Build with corepack pnpm build.

## Current capabilities

- Public application and content in DE, FR, IT, RM, EN, RU and UK; separate interface,
  task and call languages, with original or translated plan approval receipts.
- Immutable approved plans, durable preparation with stage diagnostics, bounded
  retries, shared multiuser admission, role workers and recorded provider usage.
- Compact approval summary with expandable details, a sticky desktop action panel
  and mobile bottom actions; the existing final confirmation remains required.
- Native startup preserves relevant information from the objective, context, facts
  and clarification answers; original sources remain inspectable during review.
- Task restrictions are grounded in user sources. Optional sections can be empty;
  internal model rules stay outside the plan. The existing combined audit checks
  roles, meaning, omitted restrictions and conditional branches.
- New calls default to 30-day audio retention with no form selector. Historical
  retention choices remain valid, and users can delete recordings earlier.
- Superadmin-managed test scenarios insert editable task text above the objective
  field. Superadmins have access automatically; eligible accounts can receive an
  independent tester capability. Standard preparation and approval still apply.
- Result emails use the UI language captured when the call was created. Saved AI
  prose and original transcript retain their own languages, without extra translation
  or transcript attachments. Delivery uses a separate durable owner outbox.
- Admin selection of the generation model and Standard/Fast without an evaluation
  prerequisite; fixed audit/review profiles and policy snapshots for existing jobs.
- Optional Swiss-only account phones for registration and phone changes, with
  matching forms and copy across all seven interface locales.
- Managed recording after affirmative consent; native v2 recording from
  connection with a declarative notice and durable deletion on refusal. Live
  transcripts are primary; recording ASR requires an explicit request.
- Summary-v8 uses original task context and grounded evidence, with explicit partial
  coverage. Historical reports and canonical credit evidence remain preserved.
- Transcript PDFs show a separate first-page AI assessment from saved evidence,
  including distinct pending/unavailable states and partial-analysis warnings.
- Transactional credit reserve/charge/refund and versioned beta allowances by
  lifetime, UTC day, week or month without rollover; optional registration seats display.
- Typed, localized preparation failures, safety review of returned plan revisions
  and durable localized notifications.
- Telemetry export v4 with coverage and timing diagnostics; separate Live-duration,
  backend-token and preparation/result costs with usage provenance and finality.
- Immutable preparation attribution separates tester, ordinary and unclassified
  expenses without changing provider pricing or user credit rules.

[Documentation index](docs/README.md) · [Current engineer guide](docs/engineer-guide.md) ·
[Preparation runtime](docs/preparation-runtime.md) · [Native validation](docs/native-live-validation.md) ·
[Task information and testing](docs/task-input-and-testing.md).
Historical evidence is under docs/archive/. Deployment runbooks and VPS topology
are local only under the ignored docs/local-operations/ directory.

Internal workspace package names remain callassist / @callassist/*.

## License

© 2026 Ivan Slavinskyi. All rights reserved. This repository is proprietary;
use requires prior written permission. See [LICENSE](LICENSE).
Third-party components retain their respective licenses and notices.
