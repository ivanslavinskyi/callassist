# CallAssist Architecture

## Purpose

CallAssist is a personal assistant that places outbound calls under a narrowly scoped call brief. During a call, the operator can monitor the transcript, stop the call, and approve or reject sensitive disclosures.

## System overview

```text
Next.js console ── HTTPS / SSE ──► Fastify API ──► PostgreSQL
                                         │              │
                                         │              └── encrypted private fields
                                         │
                                Twilio Programmable Voice
                                         │
                              bidirectional Media Stream
                                         │
                              server-side Realtime bridge
                                         │
                                OpenAI Realtime session

Twilio dual-channel recording ──► authenticated API download
                                             │
                                             └── channel split + voice activity turns
                                                               │
                                                               └── OpenAI post-call transcription
                                                                             │
                                                                             └── encrypted final turns
```

- `apps/web`: the Next.js operator console.
- `apps/api`: the Node.js/TypeScript Fastify API, policy boundary, Twilio gateway, and server-side Realtime connection.
- PostgreSQL: call briefs, attempts, draft transcripts, recordings, final transcripts, approvals, and audit events.
- Twilio: outbound PSTN calls, signed webhooks, DTMF consent, a bidirectional Media Stream, and temporary consent-gated recordings.
- OpenAI Realtime: direct speech-to-speech conversation. External actions remain under server control.
- OpenAI file transcription: post-call processing of the complete recording with bounded call context.
- Redis/BullMQ: planned for scheduling, retries, and time-bounded background work.

## Storage boundary

The API depends on a `CallRepository` interface. The in-memory and PostgreSQL repositories implement the same contract, keeping telephony and Realtime independent from storage. SQL migrations are versioned with the API.

Context and approved facts are encrypted before persistence. Audit events do not include transcript content or private fact values and are protected against mutation and deletion at the PostgreSQL layer.

On API startup, unfinished calls are marked as failed, pending approvals expire, and recovery is recorded in the audit trail. A cross-process event bus and durable retries remain planned alongside Redis/BullMQ.

## Telephony and consent boundary

`TelephonyProvider` isolates the transport. The mock provider supplies deterministic local scenarios; the Twilio provider creates and terminates real calls. Provider call identifiers and raw statuses are stored with each `CallAttempt`, while signed status callbacks map them into domain statuses and SSE events.

The Twilio voice webhook immediately opens a bidirectional Media Stream with call recording disabled. OpenAI Realtime uses the selected voice to disclose the AI identity, represented person, accessibility context, recording purpose, and retention period. Before the recipient presses `1`, the server discards inbound media frames and does not forward them to OpenAI.

After DTMF consent, the API persists the consent timestamp and asks Twilio to start a dual-channel recording of both tracks on the active call. Recipient media remains blocked until Twilio confirms recording startup. Only then does the same Realtime session begin the call objective. A failed recording start produces a same-voice technical notice and terminates the call.

Twilio sends recording lifecycle events to a signed webhook. A completed callback starts an idempotent post-call transcription job. The API downloads the original dual-channel media with server-side Twilio credentials. A bundled FFmpeg process separates the call legs, detects and normalises individual voice turns, and deletes its temporary working directory when processing ends. Each turn is sent to the configured OpenAI transcription model with bounded names, locale, objective, context, and keywords. The physical channels are mapped to assistant/recipient roles by similarity to the independently stored live role references; live wording is never promoted into the final transcript. The encrypted final turns keep recording-relative start/end timestamps and remain separate from the Realtime draft. Browser audio playback is proxied through the main API; the Twilio media URL and credentials remain server-side.

The main API listens on port `4000`. In Twilio mode, a separate Fastify listener on `127.0.0.1:4001` exposes only voice/status webhooks and the Media Stream WebSocket. It does not expose `/api/*`, SSE, or a health endpoint. HTTP and WebSocket requests require valid Twilio signatures, and the stream also requires a call-scoped HMAC token.

Production should preserve this boundary with a dedicated ingress route or service rather than exposing the main API.

## Call language

Language is a required `CallBrief` property rather than a profile default. One operator can therefore create calls in different languages without mixing instructions or transcripts.

```ts
type CallLanguage = {
  locale: string;           // BCP 47: de-CH, de-DE, en-GB, fr-CH, it-CH, ru-RU
  fallbackLocale?: string;  // only with explicit operator permission
  allowSwitch: boolean;     // false by default
};
```

The current allow-list is `de-CH`, `de-DE`, `en-GB`, `en-US`, `fr-CH`, `it-CH`, and `ru-RU`. The server stores the BCP 47 locale, so the list can grow without a schema migration.

Rules:

1. The operator selects the language before starting and sees it on the brief and live-call pages.
2. Realtime instructions receive the locale, required speaking style, and the language-switch policy.
3. If the recipient uses another language, the assistant asks them to continue in the selected language. Switching is allowed only when `allowSwitch` is true.
4. Every transcript segment stores the locale used for that segment. Partial text is not an authoritative final record.
5. Approval prompts use the active call language and show the exact proposed disclosure to the operator.

`de-CH` means Swiss Standard German. Dialect handling and voice selection are separate concerns and must not be inferred from the locale alone.

## MVP data model

- `CallBrief`: recipient, objective, language, context, approved facts, and policy settings.
- `CallAttempt`: provider call ID, raw and domain status, timestamps, and stop reason.
- `TranscriptSegment`: speaker role, text, locale, timestamp, and partial/final state.
- `CallRecording`: consent timestamp, provider IDs, lifecycle, duration, channels, and deletion deadline.
- `FinalTranscript`: encrypted recording-based turns, roles, timestamps, compatibility text, model, lifecycle, and failure metadata.
- `ApprovalRequest`: category, proposed speech, reason, expiry, and operator decision.
- `AuditEvent`: append-only control event without secrets or unnecessary transcript content.

## Sensitive-data policy

Private values are stored separately and encrypted. A value must not enter the model prompt or Realtime conversation history before approval.

For addresses, dates of birth, medical information, contact details, or legal commitments, the intended production flow is a server-owned `request_approval` action. The API creates a one-time request, publishes it to the console, and waits for the operator. Rejection or expiry means no disclosure.

`stop_call`, `request_approval`, and `end_call` remain server-owned capabilities. The current Realtime MVP still relies partly on prompt rules; moving these guarantees into a deterministic policy gate is required before production use.

## MVP exclusions

The first release does not include public registration, a browser softphone, a native Android app, automatic language switching, CRM/calendar integrations, RAG, click-to-seek transcript/audio alignment, operator-verified transcript revisions, or indefinite audio retention.
