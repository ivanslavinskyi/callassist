# Design QA — Emerald Paper

Final result: pass for design review of the standalone atlas. This is not approval of the new pages by the user and not a production integration certification.

Source visual truth: assets/approved-light.png and assets/approved-dark.png, copied from the user's selected exploration boards. Both are 1640×959 px and contain a desktop region approximately 1300×959 plus a mobile region. Implementation: screens/new-call-comparison-light.png and screens/new-call-comparison-dark.png, empty new-call state, EN, 1300×960 CSS viewport. Browser captures are 1285×949 px; comparison.html displays them normalized to the source desktop region. No pixel-accuracy score is claimed. No simulated device frame was used.

Full comparison evidence: comparison.html, screens/qa-comparison.png. Source and target were also opened together in one multi-image comparison input. Focused surface evidence: original-size new-call captures were inspected for labels, wordmark, section rules, footer/options overlap and input sizing. The actual SVG outlines were checked programmatically against the supplied SVG.


## Revision 02 review

Result: pass for the four requested design revisions. The before-completed desktop light capture and revised desktop light capture were opened together in one comparison input at 1440×1024 CSS px. The typography, source logo, color tokens, content width and transcript/sidebar split remain consistent. The library moon icon, transcript navigation and earlier feedback position implement the user's requested changes. Dark completed view, mobile feedback and tablet admin menu/footer were inspected separately. Evidence: revisions/02/ and the refreshed screens/ captures.

The shared footer is present exactly once in all 162 states; all 132 baseline captures contain the same seven landing-footer links. The theme button has no visible label and measures 44×44 px, with a 24 px icon. The hamburger has the same target size on all 320/834 px baseline checks. No page-wide horizontal overflow in the 99 breakpoint checks. Thirteen revision-specific interaction checks pass in qa-revision-02.json, in addition to the ten earlier baseline checks. A cache-mixing error discovered during the revision was resolved with versioned CSS/JS URLs before the final capture and state runs.

Full fidelity is assessed against the approved design and the user's four explicit amendments. Footer placement is normal document flow on every product screen, including authentication, preview and admin pages; it does not overlay the call form. Production source and service APIs remain untouched.

## Findings and iteration history

- P2, dashboard density: initial captured implementation placed Call options below the persistent footer. Revised 44 px desktop fields, 12 px section padding/gaps and the counter inside a 112 px textarea. Intermediate comparison still overlapped (options bottom 909, footer top 883). Final capture at the same viewport/state shows options bottom 882 and footer top 883. Resolved.
- P1, DE document content: the saved Privacy/Terms snapshots contained only an empty document node. Replaced missing mock content with the exact repository seed content; provenance and unverified live revision disclosed. Resolved for the design artifact.
- P2, long German document headings at 320 px: after restoring text, scroll widths were 333/350. Added wrapping/hyphenation and recaptured measurements. Both now fit 320. Resolved.
- P2, mobile density in admin/account: initial filters/navigation crowded the first viewport. Collapsed mobile filters and wrapped account navigation; final screenshots show first call record and account sections available. Resolved.

## Five fidelity surfaces

- Fonts/typography: existing Geist asset, correct weight hierarchy, 28 px compact dashboard H1, native readable labels. Native rasterization differs from the generated reference. Long German headings wrap; no important copy is ellipsized.
- Spacing/layout: top nav, approximately 30/70 history/form split, grouped sections, restrained separators, mobile panel switch. The final default form fits the reference desktop height; additional settings remain scrollable.
- Colors/tokens: white/charcoal/emerald light mode and deep green/soft white/emerald dark mode. 18 semantic contrast checks pass their defined thresholds. Stronger native field borders are an intentional accessibility refinement.
- Image/asset fidelity: original vector outlines retained; only wordmark and portal fills change. No fabricated logo or illustrative replacement. ImageGen boards are overview references, not exact text/geometry sources.
- Copy/content: existing repository fields/flows preserved. Examples are synthetic. No new pricing, integrations, testimonials or unsupported product feature claims. Source gaps are explicit.

Expected deviations: user-requested Heroicons sun/moon and hamburger controls; native selects; status/date on a second history line; valid control sizes; scenario-specific source content. These are deliberate specifications, not open defects. Secondary mock actions are bounded by the atlas scope.

## Handoff checklist

- Completed: all 33 base screens, 162 state entries, both themes, 132 desktop/mobile captures.
- Completed: 99 breakpoint checks, 18 contrast checks, 10 interaction checks, SVG geometry and JS syntax checks.
- Completed: guidelines, page specifications, provenance, portable assets and coverage navigation.
- Next stage after user approval: production integration, complete i18n binding, API/authorization/realtime and assistive-technology verification.
