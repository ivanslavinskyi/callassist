# Route and state implementation map

Approved baseline: Emerald Paper revision 02. All 33 atlas entries / 162 states are mapped in [route-state-map.json](route-state-map.json). The two system reference entries do not create new product routes.

The browser column lists observed states only. Remaining states are mapped to existing handlers and shared presentation; fault injection, provider behavior and full accessibility acceptance remain in R13/R06/R14.

| Atlas entry | Actual route | Component | Browser observations |
| --- | --- | --- | --- |
| landing | `/:locale` | [public-home.tsx](../../apps/web/components/public-home.tsx) | default, preview |
| register | `/:locale/register` | [auth-forms.tsx](../../apps/web/components/auth-forms.tsx) | default, busy |
| verify | `/:locale/verify` | [auth-forms.tsx](../../apps/web/components/auth-forms.tsx) | default, invalid-code, busy |
| login | `/:locale/login` | [auth-forms.tsx](../../apps/web/components/auth-forms.tsx) | default |
| recover | `/:locale/recover` | [auth-forms.tsx](../../apps/web/components/auth-forms.tsx) | default |
| onboarding | `/:locale/onboarding` | [onboarding-form.tsx](../../apps/web/components/onboarding-form.tsx) | default, accepted |
| new-call | `/:locale/app` | [dashboard.tsx](../../apps/web/components/dashboard.tsx), [create-call-form.tsx](../../apps/web/components/create-call-form.tsx) | default, filled, options, history, empty, preparing |
| call | `/:locale/app/calls/:id` | [live-call.tsx](../../apps/web/components/live-call.tsx), [compilation-review.tsx](../../apps/web/components/compilation-review.tsx) | review, confirm-start, live, approval, failed |
| call-completed | `/:locale/app/calls/:id` | [live-call.tsx](../../apps/web/components/live-call.tsx), [call-feedback.tsx](../../apps/web/components/call-feedback.tsx) | completed, provisional, no-recording, feedback-saved |
| account | `/:locale/app/account` | [account-console.tsx](../../apps/web/components/account-console.tsx) | default, edit-name, saved, usage, security, revoke, privacy |
| redeem | `/:locale/redeem` | [promo-redemption-form.tsx](../../apps/web/components/promo-redemption-form.tsx) | default |
| opt-out | `/:locale/opt-out` | [recipient-opt-out-form.tsx](../../apps/web/components/recipient-opt-out-form.tsx) | default |
| faq | `/:locale/faq` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| support | `/en/support · /de/hilfe` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| privacy | `/en/privacy · /de/datenschutz` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| terms | `/en/terms · /de/nutzungsbedingungen` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| acceptable-use | `/en/acceptable-use · /de/nutzungsregeln` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| imprint | `/en/imprint · /de/impressum` | [content-page.tsx](../../apps/web/components/content-page.tsx) | default |
| admin-overview | `/admin` | [admin-operations-dashboard.tsx](../../apps/web/components/admin-operations-dashboard.tsx) | default |
| admin-calls | `/admin/calls` | [admin-calls-console.tsx](../../apps/web/components/admin-calls-console.tsx) | default |
| admin-inspector | `/admin/calls/:id` | [admin-call-inspector.tsx](../../apps/web/components/admin-call-inspector.tsx) | default, sensitive |
| admin-preparation | `/admin/calls/preparations/:id` | [admin-call-preparation-inspector.tsx](../../apps/web/components/admin-call-preparation-inspector.tsx) | default |
| admin-users | `/admin/users` | [admin-users-console.tsx](../../apps/web/components/admin-users-console.tsx) | default, selected |
| admin-credits | `/admin/credits` | [admin-credits-form.tsx](../../apps/web/components/admin-credits-form.tsx) | default |
| admin-safety | `/admin/safety` | [admin-safety-form.tsx](../../apps/web/components/admin-safety-form.tsx) | default |
| admin-system | `/admin/system` | [admin-system-console.tsx](../../apps/web/components/admin-system-console.tsx) | default, jobs, alerts, outbound |
| admin-content | `/admin/content` | [admin-content-console.tsx](../../apps/web/components/admin-content-console.tsx) | default, sections, no-draft |
| admin-editorial | `/admin/content/editorial` | [admin-editorial-console.tsx](../../apps/web/components/admin-editorial-console.tsx) | default, landing, no-draft |
| admin-seo | `/admin/seo` | [admin-seo-console.tsx](../../apps/web/components/admin-seo-console.tsx) | default, warnings |
| preview-content | `/admin/content/:key/preview` | [content-draft-preview.tsx](../../apps/web/components/content-draft-preview.tsx) | default |
| preview-landing | `/admin/content/editorial/landing/preview` | [landing-draft-preview.tsx](../../apps/web/components/landing-draft-preview.tsx) | default |
| error | `Shared boundaries / 404` | [admin-route-boundary.tsx](../../apps/web/components/admin-route-boundary.tsx), [error.tsx](../../apps/web/app/error.tsx), [not-found.tsx](../../apps/web/app/not-found.tsx) | loading, signed-out, forbidden, not-found |
| components | `Design only` | [emerald-paper.css](../../apps/web/app/emerald-paper.css), [ui-icon.tsx](../../apps/web/components/ui-icon.tsx), [theme-toggle.tsx](../../apps/web/components/theme-toggle.tsx), [navigation-menu.tsx](../../apps/web/components/navigation-menu.tsx), [confirm-dialog.tsx](../../apps/web/components/confirm-dialog.tsx) | Design reference |

## Integration details

- **landing**: Published CMS landing sections, FAQ and navigation; customer-aware AppShell. Example card is explicitly illustrative.
- **onboarding**: Existing current-revision legal acceptance payload and server route gates; published legal content is not replaced by atlas text.
- **new-call**: Existing controlled form, input limits, recipient lookup, preparation/idempotency/retry and credit gates. History filters and mobile panels retain mounted form state.
- **call**: Existing policy decisions, clarification/recompile/edit, explicit start dialog, event stream, reconnect status, approval request and terminal statuses. Approved plan is collapsed once active/terminal.
- **call-completed**: Same call route. Existing final/provisional transcript, native recording player, copy/PDF, deletion and feedback endpoints; required goal result, optional quality/comment, 500-character limit.
- **account**: Hash-addressed profile/usage/data-privacy/security sections keep mounted forms. Existing profile/contact verification, session revocation, export and confirmed deletion handlers remain.
- **admin-inspector**: Technical metadata remains default. Sensitive call content uses the existing separate authorization/audit gate.
- **admin-content**: Existing draft/save/conflict/publish/rollback actions and revisions. Browser review saved a private synthetic draft, not a publication.
- **admin-editorial**: Existing landing/FAQ/navigation draft editing and publishing contracts. No content was published during review.
- **preview-content**: Private authorized draft, actual sections and links, shared article navigation/footer; preview indexing policy retained.
- **preview-landing**: Private authorized draft rendered by existing landing component and shared shell; preview indexing policy retained.
- **error**: Root error/not-found boundaries plus existing access/loading/error branches. The boundary retry reloads its component; no promise that a failed component retains unsaved data.
- **components**: Design reference only; mapped to tokens, shared controls, icons, navigation, dialogs and status treatments. No artificial application route added.
