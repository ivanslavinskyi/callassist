import { ogGenerateInputSchema, ogLocaleSchema, ogPublishInputSchema, ogUploadInputSchema, OG_UPLOAD_MAX_BYTES, type User } from "@callassist/contracts";
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { OgError } from "./og-repository";
import type { OgService } from "./og-service";

type Authorize = (request: FastifyRequest, reply: FastifyReply) => Promise<User | null>;
export function registerOgRoutes(app: FastifyInstance, service: OgService, read: Authorize, mutate: Authorize) {
  app.get("/api/content/og", async (_request, reply) => reply.header("Cache-Control", "no-store").send({ images: await service.published() }));
  app.get("/api/admin/content/og", { onRequest: async (request, reply) => { await read(request, reply); } },
    async (_request, reply) => reply.header("Cache-Control", "private, no-store").send({ locales: await service.list() }));

  for (const preview of [false, true]) {
    app.get<{ Params: { locale: string; hash: string } }>(
      preview ? "/api/admin/content/og/:locale/images/:hash.png" : "/api/content/og/:locale/images/:hash.png",
      { onRequest: async (request, reply) => { if (preview) await read(request, reply); } },
      async (request, reply) => {
        const locale = ogLocaleSchema.safeParse(request.params.locale);
        if (!locale.success || !/^[a-f0-9]{64}$/.test(request.params.hash)) return reply.status(404).header("Cache-Control", "no-store").send();
        const png = await service.repository.image(locale.data, request.params.hash, preview);
        if (!png) return reply.status(404).header("Cache-Control", "no-store").send();
        reply.header("Cache-Control", preview ? "private, no-store" : "public, max-age=31536000, immutable")
          .header("ETag", `"${request.params.hash}"`).type("image/png");
        if (!preview && request.headers["if-none-match"] === `"${request.params.hash}"`) return reply.status(304).send();
        return reply.send(png);
      }
    );
  }
  for (const action of ["generate", "upload", "publish"] as const) {
    const actors = new WeakMap<FastifyRequest, User>();
    app.post<{ Params: { locale: string } }>(`/api/admin/content/og/:locale/${action}`, {
      bodyLimit: action === "upload" ? Math.ceil(OG_UPLOAD_MAX_BYTES * 4 / 3) + 4096 : 4096,
      onRequest: async (request, reply) => {
        reply.header("Cache-Control", "private, no-store");
        const actor = await mutate(request, reply);
        if (actor) actors.set(request, actor);
      }
    }, async (request, reply) => {
      const actor = actors.get(request);
      if (!actor) return;
      const locale = ogLocaleSchema.safeParse(request.params.locale);
      if (!locale.success) return reply.status(404).send({ error: "OG_LOCALE_NOT_FOUND" });
      try {
        if (action === "publish") {
          const input = ogPublishInputSchema.safeParse(request.body);
          if (!input.success) throw new OgError("OG_INVALID_INPUT");
          return await service.publish(locale.data, input.data.versionId, actor.id, input.data.expectedRevision);
        }
        const input = (action === "generate" ? ogGenerateInputSchema : ogUploadInputSchema).safeParse(request.body);
        if (!input.success) throw new OgError("OG_INVALID_INPUT");
        return await service.prepare(locale.data, actor.id, input.data.expectedRevision, input.data);
      } catch (error) {
        if (error instanceof OgError) return reply.status(error.status).send({ error: error.code });
        throw error;
      }
    });
  }
  app.addHook("onClose", async () => service.repository.close());
}
