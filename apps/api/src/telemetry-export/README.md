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

# Application playback diagnostics

Optional `call_events.metadata.playback` on `conversation.task` records one
terminal snapshot per post-consent application playback attempt. `revision`
identifies its generation; `markId` links an acknowledged attempt to the existing
application transcript receipt. `requestedAt`, optional `renderedAt` and
`releasedAt`, and `endedAt` describe preparation, readiness, transport release and
acknowledgement/cancellation. `owner` distinguishes appointment, closing and
failure speech; `reason` is an enum. `durationMs` is null until rendering succeeds.

`acknowledged` means the application accepted the current playback mark.
`interrupted` means audio was released without an accepted completion mark;
`not_released` means this attempt ended before release. No exact heard prefix,
spoken text, audio, prompt or provider error message is recorded. Release is not
proof of audible delivery. Missing diagnostics, including older calls and process
crashes, must not be reconstructed as successful playback. Existing transcript
gaps and partial coverage remain authoritative.

The nested export allowlist strips extra playback fields and rejects invalid
values. Older events without this optional object retain their original shape.
This uses the existing content-free technical `call_events` retention: these
events can remain after call-content deletion, while content sources are redacted
or excluded and prepared exports are revoked under the existing rules. It does
not prolong audio/text retention or export pre-consent recipient content.

Writing diagnostics is asynchronous and best effort, once at cancellation or
accepted mark, never per audio frame. Playback/hangup does not await it; a failed
write produces a bounded technical warning. Missing data remains unknown. Deploy
reader support with/before the writer and retain it when rolling back emission;
older strict readers do not understand the new optional object.
