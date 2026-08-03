import type {
  ApprovalDecision,
  CallBrief,
  CallEvent,
  CallSnapshot,
  CreateCallBriefInput,
  TranscriptSegment
} from "@callassist/contracts";
import { getMockCopy } from "./mock-copy";
import {
  CallRepositoryError,
  type CallRepository
} from "./storage/call-repository";

type Subscriber = (event: CallEvent) => void;

export class CallService {
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  readonly #timers = new Map<string, Set<NodeJS.Timeout>>();
  readonly #onBackgroundError: (error: unknown) => void;

  constructor(
    readonly repository: CallRepository,
    onBackgroundError: (error: unknown) => void = console.error
  ) {
    this.#onBackgroundError = onBackgroundError;
  }

  async initialize() {
    await this.repository.ping();
    return this.repository.recoverInterruptedCalls();
  }

  list() {
    return this.repository.list();
  }

  create(input: CreateCallBriefInput) {
    return this.repository.create(input);
  }

  get(id: string) {
    return this.repository.get(id);
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

  async start(id: string) {
    const current = await this.#require(id);
    if (current.brief.status !== "ready") return current;

    const snapshot = await this.#updateStatus(id, "dialing");
    this.#schedule(id, 900, () => this.#updateStatus(id, "in_progress"));
    this.#schedule(id, 1_900, async () => {
      const call = await this.#require(id);
      await this.#addTranscript(
        id,
        "assistant",
        getMockCopy(call.brief.locale).greeting
      );
    });
    this.#schedule(id, 3_800, async () => {
      const call = await this.#require(id);
      await this.#addTranscript(
        id,
        "recipient",
        getMockCopy(call.brief.locale).recipientReply
      );
    });
    this.#schedule(id, 5_200, () => this.#requestApproval(id));
    return snapshot;
  }

  async stop(id: string) {
    this.#clearTimers(id);
    const snapshot = await this.repository.stop(id);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    return snapshot;
  }

  async resolveApproval(
    id: string,
    approvalId: string,
    input: ApprovalDecision
  ) {
    const { approval, snapshot } = await this.repository.resolveApproval(
      id,
      approvalId,
      input.decision
    );
    this.#publish(id, { type: "approval.resolved", approval });
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });

    const copy = getMockCopy(snapshot.brief.locale);
    this.#schedule(id, 650, () =>
      this.#addTranscript(
        id,
        "assistant",
        input.decision === "approved" ? approval.proposedSpeech : copy.declinedSpeech
      )
    );
    this.#schedule(id, 2_200, () => this.#updateStatus(id, "completed"));
    return snapshot;
  }

  async ping() {
    await this.repository.ping();
  }

  async close() {
    for (const id of this.#timers.keys()) this.#clearTimers(id);
    await this.repository.close();
  }

  async #requestApproval(id: string) {
    const snapshot = await this.#require(id);
    const copy = getMockCopy(snapshot.brief.locale);
    const result = await this.repository.requestApproval(id, {
      category: "contact_email",
      title: copy.approvalTitle,
      reason: copy.approvalReason,
      proposedSpeech: copy.proposedSpeech
    });
    this.#publish(id, { type: "call.updated", brief: result.snapshot.brief });
    this.#publish(id, { type: "approval.requested", approval: result.approval });
  }

  async #addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string
  ) {
    const snapshot = await this.#require(id);
    const result = await this.repository.addTranscript(
      id,
      role,
      text,
      snapshot.brief.locale
    );
    this.#publish(id, { type: "transcript.added", segment: result.segment });
    return result.snapshot;
  }

  async #updateStatus(id: string, status: CallBrief["status"]) {
    const snapshot = await this.repository.updateStatus(id, status);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    return snapshot;
  }

  #schedule(id: string, delay: number, operation: () => Promise<unknown>) {
    const timer = setTimeout(() => {
      this.#timers.get(id)?.delete(timer);
      void operation().catch(this.#onBackgroundError);
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

  async #require(id: string): Promise<CallSnapshot> {
    const snapshot = await this.repository.get(id);
    if (!snapshot) throw new CallRepositoryError("CALL_NOT_FOUND");
    return snapshot;
  }
}
