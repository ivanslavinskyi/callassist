# Language workflow: frontend and export verification

Date: 9 September 2026. Local development build, `http://localhost:3000`.

## Automated checks

- Web: 139 tests passed across 34 files. This includes draft ownership and reset, explicit guest UI preference resolution, British English selection with historical US English readability, preparation idempotency, strict translated-plan projection, transcript identity/evidence projection, and stale snapshot protection.
- Web typecheck and lint passed after the final shared presentation heading and CMS integration changes.
- Contracts: 78 tests passed across 15 files, including v2 account export and the retained v1 archive reader.
- Account export integration passed against an isolated PostgreSQL database with migrations 0001–0067. It checks retained compilation and text-artifact export, owner access and encrypted source persistence. The temporary database was removed by the test helper.

## Browser checks

At the user’s request, raw screenshots, PDFs and machine-readable reports were removed from the repository and are not versioned. The observations below preserve the completed checks as a textual record without attached raw artifacts.

The temporary in-app browser used a separate tab. Viewport emulation was reset and the tab was closed afterwards. Existing theme preference was restored to light after checking dark mode.

| Check | Result | Evidence |
| --- | --- | --- |
| English desktop, 1280 × 900 | No horizontal overflow: document width 1265 px within viewport 1280 px. Hero facts use bullets independently of numbered questions. | Local browser capture (not versioned) |
| “See how it works” | Navigates to the educational `#example` section. Two-column example renders request, review plan, excerpt and summary. | Local browser capture (not versioned) |
| German mobile, 390 × 844 | No horizontal overflow: document width 375 px. German example wraps into one column. | Local browser capture (not versioned) |
| German narrow mobile, 320 × 844 | No horizontal overflow: document/body width 305 px. Hero, summary and source links remain readable. | Local browser capture (not versioned) |
| Mobile menu at 320 px | Opens/closes, updates `aria-expanded`, exposes German navigation and the independent UI-language selector without overflow. | Local browser capture (not versioned) |
| Summary source links | All three links have existing transcript targets; navigation to the answer and next-step sources focuses the corresponding original segments. | Focus outline visible in the light summary screenshot |
| Dark result at 320 px | Summary text, uncertainty, next steps and source links remain readable. | Local browser capture (not versioned) |
| Heading hierarchy | Example section uses h2, cards use h3, nested plan and summary sections use h4. Verified in browser accessibility tree after the change. | Shared presentation components accept a contextual heading level |
| Public call languages | Six localized choices displayed; English appears once as `en-GB`. German labels use German names. | Browser accessibility tree and call-language label tests |

## PDF verification

`node scripts/verify-language-pdf.mjs` produced a local multilingual PDF using the same bundled `pdfmake` Roboto fonts as the web export. A PDF parser verified one page, three `/ToUnicode` font mappings, Russian and Ukrainian text in the extracted content. This checks actual generated PDF encoding rather than only the source strings. It is not a raster visual comparison of the PDF. Reproduction writes the PDF only to the ignored `.tools/verification-language/` directory.

## Scope and remaining release checks

These browser checks cover the read-only public demo and shared presentation. They do not claim an authenticated end-to-end call, live provider translation, recipient consent, real phone call, or account preference mutation. Those require the controlled integration/release workflow documented in the implementation plan.

The inspected screenshots verified public rendering, the educational demo and fallback-capable presentation. Development-server logs show CMS API timeouts/refused connections during this period, so the screenshots cannot establish whether the visible copy came from published CMS data or local fallback content. The new public copy is a separate prepared release candidate; its publication state must be checked against the database/release dry run rather than inferred from these screenshots.

## Follow-up: clarification review and disposable application fixture

The clarification-language review found and fixed a case where Russian objective text, a German call and manually selected German help hid the translation option. `plan-review-language.ts` now distinguishes the call-plan language from the language of clarification questions. Unknown question language requires an enabled wildcard direction; blocked output uses the clarification operation. Four new language-selection cases plus two strict projection tests pass. Web typecheck passed after this change.

The repository includes a reproducible, disposable application fixture:

1. In `apps/api`, run `node --import tsx scripts/serve-language-qa.ts`.
2. The fixture listens only on `127.0.0.1:4000` and uses in-memory repositories plus mock phone, email, compiler and text providers. It refuses production mode. The `/__qa` marker is defined only in this script.
3. The fixture generates temporary credentials and phone values per run and writes them only to the ignored `.tools/language-qa/runtime.json` manifest. For manual login, read `credentials.email` and `credentials.password` locally from that manifest. Test onboarding acceptance is preseeded only in memory. Do not commit the manifest.
4. From the repository root, run `node scripts/verify-language-qa-api.mjs`. It reads the local manifest, requires a loopback URL and the disposable fixture marker, and refuses a normal API server. Generated reports stay under the ignored `.tools/verification-language/` directory.
5. Stop the fixture with Ctrl+C. Its account, calls, text artifacts and test acceptance disappear with the process; remove the local runtime manifest when it is no longer needed.

The HTTP verifier passed authenticated login, independent UI preference changes, v2 preparation with Russian task language and a German call, durable plan artifact completion, approval with the translated artifact's hash, a mock call start, original segment identity through transcript translation, and summary references to original segments. The machine-readable result is not versioned.

The follow-up browser run could not begin: `cua.createBrowserTab("iab", ...)` reported that the browser was unavailable, and two inventories returned `browsers: []`. Opening the local page through Codex was queued and did not restore a browser surface. Consequently, authenticated click-through, live draft retention across a UI switch and authenticated result screenshots remain unverified in the browser; existing automated tests and the successful HTTP workflow are separate evidence. The earlier public-page observations remain recorded above. No real development database was changed.

## Final rollback and status review

The final frontend suite passes **154 tests in 38 files**; contracts pass **78 tests in 15 files**. The capability tests cover the disabled global switch and unknown/mixed transcript sources: final translation and summary need an enabled `*` source direction, independent of the selected voice locale.

Logical UI review confirmed that saved plan/transcript translations and saved summaries remain readable when generation is disabled. Choosing the original plan still creates original review evidence and preserves the ordinary review/start action; a failed translation does not silently approve the original. Missing text now shows an explicit disabled-feature message rather than suggesting that generation is underway.

Two recovery bugs were fixed during this review: capability loading/fetch errors now have distinct states and a refresh action (also refreshed on focus/reconnect), and refreshing an artifact after the bounded polling window now starts a new bounded window even when the queued artifact IDs have not changed. These are code-level checks; the unavailable browser prevented a new click-through verification of those recovery controls.

Saved readers now prefer the newest validated ready artifact within the exact current source identity/hash, target language and kind. A newer pending, failed or invalid artifact cannot hide an already readable plan, transcript translation or summary. First approval binds the selected reader's ID/hash; retrying start after approval omits new review evidence so the backend validates the existing receipt. Regression tests cover these behaviors.

Final package checks passed: web and contracts typecheck, lint and production build. The final web build ran with `NEXT_DIST_DIR=.next-language-verification` to avoid replacing the existing development build. Next's automatic edits to `tsconfig.json` and `next-env.d.ts` were restored to their captured pre-build contents afterwards, preserving the pre-existing workspace configuration. The final source state has 154 passing web tests; contracts have 78 passing tests. No additional browser result is implied by the successful builds.

## Follow-up: one task language, fewer controls

The creation form no longer asks for the text language. New drafts retain automatic detection, while previously saved manual draft preferences remain intact. Before approval, a compact “Plan and result: [language] · Change” disclosure provides the sole correction point. The disclosure is absent for approved, active and completed calls. Original/translated review evidence and the stored approval receipt are unchanged.

The result uses the fixed task language for both its summary and transcript translation. Separate summary/transcript selectors and the duplicate “View translation” button were removed. A translation action is replaced by an Original/language switch only when the current source has a validated ready translation. While translation is pending, failed or stale, the original remains readable, its source links work, and copy/PDF export uses the visible original. Saved readers remain available when generation is disabled.

The account fallback language is a collapsed preference whose current value remains visible. It can be reset to the interface-language fallback. Historical language tags outside the current selector remain visible as the current value and can be replaced or reset. New-task detection-first precedence is implemented separately in the shared language resolver; saved task contexts retain their prior language.

Verification for this follow-up: **30 tests passed in 7 targeted web files**, including three new readiness, source-version and fixed-target regressions. Web typecheck and lint passed. This paragraph does not claim a new production build or browser verification of the simplified controls; the earlier screenshot/build evidence applies to the preceding implementation.

The subsequent in-app browser pass on isolated memory/mock API 4100 and web 3100 verified the simplified controls with a fictional account: new form, fixed-language summary/translation, translation/original switch, source focus, historical plan without a disabled selector, DE→EN UI independence and preapproval language correction. Observations, scope and the deterministic compiler limitation are recorded in [the simplification report](ui-language-simplification-2026-09-09.md). This supersedes the earlier browser-unavailable limitation only for the paths actually exercised; it does not claim live provider translation or a real call.
