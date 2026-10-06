import { expect, it } from "vitest";
import { preparationRequestTraceSchema } from "./admin-calls";
import { preparationTransportDiagnosticsSchema } from "./preparation-diagnostics";

const diagnostics = {
  version: 1, dispatchedAt: "2026-10-04T10:00:00.000Z", reservationMs: 0, actualTimeoutMs: 35000,
  requestBytes: 50, requestCreatedMs: null, socketWriteMs: null, requestBodySentMs: null,
  responseHeadersMs: null, bodyReadMs: null, failurePhase: "before_headers", networkErrorCode: null,
  providerProcessingMs: null, remainingRequests: null, remainingTokens: null
};
it("accepts missing historical diagnostics and preserves unknown fields as null", () => {
  const trace = { id: "5b9cd96a-3743-421f-bf54-f7c774a85355", stage: "compilation", model: "test",
    startedAt: diagnostics.dispatchedAt, completedAt: null, durationMs: null, outcome: null, errorCode: null, metadata: null };
  expect(preparationRequestTraceSchema.parse(trace)).toEqual(trace);
  expect(preparationTransportDiagnosticsSchema.parse(diagnostics)).toEqual(diagnostics);
  expect(preparationTransportDiagnosticsSchema.parse({ ...diagnostics, dispatchedAt: null, failurePhase: "before_dispatch" }))
    .toMatchObject({ dispatchedAt: null, failurePhase: "before_dispatch" });
});
it.each([
  { headers: { authorization: "secret" } }, { prompt: "private plan" }, { networkErrorCode: "raw server error" },
  { responseHeadersMs: -1 }, { requestBytes: Infinity }, { providerProcessingMs: 999999999999 }, { version: 2 },
  { stream: { outputEvents: 1, outputBytes: 3, firstOutputMs: 2, lastOutputMs: 2, text: "private plan" } },
  { stream: { outputEvents: 1, outputBytes: 8_000_001, firstOutputMs: 2, lastOutputMs: 2 } }
])("rejects unsafe or invalid transport diagnostics %j", extra => {
  expect(preparationTransportDiagnosticsSchema.safeParse({ ...diagnostics, ...extra }).success).toBe(false);
});
it("retains only numeric progress from a streamed response", () => {
  const value = { ...diagnostics, stream: { outputEvents: 2, outputBytes: 80, firstOutputMs: 3700, lastOutputMs: 29000 } };
  expect(preparationTransportDiagnosticsSchema.parse(value)).toEqual(value);
});
