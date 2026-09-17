# Interactive landing demo — design QA, 2026-09-14

final result: passed

Scope: the reference-inspired demo and four landing product improvements. This is
local visual/functional acceptance, not release or WCAG certification. The previous
application-wide record is preserved unchanged in
[design-qa-original.md](Design/implementation-2026-09-07/design-qa-original.md).

## Visual truth and comparison

Source: `.codex-remote-attachments/01a09a48-1477-7590-a321-5d5a060cc592/6ddfa790-2999-498c-969c-c30936049234/1-Photo-1.jpg`
(651 × 1280 px, source CSS size/DPR unknown; window approximately 585 px wide).
The reference is a visual direction, not a pixel-exact clone.

Implementation: Next application at `http://localhost:3000/en` and `/de`, Landing r8.
Screenshots: `Design/interactive-demo-2026-09-14/`.

| File | Viewport, dimensions and state |
| --- | --- |
| `01-hero-en-desktop.png` | 1280 × 1000 CSS px; 1265 × 988 capture; desktop hero. |
| `03-live-desktop.png` | Same desktop size; paused after first substantive answer. Left hero copy is from the previous publication. |
| `02-idle-de-mobile.png` | 390 × 1100 CSS px; 375 × 1023 capture; earlier long opening, top of frame cropped by scroll position. |
| `07-refined-de-mobile.png` | 390 × 1100 CSS px; 375 × 1057 capture; final short opening, window approximately 335 × 844 CSS px. |
| `05-result-de-mobile.png` | Same mobile viewport; 375 × 1057 capture; generated summary, full result frame and PDF control. |
| `08-320-light.png` | 320 × 1000 CSS px; 305 × 953 capture; light-theme minimum-width hero. |
| `09-hero-en-light.png` | 1280 × 1000 CSS px; light-theme final transcript in the hero; native CUA capture confirms the current painted state. |
| `04-downloaded-pdf.png`, `06-downloaded-pdf-de.png` | Actual downloaded EN/DE A4 PDFs rendered at scale 1.3, 774 × 1095 px. |

CUA omits scrollbar/chrome and may compress captures. No source DPR is assumed:
window width is compared proportionally (585 source pixels to ~335 CSS pixels).
Source and implementation were displayed together in the same image-comparison
input, first for the initial mobile version, then again after shortening. Desktop
composition was reviewed alongside the source. The mobile frame is the focused
comparison for type, controls and spacing; these regions are readable without another
crop. Both actual PDF pages were opened and visually inspected.

## Findings and iteration history

No actionable P0/P1/P2 finding remains within this scope.

| Earlier finding | Fix and post-fix evidence |
| --- | --- |
| P2: unnecessarily tall DE opening/request. | Shorter CMS title “Worum geht es?”, task and helper copy. `02` → `07`; initial window ~952 → ~844 CSS px. |
| P2: typing shortened the task box and moved controls. | Hidden measuring span reserves the complete task height; final input-to-plan browser pass. |
| P2: result could retain the paused badge after manual steps. | Final transcript readiness takes precedence. `05` shows “Endtranskript bereit”. |
| P2: appointment source pointed to an offered slot rather than booking confirmation. | Source changed to explicit recipient confirmation; fixture test and DE transcript/PDF verify it. |

Intentional adaptations: emerald colors replace blue/cyan; the actual brand symbol
replaces decorative browser dots; five workflow stages replace three. No real phone
number is shown for fictional contacts. Unsupported live translation/rescheduling
controls from the reference are omitted. The initials tile is an ordinary text UI
element as in the reference. No custom logo, icon substitute or raster art was added.
The richer workflow makes the mobile window taller; content remains scrollable.

## Required fidelity surfaces

| Surface | Assessment |
| --- | --- |
| Typography | Existing Geist/fallbacks; 27–29 px demo headings, 14 px task/turn text, smaller secondary labels. Hierarchy, DE wrapping, weights and line spacing reviewed. No essential text is truncated. |
| Spacing/layout | Single hero demo, responsive minmax grid, 24–28 px outer radius, 20–26 px padding, segmented buttons, recipient tile and task inset. Review/transcript regions scroll independently. No horizontal page overflow at 1280/390/320 px. |
| Colors/tokens | Paper/emerald/ink treatment works in light and dark themes. Text-to-paper samples: ink 14.1:1, muted 5.8:1, accent 5.0:1; not a full contrast audit. |
| Images/assets | Actual SVG brand mark and PDF wordmark, sharp vectors. No raster scaling, halos, invented illustration or image approximation. |
| Copy/content | Supported operations and approved facts only; fictional/no-audio labels. Benefit-led hero, concrete scenarios, short CTA and full credit rules in FAQ. |

## Functional verification and boundaries

- Completed EN documents and DE appointment/repair in browser. Exercised explicit
  approval, consent, sequential live replies, final transcript, optional summary,
  pause/resume/manual step, reset/replay and scenario/language selection.
- Full plan opened with Enter. Summary source selected and focused the exact
  transcript turn. Native buttons, focus indicators, labelled regions and polite
  stage announcements present. Reduced-motion manual mode is implemented; an OS-level
  reduced-motion/screen-reader acceptance session was not performed.
- Browser-downloaded EN documents and DE appointment PDF files were opened/rendered.
  DE was verified in a fresh page after repeated downloads in one in-app tab did not
  save; its download event was unreliable. All six fixtures also rendered locally
  with final turns and Unicode intact. No real providers called.
- Console error/warn checks returned empty arrays. Light/dark and 320/390/1280 px
  checked. Temporary viewport override is reset at handoff.
- 198 web tests, 9 final demo tests, 8 content-service tests, copy consistency,
  lint/typecheck and isolated production build pass.

## Implementation checklist

- [x] Four product changes and one interactive hero demo.
- [x] Shared real plan/summary/PDF presentation with explicit simulated content.
- [x] EN/DE dictionaries and complete scenarios tied to UiLocale.
- [x] CMS r8 with preserved history/backups; roadmap updated.
- [x] Mobile/desktop, controls, source links, PDF and console checks.

Remaining B10 acceptance: screen reader, 200% text zoom and cross-browser checks on
the deployed release. Audio narration is outside this text-demo scope.
