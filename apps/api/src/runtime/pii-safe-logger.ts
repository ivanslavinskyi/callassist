const safeErrorCodePattern = /^[A-Z][A-Z0-9_]{1,79}$/;
const safeErrorTypePattern = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/;

type LogRequest = {
  id?: unknown;
  method?: unknown;
  routeOptions?: { url?: unknown };
};

type LogReply = { statusCode?: unknown };

export const piiSafeLoggerOptions = {
  redact: {
    censor: "[Redacted]",
    paths: [
      "authorization",
      "cookie",
      "password",
      "token",
      "verificationCode",
      "phoneNumber",
      "phoneE164",
      "email",
      "firstName",
      "lastName",
      "recipientName",
      "representedPerson",
      "objective",
      "context",
      "allowedFacts",
      "transcript",
      "text",
      "callBriefId",
      "callId",
      "providerCallId",
      "recordingId",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.headers.x-twilio-signature",
      "res.headers.set-cookie",
      "*.authorization",
      "*.cookie",
      "*.password",
      "*.token",
      "*.verificationCode",
      "*.phoneNumber",
      "*.phoneE164",
      "*.email",
      "*.firstName",
      "*.lastName",
      "*.recipientName",
      "*.representedPerson",
      "*.objective",
      "*.context",
      "*.allowedFacts",
      "*.transcript",
      "*.text",
      "*.callBriefId",
      "*.callId",
      "*.providerCallId",
      "*.recordingId"
    ]
  },
  serializers: {
    req(request: LogRequest) {
      return safeRequestForLog(request);
    },
    res(reply: LogReply) {
      return {
        statusCode: typeof reply.statusCode === "number"
          ? reply.statusCode
          : undefined
      };
    },
    err(error: unknown) {
      return safeErrorForLog(error);
    }
  }
};

export function registerPiiSafeRequestLogging(app: FastifyInstance) {
  app.addHook("onRequest", async (request) => {
    request.log.info(safeRequestForLog(request), "incoming request");
  });
  app.addHook("onError", async (request, reply, error) => {
    const safeError = safeErrorForLog(error);
    request.log.error({
      ...safeRequestForLog(request),
      statusCode: safeError.statusCode ??
        (reply.statusCode >= 400 ? reply.statusCode : 500),
      err: error
    }, "request failed");
  });
  app.addHook("onResponse", async (request, reply) => {
    request.log.info({
      ...safeRequestForLog(request),
      statusCode: reply.statusCode,
      responseTimeMs: Math.max(0, Math.round(reply.elapsedTime))
    }, "request completed");
  });
}

export function safeRequestForLog(request: LogRequest) {
  return {
    requestId: typeof request.id === "string" ? request.id : undefined,
    method: typeof request.method === "string" ? request.method : undefined,
    route: typeof request.routeOptions?.url === "string"
      ? request.routeOptions.url
      : "unmatched"
  };
}

export function safeErrorForLog(error: unknown) {
  if (!error || typeof error !== "object") return {
    type: "Error",
    message: "[Redacted]",
    stack: "[Redacted]"
  };
  const candidate = error as {
    name?: unknown;
    code?: unknown;
    statusCode?: unknown;
  };
  const type = typeof candidate.name === "string" &&
    safeErrorTypePattern.test(candidate.name)
    ? candidate.name
    : "Error";
  const code = typeof candidate.code === "string" &&
    safeErrorCodePattern.test(candidate.code)
    ? candidate.code
    : undefined;
  const statusCode = typeof candidate.statusCode === "number" &&
    Number.isInteger(candidate.statusCode) &&
    candidate.statusCode >= 400 && candidate.statusCode <= 599
    ? candidate.statusCode
    : undefined;
  return {
    type,
    message: "[Redacted]",
    stack: "[Redacted]",
    code,
    statusCode
  };
}

export function writePiiSafeOperationalError(event: string) {
  process.stderr.write(`${JSON.stringify({
    level: "error",
    time: new Date().toISOString(),
    event
  })}\n`);
}
import type { FastifyInstance } from "fastify";
