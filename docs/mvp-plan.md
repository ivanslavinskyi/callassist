# MVP Roadmap

Current status: the operator console, PostgreSQL persistence, encryption, Twilio Media Stream, and OpenAI Realtime bridge are implemented. Realtime requests DTMF consent in the selected voice; recipient audio is not sent to the model or recorded before consent. After consent, Twilio records both tracks and the application creates a separate post-call transcript from the complete recording.

The next milestone is representative end-to-end evaluation and moving sensitive operations from prompt rules into a deterministic server-side policy gate. Redis/BullMQ remains deferred until scheduling and durable retries are introduced.

## 0. Specification and test scenarios

- [ ] Define the first three low-risk call types and test recipients.
- [x] Define the assistant disclosure, task boundary, prohibited data, and stop criteria.
- [ ] Prepare test dialogues for every supported language, starting with `de-CH`.

## 1. Operator console

- [x] Create and list `CallBrief` records.
- [x] Select the call language, optional fallback locale, and language-switch permission.
- [x] Show a live-call screen with transcripts, approval controls, and stop control.
- [x] Distinguish the live draft from the post-call transcript and expose temporary audio controls.
- [x] Define shared event contracts between the API and console.

## 2. Server foundation

- [x] Add the PostgreSQL schema, migrations, encrypted private fields, and audit events.
- [x] Stream UI events over SSE and expose approve, decline, start, and stop commands.
- [ ] Add Redis/BullMQ for background jobs and durable timeouts.

## 3. Telephony

- [x] Verify Twilio webhook signatures.
- [x] Place and stop outbound calls and synchronize provider statuses.
- [x] Run a bidirectional Media Stream with DTMF consent.
- [x] Start dual-channel recording only after consent and process signed recording callbacks.
- [ ] Validate disconnect recovery and failure behaviour in repeated real calls.

## 4. Realtime and policy

- [x] Bridge Twilio PCMU audio to an OpenAI Realtime session.
- [x] Publish partial and final transcript segments for a specific `CallBrief`.
- [x] Create encrypted speaker-labelled post-call turns with timestamps from the dual-channel recording and bounded call context.
- [x] Keep one selected voice across disclosure and conversation.
- [x] Restrict the agent to the objective, context, and approved facts.
- [ ] Implement server-side function tools and a deterministic approval gate.
- [ ] Add structured call outcomes and explicit unresolved-state handling.

## 5. Evaluation and release readiness

- [ ] Measure end-of-turn latency and transcription accuracy on representative PSTN audio.
- [ ] Test Swiss German, supported languages, accents, noise, interruptions, and code-switching.
- [ ] Test wrong numbers, voicemail, sensitive-data requests, and unclear answers.
- [x] Implement immediate, 7-day, and 30-day audio deletion with restart recovery.
- [ ] Verify backup, retention, recovery, and the complete audit trail in deployment.
- [ ] Deploy the isolated webhook gateway and API in a production environment.
- [ ] Harden the responsive console as a PWA after call quality is stable.
