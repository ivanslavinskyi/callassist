# Plan preparation, review spacing and call feedback — 2026-09-15

Three local UI fixes following the user's screenshots. Provider behaviour, plan
generation, approval requirements and charging rules are unchanged.

- Preparation uses a viewport-fixed status panel, rendered outside the form's
  scroll/stacking containers. It remains visible at every scroll position, reports
  the existing queued/preparing/retrying/delayed state and reminds the user that
  review comes before a call. The moving line is indeterminate; no percentage or
  completion-time estimate is invented. There is no blocking backdrop or focus trap.
- Review has consistent 20 px heading-to-text and 32 px section spacing, including
  the previously touching objective/expected-result blocks. Rules are scoped to
  the real review panel and preserve the landing demo's independent layout.
- Confirming a call immediately reveals and focuses the transcript section with
  a starting state while the API request is pending. Provider-backed dialing and
  connected states follow. A recipient avatar with expanding rings makes dialing
  visible; a compact status remains above the first transcript turns. Loss of SSE
  updates pauses the animation and reports uncertainty. Failed, stopped and
  completed calls have no active-call animation; a rejected start restores review.
- All new copy is in typed EN/DE dictionaries. Theme tokens and reduced-motion
  media rules apply to the new feedback surfaces.

Validation: production build, web typecheck/lint and all 216 web tests pass, including seven status
projection regressions. Browser checks use actual form, review and LiveCall
components in an ignored, isolated fixture harness with all fetch/EventSource
traffic replaced locally; no real call, SMS, email or paid plan was triggered.
Checked preparation visibility at the top of a long form, delayed/error/retry/ready
states, measured review gaps, pending start, start failure, dialing, connection,
SSE loss/recovery, transcript arrival and terminal status. Desktop and mobile,
EN/DE, both themes and a 320 px-wide delayed DE panel without horizontal overflow
were inspected. Reduced-motion rules were checked in the browser's parsed stylesheet;
an OS preference change and screen-reader speech were not exercised. This does not replace provider acceptance
or a full assistive-technology audit.
