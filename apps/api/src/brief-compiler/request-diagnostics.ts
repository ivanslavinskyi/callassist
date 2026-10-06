import { AsyncLocalStorage } from "node:async_hooks";
import { channel } from "node:diagnostics_channel";
import { preparationNetworkErrorSchema, type PreparationTransportDiagnostics } from "@callassist/contracts";

const activeRequest = new AsyncLocalStorage<PreparationRequestDiagnostics>();
const owners = new WeakMap<object, PreparationRequestDiagnostics>();
type TransportMark = "requestCreatedMs" | "socketWriteMs" | "requestBodySentMs";

// Subscribe once. Observe only the compiler's scoped fetch, including concurrent
// preparations. Never inspect request headers, body, URL, socket or connection-wide
// events: a pooled connection is not attributable to a particular request.
function observe(name: string, mark: TransportMark) {
  channel(name).subscribe(message => {
    try {
      const request = (message as { request?: unknown })?.request;
      if (!request || typeof request !== "object") return;
      const owner = mark === "requestCreatedMs" ? activeRequest.getStore() : owners.get(request);
      if (!owner?.active) return;
      if (mark === "requestCreatedMs") owners.set(request, owner);
      owner.mark(mark);
    } catch { /* An optional observer must never fail a provider request. */ }
  });
}
observe("undici:request:create", "requestCreatedMs");
observe("undici:client:sendHeaders", "socketWriteMs");
observe("undici:request:bodySent", "requestBodySentMs");

function numericHeader(headers: Headers, name: string, max: number, integer = false) {
  const raw = headers.get(name);
  if (!raw || !/^\d+(?:\.\d+)?$/.test(raw) || raw.length > 24) return null;
  const value = Number(raw);
  return Number.isFinite(value) && value <= max && (!integer || Number.isSafeInteger(value)) ? value : null;
}

export class PreparationRequestDiagnostics {
  active = true;
  #startedAt = Date.now();
  readonly #data: PreparationTransportDiagnostics;
  #bodyStartedAt: number | null = null;
  constructor(reservationMs: number, timeoutMs: number, requestBytes: number) {
    this.#data = { version: 1, dispatchedAt: null,
      reservationMs, actualTimeoutMs: Math.max(0, timeoutMs), requestBytes,
      requestCreatedMs: null, socketWriteMs: null, requestBodySentMs: null,
      responseHeadersMs: null, bodyReadMs: null, failurePhase: null, networkErrorCode: null,
      providerProcessingMs: null, remainingRequests: null, remainingTokens: null };
  }
  run<T>(fetchRequest: () => T): T {
    this.#startedAt = Date.now();
    this.#data.dispatchedAt = new Date(this.#startedAt).toISOString();
    return activeRequest.run(this, fetchRequest);
  }
  mark(key: TransportMark) {
    if (this.active && this.#data[key] === null) this.#data[key] = Math.max(0, Date.now() - this.#startedAt);
  }
  headers(response: Response) {
    this.#data.responseHeadersMs = Math.max(0, Date.now() - this.#startedAt);
    try {
      this.#data.providerProcessingMs = numericHeader(response.headers, "openai-processing-ms", 86_400_000);
      this.#data.remainingRequests = numericHeader(response.headers, "x-ratelimit-remaining-requests", Number.MAX_SAFE_INTEGER, true);
      this.#data.remainingTokens = numericHeader(response.headers, "x-ratelimit-remaining-tokens", Number.MAX_SAFE_INTEGER, true);
    } catch { /* Missing or malformed optional headers are unknown. */ }
  }
  bodyStarted() { this.#bodyStartedAt = Date.now(); }
  streamStarted() {
    this.#data.stream = { outputEvents: 0, outputBytes: 0,
      firstOutputMs: null, lastOutputMs: null };
  }
  streamOutput(bytes: number) {
    const stream = this.#data.stream;
    if (!this.active || !stream || bytes <= 0) return;
    const elapsed = Math.max(0, Date.now() - this.#startedAt);
    stream.outputEvents++; stream.outputBytes += bytes;
    stream.firstOutputMs ??= elapsed; stream.lastOutputMs = elapsed;
  }
  bodyFinished() {
    if (this.#bodyStartedAt !== null) this.#data.bodyReadMs = Math.max(0, Date.now() - this.#bodyStartedAt);
  }
  failed(error: unknown) {
    this.#data.failurePhase = this.#data.responseHeadersMs !== null ? "response_body"
      : this.#data.dispatchedAt === null ? "before_dispatch" : "before_headers";
    // Error.message/stack may contain credentials, hosts or user text.
    try {
      for (let depth = 0; error && typeof error === "object" && depth < 3; depth++) {
        const { code, cause } = error as { code?: unknown; cause?: unknown };
        if (typeof code === "string") {
          const safe = preparationNetworkErrorSchema.safeParse(code);
          this.#data.networkErrorCode = safe.success ? safe.data : "OTHER";
          break;
        }
        error = cause;
      }
    } catch { this.#data.networkErrorCode = "OTHER"; }
  }
  finish() {
    if (this.active) { this.bodyFinished(); this.active = false; }
    return { ...this.#data };
  }
}
