# UI/UX Stabilization Plan

Status: **accepted as the next delivery milestone**
Source: UI/UX audit of the current operator console
Scope: 45 findings across navigation, forms, feedback, visual hierarchy,
accessibility, responsive layout, and interaction polish.

This milestone is a release gate. Product-roadmap work that adds new authenticated
screens or operator workflows should not begin until the P0-P2 acceptance criteria
below are met. P3 may be completed in the same milestone, except for explicitly
deferred visual preferences such as a manual theme toggle.

## Product decisions

1. The console is an operational tool, so the dashboard hero becomes a compact,
   persistent page header. It must not rely on first-visit state or cookies.
2. Call history uses cursor-based server pagination with a **Load more** control.
   Search and status filters are server-side and reflected in the URL. Virtualization
   is deferred until measured list size makes it necessary.
3. Creating a brief remains a single-page flow for now. Required-field progress and
   a sticky action area improve orientation without introducing a multi-step wizard.
4. **Approve and call** remains one audited domain operation, but the UI must show a
   confirmation dialog that clearly names the recipient and explains that a real
   phone call starts immediately. Terminal calls expose no edit/start actions.
5. Temporary connection loss is non-blocking status, not a generic error. Connection,
   action, validation, and fatal-load states are represented independently.
6. Destructive actions require a focused confirmation dialog, explicit consequence,
   safe initial focus, and focus restoration. Browser `confirm()` is not the target UI.
7. Dark colors first follow `prefers-color-scheme`; a persisted manual theme choice
   may be added after the functional and accessibility baseline.
8. Relative dates are localized and always retain an exact localized timestamp in an
   accessible label or tooltip.

## Internationalization foundation

Internationalization is part of the stabilization work, not a later copy migration.
The initial interface catalogues are `en` and `de`; subsequent locales can be added
without changing component APIs. Call-language support remains unchanged.

Keep these concepts separate throughout the application:

| Concept | Example | Owner and persistence |
|---|---|---|
| UI locale | `de` | URL segment plus persisted user/browser preference |
| Brief source language | free-form Russian text | inferred/compiled brief data; never derived from UI locale |
| Call locale | `de-CH` | explicit brief field and API contract |
| Fallback call locale | `en-GB` | optional explicit brief field and API contract |

Implementation rules:

- Add a locale-aware route boundary (`/[locale]/...`) and middleware negotiation.
  Locale resolution order is URL, persisted preference, supported browser language,
  then `en`. Internal links and redirects must preserve the UI locale.
- Use one typed message catalogue per locale, split by feature (`common`, `dashboard`,
  `brief`, `call`, `errors`). Message keys describe meaning, not English wording.
- Move every visible string, placeholder, validation message, status label, dialog,
  toast, empty/loading state, document title, `aria-label`, and export label into the
  catalogue. Do not concatenate translated fragments; use parameters and plural rules.
- Use `Intl.DateTimeFormat`, `Intl.RelativeTimeFormat`, `Intl.NumberFormat`, and
  locale-aware pluralization. Do not hand-format dates or interpolate English units.
- Set `<html lang>` from the UI locale. Keep layout direction in locale metadata so
  RTL can be introduced without rewriting components; use CSS logical properties.
- API errors expose stable machine codes and structured parameters. The web layer maps
  codes to localized messages; server English text is only a diagnostic fallback.
- Store status and reason codes, never localized labels. Tests must fail on missing
  catalogue keys and should render at least English and German, including long text.
- Translation loading must not block live-call events. The active locale catalogue is
  loaded at the route boundary; live event payloads remain language-neutral codes/data.

The exact i18n package should be selected in the first implementation slice after a
short proof of locale routing, typed keys, server/client rendering, and test support.
The architectural contract above is package-independent.

## Delivery slices

### Slice 0 — baseline and design primitives

- Capture desktop, tablet, and mobile reference screenshots for dashboard, create,
  review, active call, completed call, loading, empty, reconnecting, and error states.
- Add shared tokens for type, spacing, color, focus, motion, and minimum target size;
  load a self-hosted font through `next/font` and provide robust fallbacks.
- Introduce primitives for Button, Field/Error, Alert, Toast/Status, Skeleton,
  Accordion, and Dialog. Respect `prefers-reduced-motion`.
- Install the i18n route/catalogue foundation and migrate the app shell first.

Exit: locale-preserving navigation works; `<html lang>` is correct; primitive focus
styles and 44 px minimum targets are visible in keyboard and touch review.

### Slice 1 — safety and semantic correctness (P0)

- **A4:** hide edit/start actions for `completed`, `stopped`, and `failed` calls.
- **B6:** confirm permanent audio deletion in an accessible dialog.
- **C4:** confirm the combined approve-and-call operation with recipient and effect.
- Replace the terminal-state safety card with an outcome summary (**D4**).

Exit: destructive and real-world side effects cannot occur accidentally; terminal
screens offer only valid actions; dialog keyboard/focus behavior is covered by tests.

### Slice 2 — operator workflow and state feedback (P1)

- **B1, B2:** sticky form actions and a clearly non-editable disclosure preview.
- **C5:** compilation progress treatment with spinner, explanatory copy, disabled
  duplicate submission, and a recoverable timeout/error state.
- **C6:** transcript follows new turns only while the operator is at the bottom;
  manual upward scrolling pauses it and exposes a localized “jump to latest” action.
- **A5, C3:** replace full reloads with locale-aware router navigation and carry a
  one-shot success notification across the transition.
- **C2:** distinguish empty call history from an API failure and provide retry.
- **A3:** show localized relative and exact timestamps in history.

Exit: the create-to-call path has continuous feedback and no unintended full-page
reload; transcript inspection is not interrupted by auto-scroll.

### Slice 3 — scale, loading, and resilient live state (P2)

- **A1, A2:** add API cursor pagination, debounced recipient search, status filter,
  URL query state, load-more states, and pagination contract tests.
- **B3:** normalize and validate E.164 input as the user types while keeping the
  shared contract authoritative.
- **C1, G4:** add layout-shaped skeletons for call detail and history.
- **A7, C8:** split connection status, action errors, and fatal load errors; show
  reconnecting/reconnected state without overwriting an actionable error.
- **C7:** reset copy feedback after three seconds and when copied content changes.
- **D1, D6:** adopt the cross-platform font and show transcript locale only on a
  language change when switching is allowed.
- **E5:** apply consistent `:focus-visible` styles to all interactive controls.

Exit: history remains usable with a large seeded dataset; transient SSE failure is
recoverable and accurately communicated; loading and error states are distinguishable.

### Slice 4 — responsive, accessible, and visual completion (P3)

- **E1-E6:** contextual accessible names, skip link and main landmarks, focus
  management, semantic switches, hidden decorative glyphs, and valid error pages.
- **F1-F5:** viewport-relative transcript sizing, deliberate mobile content order,
  tablet hero/layout behavior, verified viewport metadata, and 44 px touch targets.
- **B4, B5, B7-B9:** phone normalization, neutral localized examples, expandable
  objective, accessible styled accordions, and required-field progress.
- **A6:** localized breadcrumb and recipient-aware page metadata.
- **D2-D5:** compact dashboard header, reduced eyebrow noise, terminal summary, and
  system dark palette.
- **G1-G3:** reduced-motion-safe accordion, hover, and connection-state transitions.

Exit: all core states pass keyboard-only review, 200% zoom/reflow, screen-reader
smoke tests, reduced motion, and responsive review at 360, 768, 1024, and 1440 px.

## Verification and definition of done

Each slice includes component/unit tests and a production build. The milestone is
complete when:

- all 45 audit findings are implemented or explicitly re-approved as deferred;
- P0-P2 have automated regression coverage for their state or behavior;
- English and German catalogues have identical keys and no production UI string is
  hard-coded in the migrated operator flows;
- route, redirect, filter, and back-navigation behavior preserve the UI locale;
- API pagination and stable error-code contracts are documented and tested;
- no critical or serious automated accessibility violations remain, and keyboard,
  focus, zoom/reflow, and screen-reader smoke checks are recorded;
- loading, empty, success, reconnecting, recoverable error, fatal error, and terminal
  states are visually verified on desktop and mobile;
- `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` pass.

## Recommended implementation order

Work in vertical slices rather than a single styling pass: foundation → safety →
create/review flow → live-call flow → history/API scale → responsive/a11y polish.
This keeps each merge independently testable and prevents new translated screens from
being built on temporary component or message APIs.
