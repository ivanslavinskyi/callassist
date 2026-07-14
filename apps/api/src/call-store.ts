import { randomUUID } from "node:crypto";
import type {
  ApprovalDecision,
  ApprovalRequest,
  CallBrief,
  CallEvent,
  CallSnapshot,
  CreateCallBriefInput,
  TranscriptSegment
} from "@callassist/contracts";
import { createCallBriefInputSchema } from "@callassist/contracts";
import { getMockCopy } from "./mock-copy";

type Subscriber = (event: CallEvent) => void;

const terminalStatuses = new Set(["completed", "stopped", "failed"]);

export class CallStore {
  readonly #calls = new Map<string, CallSnapshot>();
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  readonly #timers = new Map<string, Set<NodeJS.Timeout>>();

  list() {
    return [...this.#calls.values()]
      .map(({ brief }) => brief)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  create(input: CreateCallBriefInput) {
    const parsed = createCallBriefInputSchema.parse(input);
    const now = new Date().toISOString();
    const brief: CallBrief = {
      ...parsed,
      id: randomUUID(),
      status: "ready",
      createdAt: now,
      updatedAt: now
    };

    this.#calls.set(brief.id, {
      brief,
      transcript: [],
      pendingApproval: null
    });

    return brief;
  }

  get(id: string) {
    return this.#calls.get(id) ?? null;
  }

  subscribe(id: string, subscriber: Subscriber) {
    const subscribers = this.#subscribers.get(id) ?? new Set<Subscriber>();
    subscribers.add(subscriber);
    this.#subscribers.set(id, subscribers);

    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size === 0) this.#subscribers.delete(id);
    };
  }

  start(id: string) {
    const snapshot = this.#requireCall(id);
    if (snapshot.brief.status !== "ready") return snapshot;

    this.#updateStatus(id, "dialing");
    this.#schedule(id, 900, () => this.#updateStatus(id, "in_progress"));
    this.#schedule(id, 1_900, () => {
      const current = this.#requireCall(id);
      this.#addTranscript(id, "assistant", getMockCopy(current.brief.locale).greeting);
    });
    this.#schedule(id, 3_800, () => {
      const current = this.#requireCall(id);
      this.#addTranscript(id, "recipient", getMockCopy(current.brief.locale).recipientReply);
    });
    this.#schedule(id, 5_200, () => this.#requestApproval(id));

    return this.#requireCall(id);
  }

  stop(id: string) {
    const snapshot = this.#requireCall(id);
    if (terminalStatuses.has(snapshot.brief.status)) return snapshot;

    this.#clearTimers(id);
    snapshot.pendingApproval = null;
    this.#updateStatus(id, "stopped");
    return snapshot;
  }

  resolveApproval(id: string, approvalId: string, input: ApprovalDecision) {
    const snapshot = this.#requireCall(id);
    const approval = snapshot.pendingApproval;

    if (!approval || approval.id !== approvalId || approval.status !== "pending") {
      throw new Error("APPROVAL_NOT_FOUND");
    }

    approval.status = input.decision;
    snapshot.pendingApproval = null;
    this.#publish(id, { type: "approval.resolved", approval });
    this.#updateStatus(id, "in_progress");

    const copy = getMockCopy(snapshot.brief.locale);
    this.#schedule(id, 650, () => {
      this.#addTranscript(
        id,
        "assistant",
        input.decision === "approved" ? approval.proposedSpeech : copy.declinedSpeech
      );
    });
    this.#schedule(id, 2_200, () => this.#updateStatus(id, "completed"));

    return snapshot;
  }

  #requestApproval(id: string) {
    const snapshot = this.#requireCall(id);
    const copy = getMockCopy(snapshot.brief.locale);
    const approval: ApprovalRequest = {
      id: randomUUID(),
      category: "contact_email",
      title: copy.approvalTitle,
      reason: copy.approvalReason,
      proposedSpeech: copy.proposedSpeech,
      status: "pending",
      createdAt: new Date().toISOString()
    };

    snapshot.pendingApproval = approval;
    this.#updateStatus(id, "awaiting_approval");
    this.#publish(id, { type: "approval.requested", approval });
  }

  #addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string
  ) {
    const snapshot = this.#requireCall(id);
    const segment: TranscriptSegment = {
      id: randomUUID(),
      role,
      text,
      locale: snapshot.brief.locale,
      final: true,
      createdAt: new Date().toISOString()
    };

    snapshot.transcript.push(segment);
    this.#publish(id, { type: "transcript.added", segment });
  }

  #updateStatus(id: string, status: CallBrief["status"]) {
    const snapshot = this.#requireCall(id);
    snapshot.brief.status = status;
    snapshot.brief.updatedAt = new Date().toISOString();
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
  }

  #schedule(id: string, delay: number, operation: () => void) {
    const timer = setTimeout(() => {
      this.#timers.get(id)?.delete(timer);
      operation();
    }, delay);

    const timers = this.#timers.get(id) ?? new Set<NodeJS.Timeout>();
    timers.add(timer);
    this.#timers.set(id, timers);
  }

  #clearTimers(id: string) {
    for (const timer of this.#timers.get(id) ?? []) clearTimeout(timer);
    this.#timers.delete(id);
  }

  #publish(id: string, event: CallEvent) {
    for (const subscriber of this.#subscribers.get(id) ?? []) subscriber(event);
  }

  #requireCall(id: string) {
    const snapshot = this.#calls.get(id);
    if (!snapshot) throw new Error("CALL_NOT_FOUND");
    return snapshot;
  }
}
