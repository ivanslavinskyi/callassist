import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { CallPreparation, PreparationRequestTrace } from "@callassist/contracts";
import { AdminPreparationTiming } from "../components/admin-preparation-timing";

const startedAt = "2026-10-04T10:00:00.000Z", completedAt = "2026-10-04T10:01:26.600Z";
const preparation: CallPreparation = { id: "5b9cd96a-3743-421f-bf54-f7c774a85355", status: "failed", callBriefId: null,
  failureCode: "BRIEF_COMPILER_UNAVAILABLE", attemptCount: 2, createdAt: startedAt, updatedAt: completedAt, completedAt };
const request: PreparationRequestTrace = { id: "db755466-0d1d-45c2-911b-8a2016df999d", stage: "compilation", model: "test-model",
  startedAt, completedAt: "2026-10-04T10:00:35.000Z", durationMs: 35000, outcome: "network_error", errorCode: "OPENAI_RESPONSE_TIMEOUT", metadata: null };

it("keeps historical and incomplete records readable without inventing transport timings", () => {
  const html = renderToStaticMarkup(<AdminPreparationTiming inspector={{ preparation, generatedAt: completedAt, timeline: [request] }} />);
  expect(html).toContain("86.600 s");
  expect(html).toContain("35.000 s");
  expect(html).toContain("OPENAI_RESPONSE_TIMEOUT");
  expect(html).toContain("Transport diagnostics were not recorded");
  expect(html).toContain("Initial queue wait</dt><dd>Unknown");
  expect(html).toContain("Socket write began at</dt><dd>Unknown");
  expect(html).not.toMatch(/NaN|undefined/);
});

it("distinguishes retry waiting, headers waiting and reading the body", () => {
  const html = renderToStaticMarkup(<AdminPreparationTiming inspector={{ preparation, generatedAt: completedAt, initialQueueMs: 27,
    workerAttempts: [{ generation: 1, attemptNumber: 1, startedAt, completedAt: "2026-10-04T10:01:11.000Z",
      outcome: "retry_scheduled", errorCode: "BRIEF_COMPILER_UNAVAILABLE" },
      { generation: 1, attemptNumber: 2, startedAt: "2026-10-04T10:01:16.213Z", completedAt, outcome: "succeeded", errorCode: null }],
    timeline: [{ ...request, clientRequestId: "client-correlation-id", providerRequestId: "provider-correlation-id", diagnostics: {
      version: 1, dispatchedAt: startedAt, reservationMs: 7, actualTimeoutMs: 35000, requestBytes: 8000,
      requestCreatedMs: 1, socketWriteMs: 10, requestBodySentMs: 12, responseHeadersMs: 6012,
      bodyReadMs: 40, failurePhase: null, networkErrorCode: null, providerProcessingMs: null,
      remainingRequests: 0, remainingTokens: 1000
    } }] }} />);
  expect(html).toContain("5.213 s");
  expect(html).toContain("Wait after body sent</dt><dd>6.000 s");
  expect(html).toContain("Response body read / parse</dt><dd>0.040 s");
  expect(html).toContain("Provider processing (reported)</dt><dd>Unknown");
  expect(html).toContain("0 / 1000");
  expect(html).toContain("client-correlation-id");
  expect(html).toContain("provider-correlation-id");
  expect(html).toContain("must not be added together");
});
