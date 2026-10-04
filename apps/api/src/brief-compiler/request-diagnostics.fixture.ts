import type { PreparationTransportDiagnostics } from "@callassist/contracts";

export const preparationDiagnosticsFixture: PreparationTransportDiagnostics = {
  version: 1, dispatchedAt: "2096-01-01T00:00:01.010Z", reservationMs: 10, actualTimeoutMs: 35000,
  requestBytes: 8000, requestCreatedMs: 1, socketWriteMs: 3, requestBodySentMs: 4,
  responseHeadersMs: 120, bodyReadMs: 3, failurePhase: null, networkErrorCode: null,
  providerProcessingMs: 100.5, remainingRequests: 40, remainingTokens: 10000
};
