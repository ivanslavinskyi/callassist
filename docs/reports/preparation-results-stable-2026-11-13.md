# Stable preparation and results checkpoint

**Decision date:** 13 November 2026, Europe/Zurich.\
**Status:** accepted by the product owner as the stable source version.\
**Checkpoint:** annotated tag `stable-2026-11-13`, published only after CI succeeds
for the exact tagged commit. The tag annotation records that SHA and CI run URL.\
**Scope:** source and local acceptance. Production deployment is a separate operation.

## Accepted changes

The checkpoint combines the 13 November preparation, display translation and
post-call assessment work on top of `stable-2026-11-12`:

- Preparation audit focuses on material differences, keeps the selected call
  language explicit and understands existing appointment authority/conditional
  semantics. Generation, safety checks and the single bounded recovery remain.
- Display translation validates structure and source binding, allowing natural
  translations such as numerical compounds. It remains separate from the approved
  voice plan and post-call evidence.
- Summary v9 assesses the approved task against the original conversation. Internal
  registration neither establishes success nor downgrades a confirmed agreement.
  Calendar restrictions and substantive uncertainty remain. The existing appointment
  card uses the explicit approved operation and cited conversation result, retaining
  the notice that recipient confirmation is not independent calendar verification.

| Component | Stable identity |
| --- | --- |
| Profile | `native_v2` |
| Profile release | `native-v2-holistic-2026-11-13-v2` |
| Preparation policy | `preparation-live-holistic-2026-11-13-v2` |
| Display review | `review-translation-v1:text-processing-v2:...` |
| Summary | `summary-v9:grounded-v3:text-processing-v2:...` |
| Voice implementation | `live-plan-only-2026-11-12.2`, unchanged |
| Compiler / plan schema / approval | 17 / 11 / 10, unchanged |
| Summary extraction / source context | `native-summary-v3` / 3 for schema 11, unchanged |
| SQL catalog | `0001`–`0116`, unchanged |

Models, voices, tiers, capacity, provider budgets and pricing are not changed by
this checkpoint. Voice/action handling and credit settlement code are unchanged.
Historical completed reports, pinned jobs, approvals and billing evidence remain
versioned; opening a historical call does not automatically regrade it.

## Verification and limits

The final offline suite passed 2460 API unit tests, 34 isolated PostgreSQL
publication/assessment tests, 514 web tests and 290 contract tests. API/web/contracts
type checks, the API production build and diff checks passed. The appointment card
was checked in a headless browser using the real retained last-call result, current
application component/styles, German copy and desktop/mobile widths.

The last successful local call's retained model output reproduced the old `partial`
result exactly under v8 and produced `achieved` under v9, with the same three criterion
decisions and a confirmed appointment card. A new local report revision was saved;
the old report, canonical billing evidence and credit rows were verified unchanged.
No additional model request or telephone call was needed for this replay.

The separately budgeted preparation evaluation reduced the observed hard blocks and
technical failures. Its final full replay had 44 ready cases, three necessary
clarifications and one unnecessary clarification out of 48; the last narrow changes
received targeted provider checks, not another complete replay. The semantic auditor
remains probabilistic. Stability acceptance does not assert zero false rejections,
universal model accuracy or completed production verification.

The CI workflow supplies the remaining repository-wide integration, lint, dependency,
build, migration, encryption recovery, backup/restore and built-profile gates. The
stable tag is created only after that workflow succeeds for the commit being tagged.

## Evidence and activation

- [Preparation implementation and bounded evaluation](preparation-reliability-v2-2026-11-13.md).
- [Display translation diagnosis and verification](review-translation-simplification-2026-11-13.md).
- [Conversation assessment implementation and replay](conversation-assessment-2026-11-13.md).
- [Local persistence interruption investigation](local-call-persistence-failure-2026-11-13.md):
  the observed lock timeout is documented; no storage/runtime change is claimed.
- [Production version activation list](../plans/production-activation-stable-2026-11-13.md).

Private diagnostics, transcripts, recordings, provider responses, credentials and
host-specific process state stay in ignored operational directories.
