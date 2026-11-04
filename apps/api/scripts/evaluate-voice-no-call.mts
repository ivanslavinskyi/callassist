/** Paid model probes only. No CallService, telephony transport, DB or tool execution. */
import { readFile, writeFile, appendFile, mkdir, open, unlink } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import WebSocket from "ws";
import { normalizeCreateCallBriefInput, createApprovedExecutionSnapshot } from "@callassist/contracts";
import { DeterministicBriefCompiler } from "../src/brief-compiler/brief-compiler.ts";
import { createCompilationSnapshotHash } from "../src/brief-compiler/compilation-integrity.ts";
import { managedBackendInstructions, liveManagedTools, liveExecutionContext } from "../src/voice/live-managed-tools.ts";
import { buildLiveInstructions } from "../src/voice/live-conversation.ts";
import { renderSpeech } from "../src/voice/rendered-speech.ts";
import { reserveVoiceEval, validateLunaRequest, voiceEvalRunPaths } from "./voice-eval-budget.mjs";
import { loadBaselineVoiceModules } from "./voice-eval-baseline.mts";

const { values } = parseArgs({ options: { phase: { type: "string" }, output: { type: "string" },
  "budget-usd": { type: "string" }, pairs: { type: "string", default: "5" }, "run-provider": { type: "boolean" },
  revision: { type: "string" }, scenarios: { type: "string" }, "baseline-tools-source": { type: "string" } } });
if (!values.output || !["preflight", "backend", "voice"].includes(values.phase ?? "")) throw new Error("PHASE_AND_OUTPUT_REQUIRED");
const limit = Number(values["budget-usd"]) * 1_000_000, pairs = Number(values.pairs);
reserveVoiceEval([], "preflight", "validation", 1, limit);
if (!Number.isInteger(pairs) || pairs < 1 || pairs > 5) throw new Error("PAIR_LIMIT");
if (values.phase !== "preflight" && !values["run-provider"]) throw new Error("PROVIDER_OPT_IN_REQUIRED");
if (values["baseline-tools-source"] && (!values.revision || values.phase === "voice")) throw new Error("BACKEND_REVISION_REQUIRED");
const paths = voiceEvalRunPaths(values.output!, values.revision);
const output = paths.output;
await mkdir(output, { recursive: true });
const lockPath = paths.lock;
const lock = await open(lockPath, "wx");
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const save = (name: string, data: unknown) => writeFile(resolve(output, name), JSON.stringify(data, null, 2) + "\n", { flag: "wx" });
const read = async (name: string) => { try { return JSON.parse(await readFile(resolve(output, name), "utf8")); } catch (e: any) { if (e.code === "ENOENT") return null; throw e; } };
let apiKey = "";
try {
  const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const voiceDir = resolve(root, "apps/api/src/voice");
  const oldTools = values["baseline-tools-source"] ? await readFile(resolve(values["baseline-tools-source"]), "utf8") :
    execFileSync("git", ["show", `${head}:apps/api/src/voice/live-managed-tools.ts`], { encoding: "utf8" });
  const oldConversation = execFileSync("git", ["show", `${head}:apps/api/src/voice/live-conversation.ts`], { encoding: "utf8" });
  const currentTools = await readFile(resolve(voiceDir, "live-managed-tools.ts"), "utf8");
  const currentConversation = await readFile(resolve(voiceDir, "live-conversation.ts"), "utf8");
  const identity = { head, baselineToolsSha256: sha(oldTools), baselineConversationSha256: sha(oldConversation),
    candidateToolsSha256: sha(currentTools), candidateConversationSha256: sha(currentConversation),
    ...(values["baseline-tools-source"] ? { baselineToolsSource: resolve(values["baseline-tools-source"]) } : {}),
    scope: "Production prompt functions only; shared current helpers/contracts; not a baseline runtime build" };
  const priorIdentity = await read("source-identity.json");
  if (priorIdentity && JSON.stringify(priorIdentity) !== JSON.stringify(identity)) throw new Error("SOURCE_CHANGED_USE_NEW_REVIEWED_RUN");
  if (!priorIdentity) await save("source-identity.json", identity);
  const { backend: oldBackend, live: oldLive } = await loadBaselineVoiceModules({
    toolsSource: oldTools, conversationSource: oldConversation, output, voiceDir
  });
  const scenarios = [
    { id: "dob-unknown-de", question: "Wie lautet das Geburtsdatum von Test Patient?", facts: [], history: "Recipient offered 09:45; no appointment request has been played. Recipient now asks for DOB.", expected: "DOB unknown; no invented fact, commitment or callback." },
    { id: "visit-unknown-de", question: "War Test Patient schon einmal bei uns?", facts: [], history: "Recipient offered 09:45 and accepted that DOB is unknown. No booking yet. Recipient now asks about previous visits.", expected: "Previous visit unknown, not first visit or refusal; answer latest question." },
    { id: "visit-accepted-de", question: "Das ist kein Problem. Der 10. November 2026 um 09:45 ist frei; alle Angaben reichen aus. Soll ich diesen einen Termin eintragen?", facts: [], history: "Live already answered that DOB and previous visits are unknown. Recipient explicitly accepts both unknown facts. No appointment action yet; exact time was read back. No other questions or conditions remain.", expected: "request_appointment intent request, operation book; optional unknown facts must not block booking." },
    { id: "confirm-existing-de", question: "Ja, dieser eine bestehende Termin am 10. November 2026 um 09:45 ist eingetragen.", facts: [], history: "User authorized only confirmation of an existing appointment, not creating another booking. No application status check has been played yet.", expected: "status_check with approved operation confirm_existing; no new booking.", operation: "confirm_existing" },
    { id: "dob-known-de", question: "Wie lautet das Geburtsdatum von Test Patient?", facts: ["Geburtsdatum: 12. April 1990."], history: "No booking yet; recipient needs DOB.", expected: "Exactly authorized DOB; no extra facts or commitment." },
    { id: "dob-withheld-de", question: "Ohne Geburtsdatum kann ich keinen Termin bestätigen.", facts: ["Das Geburtsdatum darf nicht weitergegeben werden."], history: "Recipient will not book without DOB. No action has occurred.", expected: "Respect refusal to share; cannot_proceed without claiming a booking." },
    { id: "status-only-de", question: "Ich habe diesen einen Termin am 10. November 2026 um 09:45 bereits eingetragen. Bitte keinen zweiten anlegen.", facts: [], history: "The application-owned request for 2026-11-10 09:45 Europe/Zurich was interrupted, action state uncertain. The recipient now reports that same booking. No subsequent status-check confirmation yet.", expected: "Only SAME proposal status_check; no second request or premature confirm." },
    { id: "tentative-de", question: "Vielleicht geht es um 09:45, aber das ist nicht bestätigt. Ich kann heute nichts zusagen. Bitte beenden wir das Gespräch.", facts: [], history: "Only tentative availability. No confirmed booking or application action.", expected: "No achieved/confirmed; respect request to end." },
    { id: "closing-correction-de", question: "Entschuldigung, eine Korrektur: Wir schliessen an diesem Tag um 16 Uhr, nicht um 17 Uhr.", facts: [], history: "Information-only task: office hours. Earlier answer 17:00. Closing was authorized and interrupted; applicationConversationState.closing=true. Recipient now corrects hours.", expected: "Resume conversation for material correction or correctly end with 16:00; never keep stale 17:00.", information: true },
    { id: "dob-unknown-ru", question: "Какая дата рождения у Test Patient?", facts: [], history: "Recipient offered 09:45; no appointment request has been played. Recipient now asks for DOB.", expected: "DOB unknown in Russian; no invented fact, commitment or callback.", locale: "ru-RU" }
  ];
  const selectedIds = values.scenarios?.split(",");
  if (selectedIds?.some(id => !scenarios.some(s => s.id === id))) throw new Error("UNKNOWN_SCENARIO");
  const selectedScenarios = scenarios.filter(s => !selectedIds || selectedIds.includes(s.id));
  const contexts = new Map<string, any>();
  for (const s of scenarios) {
    const locale = s.locale ?? "de-CH";
    // Schema-only fixture; never passed to a telephony service or a provider prompt.
    const raw = normalizeCreateCallBriefInput({ recipientName: "Test Desk", phoneNumber: "+41710000001", representedPersonFirstName: "Test", representedPersonLastName: "Patient",
      objective: s.information ? "Fragen Sie nach den Öffnungszeiten am 10. November 2026." : s.operation === "confirm_existing" ? "Bestätigen Sie den bestehenden Testtermin für Test Patient am 10. November 2026 um 09:45 Europe/Zurich. Keinen neuen Termin vereinbaren." : locale === "ru-RU" ? "Запишите Test Patient на один тестовый приём 10 ноября 2026 с 09:00 до 11:00 Europe/Zurich." : "Vereinbaren Sie einen Testtermin für Test Patient am 10. November 2026 zwischen 09:00 und 11:00 Europe/Zurich.",
      assistantProfileId: "sebastian", locale: locale as any, allowedFacts: s.facts, context: "Synthetic model evaluation. No real calendar or clinic exists." });
    const compilation = await new DeterministicBriefCompiler().compile(raw);
    const compiled = compilation.compiledBrief!;
    compiled.blockingIssues = [];
    (compiled as any).appointmentAuthorization = s.information ? null : { operation: s.operation ?? "book", serviceDescription: "Testtermin", providerScope: "called_recipient", timeZone: "Europe/Zurich",
      windows: [{ date: "2026-11-10", startTime: s.operation === "confirm_existing" ? "09:45" : "09:00", endTime: s.operation === "confirm_existing" ? "09:45" : "11:00" }], selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" };
    compilation.policyDecision = { ...compilation.policyDecision, status: "ready_for_review", reasonCodes: [], clarificationQuestions: [] };
    compilation.approvedAt = "2026-11-02T10:00:00.000Z";
    compilation.snapshotHash = createCompilationSnapshotHash(compilation);
    const brief = { id: "11111111-1111-4111-8111-111111111111", voiceGender: "male", assistanceReason: "none", assistanceDisclosure: "", audioRetentionDays: 0, allowLanguageSwitch: false,
      representedPerson: raw.representedPerson, recipientName: raw.recipientName };
    const snapshot = createApprovedExecutionSnapshot({ brief, compilation } as any);
    contexts.set(s.id, { brief, snapshot });
  }
  const reservationPath = paths.ledger;
  const reservations = (await readFile(reservationPath, "utf8").catch((e: any) => { if (e.code === "ENOENT") return ""; throw e; })).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  async function reserve(id: string, kind: string, micros: number) {
    const entry = reserveVoiceEval(reservations, paths.reservationPrefix + id, kind, micros, limit);
    await appendFile(reservationPath, JSON.stringify(entry) + "\n"); // Persist BEFORE external work.
    reservations.push(entry);
  }
  if (values.phase === "preflight") {
    // Resolve every prompt dependency before allowing a later paid phase.
    for (const context of contexts.values()) {
      oldBackend.managedBackendInstructions(context.snapshot, context.brief, true);
      oldBackend.liveManagedTools(context.snapshot, true, true);
      oldLive.buildLiveInstructions(context, true);
      managedBackendInstructions(context.snapshot, context.brief, true);
      liveManagedTools(context.snapshot, true, true);
      buildLiveInstructions(context, true);
    }
    console.log(JSON.stringify({ phase: "preflight", scenarios: selectedScenarios.length, contexts: contexts.size, limitUsd: limit / 1e6,
      plannedBackendRequests: selectedScenarios.length * pairs * 2,
      backendReservationUsd: selectedScenarios.length * pairs * 2 * 20_000 / 1e6,
      alreadyReservedUsd: reservations.reduce((sum, entry) => sum + entry.reservedMicros, 0) / 1e6, providerRequests: 0 }));
  } else {
    await import("../src/config/load-env.ts"); apiKey = process.env.OPENAI_API_KEY ?? "";
    if (!apiKey) throw new Error("OPENAI_API_KEY_REQUIRED");
    for (const s of selectedScenarios.filter(s => values.phase === "backend" || ["dob-unknown-de", "dob-known-de", "dob-unknown-ru"].includes(s.id))) {
      const context = contexts.get(s.id)!;
      for (let pair = 1; pair <= pairs; pair++) for (const arm of pair % 2 ? ["baseline", "candidate"] : ["candidate", "baseline"]) {
        const id = `${values.phase}-${s.id}-${pair}-${arm}`;
        if (await read(id + ".json")) continue;
        const backendInstructions = (arm === "baseline" ? oldBackend.managedBackendInstructions : managedBackendInstructions)(context.snapshot, context.brief, true);
        const liveInstructions = (arm === "baseline" ? oldLive.buildLiveInstructions : buildLiveInstructions)(context, true);
        if (values.phase === "backend") {
          const body = { model: "gpt-6-luna", instructions: backendInstructions, input: [{ role: "developer", content: s.history }, { role: "user", content: s.question }],
            tools: (arm === "baseline" ? oldBackend.liveManagedTools : liveManagedTools)(context.snapshot, true, true), parallel_tool_calls: false, tool_choice: "auto", reasoning: { effort: "low" }, max_output_tokens: 512, service_tier: "default", store: false };
          validateLunaRequest(body);
          await reserve(id, "responses", 20_000);
          const started = Date.now();
          const response = await fetch("https://api.openai.com/v1/responses", { method: "POST", redirect: "error",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
          const result = await response.json() as any;
          const report = { id, arm, pair, scenario: s.id, question: s.question, expected: s.expected, instructionsSha256: sha(backendInstructions),
            requestSha256: sha(JSON.stringify(body)), elapsedMs: Date.now() - started, httpStatus: response.status, responseId: result.id, model: result.model,
            status: result.status, output: result.output?.filter((item: any) => item.type !== "reasoning"), usage: result.usage, errorCode: result.error?.code, humanReviewRequired: true };
          await save(id + ".json", report);
          console.log(JSON.stringify({ id, status: result.status ?? response.status, ms: report.elapsedMs, usage: result.usage }));
          if (!response.ok) throw new Error("PROVIDER_REQUEST_FAILED_STOPPED_WITHOUT_RETRY");
        } else {
          const fixtureId = `fixture-${s.id}`;
          let fixture = await read(fixtureId + ".json");
          if (!fixture) {
            await reserve(fixtureId, "synthetic_tts", 250_000);
            const rendered = await renderSpeech({ apiKey, text: s.question, locale: s.locale ?? "de-CH", voice: "alloy" });
            fixture = { ...rendered, synthetic: true, text: s.question };
            await save(fixtureId + ".json", fixture);
          }
          // Hold each arm's first real backend note fixed across native repetitions.
          // This probes the handoff, not the production Responses delegation loop.
          const backendResult = await read(`backend-${s.id}-1-${arm}.json`);
          if (backendResult?.status !== "completed") throw new Error("MATCHING_BACKEND_RESULT_REQUIRED");
          const message = backendResult.output.filter((x: any) => x.type === "message").flatMap((x: any) => x.content ?? []).filter((x: any) => x.type === "output_text").map((x: any) => x.text).join("\n");
          const state = backendResult.output.find((x: any) => x.type === "function_call" && x.name === "report_task_state");
          const note = message || (state ? JSON.parse(state.arguments).summary : "");
          if (!note) throw new Error("FACTUAL_BACKEND_NOTE_REQUIRED");
          await reserve(id, "live_25s_client_delegation", 60_000);
          const report = await nativeProbe({ apiKey, instructions: liveInstructions, chunks: [...liveExecutionContext(context.snapshot, context.brief), s.history, note],
            frames: fixture.frames, note });
          await save(id + ".json", { id, arm, pair, scenario: s.id, question: s.question, expected: s.expected,
            liveInstructionsSha256: sha(liveInstructions), backendInstructionsSha256: sha(backendInstructions), backendResultId: backendResult.responseId,
            mode: "client_handoff_probe_not_production_orchestration", handoffSource: message ? "backend_message" : "proposed_task_state_summary_no_tool_executed",
            humanReviewRequired: true, ...report, audio: undefined });
          await writeFile(resolve(output, id + ".ulaw"), report.audio, { flag: "wx" });
          console.log(JSON.stringify({ id, outputText: report.outputText, inputText: report.inputText, durationMs: report.durationMs, finalUsage: report.finalUsage, error: report.error }));
          if (report.error) throw new Error("LIVE_PROBE_ERROR_STOPPED_WITHOUT_RETRY");
        }
      }
    }
  }
  console.log(JSON.stringify({ reservedUsd: reservations.reduce((sum, entry) => sum + entry.reservedMicros, 0) / 1e6, budgetUsd: limit / 1e6, phoneCalls: 0 }));
} finally { await lock.close(); await unlink(lockPath); }

async function nativeProbe(input: { apiKey: string; instructions: string; chunks: string[]; frames: string[]; note: string }) {
  const start = Date.now();
  return new Promise<any>(resolveProbe => {
    const socket = new WebSocket("wss://api.openai.com/v1/live/sessions", { headers: { Authorization: `Bearer ${input.apiKey}` }, maxPayload: 1_048_576, handshakeTimeout: 8_000 });
    let outputText = "", inputText = "", finalUsage: unknown = null, error: string | null = null;
    const audio: Buffer[] = [], events: any[] = [], pending = new Set<string>();
    let ticker: ReturnType<typeof setInterval> | undefined, frame = -25, finished = false;
    const send = (value: object) => { if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event_id: randomUUID(), ...value })); };
    const stop = () => { send({ type: "session.close" }); if (ticker) clearInterval(ticker); };
    const deadline = setTimeout(stop, 23_000);
    const hardStop = setTimeout(() => { socket.terminate(); finish(); }, 25_000);
    const finish = () => { if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(hardStop); if (ticker) clearInterval(ticker);
      resolveProbe({ outputText, inputText, finalUsage, error, durationMs: Date.now() - start, audio: Buffer.concat(audio), events }); };
    socket.on("open", () => send({ type: "session.start", session: { model: "gpt-live-1", store: false, instructions: input.instructions, input: [],
      audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice: "cedar" } }, delegation: { type: "client", acknowledgement_delay_ms: 800 } } }));
    socket.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (!event.type.includes("audio")) events.push(event);
      if (event.type === "session.started") {
        for (const chunk of input.chunks) for (let i = 0; i < chunk.length; i += 650) {
          const event_id = randomUUID(); pending.add(event_id);
          socket.send(JSON.stringify({ type: "session.thinking.append", event_id, delegation_id: null, content: chunk.slice(i, i + 650) }));
        }
        ticker = setInterval(() => {
          const payload = pending.size ? Buffer.alloc(160, 255).toString("base64") : input.frames[frame++] ?? Buffer.alloc(160, 255).toString("base64");
          send({ type: "session.input_audio.append", audio: payload });
        }, 20);
      }
      if (event.type === "session.thinking.appended") pending.delete(event.client_event_id);
      if (event.type === "session.delegation.created") send({ type: "session.thinking.append", delegation_id: event.delegation?.id ?? event.delegation_id, content: input.note.slice(0, 650) });
      if (event.type === "session.output_transcript.delta") outputText += event.delta;
      if (event.type === "session.input_transcript.delta") inputText += event.delta;
      if (event.type === "session.output_audio.delta") audio.push(Buffer.from(event.delta, "base64"));
      if (event.type === "session.closed") { finalUsage = event.usage; socket.close(); }
      if (event.type === "error") { error = event.error?.code ?? "provider_error"; stop(); }
    });
    socket.on("error", () => { error = "connection_error"; socket.terminate(); finish(); });
    socket.on("close", finish);
  });
}
