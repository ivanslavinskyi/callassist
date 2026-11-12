# Brand pronunciation and stable checkpoint

**Decision date:** 12 November 2026, Europe/Zurich.\
**Status:** accepted by the product owner as the current stable version.\
**Checkpoint:** annotated Git tag `stable-2026-11-12`, published after the tagged commit passes CI.\
**Scope:** source implementation and local acceptance; production deployment remains separate.

## Accepted behavior

The assistant's written name remains `Shprohli`. GPT-Live receives localized
pronunciation instructions targeting “ШПРОХ-ли”, IPA `/ˈʃprox.li/`, including an
audible /x/ between /o/ and /l/. Both `de-CH` and `de-DE` use “Grüezi” in the
opening. German instructions include “Grüezi, ich bin Schprochli, …” with the
selected voice's grammatical gender. The native session instructions and startup
greeting share the pronunciation helper. This adds no TTS stage or replacement audio.

GPT-Live can also put `Schprochli` in its captions. The web presentation converts
that spelling to `Shprohli` in the assistant's German self-introduction after
`ich bin`, `mein Name ist` or `hier spricht`. The rule applies after live fragment
grouping, to saved transcript segments and to text/PDF exports. Other speakers,
unassigned text and references to other people's names retain their source text.
Stored transcript evidence, segment identifiers and hashes are unchanged; old
calls receive the display correction when reopened.

## Runtime identity

| Setting | Stable value |
| --- | --- |
| Selected profile | `native_v2` |
| Voice/runtime identity | `live-plan-only-2026-11-12.2` |
| Profile release | `native-v2-holistic-2026-11-11` |
| Preparation policy | `preparation-live-holistic-2026-11-11` |
| Compiler / plan schema / approval | 17 / 11 / 10 |
| Migration catalog | `0001`–`0116`, unchanged |

The accepted preparation, appointment authority and closing behavior are retained.
No model, voice, billing, database policy or deployment setting changes accompany
this checkpoint. See the [runtime specification](../native-live-runtime.md) and
[profile configuration](../runtime-profiles.md).

## Verification and acceptance

On 12 November, the owner authorized four short GPT-Live trials and analysis of
their synthetic audio using the application key, with a total cap of $1 and no
telephone calls or TTS. The owner heard the intended pronunciation in both samples
using the German first-sentence example. Automated audio judgments disagreed on
one sample, so human listening determined acceptance. The estimated total cost
was $0.05719; this is a diagnostic estimate, not a provider invoice. Private
recordings, prompts, credentials and experiment artifacts remain outside Git.

After the local API/worker update, the owner reported that pronunciation worked.
The subsequent transcript display correction was also accepted, followed by the
explicit request to freeze the current version as stable. This is local acceptance;
it does not establish acoustic reliability across every language, voice or call.

Local checks during implementation on 12 November passed:

- API: 83 targeted tests across identity, native prompts/profiles, native v2 and runtime profile configuration.
- Contracts: 38 targeted tests for the affected opening/approval contracts.
- Web: 55 tests across live fragments, saved results, transcript display and text/PDF exports.
- API, contracts and web TypeScript checks; whitespace validation.
- Local web readiness: HTTP 200 after the display change compiled.

The repository CI workflow additionally checks migrations, dependencies, lint,
types, the full test suite, encryption recovery, database backup/restore, builds
and built runtime profile compatibility. Its completed run URL and commit SHA are
recorded in the annotated stable tag after success. The tag identifies the exact
source checkpoint; local process provenance remains the captured startup source
digest until those processes are restarted.

Prior preparation and appointment evidence remains in the
[11 November validation record](preparation-holistic-validation-2026-11-11.md).
