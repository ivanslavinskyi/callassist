# Emerald Paper rev02 — application design QA

final result: passed

Date: 2026-09-07. Design integration and final production smoke checks are complete. Evidence is consolidated; the visual findings below were fixed and recaptured.

## Findings and comparison history

No unresolved P0/P1/P2 visual finding remains in reviewed screens. The first implementation was not accepted without iteration. Evidence filenames below are relative to `Design/implementation-2026-09-07/`.

| Severity | Earlier finding and impact | Correction and post-fix evidence |
| --- | --- | --- |
| P1 | Legacy shell/navigation/card treatments changed composition. | Full-width header, source widths, open sections, common footer and licensed icons. `landing-desktop-light.png`, `new-call-desktop-light.png`, `admin-system-desktop-dark.png`. |
| P2 | Auth spacing and compact field hierarchy differed. | Two-column frame, approved type/field sizing and mobile stacking. `register-mobile-light.png`, `login-desktop-dark.png`. |
| P1 | Completed-call recording/feedback lacked prominence. | Final/provisional tabs, recording then feedback sidebar, export by transcript heading, collapsed plan. `call-completed-desktop-dark.png`, `call-completed-mobile-light.png`. |
| P2 | Native player and negative form-action margins overflowed narrow screens. | Constrained audio and corrected sticky action margins. `call-completed-mobile-dark.png`, `new-call-mobile-light.png`, final 320/390/1024 measurements. |
| P1 | Account displayed all sections at once. | Hash-addressed sections, mounted forms, desktop sidebar/mobile tabs. `account-desktop-light.png`, `account-mobile-light.png`, `account-usage-mobile-dark.png`. |
| P2 | Account heading wrapped differently; identity actions were displaced/small. | Source letter spacing and centered 16px actions. `account-mobile-light.png`, `account-mobile-dark.png`. |
| P2 | Articles/onboarding retained boxes and wrong information order. | Article navigation, open sections, information before required agreement. `privacy-desktop-light.png`, `onboarding-mobile-dark.png`. |
| P1 | Admin tables, credits/safety and editors retained constrained layouts. | Workspace widths, labeled mobile rows, collapsible filters and anchored sections. `admin-credits-mobile-light.png`, `admin-calls-mobile-dark.png`, `admin-content-desktop-light.png`. |
| P2 | Long overview cost state exceeded 320px. | Explicit minimum-width grid tracks and wrapping state labels. `admin-overview-320-after-dark.png` and final 320px measurements. |
| P2 | Dark skip link/help and intermediate button colors failed contrast. | Semantic tokens; removed background/color transitions. Final contrast measurements and focus checks. |
| P2 | Root 404 failed to restore theme. | Saved/system choice restored on mount. `not-found-mobile-dark.png`, `not-found-de-desktop-dark.png`. |
| P2 | Review headings were small labels; opening boxed and metadata stacked. | Semantic 24px headings, open sections, inline metadata, a mobile title/status row and green ready state. Actual success criteria remain. `call-review-desktop-light.png`, `call-review-desktop-dark.png`, `call-review-mobile-dark.png`. |
| P2 | Lower landing heading measure and step density differed. | Source 24ch measure, two-digit numbering, compact 16/14px rows. `source-landing-how-desktop-light.png` paired with `landing-how-desktop-light.png`. |

Reference and application images were supplied together in the same comparison input. Revised account, onboarding, article, call, admin and lower-landing captures were compared again after fixes. Chronological measurements retain earlier failures.

## Visual truth, state and density

Source: [atlas](Design/system-2026-09-07/index.html), [specifications](Design/system-2026-09-07/PAGE-SPECS.md), [guidelines](Design/system-2026-09-07/GUIDELINES.md), and `Design/system-2026-09-07/screens/`.

Implementation: actual Next application at `http://localhost:3000`, existing API `buildApp`, disposable repositories/mock providers. [Reproduction and review accounts](Design/implementation-2026-09-07/README.md).

Chosen Codex in-app Chromium was controlled through CUA. Requested CSS widths: 320, 390, 768, 834, 1024 and 1440; mobile height 844, desktop/tablet height 1024. Light/dark, public/customer EN/DE, existing English-only admin were inspected.

Browser reports density approximately 1. Source/application mobile pairs are both 375 × 811 pixels; desktop pairs both 1425 × 1013 pixels. Capture excludes scrollbar/chrome from requested viewport. Equal-sized images were compared without rescaling. Files retain atlas `.png` names although CUA returns JPEG bytes; compression/antialiasing is not treated as font drift. `workspace-empty-desktop-light.png` is a 1024px state capture, not a 1440px comparison.

Role, locale, theme and layout state are matched. Synthetic identities, dates, compiled plans and current CMS/legal copy differ from atlas examples; exact text-length/page-height equivalence is not claimed. Lower landing is aligned by How it works rather than absolute screenshot y-coordinate because preceding CMS content is longer.

Representative full-view pairs share names in source and application directories: `landing-desktop-light`, `register-mobile-light`, `new-call-desktop-light`, `account-mobile-light`, `onboarding-mobile-dark`, `privacy-desktop-light`, `call-completed-desktop-dark`, `admin-system-desktop-dark`, `admin-credits-mobile-light`, `admin-calls-mobile-dark`. Review pairs source `call-desktop-light.png` with application `call-review-desktop-light.png`.

Focused inspection revisited account heading/actions, onboarding agreement, transcript/audio/feedback, table cells and review metadata in these same-scale images. Mobile text/controls are readable; separate enlarged crops were unnecessary. Lower landing has a dedicated section capture pair.

## Five required fidelity surfaces

| Surface | Evaluation |
| --- | --- |
| Fonts and typography | Embedded Geist matches approved font asset byte-for-byte. Weights, measures, body/label scale, line heights and wrapping compared; account/review drift corrected. Existing system fallbacks cover unavailable glyphs. |
| Spacing/layout rhythm | Open sections, dividers, restrained radii, content widths and responsive columns follow reference. Tables become labeled rows. No page overflow remains in retained final measurements. |
| Colors/tokens | Shared light/dark emerald, surface, border, disabled and semantic tokens. Visual comparison plus computed-style text-contrast heuristic; not complete WCAG certification. |
| Images/assets | Original SVG wordmark/portal geometry and approved variants. Exact licensed Heroicons sun/moon/hamburger/close; provenance in `apps/web/public/brand/`. No generated logo or raster substitute. |
| Copy/content | Existing EN/DE catalogues, CMS and API data. Legal disclosures, success criteria, validation and technical metadata retained. Landing example labeled; no design-process text in product flows. |

## Behavior and gates

[Coverage](Design/implementation-2026-09-07/COVERAGE.md) maps all 33 atlas entries and 162 named states to actual routes/components. Browser observations are explicitly narrower; this does not claim 162 end-to-end tests.

Observed interactions:

- Registration, invalid SMS error, correct mock verification, required agreement, accepted onboarding and empty workspace.
- Customer/admin login and customer `/admin` redirect. Role navigation and separate sensitive-text gate retained.
- Filled new-call form survives History/New call and theme changes; the history hash also survives filtering and reload; API preparation creates compiled plan. Explicit confirmation starts a mock call which reaches approval and terminal states.
- Final/provisional switching, 66-second native recording, feedback save/update and persistence after reload. Copy/PDF/deletion handlers retained; destructive deletion not executed.
- Account name edit survives section/theme switching and saves via API. Session revocation/sign-out exercised. Contact verification/export/deletion bindings retained.
- Populated admin calls/consent, user ledger, system sections, private CMS draft save and authorized preview. No publication or sensitive-text authorization submitted.
- Theme persistence, hamburger open/close, Escape and visible focus returning to trigger. Native confirmation starts at Cancel; Escape returns to its opening button.

[Chronological measurements](Design/implementation-2026-09-07/route-audit.json) retain iterations. [Final measurements](Design/implementation-2026-09-07/final-route-audit.json) retain latest valid route/width/theme observations, excluding loading, incorrect size/theme and redirects. Checks cover overflow, one common footer, theme and visible-text contrast, supplementing image comparison rather than validating every dynamic state.

26 web test files / 113 tests passed. Public copy check passed for 420 files. ESLint, TypeScript and optimized Next build passed. Fresh production checks found no new browser errors in exercised customer/admin routes. Dev hot reload emitted React `useId` warnings in existing form/dialog components; they did not reproduce after a fresh production build. New menus have explicit stable IDs.

Reduced-motion CSS is implemented; the loaded stylesheet was inspected for disabled animation/transitions and non-smooth scrolling under the media query. OS-level reduced-motion emulation, actual 200% zoom, screen readers, password managers and cross-browser testing were not executed. R13 remains partial. Native dialog behavior was checked as stated, not certified as an exhaustive keyboard audit.

## Accepted differences / remaining release work

- P3: native recording controls differ from illustrative player while providing real browser playback; dimensions fit the layout.
- P3: real identities, CMS sections, plans and metadata change row heights/page lengths; preserved instead of replaced by examples.
- P3: minor browser rendering and native disclosure-marker differences. Source brand and theme/menu assets are exact.
- R13/R06/R14 retain exhaustive fault/reconnect states, assistive technology, browser/password-manager acceptance and live-provider drills. Local design acceptance does not imply deployment or public-beta acceptance.

## Implementation checklist

- [x] Approved tokens/assets and shared responsive shells in actual app.
- [x] Public/auth/customer/completed-call/admin/preview screens.
- [x] Full atlas mapping; observed states distinguished from mapped branches.
- [x] Actionable visual findings fixed, recaptured and re-compared.
- [x] Final production smoke check, evidence consolidation and R20 local handoff.
