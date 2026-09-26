# Unified Live runtime — 26 September 2026

Branch: `codex/live-unified-runtime`. Production last reported by the owner:
`915a8f6`, Live, fallback=false, migrations through 0084. This change is not deployed.

## Runtime

`VOICE_RUNTIME_DRIVER=live` and `VOICE_RUNTIME_LIVE_FALLBACK=false` create exactly
one native Live WebSocket per admitted human stream. No Realtime or separate
transcription socket is created. One selected Live voice reads the AI/name/recording/
transcription disclosure, opening, conversation, recap and farewell. Responses
delegation stays on GPT-6 Luna with parallel_tool_calls=false. The default driver
in `.env.example` remains realtime; fallback defaults false. Explicit fallback=true
retains the older hybrid pilot for compatibility, including its Realtime speech.

Synchronous Twilio AMD still runs before stream admission. Voicemail/fax/unknown
branches and the approved neutral voicemail message keep their existing separate
Twilio policy. A declined handset call cannot reliably be distinguished from carrier
voicemail routing. No change to recording retention or post-call gpt-transcribe /
gpt-4o-transcribe processing.

## Application gates

Before consent, Live receives only language and disclosure instructions, no task
context or action tools. Input audio is continuously forwarded in PCMU at 8 kHz,
without transcoding. Native pre-consent transcripts stay in bounded memory; they
are not published/persisted as conversation history. The application assembles
the consent answer, waits for speech and transcript stability, checks an explicit
phrase allowlist, clarifies uncertainty, then offers keypad consent. Recording
must start successfully before task context and tools are enabled. Unknown consent
never becomes permission by model assertion.

Controlled speech streams immediately. This is **not a pre-playback content filter**:
native output text is checked as it arrives. A mismatch clears queued audio and
fails closed. Only the complete expected native text plus an output-quiet candidate
allows a Twilio mark. Continuous silent Live packets do not reset that candidate.
Only its matching, uncleared playback acknowledgment advances the application.
Neither a Responses completion nor an append acknowledgment finishes voice output.
There is no claimed provider guarantee of exact spoken wording; real-call acceptance
must test pronunciation, interruption, latency and transcription fidelity.

Successful closing uses a natural paraphrase of the outcome and essential agreed
details: one or two short sentences, bounded to 400 characters. The existing Responses
backend supplies the recap and separate whole recipient turns as supporting evidence;
only the recap is spoken. The application verifies evidence provenance, not semantic
equivalence. Instructions require preserving uncertainty, negations, conditions and
the latest corrections. Short answers may be interpreted in their conversation context;
the recipient need not repeat information just to produce a quotable sentence.
The application leaves 1.5 seconds for corrections, then reads the farewell.
Neither the recap nor its evidence proves external action completion. Existing appointment authorization and subsequent
confirmation fences still apply. Recipient stop requests skip the recap. New speech
cancels closing and its pending marks; a fresh interrupted-closing decision is needed.
Tools, provider disconnects and timers cannot silently restart the call in another model.

After consent, native transcript text/timing is retained. Controlled output fragments
are committed only after verified playback; cancelled fragments are discarded.
Completed provisional transcripts use document scrolling, while active calls retain
the follow/pause behavior. No transcript is translated to disguise a language error.

## Language, export and billing

The compiler audits the execution projection in a separate bounded Responses request
before approval. All natural-language fields, including dates, question purposes,
conditions and appointment service descriptions, must use the selected call locale.
Identity names, addresses and identifiers are preserved. One repair is allowed;
an invalid audit fails preparation, persistent mismatch blocks approval. Source-language
UI objectives and sourceText are excluded from execution context. This audit is billed
through the existing compiler request reservation/usage hooks and eight-request budget.
Previously approved immutable plans are not silently rewritten: recreate/review any
known mixed-language historical plan before repeating it.

Admin → Calls now opens the telemetry export panel by default and explains disabled
server configuration or missing superadmin permissions. Enable
`ADMIN_TELEMETRY_EXPORT_ENABLED=true` in both API and worker environments; PostgreSQL
and the export worker are required. Native transcript timing is included in archives.
Owner-only downloads, encryption, expiry, revocation and auditing are unchanged.
Native Live duration, Responses tokens and compiler audit tokens use the existing ledger;
missing final provider usage remains uncertain, never zero.

## Acceptance / rollout

No new SQL migration. Run the full test, lint, typecheck, build and migration-catalog
checks. Start the local API with live/fallback=false and the existing webhook tunnel.
Check the human call, negative/unclear/early consent, DTMF, recording failure, natural
German agreement, interruption during recap/farewell, recipient correction, appointment
confirmation, carrier voicemail and provider disconnect. Test completed long transcripts
on 360/390/430 px, both tabs and all customer UI locales. Create/download an export and
check its native timing, operation stages and recorded costs.

A real synthetic OpenAI probe on 26 September established the session and streamed
the first voiced disclosure audio in about 4.1 seconds from connection initiation; full native
text matched and the completion gate passed. This excludes Twilio/AMD delay and does
not replace recipient acceptance. Automated checks passed: **1,686 tests in 197 files**
(API 1,259, web 291, contracts 136), full lint, typecheck and production build. The
real-provider probe also accepted the Responses update and spoke a second controlled
utterance in the same session. A synthetic Russian task compiled to German and passed
the language audit (3,737 generation tokens and 580 audit tokens in that sample).
The local catalog matches all 84 migrations, with none pending. Real-call acceptance
and authenticated mobile/export UI checks remain pending. Use the existing release helper; preserve production live/
fallback=false, enable export on API+worker, and check both services/site after cutover.
Rollback can restore the prior release/environment or explicitly select realtime;
never replay a running conversation across providers.

Self-review covered signed/attempt-bound stream admission, canonical caller identity,
pre-consent transcript retention, unsupported/duplicate/stale tools, paraphrased recap and whole-turn evidence
evidence (including negation), interrupted marks, bounded playback/recording startup,
provider finalization and compiler request accounting. A focused 101-test runtime /
consent / smoke regression and API typecheck/build passed after final review adjustments.
Local API readiness and login page return HTTP 200; export-worker heartbeat is current.
The webhook tunnel is reachable and intentionally does not expose internal health routes.
The local frontend now uses `.next-unified-local` to avoid dev/build artifact collisions.
