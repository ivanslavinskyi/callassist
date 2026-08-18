import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import {
  approvalDecisionSchema,
  callBriefStatusSchema,
  createCallBriefInputSchema,
  type CallEvent
} from "@callassist/contracts";
import Fastify, { type FastifyBaseLogger } from "fastify";
import { CallServiceError, type CallService } from "./call-service";
import type { OpenAIRealtimeBridge } from "./realtime/openai-realtime-bridge";
import { CallRepositoryError, decodeCallBriefCursor } from "./storage/call-repository";
import {
  isTwilioCallStatus,
  isTwilioRecordingStatus,
  type TwilioCallStatus,
  type TwilioRecordingStatus
} from "./telephony/telephony-provider";
import type { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

type BuildAppOptions = {
  service: CallService;
  logger?: boolean;
  webOrigin?: string | string[];
};

type BuildWebhookAppOptions = {
  service: CallService;
  twilioProvider: TwilioTelephonyProvider;
  realtimeBridge: OpenAIRealtimeBridge;
  logger?: boolean;
};

export function buildApp({
  service,
  logger = true,
  webOrigin = process.env.WEB_ORIGIN
}: BuildAppOptions) {
  const app = Fastify({ logger });
  const webOrigins = resolveWebOrigins(webOrigin);

  void app.register(cors, {
    origin: webOrigins,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  app.get("/health", async (_request, reply) => {
    try {
      await service.ping();
      return {
        status: "ok",
        mode: service.repository.mode,
        telephony: service.telephonyProvider.mode
      };
    } catch {
      return reply.status(503).send({
        status: "unavailable",
        mode: service.repository.mode,
        telephony: service.telephonyProvider.mode
      });
    }
  });

  app.get<{
    Querystring: { limit?: string; cursor?: string; search?: string; status?: string };
  }>("/api/call-briefs", async (request, reply) => {
    const limit = request.query.limit === undefined ? 20 : Number(request.query.limit);
    const search = request.query.search?.trim();
    const status = request.query.status
      ? callBriefStatusSchema.safeParse(request.query.status)
      : null;
    const cursor = request.query.cursor
      ? decodeCallBriefCursor(request.query.cursor)
      : undefined;
    if (
      !Number.isInteger(limit) || limit < 1 || limit > 50 ||
      (search !== undefined && search.length > 100) ||
      (status !== null && !status.success) ||
      (request.query.cursor !== undefined && !cursor)
    ) {
      return reply.status(400).send({ error: "INVALID_CALL_LIST_QUERY" });
    }
    return service.list({
      limit,
      ...(cursor ? { cursor } : {}),
      ...(search ? { search } : {}),
      ...(status?.success ? { status: status.data } : {})
    });
  });

  app.post("/api/call-briefs", async (request, reply) => {
    const parsed = createCallBriefInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_CALL_BRIEF",
        issues: parsed.error.flatten()
      });
    }

    try {
      return reply.status(201).send(await service.create(parsed.data));
    } catch (error) {
      logCallPreparationError(request.log, error);
      return sendRepositoryError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id",
    async (request, reply) => {
      const snapshot = await service.get(request.params.id);
      if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });
      return snapshot;
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/call-briefs/:id",
    async (request, reply) => {
      const parsed = createCallBriefInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_CALL_BRIEF",
          issues: parsed.error.flatten()
        });
      }
      try {
        return await service.recompile(request.params.id, parsed.data);
      } catch (error) {
        logCallPreparationError(request.log, error);
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id/recording",
    async (request, reply) => {
      try {
        const media = await service.getRecordingMedia(request.params.id);
        return reply
          .header("Cache-Control", "private, no-store")
          .header(
            "Content-Disposition",
            `inline; filename=${JSON.stringify(media.fileName)}`
          )
          .type(media.contentType)
          .send(Buffer.from(media.bytes));
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.delete<{ Params: { id: string } }>(
    "/api/call-briefs/:id/recording",
    async (request, reply) => {
      try {
        return await service.deleteRecording(request.params.id);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/final-transcript/retry",
    async (request, reply) => {
      try {
        return reply
          .status(202)
          .send(await service.retryFinalTranscript(request.params.id));
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/approve",
    async (request, reply) => {
      try {
        return await service.approveCompilation(request.params.id);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/approve-and-start",
    async (request, reply) => {
      try {
        return await service.approveAndStart(request.params.id);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/start",
    async (request, reply) => {
      try {
        return await service.start(request.params.id);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/stop",
    async (request, reply) => {
      try {
        return await service.stop(request.params.id);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string; approvalId: string } }>(
    "/api/call-briefs/:id/approvals/:approvalId",
    async (request, reply) => {
      const parsed = approvalDecisionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_DECISION" });
      }

      try {
        return await service.resolveApproval(
          request.params.id,
          request.params.approvalId,
          parsed.data
        );
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id/events",
    async (request, reply) => {
      const snapshot = await service.get(request.params.id);
      if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });

      reply.hijack();
      const headers: Record<string, string> = {
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream"
      };
      const requestOrigin = request.headers.origin;
      if (requestOrigin && webOrigins.includes(requestOrigin)) {
        headers["Access-Control-Allow-Origin"] = requestOrigin;
        headers.Vary = "Origin";
      }
      reply.raw.writeHead(200, headers);
      reply.raw.write(": connected\n\n");

      const send = (event: CallEvent) => {
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      const unsubscribe = service.subscribe(request.params.id, send);
      const heartbeat = setInterval(
        () => reply.raw.write(": heartbeat\n\n"),
        15_000
      );

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    }
  );

  app.addHook("onClose", async () => {
    await service.close();
  });

  return app;
}

function resolveWebOrigins(value?: string | string[]) {
  const configured = Array.isArray(value) ? value : value?.split(",");
  const origins = configured?.map((origin) => origin.trim()).filter(Boolean);
  return origins?.length
    ? origins
    : ["http://localhost:3000", "http://127.0.0.1:3000"];
}

export function buildWebhookApp({
  service,
  twilioProvider,
  realtimeBridge,
  logger = true
}: BuildWebhookAppOptions) {
  const app = Fastify({ logger });
  void app.register(async (routes) => {
    await routes.register(websocket);
    await routes.register(formbody);

    routes.post<{ Querystring: { callBriefId?: string } }>(
      "/webhooks/twilio/voice",
      async (request, reply) => {
        const parameters = normalizeTwilioParameters(request.body);
        if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
          return reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
        }

        const callBriefId = request.query.callBriefId;
        if (!callBriefId) {
          return reply.status(400).send({ error: "CALL_BRIEF_ID_REQUIRED" });
        }
        const snapshot = await service.get(callBriefId);
        if (!snapshot) {
          return reply.status(404).send({ error: "CALL_NOT_FOUND" });
        }

        return reply
          .type("text/xml; charset=utf-8")
          .send(twilioProvider.createVoiceTwiml(snapshot.brief));
      }
    );

    routes.get(
      "/webhooks/twilio/media",
      {
        websocket: true,
        preValidation: (request, reply, done) => {
          if (!isValidTwilioMediaStream(request, twilioProvider)) {
            void reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
            return;
          }
          done();
        }
      },
      (socket) => realtimeBridge.handleTwilioSocket(socket)
    );

    routes.post<{ Querystring: { callBriefId?: string } }>(
      "/webhooks/twilio/status",
      async (request, reply) => {
        const parameters = normalizeTwilioParameters(request.body);
        if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
          return reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
        }

        const providerCallId = parameters.CallSid;
        const status = parameters.CallStatus;
        if (!providerCallId || !status || !isTwilioCallStatus(status)) {
          return reply.status(400).send({ error: "INVALID_TWILIO_STATUS" });
        }

        await service.handleTwilioStatus(
          providerCallId,
          status as TwilioCallStatus,
          request.query.callBriefId
        );
        return reply.status(204).send();
      }
    );

    routes.post<{
      Querystring: { callBriefId?: string; recordingId?: string };
    }>("/webhooks/twilio/recording", async (request, reply) => {
      const parameters = normalizeTwilioParameters(request.body);
      if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
        return reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
      }

      const providerCallId = parameters.CallSid;
      const providerRecordingId = parameters.RecordingSid;
      const providerStatus = parameters.RecordingStatus;
      const callBriefId = request.query.callBriefId;
      const recordingId = request.query.recordingId;
      if (
        !providerCallId ||
        !providerRecordingId ||
        !providerStatus ||
        !callBriefId ||
        !recordingId ||
        !isTwilioRecordingStatus(providerStatus)
      ) {
        return reply.status(400).send({ error: "INVALID_TWILIO_RECORDING_STATUS" });
      }

      await service.handleTwilioRecordingStatus({
        callBriefId,
        recordingId,
        providerCallId,
        providerRecordingId,
        providerStatus: providerStatus as TwilioRecordingStatus,
        durationSeconds: optionalNonNegativeNumber(parameters.RecordingDuration),
        channels: optionalPositiveNumber(parameters.RecordingChannels),
        startedAt: optionalIsoDate(parameters.RecordingStartTime),
        failureReason: parameters.RecordingErrorCode
      });
      return reply.status(204).send();
    });
  });

  return app;
}

function optionalNonNegativeNumber(value: string | undefined) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalPositiveNumber(value: string | undefined) {
  const parsed = optionalNonNegativeNumber(value);
  return parsed !== undefined && parsed > 0 ? parsed : undefined;
}

function optionalIsoDate(value: string | undefined) {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function normalizeTwilioParameters(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  const parameters: Record<string, string> = {};
  for (const [key, value] of Object.entries(body)) {
    if (typeof value === "string") parameters[key] = value;
  }
  return parameters;
}

function isValidTwilioWebhook(
  request: { headers: Record<string, unknown>; raw: { url?: string } },
  provider: TwilioTelephonyProvider,
  parameters: Record<string, string>
) {
  const signature = request.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !request.raw.url) return false;
  return provider.validateWebhook(signature, request.raw.url, parameters);
}

function isValidTwilioMediaStream(
  request: { headers: Record<string, unknown>; raw: { url?: string } },
  provider: TwilioTelephonyProvider
) {
  const signature = request.headers["x-twilio-signature"];
  if (typeof signature !== "string" || !request.raw.url) return false;
  return provider.validateMediaStreamWebhook(signature, request.raw.url);
}

function sendRepositoryError(
  reply: { status(code: number): { send(payload: unknown): unknown } },
  error: unknown
) {
  if (error instanceof CallServiceError) {
    const status =
      error.code === "RECORDING_NOT_AVAILABLE"
        ? 409
        : error.code === "BRIEF_COMPILER_UNAVAILABLE"
          ? 503
          : 502;
    return reply.status(status).send({ error: error.code });
  }

  if (error instanceof CallRepositoryError) {
    const status = error.code === "CALL_NOT_FOUND" ? 404 : 409;
    return reply.status(status).send({ error: error.code });
  }

  throw error;
}

function logCallPreparationError(log: FastifyBaseLogger, error: unknown) {
  if (!(error instanceof CallServiceError) || !error.diagnostic) return;
  log.warn(
    {
      code: error.code,
      compilerCode: error.diagnostic.compilerCode,
      responseId: error.diagnostic.responseId,
      clientRequestId: error.diagnostic.clientRequestId,
      compilerStage: error.diagnostic.stage,
      validationPaths: error.diagnostic.validationPaths,
      upstreamStatusCode: error.diagnostic.statusCode
    },
    "Call brief preparation failed"
  );
}
