import { planReviewFiltersSchema, planReviewUpdateSchema, sensitiveCallAccessInputSchema, type User } from "@callassist/contracts";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { isUuid } from "../storage/call-repository";
import { PlanReviewError, emptyPlanReviewSummary, type PlanReviewAdmin } from "./plan-review-service";

export function registerPlanReviewRoutes(app: FastifyInstance, service: PlanReviewAdmin | undefined,
  authorize: (request: FastifyRequest, reply: FastifyReply, mutation: boolean) => Promise<User | null>) {
  async function handle(request: FastifyRequest, reply: FastifyReply, mutation: boolean,
    action: (service: PlanReviewAdmin, actor: User) => Promise<unknown>) {
    reply.header("Cache-Control", "private, no-store");
    const actor = await authorize(request, reply, mutation);
    if (!actor) return;
    if (!service) return reply.status(503).send({ error: "PLAN_REVIEW_UNAVAILABLE" });
    try { return await action(service, actor); }
    catch (error) {
      if (error instanceof PlanReviewError) return reply.status(error.status).send({ error: error.code });
      throw error;
    }
  }
  const base = "/api/admin/safety/plan-reviews";
  app.get(base, async (request, reply) => {
    if (!service) {
      reply.header("Cache-Control", "private, no-store");
      if (!await authorize(request, reply, false)) return;
      return { available: false, items: [], nextCursor: null, summary: emptyPlanReviewSummary };
    }
    return handle(request, reply, false, async reviews => {
      const parsed = planReviewFiltersSchema.safeParse(request.query);
      if (!parsed.success) throw new PlanReviewError("PLAN_REVIEW_INPUT_INVALID", 400);
      return reviews.list(parsed.data);
    });
  });
  app.get<{ Params: { id: string } }>(`${base}/:id`, (request, reply) => handle(request, reply, false, async reviews => {
    if (!isUuid(request.params.id)) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
    return reviews.get(request.params.id);
  }));
  app.post<{ Params: { id: string } }>(`${base}/:id/sensitive-access`, (request, reply) => handle(request, reply, true, async (reviews, actor) => {
    if (!isUuid(request.params.id)) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
    const parsed = sensitiveCallAccessInputSchema.safeParse(request.body);
    if (!parsed.success) throw new PlanReviewError("PLAN_REVIEW_INPUT_INVALID", 400);
    return reviews.evidence(request.params.id, actor.id, parsed.data.reason);
  }));
  app.patch<{ Params: { id: string } }>(`${base}/:id`, (request, reply) => handle(request, reply, true, async (reviews, actor) => {
    if (!isUuid(request.params.id)) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
    const parsed = planReviewUpdateSchema.safeParse(request.body);
    if (!parsed.success) throw new PlanReviewError("PLAN_REVIEW_INPUT_INVALID", 400);
    await reviews.update(request.params.id, actor.id, parsed.data);
    return reviews.get(request.params.id);
  }));
  app.post<{ Params: { id: string; deliveryId: string } }>(`${base}/:id/emails/:deliveryId/retry`, (request, reply) => handle(request, reply, true, async (reviews, actor) => {
    if (!isUuid(request.params.id) || !isUuid(request.params.deliveryId)) throw new PlanReviewError("PLAN_REVIEW_NOT_FOUND", 404);
    const parsed = sensitiveCallAccessInputSchema.safeParse(request.body);
    if (!parsed.success) throw new PlanReviewError("PLAN_REVIEW_INPUT_INVALID", 400);
    await reviews.retryEmail(request.params.id, request.params.deliveryId, actor.id, parsed.data.reason);
    return reviews.get(request.params.id);
  }));
  if (service) app.addHook("onClose", () => service.close());
}
