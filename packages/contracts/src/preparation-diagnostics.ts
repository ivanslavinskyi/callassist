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
  remainingTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable(),
  // Optional for historical rows and non-streaming responses. No output text is retained.
  stream: z.strictObject({
    outputEvents: z.number().int().nonnegative().max(8_000_000),
    outputBytes: z.number().int().nonnegative().max(8_000_000),
    firstOutputMs: milliseconds.nullable(),
    lastOutputMs: milliseconds.nullable()
  }).optional(),
  textValidation:z.strictObject({version:z.literal(1),kind:z.enum(["call_summary","transcript_translation","plan_review","clarification_review"]),
    nativeFormat:z.enum(["native-summary-v1","native-summary-v2","native-summary-v3"]).nullable(),
    repair:z.enum(["none","grounding"]),
    repairFieldPath:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.\[\]-]{0,159}$/).nullable(),
    validationCode:z.enum(["TEXT_INVALID_SCHEMA","TEXT_INVALID_ASSESSMENT","TEXT_INVALID_FIXED_ASSESSMENT","TEXT_INVALID_REFERENCES","TEXT_INVALID_GROUNDING"]).nullable(),
    validationFieldPath:z.string().regex(/^[a-zA-Z][a-zA-Z0-9_.\[\]-]{0,159}$/).nullable()
  }).optional()
});
export type PreparationTransportDiagnostics = z.infer<typeof preparationTransportDiagnosticsSchema>;
