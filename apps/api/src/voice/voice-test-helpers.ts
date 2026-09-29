import { EventEmitter } from "node:events";
import { vi } from "vitest";
import WebSocket from "ws";
import type { AppointmentAuthorization, CallLocale, AssistantProfileId } from "@callassist/contracts";
import { InMemoryCallRepository } from "../storage/in-memory-call-repository";
import type { CallRepository } from "../storage/call-repository";
import { CallService } from "../call-service";
import { DeterministicBriefCompiler } from "../brief-compiler/brief-compiler";
import { createCompilationSnapshotHash } from "../brief-compiler/compilation-integrity";
import { originalPlanReview } from "../test-helpers/original-plan-review";

export class TestSocket extends EventEmitter {
  autoAcknowledge = false;
  readyState: number = WebSocket.OPEN;
  sent: any[] = [];
  liveSession: Record<string, unknown> | null = null;
  startLive(id: string) {
    this.receive({ type: "session.started", session: { ...this.sent.find(e => e.type === "session.start").session, id } });
  }
  send(value: string) {
    const event = JSON.parse(value); this.sent.push(event);
    if (this.autoAcknowledge && event.type === "session.update") {
      queueMicrotask(() => this.receive({ type: "session.updated", client_event_id: event.event_id, session: this.liveSession }));
    }
    if (this.autoAcknowledge && typeof event.type === "string" && event.type.endsWith(".append") && event.type !== "session.input_audio.append") {
      queueMicrotask(() => this.receive({ type: `${event.type}ed`, client_event_id: event.event_id }));
    }
  }
  close() { if (this.readyState === WebSocket.CLOSED) return; this.readyState = WebSocket.CLOSED; this.emit("close"); }
  terminate() { this.close(); }
  receive(event: object) {
    if ((event as any).type === "session.started") this.liveSession = (event as any).session;
    this.emit("message", Buffer.from(JSON.stringify(event)));
  }
  get ws() { return this as unknown as WebSocket; }
}

export const flush = () => new Promise<void>(resolve => setImmediate(resolve));
export const silence = Buffer.alloc(160, 255).toString("base64");
export const speech = Buffer.alloc(800, 128).toString("base64");
export const authorization: AppointmentAuthorization = {
  operation: "book", serviceDescription: "Routine dental check-up", providerScope: "called_recipient",
  timeZone: "Europe/Zurich", windows: [{ date: "2099-09-16", startTime: "14:00", endTime: "17:00" }],
  selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms"
};
export const proposal = { operation: "book", date: "2099-09-16", startTime: "15:00", timeZone: "Europe/Zurich",
  serviceMatches: true, recipientMatches: true, requiresPaymentOrNewTerms: false, detailsConfirmed: true };

export async function approvedCall(appointment?: AppointmentAuthorization, repository: CallRepository = new InMemoryCallRepository(), locale: CallLocale = "en-GB", providerCallId = "CA-LIVE", profile: AssistantProfileId = "anna", assistanceReason: "none" | "speech_impairment" = "speech_impairment") {
  const compiler = new DeterministicBriefCompiler();
  if (appointment) {
    const compile = compiler.compile.bind(compiler);
    vi.spyOn(compiler, "compile").mockImplementation(async (input, revision) => {
      const result = await compile(input, revision);
      if (!result.compiledBrief) throw new Error("Missing fixture plan");
      result.compiledBrief = { ...result.compiledBrief, schemaVersion: "4", taskType: "appointment_coordination", appointmentAuthorization: appointment };
      result.snapshotHash = createCompilationSnapshotHash(result);
      return result;
    });
  }
  const service = new CallService(repository, undefined, undefined, undefined, compiler);
  const brief = await service.create({ recipientName: "Example AG", phoneNumber: "+41710000001",
    objective: "Ask whether the application sent on 12 July was received", assistantProfileId: profile,
    representedPersonFirstName: "Nina", representedPersonLastName: "Keller", assistanceReason,
    locale, audioRetentionDays: 0, allowLanguageSwitch: false, allowedFacts: ["Application sent: 12 July"] });
  await service.approveCompilation(brief.id, await originalPlanReview(service, brief.id));
  const { attempt } = await repository.startAttempt(brief.id, { provider: "twilio" });
  await repository.attachProviderCall(attempt.id, providerCallId, "in-progress");
  return { service, repository, brief, attempt, snapshot: attempt.executionSnapshot! };
}
