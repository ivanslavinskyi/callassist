# Expense inspector — design QA, 2026-09-17

final result: passed

Post-QA update, 2026-09-17 19:39 UTC: OpenAI configuration is now present and the
first Costs API sync succeeded. September provider total is $5.224497 versus the
local $2.441471 usage estimate. The original visual checks below used the earlier
unconfigured state; they are preserved as dated evidence. Current reconciliation
data and its $2.783026 gap are recorded in the implementation report.

Scope: the shared expense component, its integration into admin overview, call
and preparation inspectors, and consistent money/budget wording in beta controls.
This is local component acceptance, not a production deployment or full accessibility
certification. The previous landing QA is preserved in
[design-qa-previous.md](docs/cost-audit-2026-09-17/design-qa-previous.md).

## Visual evidence

Selected source: [concept 3](docs/cost-audit-2026-09-17/concept-3.png), 1487 × 1058
raster pixels. Prompt target: 1440 × 1024 desktop. Source DPR is unknown; it is a
composition reference, not a pixel-exact contract. The user's subsequent request
also requires consistency with the existing admin design.

Implementation: the actual `AdminExpenseExplorer` TSX and admin CSS rendered in a
loopback preview with the current Postgres read model. Only Next Image is replaced
with an ordinary image for this component harness. Production authentication is
unchanged; the protected admin navigation redirects this browser to login. Full
page visual testing inside an authenticated admin session is therefore outside this
pass. API authorization remains covered by the backend test suite.

| Evidence | Viewport / state |
| --- | --- |
| `implementation-desktop.png` | 1440 × 1056 CSS viewport, DPR approximately 1, viewport capture 1424 × 1045; EN, AI conversation open. Native capture excludes browser/scrollbar pixels and is softened by host scaling. |
| `implementation-expenses.png` | Component-only crop of that viewport: 1319 × 982; no repaint or design alteration. |
| `implementation-mobile.png` | 393 × 852 requested CSS viewport, 378 × 2126 full-page capture; Twilio open. |
| `implementation-dark-call.png` | Same mobile viewport, 378 × 1696 full-page capture; DE, dark, call scope. |
| `comparison.png` | Source and implementation component normalized to equal 800px widths and displayed together. |
| `comparison-detail.png` | Focused source/implementation panel crops normalized to equal 660px widths and displayed together. |

All files are in `docs/cost-audit-2026-09-17/`. The whole composition and focused
panel comparisons were opened and visually inspected. An earlier full-page desktop
capture had stitching/scale whitespace; it was replaced with a viewport capture
before comparison. Scaling is explicit; no source DPR is inferred.

The 58/42 list/detail layout, provider headline amounts, six categories, selected
row, prominent detail amount, three tabs and collapsed technical details match the
chosen structure. Intentional adaptations: existing Emerald Paper tokens and font
stack, EN/DE product locales, smaller supporting text to match admin, standard
Heroicons, card border/radius, fuller coverage warning and reconciliation disclosure.
The technical pricing version stays in the detail panel. Monetary values reflect
corrected per-operation rounding and the now-recovered Twilio charge, so they differ
slightly from the concept. No new raster decoration was needed.

## Interaction and consistency

Passed in the browser:

- Category selection updates the panel and selected state; all six categories work.
- Cost, Usage and Requests tabs update content. Arrow keys/Home/End move through
  tabs. Selected tab has `aria-selected`; disclosure buttons have `aria-expanded`.
- Click-to-open focuses the detail heading; close and Escape return focus to the
  category. The initially open panel now also returns focus correctly. Closing
  expands the summary to full width, without an empty visual panel.
- Realtime counts 79 responses once; its audio and text components add to $1.363295.
- Twilio displays account total $5.974220 and call subtotal $4.144600 separately;
  its request list contains individual charges. Billing breakdown sums to total.
- Preparation requests, token/formula details and reconciliation expand correctly.
- Empty period displays unknown money and one empty state, without a false zero,
  blank side panel or irrelevant coverage notice.
- Narrow viewport: no horizontal document overflow; panel stacks below categories.
  EN/DE and dark call detail remain readable. Browser warning/error log is empty.

Source/integration checks:

- Overview and call/preparation inspectors reuse the same component through
  `AdminCostBreakdown`; scope controls period versus record-lifetime labels.
- Beta uses the shared money formatter for measured costs, occupied/available budget
  and next-call reserve. Its 24-hour reservation cohort is explicitly distinguished
  from the service-date overview. Existing beta English-only UI was retained.
- Missing data, partial coverage and subcent values have the same semantics across
  expense surfaces. There is no sum of account billing and its call subtotal.

Fixed during this pass: initial-panel focus return, UTF-8 punctuation, empty state,
closed-panel width, request sampling per category, Twilio request amounts and
remaining beta formatting inconsistencies. No actionable P0/P1/P2 visual finding
remains in this component scope. Screen-reader testing and authenticated full-page
visual regression are not claimed.

## Validation

API production build, API/web TypeScript checks, ESLint of changed expense/admin
components, and money formatting unit test passed. Backend full run executed 1037
tests; one obsolete cohort expectation was corrected and its 49-test related suite
passed on rerun. Fresh isolated PostgreSQL fixtures were used; existing test DB
migration checksums were not modified. Local API was restarted after migration and
latest server changes; readiness reports database ready.

OpenAI Costs is not configured in this environment. The UI correctly exposes that
limitation plus 15 paid operations with missing usage and earliest local usage on
September 5. This is an accounting coverage limitation, not a hidden UI success.
See [implementation report](docs/cost-audit-2026-09-17/implementation.md) for exact
amounts, operations, validation scope and deployment instructions.
