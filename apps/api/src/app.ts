import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";
import {
  ADMIN_CALL_LIST_LIMIT_MAX,
  accountStatusActionSchema,
  adminCallListFiltersSchema,
  adminDurableJobRetryInputSchema,
  adminOperationsWindowSchema,
  adminOutboundCallControlInputSchema,
  adminUserSearchSchema,
  adminCreditGrantInputSchema,
  approvalDecisionSchema,
  callBriefStatusSchema,
  contentAdminActionInputSchema,
  contentDraftUpdateInputSchema,
  editorialCollectionKeySchema,
  editorialDraftUpdateInputSchema,
  createCallBriefInputSchema,
  loginInputSchema,
  contentLocaleSchema,
  contentPageKeySchema,
  onboardingAcceptanceInputSchema,
  ownerCallFeedbackInputSchema,
  phoneVerificationInputSchema,
  promoCodeCreateInputSchema,
  promoRedemptionInputSchema,
  recipientOptOutConfirmationSchema,
  recipientOptOutRequestSchema,
  registrationInputSchema,
  serviceLivenessSchema,
  serviceReadinessSchema,
  sessionRevocationActionSchema,
  sensitiveCallAccessInputSchema,
  staffRecipientSuppressionLiftSchema,
  staffRecipientSuppressionSchema,
  userRoleSchema,
  userStatusSchema,
  verificationResendInputSchema,
  type CallEvent,
  type User
} from "@callassist/contracts";
import Fastify, {
  LogController,
  type FastifyBaseLogger,
  type FastifyReply,
  type FastifyRequest
} from "fastify";
import { ApplicationRateLimiter } from "./auth/rate-limiter";
import { AuthServiceError, type AuthService } from "./auth/auth-service";
import { decodeAdminUserCursor } from "./auth/auth-repository";
import { CallServiceError, type CallService } from "./call-service";
import type { CreditService } from "./credits/credit-service";
import { ContentRepositoryError } from "./content/content-repository";
import type { ContentService } from "./content/content-service";
import {
  defaultEndpointRateLimitPolicy,
  type EndpointRateLimitPolicy,
  type EndpointRateLimitRule
} from "./config/endpoint-rate-limit-policy";
import type { OpenAIRealtimeBridge } from "./realtime/openai-realtime-bridge";
import {
  piiSafeLoggerOptions,
  registerPiiSafeRequestLogging
} from "./runtime/pii-safe-logger";
import {
  RecipientOptOutService,
  RecipientOptOutServiceError
} from "./safety/recipient-opt-out-service";
import {
  CallRepositoryError,
  decodeAdminCallCursor,
  decodeCallBriefCursor,
  isUuid,
  type ProviderWebhookDeliveryInput
} from "./storage/call-repository";
import {
  isTwilioCallStatusCallbackValue,
  isTwilioRecordingStatus,
  type TwilioRecordingStatus
} from "./telephony/telephony-provider";
import type { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

type BuildAppOptions = {
  service: CallService;
  authService?: AuthService;
  creditService?: CreditService;
  contentService?: ContentService;
  allowAnonymousCallsForTesting?: boolean;
  logger?: boolean;
  secureCookies?: boolean;
  webOrigin?: string | string[];
  endpointRateLimiter?: ApplicationRateLimiter;
  endpointRateLimitPolicy?: EndpointRateLimitPolicy;
  recipientOptOutService?: RecipientOptOutService;
  realtimeConfigured?: boolean;
};

type BuildWebhookAppOptions = {
  service: CallService;
  twilioProvider: TwilioTelephonyProvider;
  realtimeBridge: OpenAIRealtimeBridge;
  logger?: boolean;
};

export function buildApp({
  service,
  authService,
  creditService,
  contentService,
  allowAnonymousCallsForTesting = false,
  logger = true,
  secureCookies = process.env.NODE_ENV === "production",
  webOrigin = process.env.WEB_ORIGIN,
  endpointRateLimiter = new ApplicationRateLimiter(),
  endpointRateLimitPolicy = defaultEndpointRateLimitPolicy,
  realtimeConfigured = false,
  recipientOptOutService = authService
    ? new RecipientOptOutService({
        repository: service.repository,
        verificationProvider: authService.verificationProvider
      })
    : undefined
}: BuildAppOptions) {
  const app = Fastify({
    logger: logger ? piiSafeLoggerOptions : false,
    logController: new LogController({ disableRequestLogging: logger })
  });
  if (logger) registerPiiSafeRequestLogging(app);
  const webOrigins = resolveWebOrigins(webOrigin);

  void app.register(cors, {
    origin: webOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE", "OPTIONS"]
  });

  async function authorizeCallAccess(
    request: FastifyRequest,
    reply: FastifyReply,
    options: { callId?: string; mutation?: boolean } = {}
  ): Promise<{ userId: string | null; user: User | null } | null> {
    if (
      options.mutation &&
      !hasAllowedOrigin(request.headers.origin, webOrigins)
    ) {
      await reply.status(403).send({ error: "INVALID_ORIGIN" });
      return null;
    }
    if (!authService && !allowAnonymousCallsForTesting) {
      await reply.status(503).send({ error: "AUTHENTICATION_UNAVAILABLE" });
      return null;
    }
    const user = authService
      ? await authService.authenticate(sessionTokenFromHeaders(request.headers))
      : null;
    if (authService && !user) {
      await reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      return null;
    }
    if (user?.role === "content_editor") {
      await reply.status(403).send({ error: "CALL_ACCESS_FORBIDDEN" });
      return null;
    }
    if (
      contentService &&
      user &&
      !(await contentService.hasCurrentAcceptance(user.id))
    ) {
      await reply.status(403).send({ error: "ONBOARDING_REQUIRED" });
      return null;
    }
    const userId = user?.id ?? null;
    if (options.callId) {
      try {
        await service.assertOwned(options.callId, userId);
      } catch (error) {
        await sendRepositoryError(reply, error);
        return null;
      }
    }
    return { userId, user };
  }

  async function authorizeAdminMutation(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
      await reply.status(403).send({ error: "INVALID_ORIGIN" });
      return null;
    }
    return authorizeAdminRead(request, reply);
  }

  async function authorizeAdminRead(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!authService) {
      await reply.status(503).send({ error: "AUTHENTICATION_UNAVAILABLE" });
      return null;
    }
    const user = await authService.authenticate(
      sessionTokenFromHeaders(request.headers)
    );
    if (!user) {
      await reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      return null;
    }
    if (user.role !== "admin" && user.role !== "superadmin") {
      await reply.status(403).send({ error: "ADMIN_ACTION_FORBIDDEN" });
      return null;
    }
    if (
      contentService &&
      !(await contentService.hasCurrentAcceptance(user.id))
    ) {
      await reply.status(403).send({ error: "ONBOARDING_REQUIRED" });
      return null;
    }
    return user;
  }

  async function authorizeSensitiveCallMutation(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
      await reply.status(403).send({ error: "INVALID_ORIGIN" });
      return null;
    }
    const actor = await authorizeAdminRead(request, reply);
    if (!actor) return null;
    if (actor.role !== "superadmin") {
      await reply.status(403).send({
        error: "SENSITIVE_CALL_ACCESS_FORBIDDEN"
      });
      return null;
    }
    return actor;
  }

  async function authorizeContentMutation(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
      await reply.status(403).send({ error: "INVALID_ORIGIN" });
      return null;
    }
    return authorizeContentRead(request, reply);
  }

  async function authorizeContentRead(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!authService) {
      await reply.status(503).send({ error: "AUTHENTICATION_UNAVAILABLE" });
      return null;
    }
    const user = await authService.authenticate(
      sessionTokenFromHeaders(request.headers)
    );
    if (!user) {
      await reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      return null;
    }
    if (!(["content_editor", "admin", "superadmin"] as User["role"][])
      .includes(user.role)) {
      await reply.status(403).send({ error: "CONTENT_ACTION_FORBIDDEN" });
      return null;
    }
    if (
      contentService &&
      !(await contentService.hasCurrentAcceptance(user.id))
    ) {
      await reply.status(403).send({ error: "ONBOARDING_REQUIRED" });
      return null;
    }
    return user;
  }

  async function enforceEndpointRateLimit(
    request: FastifyRequest,
    reply: FastifyReply,
    userId: string | null,
    scope: string,
    rule: EndpointRateLimitRule
  ) {
    const result = endpointRateLimiter.consumeMany([
      {
        scope: `endpoint:${scope}:ip`,
        identifier: request.ip,
        limit: rule.ipLimit,
        windowMs: rule.windowMs
      },
      ...(userId ? [{
        scope: `endpoint:${scope}:user`,
        identifier: userId,
        limit: rule.userLimit,
        windowMs: rule.windowMs
      }] : [])
    ]);
    if (result.allowed) return true;
    await reply
      .header("Retry-After", String(result.retryAfterSeconds))
      .status(429)
      .send({ error: "RATE_LIMITED" });
    return false;
  }

  if (contentService) {
    app.get("/api/content/index", async (_request, reply) => {
      return reply
        .header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
        .send(await contentService.listPublishedContentIndex());
    });

    app.get<{ Querystring: { locale?: string } }>(
      "/api/content/faq",
      async (request, reply) => {
        const locale = contentLocaleSchema.safeParse(request.query.locale);
        if (!locale.success) {
          return reply.status(400).send({ error: "INVALID_CONTENT_LOCALE" });
        }
        const faq = await contentService.getPublishedFaq(locale.data);
        if (!faq) {
          return reply.status(404).send({ error: "EDITORIAL_COLLECTION_NOT_FOUND" });
        }
        return reply
          .header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
          .send({ faq });
      }
    );

    app.get<{ Querystring: { locale?: string } }>(
      "/api/content/landing",
      async (request, reply) => {
        const locale = contentLocaleSchema.safeParse(request.query.locale);
        if (!locale.success) {
          return reply.status(400).send({ error: "INVALID_CONTENT_LOCALE" });
        }
        const landing = await contentService.getPublishedLanding(locale.data);
        if (!landing) {
          return reply.status(404).send({ error: "EDITORIAL_COLLECTION_NOT_FOUND" });
        }
        return reply
          .header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
          .send({ landing });
      }
    );

    app.get<{ Querystring: { locale?: string } }>(
      "/api/content/navigation",
      async (request, reply) => {
        const locale = contentLocaleSchema.safeParse(request.query.locale);
        if (!locale.success) {
          return reply.status(400).send({ error: "INVALID_CONTENT_LOCALE" });
        }
        const navigation = await contentService.getPublishedNavigation(
          locale.data
        );
        if (!navigation) {
          return reply.status(404).send({ error: "EDITORIAL_COLLECTION_NOT_FOUND" });
        }
        return reply
          .header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
          .send({ navigation });
      }
    );

    app.get<{
      Params: { slug: string };
      Querystring: { locale?: string };
    }>("/api/content/pages/:slug", async (request, reply) => {
      const locale = contentLocaleSchema.safeParse(request.query.locale);
      if (!locale.success || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(request.params.slug)) {
        return reply.status(400).send({ error: "INVALID_CONTENT_PAGE_REQUEST" });
      }
      const page = await contentService.getPublishedPage(
        locale.data,
        request.params.slug
      );
      if (!page) return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
      return reply
        .header("Cache-Control", "public, max-age=60, stale-while-revalidate=300")
        .send({ page });
    });
  }

  if (recipientOptOutService) {
    app.post("/api/recipient-opt-out/verification", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = recipientOptOutRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_OPT_OUT_REQUEST" });
      }
      try {
        return reply
          .header("Cache-Control", "no-store")
          .status(202)
          .send(await recipientOptOutService.requestVerification(
            parsed.data,
            { ip: request.ip }
          ));
      } catch (error) {
        return sendRecipientOptOutError(reply, error);
      }
    });

    app.post("/api/recipient-opt-out/confirm", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = recipientOptOutConfirmationSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_OPT_OUT_CONFIRMATION" });
      }
      try {
        return reply
          .header("Cache-Control", "no-store")
          .send(await recipientOptOutService.confirm(
            parsed.data,
            { ip: request.ip }
          ));
      } catch (error) {
        return sendRecipientOptOutError(reply, error);
      }
    });
  }

  if (authService) {
    app.post("/api/auth/register", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = registrationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_REGISTRATION",
          issues: parsed.error.flatten()
        });
      }
      try {
        return reply
          .status(202)
          .send(await authService.register(parsed.data, authContext(request)));
      } catch (error) {
        return sendAuthError(reply, error);
      }
    });

    app.post("/api/auth/verification/resend", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = verificationResendInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_VERIFICATION_REQUEST" });
      }
      try {
        return reply.status(202).send(
          await authService.resendVerification(parsed.data, authContext(request))
        );
      } catch (error) {
        return sendAuthError(reply, error);
      }
    });

    app.post("/api/auth/verify-phone", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = phoneVerificationInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_VERIFICATION_REQUEST" });
      }
      try {
        const session = await authService.verifyPhone(
          parsed.data,
          authContext(request)
        );
        setSessionCookie(reply, session.token, session.expiresAt, secureCookies);
        return reply
          .header("Cache-Control", "private, no-store")
          .send({ user: session.user });
      } catch (error) {
        return sendAuthError(reply, error);
      }
    });

    app.post("/api/auth/login", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const parsed = loginInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_LOGIN" });
      }
      try {
        const session = await authService.login(parsed.data, authContext(request));
        setSessionCookie(reply, session.token, session.expiresAt, secureCookies);
        return reply
          .header("Cache-Control", "private, no-store")
          .send({ user: session.user });
      } catch (error) {
        return sendAuthError(reply, error);
      }
    });

    app.post("/api/auth/logout", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      await authService.logout(sessionTokenFromHeaders(request.headers));
      clearSessionCookie(reply, secureCookies);
      return reply.status(204).send();
    });

    app.post("/api/auth/sessions/revoke", async (request, reply) => {
      if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
        return reply.status(403).send({ error: "INVALID_ORIGIN" });
      }
      const user = await authService.authenticate(
        sessionTokenFromHeaders(request.headers)
      );
      if (!user) {
        return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      }
      await authService.revokeAllSessions(user.id);
      clearSessionCookie(reply, secureCookies);
      return reply.status(204).send();
    });

    app.get("/api/auth/me", async (request, reply) => {
      const user = await authService.authenticate(
        sessionTokenFromHeaders(request.headers)
      );
      if (!user) return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      return reply
        .header("Cache-Control", "private, no-store")
        .send({ user });
    });

    if (contentService) {
      app.get<{
        Querystring: { locale?: string };
      }>("/api/onboarding/status", async (request, reply) => {
        const user = await authService.authenticate(
          sessionTokenFromHeaders(request.headers)
        );
        if (!user) {
          return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
        }
        const locale = contentLocaleSchema.safeParse(
          request.query.locale ?? user.uiLocale
        );
        if (!locale.success) {
          return reply.status(400).send({ error: "INVALID_CONTENT_LOCALE" });
        }
        return reply
          .header("Cache-Control", "private, no-store")
          .send(await contentService.getOnboardingStatus(user.id, locale.data));
      });

      app.post("/api/onboarding/accept", async (request, reply) => {
        if (!hasAllowedOrigin(request.headers.origin, webOrigins)) {
          return reply.status(403).send({ error: "INVALID_ORIGIN" });
        }
        const user = await authService.authenticate(
          sessionTokenFromHeaders(request.headers)
        );
        if (!user) {
          return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
        }
        const parsed = onboardingAcceptanceInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_ONBOARDING_ACCEPTANCE" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await contentService.acceptOnboarding(user.id, parsed.data));
        } catch (error) {
          return sendContentError(reply, error);
        }
      });

      app.get("/api/admin/content/pages", async (request, reply) => {
        const actor = await authorizeContentRead(request, reply);
        if (!actor) return;
        return reply
          .header("Cache-Control", "private, no-store")
          .send({ pages: await contentService.listAdminPages() });
      });

      app.get<{
        Params: { key: string };
        Querystring: { locale?: string };
      }>("/api/admin/content/pages/:key", async (request, reply) => {
        const actor = await authorizeContentRead(request, reply);
        if (!actor) return;
        const key = contentPageKeySchema.safeParse(request.params.key);
        const locale = contentLocaleSchema.safeParse(request.query.locale);
        if (!key.success || !locale.success) {
          return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await contentService.getAdminPage(key.data, locale.data));
        } catch (error) {
          return sendContentError(reply, error);
        }
      });

      app.get<{
        Params: { key: string };
        Querystring: { locale?: string };
      }>("/api/admin/content/pages/:key/preview", async (request, reply) => {
        const actor = await authorizeContentRead(request, reply);
        if (!actor) return;
        const key = contentPageKeySchema.safeParse(request.params.key);
        const locale = contentLocaleSchema.safeParse(request.query.locale);
        if (!key.success || !locale.success) {
          return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send({
              page: await contentService.getAdminPreview(key.data, locale.data)
            });
        } catch (error) {
          return sendContentError(reply, error);
        }
      });

      app.get<{ Params: { key: string } }>(
        "/api/admin/content/pages/:key/revisions",
        async (request, reply) => {
          const actor = await authorizeContentRead(request, reply);
          if (!actor) return;
          const key = contentPageKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
          }
          return reply
            .header("Cache-Control", "private, no-store")
            .send({
              revisions: await contentService.listAdminRevisions(key.data)
            });
        }
      );

      app.post<{ Params: { key: string } }>(
        "/api/admin/content/pages/:key/drafts",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = contentPageKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
          }
          try {
            return reply.status(201).send({
              draft: await contentService.createDraft(actor.id, key.data)
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.put<{ Params: { key: string } }>(
        "/api/admin/content/pages/:key/draft",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = contentPageKeySchema.safeParse(request.params.key);
          const input = contentDraftUpdateInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
          }
          if (!input.success) {
            return reply.status(400).send({
              error: "INVALID_CONTENT_DRAFT",
              issues: input.error.flatten()
            });
          }
          try {
            return reply.send({
              draft: await contentService.updateDraft(
                actor.id,
                key.data,
                input.data
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.post<{ Params: { key: string } }>(
        "/api/admin/content/pages/:key/publish",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = contentPageKeySchema.safeParse(request.params.key);
          const input = contentAdminActionInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
          }
          if (!input.success) {
            return reply.status(400).send({ error: "INVALID_CONTENT_ACTION" });
          }
          try {
            return reply.send({
              revision: await contentService.publishDraft(
                actor.id,
                key.data,
                input.data.reason
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.post<{
        Params: { key: string; revisionNumber: string };
      }>(
        "/api/admin/content/pages/:key/revisions/:revisionNumber/rollback",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = contentPageKeySchema.safeParse(request.params.key);
          const revisionNumber = Number(request.params.revisionNumber);
          const input = contentAdminActionInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({ error: "CONTENT_PAGE_NOT_FOUND" });
          }
          if (
            !Number.isInteger(revisionNumber) ||
            revisionNumber < 1 ||
            !input.success
          ) {
            return reply.status(400).send({ error: "INVALID_CONTENT_ACTION" });
          }
          try {
            return reply.status(201).send({
              draft: await contentService.createRollbackDraft(
                actor.id,
                key.data,
                revisionNumber,
                input.data.reason
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.get<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key",
        async (request, reply) => {
          const actor = await authorizeContentRead(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          try {
            return reply
              .header("Cache-Control", "private, no-store")
              .send(await contentService.getAdminEditorialCollection(key.data));
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.get<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key/preview",
        async (request, reply) => {
          const actor = await authorizeContentRead(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          try {
            return reply
              .header("Cache-Control", "private, no-store")
              .send({
                draft: await contentService.getAdminEditorialPreview(key.data)
              });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.get<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key/revisions",
        async (request, reply) => {
          const actor = await authorizeContentRead(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          return reply
            .header("Cache-Control", "private, no-store")
            .send({
              revisions: await contentService.listAdminEditorialRevisions(
                key.data
              )
            });
        }
      );

      app.post<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key/drafts",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          try {
            return reply.status(201).send({
              draft: await contentService.createEditorialDraft(
                actor.id,
                key.data
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.put<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key/draft",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          const input = editorialDraftUpdateInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          if (!input.success) {
            return reply.status(400).send({
              error: "INVALID_EDITORIAL_DRAFT",
              issues: input.error.flatten()
            });
          }
          try {
            return reply.send({
              draft: await contentService.updateEditorialDraft(
                actor.id,
                key.data,
                input.data
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.post<{ Params: { key: string } }>(
        "/api/admin/content/editorial/:key/publish",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          const input = contentAdminActionInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          if (!input.success) {
            return reply.status(400).send({ error: "INVALID_CONTENT_ACTION" });
          }
          try {
            return reply.send({
              revision: await contentService.publishEditorialDraft(
                actor.id,
                key.data,
                input.data.reason
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );

      app.post<{
        Params: { key: string; revisionNumber: string };
      }>(
        "/api/admin/content/editorial/:key/revisions/:revisionNumber/rollback",
        async (request, reply) => {
          const actor = await authorizeContentMutation(request, reply);
          if (!actor) return;
          const key = editorialCollectionKeySchema.safeParse(request.params.key);
          const revisionNumber = Number(request.params.revisionNumber);
          const input = contentAdminActionInputSchema.safeParse(request.body);
          if (!key.success) {
            return reply.status(404).send({
              error: "EDITORIAL_COLLECTION_NOT_FOUND"
            });
          }
          if (
            !Number.isInteger(revisionNumber) ||
            revisionNumber < 1 ||
            !input.success
          ) {
            return reply.status(400).send({ error: "INVALID_CONTENT_ACTION" });
          }
          try {
            return reply.status(201).send({
              draft: await contentService.createEditorialRollbackDraft(
                actor.id,
                key.data,
                revisionNumber,
                input.data.reason
              )
            });
          } catch (error) {
            return sendContentError(reply, error);
          }
        }
      );
    }

    app.get("/api/usage", async (request, reply) => {
      const access = await authorizeCallAccess(request, reply);
      if (!access) return;
      if (!access.userId) {
        return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      }
      return reply
        .header("Cache-Control", "private, no-store")
        .send(await service.getCreditUsage(access.userId));
    });

    if (creditService) {
      app.post("/api/credits/promo-redemptions", async (request, reply) => {
        const access = await authorizeCallAccess(request, reply, {
          mutation: true
        });
        if (!access?.user) return;
        const parsed = promoRedemptionInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_PROMO_REDEMPTION" });
        }
        if (!await enforceEndpointRateLimit(
          request,
          reply,
          access.userId,
          "promo-redemption",
          endpointRateLimitPolicy.promoRedemption
        )) return;
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await creditService.redeem(access.user, parsed.data));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      });

      app.post("/api/admin/promo-codes", async (request, reply) => {
        const actor = await authorizeAdminMutation(request, reply);
        if (!actor) return;
        const parsed = promoCodeCreateInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_PROMO_CODE" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await creditService.createPromoCode(actor, parsed.data));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      });

      app.post("/api/admin/credit-grants", async (request, reply) => {
        const actor = await authorizeAdminMutation(request, reply);
        if (!actor) return;
        const parsed = adminCreditGrantInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_CREDIT_GRANT" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await creditService.grantAdminCredits(actor, parsed.data));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      });
    }

    app.get("/api/admin/call-outcome-metrics", async (request, reply) => {
      const actor = await authorizeAdminRead(request, reply);
      if (!actor) return;
      return reply
        .header("Cache-Control", "private, no-store")
        .send(await service.getOutcomeMetrics());
    });

    app.get<{ Querystring: { window?: string } }>(
      "/api/admin/operations/overview",
      async (request, reply) => {
        const actor = await authorizeAdminRead(request, reply);
        if (!actor) return;
        const window = adminOperationsWindowSchema.safeParse(
          request.query.window ?? "24h"
        );
        if (!window.success) {
          return reply.status(400).send({
            error: "INVALID_ADMIN_OPERATIONS_WINDOW"
          });
        }
        return reply
          .header("Cache-Control", "private, no-store")
          .send(await service.getAdminOperationsOverview(window.data));
      }
    );

    app.get("/api/admin/system", async (request, reply) => {
      const actor = await authorizeAdminRead(request, reply);
      if (!actor) return;
      return reply
        .header("Cache-Control", "private, no-store")
        .send(await service.getAdminSystemStatus(realtimeConfigured));
    });

    app.put("/api/admin/system/outbound-calls", async (request, reply) => {
      const actor = await authorizeAdminMutation(request, reply);
      if (!actor) return;
      const parsed = adminOutboundCallControlInputSchema.safeParse(
        request.body
      );
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_OUTBOUND_CALL_CONTROL"
        });
      }
      if (parsed.data.enabled && actor.role !== "superadmin") {
        return reply.status(403).send({
          error: "OUTBOUND_CALL_ENABLE_FORBIDDEN"
        });
      }
      await service.repository.setOutboundCallsEnabled(parsed.data.enabled, {
        actorUserId: actor.id,
        reason: parsed.data.reason
      });
      return reply
        .header("Cache-Control", "private, no-store")
        .send(await service.getAdminSystemStatus(realtimeConfigured));
    });

    app.post<{ Params: { jobId: string } }>(
      "/api/admin/system/jobs/:jobId/retry",
      async (request, reply) => {
        const actor = await authorizeAdminMutation(request, reply);
        if (!actor) return;
        if (actor.role !== "superadmin") {
          return reply.status(403).send({
            error: "DURABLE_JOB_RETRY_FORBIDDEN"
          });
        }
        if (!isUuid(request.params.jobId)) {
          return reply.status(400).send({ error: "INVALID_DURABLE_JOB_ID" });
        }
        const parsed = adminDurableJobRetryInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: "INVALID_DURABLE_JOB_RETRY"
          });
        }
        try {
          await service.retryAdminDurableJob(
            request.params.jobId,
            actor.id,
            parsed.data.reason
          );
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await service.getAdminSystemStatus(realtimeConfigured));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      }
    );

    app.get<{
      Querystring: {
        limit?: string;
        cursor?: string;
        status?: string;
        outcome?: string;
        consent?: string;
        failureStage?: string;
        locale?: string;
        dateFrom?: string;
        dateTo?: string;
      };
    }>("/api/admin/calls", async (request, reply) => {
      const actor = await authorizeAdminRead(request, reply);
      if (!actor) return;
      const limit = request.query.limit === undefined
        ? 20
        : Number(request.query.limit);
      const filters = adminCallListFiltersSchema.safeParse({
        ...(request.query.status ? { status: request.query.status } : {}),
        ...(request.query.outcome ? { outcome: request.query.outcome } : {}),
        ...(request.query.consent ? { consent: request.query.consent } : {}),
        ...(request.query.failureStage
          ? { failureStage: request.query.failureStage }
          : {}),
        ...(request.query.locale ? { locale: request.query.locale } : {}),
        ...(request.query.dateFrom
          ? { dateFrom: request.query.dateFrom }
          : {}),
        ...(request.query.dateTo ? { dateTo: request.query.dateTo } : {})
      });
      const cursor = request.query.cursor
        ? decodeAdminCallCursor(request.query.cursor)
        : undefined;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > ADMIN_CALL_LIST_LIMIT_MAX ||
        !filters.success ||
        (request.query.cursor !== undefined && !cursor)
      ) {
        return reply.status(400).send({ error: "INVALID_ADMIN_CALL_QUERY" });
      }
      return reply
        .header("Cache-Control", "private, no-store")
        .send(await service.listAdminCalls(
          filters.data,
          limit,
          cursor ?? undefined
        ));
    });

    app.get<{ Params: { id: string } }>(
      "/api/admin/calls/:id",
      async (request, reply) => {
        const actor = await authorizeAdminRead(request, reply);
        if (!actor) return;
        if (!isUuid(request.params.id)) {
          return reply.status(404).send({ error: "CALL_NOT_FOUND" });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await service.getAdminCallInspector(request.params.id));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      }
    );

    app.post<{ Params: { id: string } }>(
      "/api/admin/calls/:id/sensitive-access",
      async (request, reply) => {
        const actor = await authorizeSensitiveCallMutation(request, reply);
        if (!actor) return;
        if (!isUuid(request.params.id)) {
          return reply.status(404).send({ error: "CALL_NOT_FOUND" });
        }
        const parsed = sensitiveCallAccessInputSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({
            error: "INVALID_SENSITIVE_CALL_ACCESS"
          });
        }
        try {
          return reply
            .header("Cache-Control", "private, no-store")
            .send(await service.getAdminCallSensitiveContent(
              request.params.id,
              actor.id,
              parsed.data.reason
            ));
        } catch (error) {
          return sendRepositoryError(reply, error);
        }
      }
    );

    app.get<{
      Querystring: {
        limit?: string;
        cursor?: string;
        search?: string;
        role?: string;
        status?: string;
      };
    }>("/api/admin/users", async (request, reply) => {
      const actor = await authorizeAdminRead(request, reply);
      if (!actor) return;
      const limit = request.query.limit === undefined
        ? 20
        : Number(request.query.limit);
      const searchValue = request.query.search?.trim() || undefined;
      const search = searchValue
        ? adminUserSearchSchema.safeParse(searchValue)
        : null;
      const role = request.query.role
        ? userRoleSchema.safeParse(request.query.role)
        : null;
      const status = request.query.status
        ? userStatusSchema.safeParse(request.query.status)
        : null;
      const cursor = request.query.cursor
        ? decodeAdminUserCursor(request.query.cursor)
        : undefined;
      if (
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 50 ||
        (search !== null && !search.success) ||
        (role !== null && !role.success) ||
        (status !== null && !status.success) ||
        (request.query.cursor !== undefined && !cursor)
      ) {
        return reply.status(400).send({ error: "INVALID_ADMIN_USER_QUERY" });
      }
      try {
        return reply
          .header("Cache-Control", "private, no-store")
          .send(await authService.listUsersAsAdmin(actor, {
            limit,
            ...(search?.success ? { search: search.data } : {}),
            ...(role?.success ? { role: role.data } : {}),
            ...(status?.success ? { status: status.data } : {}),
            ...(cursor ? { cursor } : {})
          }));
      } catch (error) {
        return sendAuthError(reply, error);
      }
    });

    app.get<{ Params: { userId: string } }>(
      "/api/admin/users/:userId/credits",
      async (request, reply) => {
        const actor = await authorizeAdminRead(request, reply);
        if (!actor) return;
        if (!isUuid(request.params.userId)) {
          return reply.status(404).send({ error: "USER_NOT_FOUND" });
        }
        try {
          const user = await authService.findUserAsAdmin(
            actor,
            request.params.userId
          );
          const usage = await service.getCreditUsage(user.id);
          return reply
            .header("Cache-Control", "private, no-store")
            .send({ user, usage });
        } catch (error) {
          return sendAuthError(reply, error);
        }
      }
    );

    app.put<{ Params: { userId: string } }>(
      "/api/admin/users/:userId/status",
      async (request, reply) => {
        const actor = await authorizeAdminMutation(request, reply);
        if (!actor) return;
        if (!isUuid(request.params.userId)) {
          return reply.status(404).send({ error: "USER_NOT_FOUND" });
        }
        const parsed = accountStatusActionSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_ACCOUNT_STATUS_ACTION" });
        }
        try {
          const user = await authService.changeAccountStatus(
            actor,
            request.params.userId,
            parsed.data.status,
            parsed.data.reason
          );
          return reply
            .header("Cache-Control", "private, no-store")
            .send({ user });
        } catch (error) {
          return sendAuthError(reply, error);
        }
      }
    );

    app.post<{ Params: { userId: string } }>(
      "/api/admin/users/:userId/sessions/revoke",
      async (request, reply) => {
        const actor = await authorizeAdminMutation(request, reply);
        if (!actor) return;
        if (!isUuid(request.params.userId)) {
          return reply.status(404).send({ error: "USER_NOT_FOUND" });
        }
        const parsed = sessionRevocationActionSchema.safeParse(request.body);
        if (!parsed.success) {
          return reply.status(400).send({ error: "INVALID_SESSION_REVOCATION_ACTION" });
        }
        try {
          await authService.revokeUserSessionsAsAdmin(
            actor,
            request.params.userId,
            parsed.data.reason
          );
          return reply.status(204).send();
        } catch (error) {
          return sendAuthError(reply, error);
        }
      }
    );

    app.post("/api/admin/recipient-suppressions", async (request, reply) => {
      const actor = await authorizeAdminMutation(request, reply);
      if (!actor) return;
      const parsed = staffRecipientSuppressionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_RECIPIENT_SUPPRESSION" });
      }
      const created = await service.repository.suppressRecipient({
        ...parsed.data,
        actorUserId: actor.id
      });
      return reply
        .header("Cache-Control", "private, no-store")
        .send({ status: created ? "suppressed" : "already_suppressed" });
    });

    app.post("/api/admin/recipient-suppressions/lift", async (request, reply) => {
      const actor = await authorizeAdminMutation(request, reply);
      if (!actor) return;
      const parsed = staffRecipientSuppressionLiftSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_RECIPIENT_SUPPRESSION_LIFT" });
      }
      const lifted = await service.repository.liftRecipientSuppression(
        parsed.data.phoneE164,
        { reason: parsed.data.reason, actorUserId: actor.id }
      );
      return reply
        .header("Cache-Control", "private, no-store")
        .send({ status: lifted ? "lifted" : "not_suppressed" });
    });
  }

  app.get("/health/live", async (_request, reply) => {
    return reply
      .header("Cache-Control", "no-store")
      .send(serviceLivenessSchema.parse({ status: "alive" }));
  });

  app.get("/health/ready", async (_request, reply) => {
    try {
      await service.ping();
      return reply
        .header("Cache-Control", "no-store")
        .send(serviceReadinessSchema.parse({
          status: "ready",
          checks: { database: "ready" }
        }));
    } catch {
      return reply
        .header("Cache-Control", "no-store")
        .status(503)
        .send(serviceReadinessSchema.parse({
          status: "not_ready",
          checks: { database: "unavailable" }
        }));
    }
  });

  app.get<{
    Querystring: { limit?: string; cursor?: string; search?: string; status?: string };
  }>("/api/call-briefs", async (request, reply) => {
    const access = await authorizeCallAccess(request, reply);
    if (!access) return;
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
      userId: access.userId,
      ...(cursor ? { cursor } : {}),
      ...(search ? { search } : {}),
      ...(status?.success ? { status: status.data } : {})
    });
  });

  app.post("/api/call-briefs", async (request, reply) => {
    const access = await authorizeCallAccess(request, reply, { mutation: true });
    if (!access) return;
    const parsed = createCallBriefInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: "INVALID_CALL_BRIEF",
        issues: parsed.error.flatten()
      });
    }
    if (!(await enforceEndpointRateLimit(
      request,
      reply,
      access.userId,
      "brief-preparation",
      endpointRateLimitPolicy.briefPreparation
    ))) return;

    try {
      return reply.status(201).send(
        await service.create(parsed.data, access.userId)
      );
    } catch (error) {
      logCallPreparationError(request.log, error);
      return sendRepositoryError(reply, error);
    }
  });

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id
      });
      if (!access) return;
      const snapshot = await service.get(request.params.id);
      if (!snapshot) return reply.status(404).send({ error: "CALL_NOT_FOUND" });
      return snapshot;
    }
  );

  app.get<{ Params: { id: string } }>(
    "/api/call-briefs/:id/outcome",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id
      });
      if (!access) return;
      try {
        return reply
          .header("Cache-Control", "private, no-store")
          .send(await service.getOutcome(request.params.id));
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/call-briefs/:id/feedback",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
      if (!access.userId) {
        return reply.status(401).send({ error: "AUTHENTICATION_REQUIRED" });
      }
      const parsed = ownerCallFeedbackInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: "INVALID_CALL_FEEDBACK" });
      }
      try {
        return reply
          .header("Cache-Control", "private, no-store")
          .send(await service.submitOwnerFeedback(
            request.params.id,
            access.userId,
            parsed.data
          ));
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.put<{ Params: { id: string } }>(
    "/api/call-briefs/:id",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
      const parsed = createCallBriefInputSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "INVALID_CALL_BRIEF",
          issues: parsed.error.flatten()
        });
      }
      if (!(await enforceEndpointRateLimit(
        request,
        reply,
        access.userId,
        "brief-preparation",
        endpointRateLimitPolicy.briefPreparation
      ))) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id
      });
      if (!access) return;
      if (!(await enforceEndpointRateLimit(
        request,
        reply,
        access.userId,
        "recording-download",
        endpointRateLimitPolicy.recordingDownload
      ))) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
      if (!(await enforceEndpointRateLimit(
        request,
        reply,
        access.userId,
        "transcription-retry",
        endpointRateLimitPolicy.transcriptionRetry
      ))) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
      if (!(await enforceEndpointRateLimit(
        request,
        reply,
        access.userId,
        "call-start",
        endpointRateLimitPolicy.callStart
      ))) return;
      try {
        return await service.approveAndStart(request.params.id, access.userId);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/start",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
      if (!(await enforceEndpointRateLimit(
        request,
        reply,
        access.userId,
        "call-start",
        endpointRateLimitPolicy.callStart
      ))) return;
      try {
        return await service.start(request.params.id, access.userId);
      } catch (error) {
        return sendRepositoryError(reply, error);
      }
    }
  );

  app.post<{ Params: { id: string } }>(
    "/api/call-briefs/:id/stop",
    async (request, reply) => {
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id,
        mutation: true
      });
      if (!access) return;
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
      const access = await authorizeCallAccess(request, reply, {
        callId: request.params.id
      });
      if (!access) return;
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
        headers["Access-Control-Allow-Credentials"] = "true";
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
    await Promise.all([
      service.close(),
      authService?.close(),
      contentService?.close()
    ]);
  });

  return app;
}

const sessionCookieName = "callassist_session";

function authContext(request: {
  ip: string;
  headers: { "user-agent"?: string };
}) {
  return { ip: request.ip, userAgent: request.headers["user-agent"] };
}

function hasAllowedOrigin(origin: string | undefined, webOrigins: string[]) {
  return origin === undefined || webOrigins.includes(origin);
}

function sessionTokenFromHeaders(headers: { cookie?: string }) {
  const cookie = headers.cookie;
  if (!cookie) return undefined;
  for (const part of cookie.split(";")) {
    const [name, ...valueParts] = part.trim().split("=");
    if (name === sessionCookieName) return valueParts.join("=") || undefined;
  }
  return undefined;
}

function setSessionCookie(
  reply: { header(name: string, value: string): unknown },
  token: string,
  expiresAt: string,
  secure: boolean
) {
  const maxAge = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1_000)
  );
  reply.header(
    "Set-Cookie",
    [
      `${sessionCookieName}=${token}`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
      `Expires=${new Date(expiresAt).toUTCString()}`,
      ...(secure ? ["Secure"] : [])
    ].join("; ")
  );
}

function clearSessionCookie(
  reply: { header(name: string, value: string): unknown },
  secure: boolean
) {
  reply.header(
    "Set-Cookie",
    [
      `${sessionCookieName}=`,
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      "Max-Age=0",
      "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
      ...(secure ? ["Secure"] : [])
    ].join("; ")
  );
}

function sendAuthError(
  reply: {
    header(name: string, value: string): unknown;
    status(code: number): { send(payload: unknown): unknown };
  },
  error: unknown
) {
  if (!(error instanceof AuthServiceError)) throw error;
  if (error.code === "RATE_LIMITED") {
    reply.header("Retry-After", String(error.retryAfterSeconds ?? 1));
    return reply.status(429).send({ error: error.code });
  }
  const status = error.code === "VERIFICATION_UNAVAILABLE"
    ? 503
    : error.code === "INVALID_CREDENTIALS" || error.code === "INVALID_VERIFICATION"
      ? 401
      : error.code === "USER_NOT_FOUND"
        ? 404
        : [
            "ACCOUNT_STATUS_UNCHANGED",
            "ACCOUNT_STATUS_TRANSITION_INVALID"
          ].includes(error.code)
          ? 409
          : 403;
  return reply.status(status).send({ error: error.code });
}

function sendRecipientOptOutError(
  reply: {
    header(name: string, value: string): unknown;
    status(code: number): { send(payload: unknown): unknown };
  },
  error: unknown
) {
  if (!(error instanceof RecipientOptOutServiceError)) throw error;
  if (error.code === "RATE_LIMITED") {
    reply.header("Retry-After", String(error.retryAfterSeconds ?? 1));
    return reply.status(429).send({ error: error.code });
  }
  return reply
    .status(error.code === "VERIFICATION_UNAVAILABLE" ? 503 : 401)
    .send({ error: error.code });
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
  const app = Fastify({
    logger: logger ? piiSafeLoggerOptions : false,
    logController: new LogController({ disableRequestLogging: logger })
  });
  if (logger) registerPiiSafeRequestLogging(app);
  async function recordWebhookDelivery(
    request: FastifyRequest,
    input: ProviderWebhookDeliveryInput
  ) {
    try {
      await service.recordProviderWebhookDelivery(input);
    } catch (error) {
      request.log.error(error, "Failed to record provider webhook delivery");
    }
  }
  void app.register(async (routes) => {
    await routes.register(websocket);
    await routes.register(formbody);

    routes.post<{ Querystring: { callBriefId?: string } }>(
      "/webhooks/twilio/voice",
      async (request, reply) => {
        const receivedAt = new Date().toISOString();
        const parameters = normalizeTwilioParameters(request.body);
        if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
          await recordWebhookDelivery(request, {
            kind: "voice",
            outcome: "rejected",
            receivedAt,
            errorCode: "INVALID_TWILIO_SIGNATURE"
          });
          return reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
        }

        const callBriefId = request.query.callBriefId;
        if (!callBriefId) {
          await recordWebhookDelivery(request, {
            kind: "voice",
            outcome: "rejected",
            receivedAt,
            errorCode: "CALL_BRIEF_ID_REQUIRED"
          });
          return reply.status(400).send({ error: "CALL_BRIEF_ID_REQUIRED" });
        }
        try {
          const snapshot = await service.get(callBriefId);
          if (!snapshot) {
            await recordWebhookDelivery(request, {
              kind: "voice",
              outcome: "unmatched",
              receivedAt,
              errorCode: "CALL_NOT_FOUND"
            });
            return reply.status(404).send({ error: "CALL_NOT_FOUND" });
          }
          const twiml = twilioProvider.createVoiceTwiml(snapshot.brief);
          await recordWebhookDelivery(request, {
            kind: "voice",
            outcome: "accepted",
            receivedAt
          });
          return reply.type("text/xml; charset=utf-8").send(twiml);
        } catch (error) {
          await recordWebhookDelivery(request, {
            kind: "voice",
            outcome: "failed",
            receivedAt,
            errorCode: webhookProcessingErrorCode(error)
          });
          throw error;
        }
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
        const receivedAt = new Date().toISOString();
        const parameters = normalizeTwilioParameters(request.body);
        if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
          await recordWebhookDelivery(request, {
            kind: "call_status",
            outcome: "rejected",
            receivedAt,
            errorCode: "INVALID_TWILIO_SIGNATURE"
          });
          return reply.status(403).send({ error: "INVALID_TWILIO_SIGNATURE" });
        }

        const providerCallId = parameters.CallSid;
        const status = parameters.CallStatus;
        if (
          !providerCallId ||
          !status ||
          !isTwilioCallStatusCallbackValue(status)
        ) {
          await recordWebhookDelivery(request, {
            kind: "call_status",
            outcome: "rejected",
            receivedAt,
            errorCode: "INVALID_TWILIO_STATUS"
          });
          return reply.status(400).send({ error: "INVALID_TWILIO_STATUS" });
        }

        try {
          const snapshot = await service.handleTwilioStatus(
            providerCallId,
            status,
            request.query.callBriefId
          );
          await recordWebhookDelivery(request, snapshot
            ? { kind: "call_status", outcome: "accepted", receivedAt }
            : {
                kind: "call_status",
                outcome: "unmatched",
                receivedAt,
                errorCode: "WEBHOOK_TARGET_NOT_FOUND"
              });
          return reply.status(204).send();
        } catch (error) {
          await recordWebhookDelivery(request, {
            kind: "call_status",
            outcome: "failed",
            receivedAt,
            errorCode: webhookProcessingErrorCode(error)
          });
          throw error;
        }
      }
    );

    routes.post<{
      Querystring: { callBriefId?: string; recordingId?: string };
    }>("/webhooks/twilio/recording", async (request, reply) => {
      const receivedAt = new Date().toISOString();
      const parameters = normalizeTwilioParameters(request.body);
      if (!isValidTwilioWebhook(request, twilioProvider, parameters)) {
        await recordWebhookDelivery(request, {
          kind: "recording_status",
          outcome: "rejected",
          receivedAt,
          errorCode: "INVALID_TWILIO_SIGNATURE"
        });
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
        await recordWebhookDelivery(request, {
          kind: "recording_status",
          outcome: "rejected",
          receivedAt,
          errorCode: "INVALID_TWILIO_RECORDING_STATUS"
        });
        return reply.status(400).send({ error: "INVALID_TWILIO_RECORDING_STATUS" });
      }

      try {
        const snapshot = await service.handleTwilioRecordingStatus({
          callBriefId,
          recordingId,
          providerCallId,
          providerRecordingId,
          providerStatus: providerStatus as TwilioRecordingStatus,
          durationSeconds: optionalNonNegativeNumber(
            parameters.RecordingDuration
          ),
          channels: optionalPositiveNumber(parameters.RecordingChannels),
          startedAt: optionalIsoDate(parameters.RecordingStartTime),
          failureReason: parameters.RecordingErrorCode
        });
        await recordWebhookDelivery(request, snapshot
          ? { kind: "recording_status", outcome: "accepted", receivedAt }
          : {
              kind: "recording_status",
              outcome: "unmatched",
              receivedAt,
              errorCode: "WEBHOOK_TARGET_NOT_FOUND"
            });
        return reply.status(204).send();
      } catch (error) {
        await recordWebhookDelivery(request, {
          kind: "recording_status",
          outcome: "failed",
          receivedAt,
          errorCode: webhookProcessingErrorCode(error)
        });
        throw error;
      }
    });
  });

  return app;
}

function sendContentError(
  reply: { status(code: number): { send(payload: unknown): unknown } },
  error: unknown
) {
  if (error instanceof ContentRepositoryError) {
    const status = [
      "LEGAL_REVISION_CHANGED",
      "CONTENT_DRAFT_EXISTS",
      "EDITORIAL_DRAFT_EXISTS",
      "EDITORIAL_DESTINATION_UNAVAILABLE"
    ]
      .includes(error.code)
      ? 409
      : [
          "USER_NOT_FOUND",
          "CONTENT_PAGE_NOT_FOUND",
          "CONTENT_DRAFT_NOT_FOUND",
          "CONTENT_REVISION_NOT_FOUND",
          "EDITORIAL_COLLECTION_NOT_FOUND",
          "EDITORIAL_DRAFT_NOT_FOUND",
          "EDITORIAL_REVISION_NOT_FOUND"
        ].includes(error.code)
        ? 404
        : [
            "CONTENT_REACCEPTANCE_INVALID",
            "EDITORIAL_COLLECTION_MISMATCH"
          ].includes(error.code)
          ? 400
          : 503;
    return reply.status(status).send({ error: error.code });
  }
  throw error;
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

function webhookProcessingErrorCode(error: unknown) {
  if (error instanceof CallRepositoryError || error instanceof CallServiceError) {
    return error.code;
  }
  return "WEBHOOK_PROCESSING_FAILED";
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
      error.code === "SWISS_DESTINATION_REQUIRED"
        ? 422
        : error.code === "RECORDING_NOT_AVAILABLE"
        ? 409
        : error.code === "BRIEF_COMPILER_UNAVAILABLE"
          ? 503
          : 502;
    return reply.status(status).send({ error: error.code });
  }

  if (error instanceof CallRepositoryError) {
    const status = ["CALL_NOT_FOUND", "DURABLE_JOB_NOT_FOUND"]
      .includes(error.code)
      ? 404
      : error.code === "CREDIT_USER_NOT_FOUND"
        ? 404
      : error.code === "OUTBOUND_CALLS_DISABLED"
        ? 503
        : error.code === "RECIPIENT_SUPPRESSED"
          ? 403
          : [
              "CREDIT_ADMIN_ACTION_FORBIDDEN",
              "CREDIT_SELF_GRANT_FORBIDDEN"
            ].includes(error.code)
            ? 403
          : error.code === "PROMO_CODE_UNAVAILABLE"
            ? 404
          : [
              "HOURLY_CALL_LIMIT",
              "DAILY_CALL_LIMIT",
              "RECIPIENT_REPEAT_LIMIT"
            ].includes(error.code)
            ? 429
            : 409;
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
