import { z } from "zod";

// Technical numbers/enums only: never add raw headers, URLs, errors or plan text.
const milliseconds = z.number().int().nonnegative().max(86_400_000);
export const preparationNetworkErrorSchema = z.enum([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET",
  "UND_ERR_ABORTED", "ABORT_ERR", "CERT_HAS_EXPIRED", "DEPTH_ZERO_SELF_SIGNED_CERT",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "UNABLE_TO_GET_ISSUER_CERT_LOCALLY", "OTHER"
]);
export const preparationTransportDiagnosticsSchema = z.strictObject({
  version: z.literal(1),
  dispatchedAt: z.iso.datetime().nullable(),
  reservationMs: milliseconds,
  actualTimeoutMs: milliseconds,
  requestBytes: z.number().int().nonnegative().max(100_000_000),
  // Offsets from dispatch. Null means unobserved, never zero latency.
  requestCreatedMs: milliseconds.nullable(),
  socketWriteMs: milliseconds.nullable(),
  requestBodySentMs: milliseconds.nullable(),
  responseHeadersMs: milliseconds.nullable(),
  bodyReadMs: milliseconds.nullable(),
  failurePhase: z.enum(["before_dispatch", "before_headers", "response_body"]).nullable(),
  networkErrorCode: preparationNetworkErrorSchema.nullable(),
  providerProcessingMs: z.number().nonnegative().max(86_400_000).nullable(),
  remainingRequests: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  remainingTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable()
});
export type PreparationTransportDiagnostics = z.infer<typeof preparationTransportDiagnosticsSchema>;
