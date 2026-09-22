import { Readable } from "node:stream";
import { telemetryExportInputSchema, type User } from "@callassist/contracts";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { isUuid } from "../storage/call-repository";
import { ExportError } from "./archive";
import type { TelemetryExportService } from "./service";

type Authorize = (request: FastifyRequest, reply: FastifyReply, mutation: boolean) => Promise<User | null>;
export function registerTelemetryExportRoutes(app: FastifyInstance, service: TelemetryExportService | undefined,
  authorize: Authorize, stillAuthorized: (request: FastifyRequest, actor: string) => Promise<boolean>) {
  async function handle(request: FastifyRequest, reply: FastifyReply, mutation: boolean,
    action: (actor: User, service: TelemetryExportService) => Promise<unknown>) {
    reply.header("Cache-Control", "private, no-store");
    const actor = await authorize(request, reply, mutation); if (!actor) return;
    if (!service) return reply.status(503).send({ error: "EXPORT_UNAVAILABLE" });
    try { return await action(actor, service); }
    catch (error) {
      if (error instanceof ExportError) return reply.status(error.status).send({ error: error.code });
      throw error;
    }
  }
  app.get<{ Querystring: { cursor?: string } }>("/api/admin/telemetry-exports", async (request, reply) => {
    reply.header("Cache-Control", "private, no-store");
    if (!service) {
      const actor = await authorize(request, reply, false); if (!actor) return;
      return { available: false, items: [], nextCursor: null };
    }
    return handle(request, reply, false, (actor, exports) => exports.list(actor.id, request.query.cursor));
  });
  app.post("/api/admin/telemetry-exports", (request, reply) => handle(request, reply, true, async (actor, exports) => {
    const input = telemetryExportInputSchema.safeParse(request.body);
    if (!input.success) throw new ExportError("EXPORT_INVALID_INPUT", 400);
    const result = await exports.create(actor.id, input.data);
    return reply.status(202).send(result);
  }));
  app.get<{ Params: { id: string } }>("/api/admin/telemetry-exports/:id", (request, reply) => handle(request, reply, false, async (actor, exports) => {
    if (!isUuid(request.params.id)) throw new ExportError("EXPORT_NOT_FOUND", 404);
    return exports.get(actor.id, request.params.id);
  }));
  for (const action of ["cancel", "retry"] as const) {
    app.post<{ Params: { id: string } }>(`/api/admin/telemetry-exports/:id/${action}`, (request, reply) => handle(request, reply, true, async (actor, exports) => {
      if (!isUuid(request.params.id)) throw new ExportError("EXPORT_NOT_FOUND", 404);
      await exports[action](actor.id, request.params.id);
      return exports.get(actor.id, request.params.id);
    }));
  }
  app.get<{ Params: { id: string } }>("/api/admin/telemetry-exports/:id/download", (request, reply) => handle(request, reply, false, async (actor, exports) => {
    if (!isUuid(request.params.id)) throw new ExportError("EXPORT_NOT_FOUND", 404);
    const file = await exports.get(actor.id, request.params.id);
    if (file.status !== "ready") throw new ExportError("EXPORT_NOT_READY");
    const stream = Readable.from(exports.download(actor.id, file.id, () => stillAuthorized(request, actor.id)), { objectMode: false, highWaterMark: 64 * 1024 });
    // No full browser Blob or server buffering. Closing the socket stops the iterator.
    reply.raw.once("close", () => {
      if (!reply.raw.writableFinished) {
        stream.destroy();
        void exports.audit(file.id, actor.id, "download_disconnected").catch(() => undefined);
      }
    });
    reply.raw.once("finish", () => {
      if (reply.statusCode === 200 && stream.readableEnded && !stream.errored) {
        void exports.audit(file.id, actor.id, "download_completed").catch(() => undefined);
      }
    });
    return reply.type("application/zip").header("Content-Length", file.bytes)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Disposition", `attachment; filename="shprohli-telemetry_${file.from.slice(0, 10)}_${file.id}.zip"`)
      .send(stream);
  }));
  if (service) app.addHook("onClose", () => service.close());
}
