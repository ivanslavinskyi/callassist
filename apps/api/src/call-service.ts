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
import { MockTelephonyProvider } from "./telephony/mock-telephony-provider";
import {
  mapTwilioStatusToCallStatus,
  type TelephonyProvider,
  type TwilioCallStatus
} from "./telephony/telephony-provider";

type Subscriber = (event: CallEvent) => void;

export class CallServiceError extends Error {
  constructor(
    readonly code: "TELEPHONY_START_FAILED" | "TELEPHONY_STOP_FAILED",
    options?: { cause?: unknown }
  ) {
    super(code, options);
    this.name = "CallServiceError";
  }
}

export class CallService {
  readonly #subscribers = new Map<string, Set<Subscriber>>();
  readonly #timers = new Map<string, Set<NodeJS.Timeout>>();
  readonly #onBackgroundError: (error: unknown) => void;

  constructor(
    readonly repository: CallRepository,
    readonly telephonyProvider: TelephonyProvider = new MockTelephonyProvider(),
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

    const reserved = await this.repository.startAttempt(id, {
      provider: this.telephonyProvider.mode
    });
    this.#publish(id, {
      type: "call.updated",
      brief: reserved.snapshot.brief
    });

    let started;
    try {
      started = await this.telephonyProvider.startCall(current.brief);
    } catch (error) {
      await this.#markFailedIfActive(id).catch(this.#onBackgroundError);
      this.#onBackgroundError(error);
      throw new CallServiceError("TELEPHONY_START_FAILED", { cause: error });
    }

    let snapshot: CallSnapshot;
    try {
      if (!started.providerCallId) {
        throw new CallServiceError("TELEPHONY_START_FAILED");
      }
      snapshot = await this.repository.attachProviderCall(
        reserved.attempt.id,
        started.providerCallId,
        started.providerStatus
      );
    } catch (error) {
      if (started.providerCallId) {
        await this.telephonyProvider
          .stopCall(started.providerCallId)
          .catch(this.#onBackgroundError);
      }
      await this.#markFailedIfActive(id).catch(this.#onBackgroundError);
      throw error;
    }

    if (["completed", "failed", "stopped"].includes(snapshot.brief.status)) {
      await this.telephonyProvider
        .stopCall(started.providerCallId)
        .catch(this.#onBackgroundError);
      return snapshot;
    }

    if (this.telephonyProvider.mode === "mock") {
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
    }
    return snapshot;
  }

  async stop(id: string) {
    this.#clearTimers(id);
    const attempt = await this.repository.getLatestAttempt(id);
    if (attempt?.providerCallId) {
      try {
        await this.telephonyProvider.stopCall(attempt.providerCallId);
      } catch (error) {
        this.#onBackgroundError(error);
        throw new CallServiceError("TELEPHONY_STOP_FAILED", { cause: error });
      }
    }
    const snapshot = await this.repository.stop(id);
    this.#publish(id, { type: "call.updated", brief: snapshot.brief });
    return snapshot;
  }

  async handleTwilioStatus(
    providerCallId: string,
    status: TwilioCallStatus,
    callBriefId?: string
  ) {
    const result = await this.repository.applyProviderStatus(
      providerCallId,
      status,
      mapTwilioStatusToCallStatus(status),
      callBriefId
    );
    if (result) {
      this.#publish(result.callId, {
        type: "call.updated",
        brief: result.snapshot.brief
      });
    }
    return result?.snapshot ?? null;
  }

  async addTranscript(
    id: string,
    role: TranscriptSegment["role"],
    text: string
  ) {
    const normalized = text.trim();
    if (!normalized) return this.#require(id);
    return this.#addTranscript(id, role, normalized);
  }

  publishTranscriptDelta(
    id: string,
    key: string,
    role: "assistant" | "recipient",
    delta: string,
    locale: CallBrief["locale"]
  ) {
    if (!delta) return;
    this.#publish(id, { type: "transcript.delta", key, role, delta, locale });
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

  async #markFailedIfActive(id: string) {
    const snapshot = await this.#require(id);
    if (["completed", "failed", "stopped"].includes(snapshot.brief.status)) {
      return snapshot;
    }
    return this.#updateStatus(id, "failed");
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
