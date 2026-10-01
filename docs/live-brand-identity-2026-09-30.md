# Shprohli identity and post-reboot verification — 30 September 2026

Current follow-up: [v4 implementation and acceptance record](live-combined-stabilization-implementation-2026-09-30.md) implements the combined runtime/disclosure changes. Historical evidence below describes its original version; v4 handset acceptance remains pending.


Branch: `codex/live-unified-runtime`. This implements the owner's choice of one
assistant name, **Shprohli**, for both male `cedar` and female `marin` voices.
Pronunciation target: **ШПРОХ-ли**, German **Schprochli**, IPA `/ˈʃprox.li/`:
two syllables, first-syllable stress. Pronunciation remains subject to handset
listening acceptance; prompt tests do not establish acoustic consistency.

## What survived the interrupted session

The previous orchestration stabilization and its analysis documentation survived.
The identity implementation and new tests were also on disk before the reboot,
but identity verification, documentation and runtime activation were unfinished.
The last saved test logs contained launch errors rather than passing results.
After reboot, PostgreSQL was available and no application listener or tunnel was
running. Old process IDs and the old temporary tunnel URL were not reused.

## Implemented contract

- `packages/contracts/src/assistant-identity.ts` defines `ASSISTANT_NAME = "Shprohli"`.
  New/editable brief normalization and newly created approved execution snapshots
  use this name independently of the selected legacy profile ID.
- Live instructions use the shared product name directly. Existing immutable
  approved snapshots can still contain old names, but those names no longer define
  the Live assistant. Existing snapshots, hashes and historical transcripts are not
  rewritten. Six historical profile IDs remain valid for voice compatibility.
- `apps/web/lib/assistant-identity.ts` re-exports the same constant for assistant
  speaker labels in the interface and exports. Uppercase SHPROHLI in product headings
  remains presentation typography rather than a separate identity.
- `live-assistant-identity.ts` adds a short cue in each of the seven supported call
  locales and the shared IPA target. German cues use `Schprochli`; Russian uses
  `Шпрохли`; English, French and Italian describe the initial sh sound and the kh
  sound using local-language examples. Language switching preserves the same name
  and pronunciation target. The model remains explicitly an AI assistant.
- These instructions concern only the assistant's name. Recipient and represented
  person names are preserved, including names matching legacy persona names.
  Pronunciation cues are instructions, not extra words in controlled speech.
  Disclosure/permission TTS, recording admission, voice selection, tool authorization
  and closing timing are unchanged by this identity fix.

The [official OpenAI Live prompting guide](https://developers.openai.com/api/docs/guides/live-prompting#language-and-pronunciation)
recommends language-specific pronunciation cues with IPA and listening checks for
the chosen voice. This implementation follows that approach; it adds no second
voice runtime or synthesized name clip to the natural conversation.

## Verification after reboot

Fresh checks on 30 September passed:

- 176 tests in five API suites: identity, native Live protocol, unified call,
  preparation and runtime selection.
- All 151 contracts tests; 17 web result/transcript export tests in two matching
  suites. The attempted derived-transcript-export filename has no test file and
  contributes no tests to this total.
- API and web TypeScript checks; API and contracts builds; `git diff --check`.

The identity matrix covers all six legacy profiles across all seven call locales
and both pre-consent/task instruction modes. It checks unchanged voice selection
and stored snapshots, the new approval name, continued silence before task admission,
and preserved participant names. The socket protocol test also checks that the
actual `session.start` instructions carry the brand and IPA cue.

Private test logs are in `.tools/live-brand-*-tests.log`, `*-typecheck.log` and
`*-build.log`. The pre-identity source baseline is
`.tools/live-brand-baseline-20260930/manifest.json`; the activated candidate's twelve
source files and hashes are in `.tools/live-brand-candidate-20260930/manifest.json`.
`runtimeVersion=live-managed-v2` identifies the orchestration version;
`identityRevision=shprohli-v1` in the local state/manifest identifies this identity
change. No new telemetry runtime-version value is implied.

## Local runtime and handset acceptance

The local application was started after reboot on 30 September at 15:50 Zurich:
Live `gpt-live-1`, GPT-6 Luna delegation, fallback=false, embedded worker and automatic
hangup enabled. The database is through migration 0089, and the preflight found zero
active calls. API readiness and liveness passed; `/ru` returned HTTP 200. All application
listeners bind only to loopback. The fresh tunnel targets the Twilio gateway at 4001.
The public tunnel returns 404 for private `/health/ready` and 403 for an unsigned
`/webhooks/twilio/voice` POST, confirming gateway routing and signature enforcement.
Next generated references to `.next-unified-local` in `next-env.d.ts`/`tsconfig.json`
for this isolated local dev build; the web TypeScript check passed again afterwards.
Current process IDs, actual log paths and the tunnel URL are in
`.tools/runtime/stabilization-state.json`; older local runtime state files are stale.

Open `http://localhost:3000/ru` for the owner's test call. Listen for Shprohli with
first-syllable stress, one AI introduction, correct names of the people involved,
complete opening speech and playback-confirmed hangup. Repeat with the other voice;
cross-language acoustic consistency requires additional listening checks.

The [earlier call review](live-call-review-2026-09-30.md) established a successful
information task and application hangup, but preceded this identity fix. Its possible
opening clipping, overlapping acknowledgement and unnecessary processing filler remain
observations, not fixes implemented here. Appointment corrections and reciprocal
farewell also remain handset acceptance work. No production deployment or outgoing
test call was performed by this recovery task.
