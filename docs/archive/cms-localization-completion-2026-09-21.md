# CMS localization completion — 2026-09-21

Applied to the running local PostgreSQL CMS. This is not an external deployment.
The current English homepage was the content and layout reference; existing
English, German and authored translations were preserved.

## Result

- Published landing **r10** supports DE, FR, IT, RM, EN, RU and UK. Its nine stored
  blocks (eight enabled), order, identifiers, settings and EN/DE copy match r9.
  The existing r10 draft matched that publication and was completed and published
  through `ContentService`; r9 remains unchanged.
- Added **35 page localizations**: five each to the current published acceptable
  use, FAQ, imprint, privacy and terms revisions, and five each to the existing
  imprint and support drafts. Draft pages remain unpublished.
- All six published pages now have all seven locales. Published support, FAQ
  collection and navigation already had translations; they were retained.
  Navigation now resolves to translated destination pages.
- Page titles, summaries, sections, link labels and SEO fields are covered.
  Landing copy includes hero, founder story, examples, steps, limits, FAQ and CTA.
- The five existing public locale resources now contain 203 source phrases each.
  Fifteen missing source phrases were added per resource. Obvious calques in
  affected landing copy were also corrected. Fixed brand slogans were preserved.

## Implementation and replay

`apps/api/src/content/cms-localization-completion.ts` uses the existing locale
registry, public resources, schemas, repository and editorial publication service.
It fills absent translations on the **exact current revision**, rather than
mistaking an older translated revision for a current one. It never overwrites
authored translations or changes layout.

Missing page locale rows are appended to the same semantic revision. Existing
published rows and revision metadata remain immutable; legal acceptance IDs and
existing user acceptances are unchanged. Collection snapshots use normal
draft/publication methods. An unrelated editorial draft aborts the operation
instead of being published implicitly. No triggers or authorization checks are
disabled. No migration is required.

The operator script defaults to read-only planning. Applying requires an active
content editor/Admin account, records that actor in the CMS audit, validates all
translations before writing and runs atomically under CMS table locks. Concurrent
or subsequent replay adds nothing once the gaps are filled. Unknown source text
fails explicitly and must first receive a translation in the locale resources.

Run from `apps/api`, using a unique output filename each time:

```powershell
node --import tsx scripts/complete-cms-locales.ts --output ../../.tools/public-content/cms-locales-plan.json
node --import tsx scripts/complete-cms-locales.ts --apply --actor-email <editor-email> --output ../../.tools/public-content/cms-locales-applied.json
```

Full source snapshots, actor IDs and application reports stay in ignored
`.tools/public-content`; they are not committed as public documentation.
The web frontend retains its existing 60-second content revalidation policy.
An initial stale response can be followed by the updated page after revalidation.

## Verification

- Focused API tests: **3 files, 13 tests passed**, including isolated PostgreSQL
  integration tests for dry-run, authorization, atomic failure, concurrent replay,
  layout preservation, authored translations and unchanged legal acceptances.
- API lint/typecheck and build passed; `copy:check` passed (746 files), Rumantsch review
  export regenerated, and `git diff --check` passed.
- All **42 public page/locale API combinations** returned the requested locale.
  Landing, FAQ and navigation returned the requested language for all seven
  locales, without fallback. A new dry-run found **zero remaining additions**.
- Existing published EN/DE page DTOs were compared with the pre-change snapshot
  and match exactly; landing layout and EN/DE fields also match.
- Browser checks confirmed translated French, Italian, Rumantsch, Russian and Ukrainian homepages,
  localized metadata and the French privacy page after cache revalidation.
  The Russian desktop screenshot showed the existing layout intact.
- An earlier full API run was not green: the existing shared test database has a
  checksum mismatch for `0065_text_artifacts_and_jobs.sql`, and superadmin email
  tests still expect English/USD text despite locale-aware output. The new CMS
  fixture also initially failed against immutable-row protections; that fixture
  was corrected and the focused final run passed. The shared database and unrelated
  email tests were not modified. This is not a claim that the full suite passes.

## Rumantsch review

Rumantsch Grischun copy is implemented but has not been reviewed by a native
editor. All 203 public source/translation pairs are individually listed in
[the Rumantsch review handoff](rumantsch-review.md), alongside UI/email strings.
Review the whole RM public catalogue, especially idiomatic headlines, the founder
story and legal/consent terminology; the approved slogan is fixed.
