# Consent policy export scope

`call_attempts.consent_runtime_policy` is included for retained calls in the export
cohort. It records the mode, settings revision, classifier version and settlement
windows pinned when the attempt was admitted. Export mapping allows only these
policy fields. A missing historical policy remains `null`; the exporter does not
substitute the current configuration or reconstruct earlier settings.

The global `voice_consent_settings` and `voice_consent_settings_audit` tables are
excluded. They cover the whole service and contain operator identities and change
reasons unrelated to the selected calls. Their exclusion is explicit in the source
inventory test. Changing global settings does not change a prior attempt's export.

The existing `call_events` source carries the consent audit chain: disclosure
receipt, decision and method, recording request, and provider recording start.
These records contain application metadata, not pre-consent recipient text or
audio. Join receipt, decision and recording IDs to follow the chain. Optional
retained audio exports continue to use the existing post-consent recording boundary.

Deleted or deletion-pending calls do not contribute attempt rows or pinned
policies. Existing export authorization, snapshot isolation, encrypted storage,
revocation and retention rules continue to apply.

# Preparation transport diagnostics

`provider_operation_results.response_metadata` contains optional bounded technical
measurements for compiler requests: reservation/transport/body timings, request
byte count, safe network codes and numeric processing/rate-limit headers. Only
schema fields cross the export boundary; extra fields are stripped and invalid
values fail validation. No raw headers, plan content, URLs or error messages are
included. Existing operation IDs, client/provider request IDs, usage records and
durable job attempts correlate these measurements. Historical nulls remain null.
