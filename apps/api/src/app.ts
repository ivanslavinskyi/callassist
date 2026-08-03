import cors from "@fastify/cors";
import {
  approvalDecisionSchema,
  createCallBriefInputSchema,
  type CallEvent
} from "@callassist/contracts";
import Fastify from "fastify";
import type { CallService } from "./call-service";
import { CallRepositoryError } from "./storage/call-repository";

type BuildAppOptions = {
  service: CallService;
  logger?: boolean;
  webOrigin?: string;
};

export function buildApp({
  service,
  logger = true,
  webOrigin = process.env.WEB_ORIGIN ?? "http://localhost:3000"
}: BuildAppOptions) {
  const app = Fastify({ logger });

  void app.register(cors, { origin: webOrigin });

  app.get("/health", async (_request, reply) => {
    try {
      await service.ping();
      return { status: "ok", mode: service.repository.mode };
    } catch {
      return reply.status(503).send({
        status: "unavailable",
        mode: service.repository.mode
      });
    }
  });

  app.get("/api/call-briefs", async () => ({ items: await service.list() }));

  app.post("/api/call-briefs", async (request, reply) => {
    const parsed = createCallBriefInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_CALL_BRIEF",
        issues: parsed.error.flatten()
      });
    }

    return reply.status(201).send(await service.create(parsed.data));
  });

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id",
    async (request, reply) => {
      const snapshot = await service.get(request.params.id);
      if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });
      return snapshot;
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
      reply.raw.writeHead(200, {
        "Access-Control-Allow-Origin": webOrigin,
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Content-Type": "text/event-stream"
      });
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

function sendRepositoryError(
  reply: { status(code: number): { send(payload: unknown): unknown } },
  error: unknown
) {
  if (error instanceof CallRepositoryError) {
    const status = error.code === "CALL_NOT_FOUND" ? 404 : 409;
    return reply.status(status).send({ error: error.code });
  }

  throw error;
}
