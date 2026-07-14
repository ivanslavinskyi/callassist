import cors from "@fastify/cors";
import {
  approvalDecisionSchema,
  createCallBriefInputSchema,
  type CallEvent
} from "@callassist/contracts";
import Fastify from "fastify";
import { CallStore } from "./call-store";

const app = Fastify({ logger: true });
const store = new CallStore();

await app.register(cors, {
  origin: process.env.WEB_ORIGIN ?? "http://localhost:3000"
});

app.get("/health", async () => ({ status: "ok", mode: "mock" }));

app.get("/api/call-briefs", async () => ({ items: store.list() }));

app.post("/api/call-briefs", async (request, reply) => {
  const parsed = createCallBriefInputSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      error: "INVALID_CALL_BRIEF",
      issues: parsed.error.flatten()
    });
  }

  return reply.status(201).send(store.create(parsed.data));
});

app.get<{ Params: { id: string } }>("/api/call-briefs/:id", async (request, reply) => {
  const snapshot = store.get(request.params.id);
  if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });
  return snapshot;
});

app.post<{ Params: { id: string } }>(
  "/api/call-briefs/:id/start",
  async (request, reply) => {
    try {
      return store.start(request.params.id);
    } catch {
      return reply.status(404).send({ error: "CALL_NOT_FOUND" });
    }
  }
);

app.post<{ Params: { id: string } }>(
  "/api/call-briefs/:id/stop",
  async (request, reply) => {
    try {
      return store.stop(request.params.id);
    } catch {
      return reply.status(404).send({ error: "CALL_NOT_FOUND" });
    }
  }
);

app.post<{ Params: { id: string; approvalId: string } }>(
  "/api/call-briefs/:id/approvals/:approvalId",
  async (request, reply) => {
    const parsed = approvalDecisionSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: "INVALID_DECISION" });

    try {
      return store.resolveApproval(
        request.params.id,
        request.params.approvalId,
        parsed.data
      );
    } catch (error) {
      const code = error instanceof Error ? error.message : "UNKNOWN_ERROR";
      return reply.status(code === "CALL_NOT_FOUND" ? 404 : 409).send({ error: code });
    }
  }
);

app.get<{ Params: { id: string } }>(
  "/api/call-briefs/:id/events",
  async (request, reply) => {
    const snapshot = store.get(request.params.id);
    if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });

    reply.hijack();
    reply.raw.writeHead(200, {
      "Access-Control-Allow-Origin": process.env.WEB_ORIGIN ?? "http://localhost:3000",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });
    reply.raw.write(": connected\n\n");

    const send = (event: CallEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = store.subscribe(request.params.id, send);
    const heartbeat = setInterval(() => reply.raw.write(": heartbeat\n\n"), 15_000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  }
);

const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });
