import { preparationRequestReserve } from "../config/preparation-pricing";
import { isNativeActionsPolicy, isProgressivePolicy, isIntegrityPolicy, NATIVE_ROLES_POLICY, nativeAppointmentInterpretationJsonSchema, prepareNativeAppointmentOutput } from "./native-appointment-compilation";
import {preparationIssue,moderationIssueCategories,type PreparationIssue} from "@callassist/contracts";
import { buildCompilerInstructions } from "./compiler-instructions";
import { equivalentIdentityLabel, preservesIdentityLabel } from "./identity-label";
import { readProviderResponse, ResponseReadError, providerBackoffMs } from "./response-reader";
import { writePiiSafeOperationalError } from "../runtime/pii-safe-logger";
import { preparationCheckpointSchema, type PreparationRuntimePolicy, type PreparationCheckpoint } from "@callassist/contracts";
// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import { randomUUID } from "node:crypto";
import {
  BRIEF_COMPILER_VERSION,
  CALL_BRIEF_SCHEMA_VERSION,
  CALL_POLICY_VERSION,
  compiledCallBriefSchema,
  currentCompiledCallBriefSchema,
  nativeActionCompiledCallBriefSchema,
  nativeAppointmentRuleContains,
  getAppointmentAuthorization,
  createApprovedExecutionPlan,
  createCallBriefInputSchema,
  type CallCompilation,
  type CompiledCallBrief,
  type NormalizedCallBriefInput,
  type PolicyDecision,
  type RawCallBrief
} from "@callassist/contracts";
import { deterministicMockAppointmentIntent, appointmentClarification, canonicalAppointmentDate, enforceAppointmentPlan,
  isAuthorizedAppointmentDateIdentifier, modelAppointmentAuthorizationJsonSchema, modelSchedulingInterpretationJsonSchema,
  prepareAppointmentModelOutput, type AppointmentCompilationContext } from "./appointment-compilation";
import { createCompilationSnapshotHash } from "./compilation-integrity";
import { storedCallBriefInputSchema, previousCompiledCallBriefSchema } from "@callassist/contracts";
import { verifyExecutionLanguage } from "./execution-language";
import { verifyExecutionFidelity, type ExecutionFidelityVerdict } from "./execution-fidelity";
import { PreparationRequestDiagnostics } from "./request-diagnostics";

const defaultCompilerModel = "gpt-5.6";
const defaultResponsesEndpoint = "https://api.openai.com/v1/responses";
const defaultModerationEndpoint = "https://api.openai.com/v1/moderations";
const defaultCompilationTimeoutMs = 120_000;
// Successful requests in the release baseline completed within 29 seconds;
// bound a stalled request before it consumes an entire preparation attempt.
const defaultGenerationRequestTimeoutMs = 35_000;
const defaultModerationRequestTimeoutMs = 25_000;

const executionLanguageRepairLimit = 3;
// Three language repairs each need generation + audit. Shared with the
// durable reservation ledger; transport retries still consume this same budget.
export const briefCompilationProviderRequestBudget = 12;

export type BriefCompilerStage =
  | "input_moderation"
  | "compilation"
  | "compilation_repair"
  | "language_audit"
  | "output_moderation";

export type PreparationRequestMetadata = {
  repairKind: "none" | "language" | "integrity" | "schema";
  repairNumber: number;
  transportAttempt: number;
  timeoutMs: number;
  remainingMs: number;
};

export type BriefCompilerRunOptions = {
  policy?: PreparationRuntimePolicy;
  signal?: AbortSignal;
  checkpoint?: (clientRequestId: string, checkpoint: PreparationCheckpoint) => Promise<void>;
  maxProviderRequests?: number;
  /** Persisted preparation creation time bounds all durable retries together. */
  deadlineAtMs?: number;
  beforeProviderRequest?: (request: {
    clientRequestId: string;
    stage: BriefCompilerStage;
    operationType: "brief_moderation" | "brief_compilation";
    provider: "openai";
    model: string;
    startedAt: string;
    requestMetadata?: PreparationRequestMetadata;
    requestedServiceTier?: string;
    pricingVersion?: string;
    reserveUsdMicros?: number;
    estimatedTokens?: number;
  }) => Promise<boolean>;
  afterProviderRequest?: (result: BriefCompilerProviderRequestResult) =>
    Promise<void>;
};

export type BriefCompilerProviderRequestResult = {
  actualServiceTier?: string | null;
  retryAfterMs?: number;
  diagnostics?: import("@callassist/contracts").PreparationTransportDiagnostics;
  clientRequestId: string;
  stage: BriefCompilerStage;
  outcome: "succeeded" | "provider_error" | "network_error" | "invalid_response";
  providerRequestId: string | null;
  providerResponseId: string | null;
  providerModel: string | null;
  statusCode: number | null;
  completedAt: string;
  durationMs: number;
  errorCode?: string | null;
  usage: OpenAITextTokenUsage | null;
};

export type OpenAITextTokenUsage = {
  inputTextTokens: number | null;
  cachedInputTextTokens: number | null;
  cacheWriteInputTextTokens: number | null;
  outputTextTokens: number | null;
  reasoningOutputTokens: number | null;
  totalTokens: number | null;
  rawUsage: Record<string, unknown>;
};

export interface BriefCompiler {
  readonly model: string;
  compile(
    input: NormalizedCallBriefInput,
    revision?: number,
    options?: BriefCompilerRunOptions
  ): Promise<CallCompilation>;
}

export class BriefCompilerError extends Error {
  readonly retryAfterMs: number;
  readonly responseId: string | null;
  readonly clientRequestId: string | null;
  readonly validationPaths: string[];
  readonly statusCode: number | null;
  readonly stage: BriefCompilerStage | null;

  constructor(
    readonly code:
      | "OPENAI_REQUEST_FAILED"
      | "OPENAI_REQUEST_BUDGET_EXHAUSTED"
      | "OPENAI_RESPONSE_INVALID",
    options?: {
      retryAfterMs?: number;
      cause?: unknown;
      responseId?: string | null;
      clientRequestId?: string | null;
      validationPaths?: string[];
      statusCode?: number | null;
      stage?: BriefCompilerStage | null;
    }
  ) {
    super(code, options);
    this.name = "BriefCompilerError";
    this.retryAfterMs = options?.retryAfterMs ?? 0;
    this.responseId = options?.responseId ?? null;
    this.clientRequestId = options?.clientRequestId ?? null;
    this.validationPaths = options?.validationPaths ?? [];
    this.statusCode = options?.statusCode ?? null;
    this.stage = options?.stage ?? null;
  }
}

type OpenAIBriefCompilerOptions = {
  apiKey: string;
  model?: string;
  responsesEndpoint?: string;
  moderationEndpoint?: string;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  fetchImplementation?: typeof fetch;
  now?: () => Date;
};

type OpenAIResponsePayload = {
  id?: unknown;
  status?: unknown;
  output_text?: unknown;
  output?: Array<{
    type?: unknown;
    content?: Array<{
      type?: unknown;
      text?: unknown;
      refusal?: unknown;
    }>;
  }>;
};

export class OpenAIBriefCompiler implements BriefCompiler {
  readonly model: string;
  readonly #apiKey: string;
  readonly #responsesEndpoint: string;
  readonly #moderationEndpoint: string;
  readonly #timeoutMs: number;
  readonly #requestTimeoutMs: number | undefined;
  readonly #fetch: typeof fetch;
  readonly #now: () => Date;

  constructor(options: OpenAIBriefCompilerOptions) {
    this.#apiKey = options.apiKey;
    this.model = options.model?.trim() || defaultCompilerModel;
    this.#responsesEndpoint =
      options.responsesEndpoint?.trim() || defaultResponsesEndpoint;
    this.#moderationEndpoint =
      options.moderationEndpoint?.trim() || defaultModerationEndpoint;
    this.#timeoutMs = options.timeoutMs ?? defaultCompilationTimeoutMs;
    this.#requestTimeoutMs = options.requestTimeoutMs;
    this.#fetch = options.fetchImplementation ?? fetch;
    this.#now = options.now ?? (() => new Date());
  }

  async compile(
    input: NormalizedCallBriefInput,
    revision = 1,
    options: BriefCompilerRunOptions = {}
  ) {
    const deadline = Math.min(Date.now() + Math.min(options.policy?.timeoutMs ?? Infinity, this.#timeoutMs), options.deadlineAtMs ?? Infinity);
    if (deadline <= Date.now()) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", {
      cause: new Error("PREPARATION_DEADLINE_EXCEEDED")
    });
    // Generation and its retries share a deadline that leaves time for the final moderation request.
    const compilationDeadline = deadline - Math.min(
      this.#requestTimeoutMs ?? defaultModerationRequestTimeoutMs, Math.floor((deadline - Date.now()) / 4)
    );
    const model = options.policy?.generation.model ?? this.model;
    const requestBudget = createRequestBudget({ ...options, deadlineAtMs: deadline });
    const native = options.policy?.promptVersion !== "preparation-2026-10-05";
    const nativeActions = isNativeActionsPolicy(options.policy?.promptVersion);
    const progressive = isProgressivePolicy(options.policy?.promptVersion), integrity = isIntegrityPolicy(options.policy?.promptVersion);
    const roles = options.policy?.promptVersion === NATIVE_ROLES_POLICY;
    const rawBrief = (native ? createCallBriefInputSchema : storedCallBriefInputSchema).parse(input);
    const currentDateTime = this.#now().toISOString();
    const moderation=await this.#isFlaggedByModeration(rawBrief,deadline,requestBudget);
    if (moderation.flagged) {
      return createCompilation({
        native, nativeActions, progressive, integrity, roles,
        rawBrief,
        compiledBrief: null,
        policyDecision: {...blockedDecision("input_moderation_flagged"),...(integrity?{issue:preparationIssue("input_moderation_flagged","input_moderation",moderation.categories)}:{})},
        compilerModel: model,
        compilerResponseId: null,
        revision
      });
    }

    let response: OpenAIResponsePayload | null = null;
    let compiledBrief: CompiledCallBrief | null = null;
    let displayObjective: CallCompilation["displayObjective"];
    let localPolicy: PolicyDecision | null = null;
    let validationFeedback: string[] = [];
    let languageRepairs = 0;
    let repairKind: PreparationRequestMetadata["repairKind"] = "none";

    // Keep the existing single initial schema/policy repair, independently of
    // language repairs. Every pass still shares the original deadline and budget.
    for (let attempt = 0; attempt < 2 + executionLanguageRepairLimit; attempt += 1) {
      requestBudget.repairKind = repairKind;
      requestBudget.repairNumber = attempt;
      try {
        response = await this.#requestCompilation(
          rawBrief, validationFeedback, compilationDeadline, requestBudget, currentDateTime
        );
      } catch (cause) {
        // A live connection emitting padding is not a slow useful generation.
        // Cancel it early and use the existing single schema repair, with the
        // original deadline/budget and without replaying the identical prompt.
        if (attempt === 0 && cause instanceof BriefCompilerError && cause.code === "OPENAI_RESPONSE_INVALID" &&
          cause.validationPaths.includes("stream_padding")) {
          repairKind = "schema";
          validationFeedback = ["output: the previous response stalled in whitespace between JSON fields. Return one complete compact JSON object, no indentation, blank lines or padding. Include every required property, including required on each ordered question. Keep the plan proportional to the task."];
          continue;
        }
        throw cause;
      }
      const refusal = extractRefusal(response);
      if (refusal) {
        return createCompilation({
          native, nativeActions, progressive, integrity, roles,
          rawBrief,
          compiledBrief: null,
          policyDecision: {...blockedDecision("model_refusal"),...(integrity?{issue:preparationIssue("model_refusal","model_refusal")}:{})},
          compilerModel: model,
          compilerResponseId: stringOrNull(response.id),
          revision
        });
      }

      const parsed = parseCompiledBriefResponse(response, rawBrief, new Date(currentDateTime), nativeActions);
      if (parsed.success) {
        displayObjective = parsed.displayObjective;
        compiledBrief = enforceAppointmentPlan(rawBrief, {
          ...parsed.data,
          blockingIssues: filterApplicableBlockingIssues(rawBrief, parsed.data)
        });
        if (parsed.context.missingSchedulingConstraints && compiledBrief.blockingIssues.length === 0) {
          compiledBrief = { ...compiledBrief, blockingIssues: [{ code: "missing_scheduling_constraints",
            question: appointmentClarification(rawBrief, compiledBrief.sourceLanguage) }] };
        }
        localPolicy = evaluateCompiledBrief(rawBrief, compiledBrief, parsed.context);
        if (localPolicy.status === "ready_for_review") {
          let languageIssues: string[];
          let semanticIssues: ExecutionFidelityVerdict["semanticViolations"] = [];
          try {
            const auditRequest = (body: object) => this.#request(this.#responsesEndpoint, body, compilationDeadline,
              "language_audit", options.policy?.audit.model ?? model, requestBudget);
            if (roles) {
              const verdict = await verifyExecutionFidelity(compiledBrief, rawBrief, auditRequest, options.policy?.audit.model ?? model);
              languageIssues = verdict.languageViolations;
              semanticIssues = verdict.semanticViolations;
            } else {
              languageIssues = await verifyExecutionLanguage(compiledBrief, rawBrief, auditRequest, options.policy?.audit.model ?? model);
            }
          } catch (cause) {
            if (cause instanceof BriefCompilerError) throw cause;
            throw new BriefCompilerError("OPENAI_RESPONSE_INVALID", { cause, stage: "language_audit", validationPaths: [roles ? "execution_fidelity_audit" : "execution_language_audit"] });
          }
          if (languageIssues.length || semanticIssues.length) {
            if (languageRepairs < executionLanguageRepairLimit) {
              languageRepairs += 1;
              repairKind = semanticIssues.length ? "integrity" : "language";
              validationFeedback = [
                ...languageIssues.map(path => `Language mismatch at ${path}: regenerate all runtime text in ${rawBrief.locale}, including dates, conditions and approved facts. Preserve identity names, addresses and reference IDs. Do not copy source-language prose into runtime fields.`),
                ...semanticIssues.map(({ path, reason }) => `Semantic fidelity failure at ${path} (${reason}): regenerate from the original labelled parties and full task sources. Preserve who each preference, fact, request and condition concerns, including recipient and third-party subjects; do not merge people by name similarity. Restore omitted facts and restrictions without inventing facts or broadening action authority. Make all plan fields mutually consistent.`)
              ];
              continue;
            }
            localPolicy = blockedDecision(semanticIssues.length ? "fact_integrity_failure" : "plan_constraint_failure");
          }
        }
        const recoverable = compiledBrief.taskType !== "unsupported" && compiledBrief.riskCategories.length === 0 &&
          !parsed.context.missingSchedulingConstraints && compiledBrief.blockingIssues.length === 0 &&
          localPolicy.status === "blocked" && localPolicy.reasonCodes.some((reason) =>
            reason === "fact_integrity_failure" || reason === "plan_constraint_failure");
        if (attempt === 0 && recoverable) {
          repairKind = "integrity";
          validationFeedback = localPolicy.reasonCodes.map((reason) => reason === "fact_integrity_failure"
            ? "fact_integrity_failure: preserve every supplied name, address and reference exactly; use only supplied facts and dates derived from schedulingInterpretation; do not invent identifiers"
            : "plan_constraint_failure: preserve selected task settings and keep semantic intent, requested authority, operation and time zone consistent; availability alone grants no authority");
          continue;
        }
        break;
      }

      validationFeedback = parsed.validationFeedback;
      repairKind = "schema";
      if (attempt >= 1) {
        throw new BriefCompilerError("OPENAI_RESPONSE_INVALID", {
          cause: parsed.cause,
          responseId: stringOrNull(response.id),
          validationPaths: parsed.validationPaths
        });
      }
    }

    if (!response || !compiledBrief) {
      throw new BriefCompilerError("OPENAI_RESPONSE_INVALID");
    }

    if (!localPolicy) throw new BriefCompilerError("OPENAI_RESPONSE_INVALID");
    const outputModeration = await this.#isFlaggedByModerationText(
      buildRuntimeModerationText(compiledBrief), deadline, "output_moderation", requestBudget
    );
    const policyDecision = outputModeration.flagged ? {...blockedDecision("prohibited_content"),...(integrity?{issue:preparationIssue("prohibited_content","output_moderation",outputModeration.categories)}:{})} : localPolicy;

    if (Date.now() >= deadline || options.signal?.aborted) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { cause: new Error("PREPARATION_DEADLINE_EXCEEDED") });
    return createCompilation({
      native, nativeActions, progressive, integrity, roles,
      rawBrief,
      compiledBrief,
      policyDecision,
      compilerModel: model,
      compilerResponseId: stringOrNull(response.id),
      displayObjective,
      revision
    });
  }

  async #isFlaggedByModeration(
    rawBrief: RawCallBrief,
    deadline: number,
    requestBudget: ProviderRequestBudget
  ) {
    return this.#isFlaggedByModerationText(
      [
        rawBrief.recipientName,
        rawBrief.representedPerson,
        rawBrief.objective,
        rawBrief.context,
        rawBrief.deliveryInstruction,
        ...rawBrief.clarificationAnswers.map(({ answer }) => answer),
        ...rawBrief.allowedFacts
      ].join("\n"),
      deadline,
      "input_moderation",
      requestBudget
    );
  }

  async #isFlaggedByModerationText(
    input: string,
    deadline: number,
    stage: Extract<BriefCompilerStage, "input_moderation" | "output_moderation">,
    requestBudget: ProviderRequestBudget
  ) {
    const response = await this.#request(
      this.#moderationEndpoint,
      {
        model: "omni-moderation-latest",
        input
      },
      deadline,
      stage,
      "omni-moderation-latest",
      requestBudget
    );
    const payload = response as {
      results?: Array<{ flagged?: unknown;categories?:unknown }>;
    };
    const flagged = payload.results?.[0]?.flagged;
    if (typeof flagged !== "boolean") {
      throw new BriefCompilerError("OPENAI_RESPONSE_INVALID");
    }
    return {flagged,categories:moderationIssueCategories(payload.results?.[0]?.categories)};
  }

  async #requestCompilation(
    rawBrief: RawCallBrief,
    validationFeedback: string[],
    deadline: number,
    requestBudget: ProviderRequestBudget,
    currentDateTime: string
  ) {
    const native = requestBudget.policy?.promptVersion !== "preparation-2026-10-05";
    const nativeActions = isNativeActionsPolicy(requestBudget.policy?.promptVersion);
    const instructions = requestBudget.policy?.promptVersion === NATIVE_ROLES_POLICY ? rolesCompilerInstructions
      : isProgressivePolicy(requestBudget.policy?.promptVersion) ? progressiveCompilerInstructions
      : nativeActions ? nativeActionsCompilerInstructions : native ? nativeCompilerInstructions : compilerInstructions;
    return (await this.#request(
      this.#responsesEndpoint,
      {
        model: requestBudget.policy?.generation.model ?? this.model,
        store: false,
        max_output_tokens: requestBudget.policy?.maxOutputTokens ?? 20_000,
        reasoning: { effort: "low" },
        input: [
          {
            role: "system",
            content: validationFeedback.length
              ? `${instructions}\n\nTrusted current date/time: ${currentDateTime}. Default appointment time zone: Europe/Zurich.\nThe previous output failed local validation. Regenerate the complete plan and correct every issue below:\n- ${validationFeedback.join("\n- ")}`
              : `${instructions}\n\nTrusted current date/time: ${currentDateTime}. Default appointment time zone: Europe/Zurich.`
          },
          {
            role: "user",
            content: JSON.stringify({
              callLocale: rawBrief.locale,
              fallbackLocale: rawBrief.fallbackLocale ?? null,
              allowLanguageSwitch: rawBrief.allowLanguageSwitch,
              recipientName: rawBrief.recipientName,
              representedPerson: rawBrief.representedPerson,
              assistanceReason: rawBrief.assistanceReason,
              objective: rawBrief.objective,
              context: rawBrief.context,
              approvedFacts: rawBrief.allowedFacts,
              resultHandling: rawBrief.resultHandling,
              addressingMode: rawBrief.addressingMode,
              tonePreference: rawBrief.tonePreference,
              voicemailPolicy: rawBrief.voicemailPolicy,
              deliveryInstruction: rawBrief.deliveryInstruction,
              clarificationAnswers: rawBrief.clarificationAnswers
            })
          }
        ],
        text: {
          verbosity: "low",
          format: {
            type: "json_schema",
            name: "callassist_compiled_brief",
            strict: true,
            schema: nativeActions ? nativeActionsModelSchema : native ? nativeModelCompiledBriefJsonSchema : modelCompiledBriefJsonSchema
          }
        }
      },
      deadline,
      requestBudget.repairNumber > 0 ? "compilation_repair" : "compilation",
      requestBudget.policy?.generation.model ?? this.model,
      requestBudget
    )) as OpenAIResponsePayload;
  }

  async #request(endpoint: string, body: unknown, deadline: number, stage: BriefCompilerStage,
    model: string, budget: ProviderRequestBudget) {
    const paid = ["compilation", "compilation_repair", "language_audit"].includes(stage);
    const profile = stage === "language_audit" ? budget.policy?.audit : budget.policy?.generation;
    const tier = paid ? profile?.serviceTier ?? "default" : undefined;
    const deadlineController = new AbortController();
    const deadlineTimer = setTimeout(() => deadlineController.abort(new DOMException("Preparation deadline reached", "TimeoutError")), Math.max(0,deadline-Date.now()));
    const deadlineSignal = AbortSignal.any([deadlineController.signal, ...(budget.signal ? [budget.signal] : [])]);
    try {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (Date.now() >= deadline || deadlineSignal.aborted) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { stage });
      const clientRequestId = randomUUID(), reservedAt = Date.now();
      const remainingMs = Math.max(0, deadline - reservedAt);
      const timeoutMs = Math.min(this.#requestTimeoutMs ?? (paid ? budget.policy?.requestTimeoutMs ?? defaultGenerationRequestTimeoutMs : defaultModerationRequestTimeoutMs), remainingMs);
      const requestMetadata: PreparationRequestMetadata = { repairKind: budget.repairKind, repairNumber: budget.repairNumber,
        transportAttempt: attempt + 1, timeoutMs, remainingMs };
      if (budget.used >= budget.max) throw new BriefCompilerError("OPENAI_REQUEST_BUDGET_EXHAUSTED", { clientRequestId, stage });
      const requestBody = JSON.stringify(paid ? { ...(body as object), model, service_tier: tier, stream: true } : body);
      const reserveUsdMicros = paid && profile ? preparationRequestReserve(profile, Buffer.byteLength(requestBody),
        Number((body as { max_output_tokens?: number }).max_output_tokens ?? 20000)) : undefined;
      // Reservation is part of the preparation deadline, including a slow SQL pool.
      if (budget.beforeProviderRequest && !await awaitWithAbort(budget.beforeProviderRequest({ clientRequestId, stage,
        operationType: paid ? "brief_compilation" : "brief_moderation", provider: "openai", model,
        startedAt: new Date(reservedAt).toISOString(), requestMetadata, requestedServiceTier: tier,
        pricingVersion: budget.policy?.pricingVersion, reserveUsdMicros,
        estimatedTokens: Buffer.byteLength(requestBody) + 4096 + (paid ? Number((body as { max_output_tokens?: number }).max_output_tokens ?? 20000) : 0) }), deadlineSignal)) {
        throw new BriefCompilerError("OPENAI_REQUEST_BUDGET_EXHAUSTED", { clientRequestId, stage });
      }
      budget.used++;
      const started = Date.now();
      const actualTimeout = Math.max(0, Math.min(timeoutMs, deadline - started));
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, deadlineSignal]);
      const timer = setTimeout(() => controller.abort(new DOMException("Provider request timed out", "TimeoutError")), actualTimeout);
      const diagnostics = new PreparationRequestDiagnostics(started - reservedAt, actualTimeout, Buffer.byteLength(requestBody));
      let response: Response | undefined, payload: Record<string, unknown> | null = null, error: unknown;
      let requestId: string | null = null, responseId: string | null = null, actualTier: string | null = null;
      const seen = new Set<PreparationCheckpoint["kind"]>();
      const checkpoint = async (kind: PreparationCheckpoint["kind"]) => {
        if (!budget.checkpoint || seen.has(kind)) return;
        seen.add(kind);
        const parsed = preparationCheckpointSchema.safeParse({ version: 1, kind, elapsedMs: Math.max(0, Date.now() - started),
          providerRequestId: requestId, providerResponseId: responseId, actualServiceTier: actualTier });
        if (parsed.success) {
          try { await awaitWithAbort(budget.checkpoint(clientRequestId, parsed.data), deadlineSignal); }
          catch (cause) {
            deadlineSignal.throwIfAborted();
            writePiiSafeOperationalError("preparation_checkpoint_failed", cause);
          }
        }
      };
      try {
        if (Date.now() >= deadline) throw new DOMException("Preparation deadline reached", "TimeoutError");
        signal.throwIfAborted();
        await checkpoint("dispatched");
        response = await awaitWithAbort(diagnostics.run(() => this.#fetch(endpoint, { method: "POST",
          headers: { Authorization: `Bearer ${this.#apiKey}`, "Content-Type": "application/json", "X-Client-Request-Id": clientRequestId },
          body: requestBody, signal })), signal);
        diagnostics.headers(response);
        requestId = response.headers.get("x-request-id");
        await checkpoint("headers");
        if (response.ok) {
          diagnostics.bodyStarted();
          if (paid && response.headers.get("content-type")?.toLowerCase().includes("text/event-stream")) diagnostics.streamStarted();
          const value = await awaitWithAbort(readProviderResponse(response, signal, async (type, eventResponse, outputBytes) => {
            signal.throwIfAborted();
            diagnostics.streamOutput(outputBytes);
            responseId = stringOrNull(eventResponse?.id) ?? responseId;
            actualTier = serviceTier(eventResponse?.service_tier) ?? actualTier;
            await checkpoint("first_event");
            if (type === "response.created") await checkpoint("response_created");
            if (type === "response.output_text.delta") await checkpoint("first_output");
            if (["response.completed", "response.failed", "response.incomplete"].includes(type)) await checkpoint("terminal");
          }), signal);
          payload = objectOrNull(value);
          responseId = stringOrNull(payload?.id) ?? responseId;
          actualTier = serviceTier(payload?.service_tier) ?? actualTier;
          if (!payload || (paid && payload.status !== undefined && payload.status !== "completed")) throw new ResponseReadError("OPENAI_STREAM_FAILED", payload);
        }
      } catch (cause) {
        error = cause; diagnostics.failed(cause);
        if (cause instanceof ResponseReadError && cause.response) payload = cause.response;
      } finally {
        clearTimeout(timer);
        // Always release rejected/aborted responses, including 429 and 503.
        if (response?.body && !response.body.locked) await response.body.cancel().catch(() => undefined);
      }
      const delay = response ? providerBackoffMs(response.headers) : 0;
      const invalid = error instanceof ResponseReadError || error instanceof SyntaxError;
      const result: BriefCompilerProviderRequestResult = {
        diagnostics: diagnostics.finish(), clientRequestId, stage,
        outcome: error ? invalid ? "invalid_response" : "network_error" : response?.ok ? "succeeded" : "provider_error",
        providerRequestId: requestId, providerResponseId: responseId, providerModel: stringOrNull(payload?.model),
        actualServiceTier: actualTier, retryAfterMs: delay,
        statusCode: response?.status ?? null, completedAt: new Date().toISOString(), durationMs: Math.max(0, Date.now() - started),
        errorCode: error ? error instanceof ResponseReadError && error.code === "OPENAI_STREAM_PADDING" ? error.code : invalid ? "OPENAI_RESPONSE_INVALID" : signal.aborted || isTimeoutError(error)
          ? response ? "OPENAI_BODY_TIMEOUT" : "OPENAI_RESPONSE_TIMEOUT" : "OPENAI_NETWORK_ERROR"
          : response?.ok ? null : `OPENAI_HTTP_${response?.status ?? 0}`,
        usage: parseOpenAITextTokenUsage(payload?.usage)
      };
      // Accounting may finish late, but the caller must never publish after its deadline.
      await awaitWithAbort(completeProviderRequest(budget, result), deadlineSignal);
      if (Date.now() >= deadline || budget.signal?.aborted) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { stage, clientRequestId });
      if ((!error && response?.ok) || (error instanceof ResponseReadError && payload?.status === "incomplete")) return payload;
      const status = response?.status ?? null;
      // A provider cooldown is persisted and deferred to the durable queue, never slept in a slot.
      if (status === 429 || delay > 0) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", {
        stage, clientRequestId, statusCode: status, retryAfterMs: Math.max(1000, delay) + Math.floor(Math.random() * 251) });
      if (invalid) throw new BriefCompilerError("OPENAI_RESPONSE_INVALID", { stage, clientRequestId, responseId, cause: error,
        validationPaths: error instanceof ResponseReadError && error.code === "OPENAI_STREAM_PADDING" ? ["stream_padding"] : [] });
      if (attempt === 0 && !budget.signal?.aborted && (error || (status !== null && isRetryableOpenAIStatus(status)))) continue;
      throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { stage, clientRequestId, responseId, statusCode: status, cause: error });
    }
    throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { stage });
    } catch (error) {
      if (deadlineSignal.aborted) throw new BriefCompilerError("OPENAI_REQUEST_FAILED", { stage, cause: error });
      throw error;
    } finally { clearTimeout(deadlineTimer); }
  }

}

export class DeterministicBriefCompiler implements BriefCompiler {
  readonly model = "deterministic-dev";

  async compile(input: NormalizedCallBriefInput, revision = 1, options: BriefCompilerRunOptions = {}) {
    const native = options.policy?.promptVersion !== "preparation-2026-10-05";
    const nativeActions=isNativeActionsPolicy(options.policy?.promptVersion);
    const progressive = isProgressivePolicy(options.policy?.promptVersion), integrity = isIntegrityPolicy(options.policy?.promptVersion);
    const roles = options.policy?.promptVersion === NATIVE_ROLES_POLICY;
    const rawBrief = (native ? createCallBriefInputSchema : storedCallBriefInputSchema).parse(input);
    const compiledBrief = compiledCallBriefSchema.parse({
      schemaVersion: nativeActions?"9":CALL_BRIEF_SCHEMA_VERSION,
      ...(nativeActions?{nativeAppointmentAuthorization:null}:{}),
      appointmentAuthorization: null,
      callLocale: rawBrief.locale,
      sourceLanguage: "und",
      taskType: deterministicMockAppointmentIntent(rawBrief) ? "appointment_coordination" : "information_request",
      tone: rawBrief.tonePreference === "auto" ? "neutral" : rawBrief.tonePreference,
      addressingStyle:
        rawBrief.addressingMode === "auto" ? "formal" : rawBrief.addressingMode,
      resultHandling: rawBrief.resultHandling,
      voicemailAction:
        rawBrief.voicemailPolicy === "leave_neutral_message"
          ? "leave_neutral_message"
          : "hang_up",
      refusalBehavior: "respect_and_end",
      localizedObjective: rawBrief.objective,
      opening: buildDeterministicOpening(rawBrief),
      backgroundSummary: [rawBrief.representedPerson, rawBrief.context].filter(Boolean).join("\n"),
      orderedQuestions: [
        {
          text: rawBrief.objective,
          purpose: "Complete the operator's stated objective",
          required: true
        }
      ],
      conditionalFollowUps: [],
      successCriteria: ["The recipient provides a clear answer to the question"],
      unresolvedCriteria: ["The recipient cannot provide a clear answer"],
      stopConditions: [
        "The objective is resolved",
        "The recipient asks to end the call"
      ],
      approvedFacts: rawBrief.allowedFacts.map((fact) => ({
        sourceText: fact,
        callLanguageText: fact
      })),
      prohibitedActions: [
        "Do not invent facts or make commitments outside the approved brief"
      ],
      namedEntities: [],
      riskCategories: [],
      assumptions: deriveProductAssumptions(rawBrief),
      blockingIssues: deterministicMockAppointmentIntent(rawBrief) ? [{ code: "missing_scheduling_constraints", question: appointmentClarification(rawBrief) }] : []
    });
    return createCompilation({
      native, nativeActions, progressive, integrity, roles,
      rawBrief,
      compiledBrief,
      policyDecision: evaluateCompiledBrief(rawBrief, compiledBrief, {
        intent: deterministicMockAppointmentIntent(rawBrief) ?? "none", calendarDates: [],
        missingSchedulingConstraints: deterministicMockAppointmentIntent(rawBrief) !== null, authorizationMismatch: false
      }),
      compilerModel: this.model,
      compilerResponseId: null,
      revision
    });
  }
}

export function evaluateCompiledBrief(
  rawBrief: RawCallBrief,
  compiledBrief: CompiledCallBrief,
  context?: AppointmentCompilationContext
): PolicyDecision {
  const sourceFacts = compiledBrief.approvedFacts.map(
    ({ sourceText }) => sourceText
  );
  const factIntegrity =
    sourceFacts.length === rawBrief.allowedFacts.length &&
    sourceFacts.every((fact, index) => fact === rawBrief.allowedFacts[index]) &&
    compiledBrief.approvedFacts.every(({ sourceText, callLanguageText }) =>
      protectedIdentifiers(sourceText).every((identifier) =>
        callLanguageText.includes(identifier)
      )
    );

  if (!factIntegrity) return blockedDecision("fact_integrity_failure");
  const executionText = buildRuntimeIntegrityText(compiledBrief);
  const objectiveIdentifiers = protectedIdentifiers(rawBrief.objective);
  const executionIdentifiers = protectedIdentifiers(executionText);
  if (!objectiveIdentifiers.every((identifier) => executionText.includes(identifier) ||
    (canonicalAppointmentDate(identifier) !== null && executionIdentifiers.some((candidate) =>
      canonicalAppointmentDate(candidate) === canonicalAppointmentDate(identifier))))) {
    return blockedDecision("fact_integrity_failure");
  }
  const sourceText = [
    rawBrief.recipientName,
    rawBrief.representedPerson,
    rawBrief.objective,
    rawBrief.context,
    rawBrief.deliveryInstruction,
    ...rawBrief.allowedFacts,
    ...rawBrief.clarificationAnswers.map(({ answer }) => answer)
  ].join("\n");
  const appointment = getAppointmentAuthorization(compiledBrief);
  // Production always supplies validated compilation-only semantic context. Legacy stored plans retain their typed authority.
  const requestedOperation = context?.intent ?? appointment?.operation ?? "none";
  if (context?.authorizationMismatch || (appointment && (compiledBrief.schemaVersion === "3" || compiledBrief.taskType !== "appointment_coordination" || appointment.operation !== requestedOperation))) {
    return blockedDecision("plan_constraint_failure");
  }
  // Native action snapshots supply the original identities separately to Live.
  // An equivalent declared identity need not also occur in the spoken task prose;
  // the entity-source check below still rejects invented or altered declarations.
  if (![rawBrief.recipientName, rawBrief.representedPerson].every(value =>
    preservesIdentityLabel(value, executionText, sourceText) ||
    (compiledBrief.schemaVersion === "9" && compiledBrief.namedEntities.some(entity =>
      ["person", "organisation", "location"].includes(entity.type) &&
      equivalentIdentityLabel(value, entity.value, sourceText)))) ||
    !protectedPostalAddresses(sourceText).every(value => executionText.includes(value))) {
    return blockedDecision("fact_integrity_failure");
  }
  if (!protectedPostalAddresses(executionText).every((address) =>
    sourceText.includes(address)
  )) {
    return blockedDecision("fact_integrity_failure");
  }
  if (compiledBrief.namedEntities.some(({ type, value }) =>
    ["person", "organisation", "location"].includes(type) &&
    !sourceText.includes(value) && ![rawBrief.recipientName, rawBrief.representedPerson].some(original =>
      equivalentIdentityLabel(original, value, sourceText))
  )) {
    return blockedDecision("fact_integrity_failure");
  }
  if (
    !protectedIdentifiers(executionText).every((identifier) =>
      sourceText.includes(identifier) || isAuthorizedAppointmentDateIdentifier(identifier, appointment, context?.calendarDates) ||
      (compiledBrief.schemaVersion === "9" && canonicalAppointmentDate(identifier) !== null &&
        (compiledBrief.nativeAppointmentAuthorization?.existingAppointment?.date === canonicalAppointmentDate(identifier) ||
         compiledBrief.nativeAppointmentAuthorization?.alternatives.some(a=>a.rules.some(r=>nativeAppointmentRuleContains(r,canonicalAppointmentDate(identifier)!))))) ||
      (canonicalAppointmentDate(identifier) !== null && protectedIdentifiers(sourceText).some((source) =>
        canonicalAppointmentDate(source) === canonicalAppointmentDate(identifier)))
    )
  ) {
    return blockedDecision("fact_integrity_failure");
  }
  const expectedVoicemailAction =
    rawBrief.voicemailPolicy === "leave_neutral_message"
      ? "leave_neutral_message"
      : "hang_up";
  if (
    compiledBrief.resultHandling !== rawBrief.resultHandling ||
    compiledBrief.voicemailAction !== expectedVoicemailAction ||
    (rawBrief.addressingMode !== "auto" &&
      compiledBrief.addressingStyle !== rawBrief.addressingMode) ||
    (rawBrief.tonePreference !== "auto" &&
      compiledBrief.tone !== rawBrief.tonePreference)
  ) {
    return blockedDecision("plan_constraint_failure");
  }
  if (compiledBrief.taskType === "unsupported") {
    return blockedDecision("unsupported_task");
  }
  if (compiledBrief.riskCategories.length > 0) {
    return blockedDecision("prohibited_content");
  }
  if (compiledBrief.blockingIssues.length > 0) {
    return {
      policyVersion: CALL_POLICY_VERSION,
      status: "needs_clarification",
      riskLevel: "low",
      reasonCodes: ["required_information_missing"],
      clarificationQuestions: compiledBrief.blockingIssues.map(
        ({ question }) => question
      )
    };
  }
  if (context?.missingSchedulingConstraints || (requestedOperation !== "none" && !appointment)) {
    return { policyVersion: CALL_POLICY_VERSION, status: "needs_clarification", riskLevel: "low",
      reasonCodes: ["required_information_missing"], clarificationQuestions: [appointmentClarification(rawBrief, compiledBrief.sourceLanguage)] };
  }
  return {
    policyVersion: CALL_POLICY_VERSION,
    status: "ready_for_review",
    riskLevel: "low",
    reasonCodes: [],
    clarificationQuestions: []
  };
}

function blockedDecision(
  code: PolicyDecision["reasonCodes"][number]
): PolicyDecision {
  return {
    policyVersion: CALL_POLICY_VERSION,
    status: "blocked",
    riskLevel: "high",
    reasonCodes: [code],
    clarificationQuestions: []
  };
}

function createCompilation(input: {
  native?: boolean;
  nativeActions?: boolean;
  progressive?: boolean;
  integrity?:boolean;
  roles?: boolean;
  rawBrief: RawCallBrief;
  compiledBrief: CompiledCallBrief | null;
  policyDecision: PolicyDecision;
  compilerModel: string;
  compilerResponseId: string | null;
  displayObjective?: CallCompilation["displayObjective"];
  revision: number;
}): CallCompilation {
  const { native = true, nativeActions = false, progressive = false, integrity=false, roles = false, ...original } = input;
  const compilerVersion = roles ? "brief-compiler-14" : integrity?"brief-compiler-13":progressive ? "brief-compiler-12" : nativeActions ? "brief-compiler-11" : native ? BRIEF_COMPILER_VERSION : "brief-compiler-6";
  if(integrity&&original.policyDecision.status!=="ready_for_review"){
    const decision=original.policyDecision,code=decision.reasonCodes[0]??"model_refusal";
    const categories=original.compiledBrief?.riskCategories??[];
    const issue:PreparationIssue=("issue" in decision?decision.issue:undefined)??preparationIssue(code,categories.length||code==="unsupported_task"?"product_policy":"compiler",categories);
    original.policyDecision={...decision,policyVersion:CALL_POLICY_VERSION,issue,riskLevel:issue.kind==="policy_restriction"?"high":"low"};
  }
  const normalized = { ...original, compiledBrief: !native && original.compiledBrief
    ? previousCompiledCallBriefSchema.parse({ ...original.compiledBrief, schemaVersion: "4" }) : original.compiledBrief };
  return {
    ...normalized,
    compilerVersion,
    compiledAt: new Date().toISOString(),
    approvedAt: null,
    snapshotHash: createCompilationSnapshotHash({
      ...normalized,
      compilerVersion
    })
  };
}

export function protectedIdentifiers(sourceText: string) {
  const matches = new Set<string>();
  const patterns = [
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    /\+\d[\d ()/.-]{6,}\d/g,
    /\b\d{1,4}[./-]\d{1,2}[./-]\d{1,4}\b/g,
    /\b(?=[A-Z0-9][A-Z0-9._/-]{3,}\b)(?=[A-Z0-9._/-]*[A-Z])(?=[A-Z0-9._/-]*\d)[A-Z0-9]+(?:[._/-][A-Z0-9]+)+\b/gi,
    /\b(?=[A-Z0-9]{6,}\b)(?=[A-Z0-9]*[A-Z])(?=[A-Z0-9]*\d)[A-Z0-9]{6,}\b/gi,
    /\b\d{6,}\b/g
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      matches.add(match[0].replace(/[.,;:]+$/, ""));
    }
  }
  return [...matches];
}

export function protectedPostalAddresses(sourceText: string) {
  const matches = new Set<string>();
  const streetSuffix = String.raw`(?:strasse|stra\u00dfe|weg|gasse|platz|allee|quai|via|viale|piazza|chemin)`;
  const streetPrefix = String.raw`(?:rue|route|via|viale|piazza|chemin)`;
  const streetWord = String.raw`[\p{L}][\p{L}'\u2019.-]*`;
  const locality = String.raw`(?:[ \t]*,?[ \t]*[1-9]\d{3}[ \t]+[\p{L}][\p{L}'\u2019.-]*(?:[ \t]+[\p{L}][\p{L}'\u2019.-]*){0,3})?`;
  const patterns = [
    new RegExp(
      String.raw`\b${streetWord}${streetSuffix}[ \t]+\d{1,4}[A-Za-z]?${locality}`,
      "giu"
    ),
    new RegExp(
      String.raw`\b${streetPrefix}[ \t]+${streetWord}(?:[ \t]+${streetWord}){0,3}[ \t]+\d{1,4}[A-Za-z]?${locality}`,
      "giu"
    )
  ];
  for (const pattern of patterns) {
    for (const match of sourceText.matchAll(pattern)) {
      matches.add(match[0].replace(/[.,;:]+$/, ""));
    }
  }
  return [...matches];
}

function buildRuntimeIntegrityText(compiled: CompiledCallBrief) {
  const plan = createApprovedExecutionPlan(compiled);
  return [
    plan.localizedObjective,
    plan.opening.recipientAddress,
    plan.opening.purposeStatement,
    plan.opening.readinessQuestion,
    plan.backgroundSummary,
    ...plan.orderedQuestions.flatMap(({ text, purpose }) => [text, purpose]),
    ...plan.conditionalFollowUps.flatMap(({ condition, question }) => [
      condition,
      question
    ]),
    ...plan.successCriteria,
    ...plan.unresolvedCriteria,
    ...plan.stopConditions,
    ...plan.approvedFacts,
    ...plan.prohibitedActions,
    getAppointmentAuthorization(plan)?.serviceDescription ?? "",
    ...(compiled.schemaVersion==="9"&&compiled.nativeAppointmentAuthorization?[compiled.nativeAppointmentAuthorization.serviceDescription,...compiled.nativeAppointmentAuthorization.requirements.map(r=>r.description),...compiled.nativeAppointmentAuthorization.alternatives.flatMap(a=>a.requirements.map(r=>r.description))]:[])
  ].join("\n");
}

function extractRefusal(payload: OpenAIResponsePayload) {
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "refusal" && typeof content.refusal === "string") {
        return content.refusal;
      }
    }
  }
  return null;
}

function extractOutputText(payload: OpenAIResponsePayload) {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text;
  }
  for (const output of payload.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  throw new BriefCompilerError("OPENAI_RESPONSE_INVALID");
}

function parseCompiledBriefResponse(
  response: OpenAIResponsePayload,
  rawBrief: RawCallBrief,
  now: Date,
  nativeActions = false
):
  | { success: true; data: CompiledCallBrief; context: AppointmentCompilationContext; displayObjective?: CallCompilation["displayObjective"] }
  | {
      success: false;
      cause: unknown;
      validationPaths: string[];
      validationFeedback: string[];
    } {
  let modelOutput: unknown;
  if (response.status !== undefined && response.status !== "completed") {
    return {
      success: false,
      cause: new Error("Incomplete compiler response"),
      validationPaths: ["output"],
      validationFeedback: ["output: the previous response was incomplete; return one complete compact JSON object without indentation or padding, keeping the plan proportional to the task"]
    };
  }
  try {
    modelOutput = JSON.parse(extractOutputText(response));
  } catch (cause) {
    return {
      success: false,
      cause,
      validationPaths: ["output"],
      validationFeedback: ["output: return one complete JSON object"]
    };
  }

  const appointment = nativeActions ? prepareNativeAppointmentOutput(modelOutput, rawBrief, now) : prepareAppointmentModelOutput(modelOutput, rawBrief, now);
  if (!appointment.success) return { success: false, cause: new Error(appointment.message),
    validationPaths: [appointment.path], validationFeedback: [`${appointment.path}: ${appointment.message}`] };
  const parsed = (nativeActions ? nativeActionCompiledCallBriefSchema : currentCompiledCallBriefSchema).safeParse({
    ...appointment.output,
    schemaVersion: nativeActions ? "9" : CALL_BRIEF_SCHEMA_VERSION,
    callLocale: rawBrief.locale,
    assumptions: deriveProductAssumptions(rawBrief)
  });
  if (parsed.success) {
    const sourceObjective = modelOutput && typeof modelOutput === "object" && "sourceObjective" in modelOutput ? modelOutput.sourceObjective : undefined;
    const displayObjective = typeof sourceObjective === "string" && sourceObjective.trim().length > 0 && sourceObjective.length <= 2000
      ? { text: sourceObjective.trim(), language: parsed.data.sourceLanguage } : undefined;
    return { success: true, data: parsed.data, context: appointment.context, displayObjective };
  }

  const validationPaths = [
    ...new Set(
      parsed.error.issues.map(({ path }) => path.join(".") || "output")
    )
  ];
  return {
    success: false,
    cause: parsed.error,
    validationPaths,
    validationFeedback: parsed.error.issues.map(
      ({ path, message }) => `${path.join(".") || "output"}: ${message}`
    )
  };
}

export function isRetryableOpenAIStatus(status: number) {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

export function isBriefCompilerErrorRetryable(error: BriefCompilerError) {
  if (
    error.code === "OPENAI_RESPONSE_INVALID" ||
    error.code === "OPENAI_REQUEST_BUDGET_EXHAUSTED"
  ) return false;
  return error.statusCode === null || isRetryableOpenAIStatus(error.statusCode);
}

function serviceTier(value: unknown): string | null {
  return typeof value === "string" ? (["default", "fast", "priority", "flex", "auto"].includes(value) ? value : "unknown") : null;
}

type ProviderRequestBudget = {
  policy?: PreparationRuntimePolicy;
  signal?: AbortSignal;
  checkpoint?: BriefCompilerRunOptions["checkpoint"];
  used: number;
  max: number;
  repairKind: PreparationRequestMetadata["repairKind"];
  repairNumber: number;
  beforeProviderRequest?: BriefCompilerRunOptions["beforeProviderRequest"];
  afterProviderRequest?: BriefCompilerRunOptions["afterProviderRequest"];
};

function createRequestBudget(
  options: BriefCompilerRunOptions
): ProviderRequestBudget {
  const max = options.maxProviderRequests ??
    briefCompilationProviderRequestBudget;
  if (!Number.isSafeInteger(max) || max < 0) {
    throw new TypeError("maxProviderRequests must be a non-negative integer");
  }
  return {
    used: 0,
    policy: options.policy, signal: options.signal, checkpoint: options.checkpoint,
    max,
    repairKind: "none",
    repairNumber: 0,
    ...(options.beforeProviderRequest
      ? { beforeProviderRequest: options.beforeProviderRequest }
      : {}),
    ...(options.afterProviderRequest
      ? { afterProviderRequest: options.afterProviderRequest }
      : {})
  };
}

async function completeProviderRequest(
  requestBudget: ProviderRequestBudget,
  result: BriefCompilerProviderRequestResult
) {
  await requestBudget.afterProviderRequest?.(result);
}

export function parseOpenAITextTokenUsage(
  value: unknown
): OpenAITextTokenUsage | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const usage = value as Record<string, unknown>;
  const inputDetails = objectOrNull(usage.input_tokens_details);
  const outputDetails = objectOrNull(usage.output_tokens_details);
  const parsed = {
    inputTextTokens: nonNegativeIntegerOrNull(usage.input_tokens),
    cachedInputTextTokens: nonNegativeIntegerOrNull(
      inputDetails?.cached_tokens
    ),
    cacheWriteInputTextTokens: nonNegativeIntegerOrNull(
      inputDetails?.cache_write_tokens
    ),
    outputTextTokens: nonNegativeIntegerOrNull(usage.output_tokens),
    reasoningOutputTokens: nonNegativeIntegerOrNull(
      outputDetails?.reasoning_tokens
    ),
    totalTokens: nonNegativeIntegerOrNull(usage.total_tokens),
    rawUsage: usage
  };
  return [
    parsed.inputTextTokens,
    parsed.cachedInputTextTokens,
    parsed.cacheWriteInputTextTokens,
    parsed.outputTextTokens,
    parsed.reasoningOutputTokens,
    parsed.totalTokens
  ].every((entry) => entry === null)
    ? null
    : parsed;
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function nonNegativeIntegerOrNull(value: unknown) {
  return Number.isSafeInteger(value) && (value as number) >= 0
    ? value as number
    : null;
}

function isTimeoutError(error: unknown) {
  return (
    error instanceof Error &&
    (error.name === "TimeoutError" || error.message === "BRIEF_COMPILATION_TIMEOUT")
  );
}

/** Also bounds injected transports/body readers that fail to propagate fetch's AbortSignal themselves. */
function awaitWithAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? new DOMException("Request aborted", "AbortError"));
    if (signal.aborted) {
      operation.catch(() => undefined);
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

const compilerInstructions = buildCompilerInstructions("legacy");
export const modelCompiledBriefJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "appointmentAuthorization",
    "schedulingInterpretation",
    "sourceLanguage",
    "sourceObjective",
    "taskType",
    "tone",
    "addressingStyle",
    "resultHandling",
    "voicemailAction",
    "refusalBehavior",
    "localizedObjective",
    "opening",
    "backgroundSummary",
    "orderedQuestions",
    "conditionalFollowUps",
    "successCriteria",
    "unresolvedCriteria",
    "stopConditions",
    "approvedFacts",
    "prohibitedActions",
    "namedEntities",
    "riskCategories",
    "blockingIssues"
  ],
  properties: {
    appointmentAuthorization: modelAppointmentAuthorizationJsonSchema,
    schedulingInterpretation: modelSchedulingInterpretationJsonSchema,
    sourceLanguage: {
      type: "string",
      minLength: 2,
      maxLength: 35,
      pattern: "^[A-Za-z0-9-]{2,35}$",
      description: "Short language tag such as ru, uk, de, de-CH, or und"
    },
    taskType: {
      type: "string",
      enum: [
        "information_request",
        "receipt_confirmation",
        "appointment_coordination",
        "document_requirements",
        "neutral_message",
        "unsupported"
      ]
    },
    tone: { type: "string", enum: ["formal", "neutral", "friendly"] },
    addressingStyle: { type: "string", enum: ["formal", "informal"] },
    resultHandling: {
      type: "string",
      enum: [
        "capture_in_callassist",
        "request_external_delivery",
        "message_only"
      ]
    },
    voicemailAction: {
      type: "string",
      enum: ["hang_up", "leave_neutral_message"]
    },
    refusalBehavior: { type: "string", enum: ["respect_and_end"] },
    sourceObjective: { type: "string", minLength: 1, maxLength: 2_000 },
    localizedObjective: { type: "string", minLength: 10, maxLength: 2_000 },
    opening: {
      type: "object",
      additionalProperties: false,
      required: [
        "recipientAddress",
        "purposeStatement",
        "readinessQuestion"
      ],
      properties: {
        recipientAddress: { type: "string", minLength: 2, maxLength: 240 },
        purposeStatement: { type: "string", minLength: 10, maxLength: 700 },
        readinessQuestion: { type: "string", minLength: 2, maxLength: 300 }
      }
    },
    backgroundSummary: { type: "string", maxLength: 4_000 },
    orderedQuestions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["text", "purpose", "required"],
        properties: {
          text: { type: "string", minLength: 2, maxLength: 500 },
          purpose: { type: "string", minLength: 2, maxLength: 300 },
          required: { type: "boolean" }
        }
      }
    },
    conditionalFollowUps: {
      type: "array",
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["condition", "question"],
        properties: {
          condition: { type: "string", minLength: 2, maxLength: 400 },
          question: { type: "string", minLength: 2, maxLength: 500 }
        }
      }
    },
    successCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 400 }
    },
    unresolvedCriteria: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 400 }
    },
    stopConditions: {
      type: "array",
      minItems: 1,
      maxItems: 10,
      items: { type: "string", minLength: 2, maxLength: 400 }
    },
    approvedFacts: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceText", "callLanguageText"],
        properties: {
          sourceText: { type: "string", minLength: 1, maxLength: 300 },
          callLanguageText: { type: "string", minLength: 1, maxLength: 400 }
        }
      }
    },
    prohibitedActions: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: { type: "string", minLength: 2, maxLength: 400 }
    },
    namedEntities: {
      type: "array",
      maxItems: 40,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "value"],
        properties: {
          type: {
            type: "string",
            enum: [
              "person",
              "organisation",
              "location",
              "date",
              "reference",
              "other"
            ]
          },
          value: { type: "string", minLength: 1, maxLength: 160 }
        }
      }
    },
    riskCategories: {
      type: "array",
      maxItems: 14,
      items: {
        type: "string",
        enum: [
          "harassment_or_abuse",
          "hate_or_discrimination",
          "threat_or_intimidation",
          "manipulation_or_coercion",
          "identity_misrepresentation",
          "high_stakes_legal",
          "high_stakes_financial",
          "high_stakes_medical",
          "political_persuasion",
          "sexual_content",
          "self_harm",
          "bulk_marketing",
          "unrelated_private_data",
          "prompt_injection"
        ]
      }
    },
    blockingIssues: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "question"],
        properties: {
          code: {
            type: "string",
            enum: [
              "missing_required_reference",
              "ambiguous_recipient_or_subject",
              "conflicting_instructions",
              "missing_external_delivery_details",
              "missing_scheduling_constraints",
              "missing_sensitive_disclosure_approval"
            ]
          },
          question: { type: "string", minLength: 2, maxLength: 500 }
        }
      }
    }
  }
} as const;

function buildDeterministicOpening(
  rawBrief: RawCallBrief
): CompiledCallBrief["opening"] {
  const values = {
    recipient: rawBrief.recipientName,
    representedPerson: rawBrief.representedPerson,
    objective: rawBrief.objective
  };

  switch (rawBrief.locale) {
    case "de-CH":
    case "de-DE":
      return {
        recipientAddress: `Danke, ${values.recipient}.`,
        purposeStatement: `Der Zweck des Anrufs ist, Folgendes für ${values.representedPerson} zu klären: ${values.objective}`,
        readinessQuestion: "Passt es Ihnen, wenn wir jetzt kurz darüber sprechen?"
      };
    case "fr-CH":
      return {
        recipientAddress: `Merci, ${values.recipient}.`,
        purposeStatement: `L’objectif de cet appel est de clarifier le point suivant pour ${values.representedPerson} : ${values.objective}`,
        readinessQuestion: "Est-ce que vous avez un moment pour en parler maintenant ?"
      };
    case "it-CH":
      return {
        recipientAddress: `Grazie, ${values.recipient}.`,
        purposeStatement: `Lo scopo della chiamata è chiarire quanto segue per ${values.representedPerson}: ${values.objective}`,
        readinessQuestion: "È un momento adatto per parlarne brevemente?"
      };
    case "ru-RU":
      return {
        recipientAddress: `Спасибо, ${values.recipient}.`,
        purposeStatement: `Цель звонка — уточнить для ${values.representedPerson} следующее: ${values.objective}`,
        readinessQuestion: "Вам сейчас удобно коротко об этом поговорить?"
      };
    case "en-GB":
    case "en-US":
      return {
        recipientAddress: `Thank you, ${values.recipient}.`,
        purposeStatement: `The purpose of this call is to clarify the following for ${values.representedPerson}: ${values.objective}`,
        readinessQuestion: "Is now a convenient time to talk about it briefly?"
      };
  }
}

function deriveProductAssumptions(rawBrief: RawCallBrief) {
  const assumptions: CompiledCallBrief["assumptions"] = [
    "respect_refusal_and_end"
  ];
  if (rawBrief.resultHandling === "capture_in_callassist") {
    assumptions.push("spoken_answers_saved_in_callassist");
  }
  if (rawBrief.addressingMode === "auto") {
    assumptions.push("addressing_inferred");
  }
  if (rawBrief.tonePreference === "auto") assumptions.push("tone_inferred");
  assumptions.push(
    rawBrief.voicemailPolicy === "leave_neutral_message"
      ? "neutral_voicemail_only"
      : "no_detailed_voicemail"
  );
  return assumptions;
}

function isApplicableBlockingIssue(
  rawBrief: RawCallBrief,
  compiledBrief: CompiledCallBrief,
  code: CompiledCallBrief["blockingIssues"][number]["code"]
) {
  if (code === "missing_external_delivery_details") {
    // The compiler reasons about the objective/context; the legacy UI enum no longer selects delivery.
    return true;
  }
  if (code === "missing_scheduling_constraints") {
    return compiledBrief.taskType === "appointment_coordination";
  }
  return true;
}

function filterApplicableBlockingIssues(
  rawBrief: RawCallBrief,
  compiledBrief: CompiledCallBrief
) {
  const seen = new Set<string>();
  return compiledBrief.blockingIssues.filter((issue) => {
    if (seen.has(issue.code)) return false;
    if (!isApplicableBlockingIssue(rawBrief, compiledBrief, issue.code)) {
      return false;
    }
    seen.add(issue.code);
    return true;
  });
}

function buildRuntimeModerationText(compiled: CompiledCallBrief) {
  return JSON.stringify({ ...createApprovedExecutionPlan(compiled),
    ...("contextAppendix" in compiled ? { contextAppendix: compiled.contextAppendix } : {}) });
}

// The old policy keeps the exact old prompt. New jobs pin the native policy;
// retrying a historical job must never silently change its compilation behavior.
const nativeCompilerInstructions = buildCompilerInstructions("native");

const nativeModelCompiledBriefJsonSchema = {
  ...modelCompiledBriefJsonSchema,
  required: [...modelCompiledBriefJsonSchema.required, "contextAppendix"],
  properties: { ...modelCompiledBriefJsonSchema.properties, contextAppendix: {
    type: "array", maxItems: 12, items: { type: "object", additionalProperties: false,
      required: ["id", "title", "description", "content"], properties: {
        id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,63}$" },
        title: { type: "string", minLength: 1, maxLength: 160 },
        description: { type: "string", minLength: 1, maxLength: 400 },
        content: { type: "string", minLength: 1, maxLength: 4000 }
      } }
  } }
};

const nativeActionsCompilerInstructions = buildCompilerInstructions("native_actions");
const progressiveCompilerInstructions = buildCompilerInstructions("native_progressive");
const rolesCompilerInstructions = buildCompilerInstructions("native_roles");
const { schedulingInterpretation: _legacySchedulingSchema, ...nativeActionProperties } = nativeModelCompiledBriefJsonSchema.properties;
const nativeActionsModelSchema = {
  ...nativeModelCompiledBriefJsonSchema,
  required:[...nativeModelCompiledBriefJsonSchema.required.filter(key=>key!=="schedulingInterpretation"),"nativeAppointmentInterpretation"],
  properties:{...nativeActionProperties,appointmentAuthorization:{type:"null"},nativeAppointmentInterpretation:nativeAppointmentInterpretationJsonSchema}
};
