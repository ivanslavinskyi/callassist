import type { AddressInfo } from "node:net";
import type { CreateCallBriefInput } from "@callassist/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import { ApplicationRateLimiter } from "./auth/rate-limiter";
import { CallService } from "./call-service";
import type { EndpointRateLimitPolicy } from "./config/endpoint-rate-limit-policy";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import type { TelephonyProvider } from "./telephony/telephony-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp() {
  return createAppWithService().app;
}

function createAppWithService() {
  const service = new CallService(
    new InMemoryCallRepository(),
    undefined,
    () => undefined,
    undefined
  );
  const app = buildApp({
    service,
    allowAnonymousCallsForTesting: true,
    logger: false
  });
  apps.push(app);
  return { app, service };
}

describe("call API", () => {
  it("paginates and searches call briefs with an opaque cursor", async () => {
    const { app, service } = createAppWithService();
    for (const [index, recipientName] of ["Alpha Office", "Beta Clinic", "Gamma Council"].entries()) {
      await service.create({
          recipientName,
          phoneNumber: `+4171000000${index}`,
          objective: `Ask ${recipientName} for opening hours`,
          assistantProfileId: "sebastian",
          representedPersonFirstName: "Nina",
          representedPersonLastName: "Keller",
          assistanceReason: "speech_impairment",
          locale: "en-GB",
          allowLanguageSwitch: false,
          allowedFacts: []
      });
    }

    const first = await app.inject({ method: "GET", url: "/api/call-briefs?limit=2" });
    expect(first.statusCode).toBe(200);
    const firstPage = first.json<{ items: unknown[]; nextCursor: string | null }>();
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).toBeTypeOf("string");

    const second = await app.inject({
      method: "GET",
      url: `/api/call-briefs?limit=2&cursor=${encodeURIComponent(firstPage.nextCursor!)}`
    });
    expect(second.json<{ items: unknown[]; nextCursor: null }>().items).toHaveLength(1);

    const searched = await app.inject({
      method: "GET",
      url: "/api/call-briefs?search=Beta&status=review_required"
    });
    expect(searched.json<{ items: Array<{ recipientName: string }> }>().items)
      .toHaveLength(1);
    expect(searched.json<{ items: Array<{ recipientName: string }> }>().items[0]?.recipientName)
      .toBe("Beta Clinic");
  });

  it("rejects invalid call-list cursors", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "GET",
      url: "/api/call-briefs?cursor=not-a-cursor"
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "INVALID_CALL_LIST_QUERY" });
  });

  it("creates and returns a persisted call brief", async () => {
    const { app, service } = createAppWithService();
    const created = await service.create({
        recipientName: "Cabinet Medical Geneve",
        phoneNumber: "+41225550123",
        objective: "Prendre un rendez-vous de controle la semaine prochaine",
        assistantProfileId: "anna",
        representedPersonFirstName: "Nina",
        representedPersonLastName: "Keller",
        assistanceReason: "language_barrier",
        locale: "fr-CH",
        allowLanguageSwitch: true,
        fallbackLocale: "de-CH",
        allowedFacts: []
    });
    expect(created.locale).toBe("fr-CH");
    expect(created.assistantProfileId).toBe("anna");
    expect(created.voiceGender).toBe("female");
    expect(created.assistanceReason).toBe("language_barrier");
    expect(created.status).toBe("review_required");

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${created.id}`
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().brief.id).toBe(created.id);
    expect(getResponse.json().compilation.policyDecision.status).toBe(
      "ready_for_review"
    );

    const approveResponse = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${created.id}/approve`
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().brief.status).toBe("ready");
  });

  it("keeps the event stream subscribed after the request has completed", async () => {
    const { app, service } = createAppWithService();
    const brief = await service.create({
      recipientName: "Live transcript office",
      phoneNumber: "+41710000007",
      objective: "Verify live transcript delivery over the event stream",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as AddressInfo;
    const controller = new AbortController();
    const response = await fetch(
      `http://127.0.0.1:${port}/api/call-briefs/${brief.id}/events`,
      { signal: controller.signal }
    );
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    const readUntil = async (expected: string) => {
      let text = "";
      return Promise.race([
        (async () => {
          while (!text.includes(expected)) {
            const chunk = await reader.read();
            if (chunk.done) throw new Error("SSE stream ended unexpectedly");
            text += decoder.decode(chunk.value, { stream: true });
          }
          return text;
        })(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("Timed out waiting for SSE event")), 1_000)
        )
      ]);
    };

    expect(response.status).toBe(200);
    const connected = await readUntil('"type":"call.updated"');
    expect(connected).toContain("connected");
    expect(connected).toContain(brief.id);

    service.publishTranscriptDelta(
      brief.id,
      "recipient:1",
      "recipient",
      "Hello live",
      "en-GB"
    );
    const eventText = await readUntil('"type":"transcript.delta"');
    expect(eventText).toContain('"type":"transcript.delta"');
    expect(eventText).toContain("Hello live");

    controller.abort();
  });

  it("updates an existing brief and approves and starts it with one request", async () => {
    const { app, service } = createAppWithService();
    const payload: CreateCallBriefInput = {
      recipientName: "Elena",
      phoneNumber: "+41710000001",
      objective: "Ask Elena which book she likes most",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    };
    const created = await service.create(payload);
    const id = created.id;

    const updated = await app.inject({
      method: "PUT",
      url: `/api/call-briefs/${id}`,
      payload: {
        ...payload,
        objective: "Ask Elena which book and country she likes most"
      }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().brief.id).toBe(id);
    expect(updated.json().compilation.revision).toBe(2);

    const started = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${id}/approve-and-start`
    });
    expect(started.statusCode).toBe(200);
    expect(started.json().brief.status).toBe("dialing");
  });

  it("reports liveness without touching a dependency", async () => {
    const repository = new InMemoryCallRepository();
    const ping = vi.spyOn(repository, "ping");
    const service = new CallService(repository);
    const app = buildApp({
      service,
      allowAnonymousCallsForTesting: true,
      logger: false
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["content-security-policy"]).toContain(
      "default-src 'none'"
    );
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["x-frame-options"]).toBe("DENY");
    expect(response.headers["strict-transport-security"]).toBeUndefined();
    expect(response.json()).toEqual({ status: "alive" });
    expect(ping).not.toHaveBeenCalled();
  });

  it("reports database-backed readiness", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.json()).toEqual({
      status: "ready",
      checks: { database: "ready" }
    });
  });

  it("fails readiness without leaking a dependency error", async () => {
    const repository = new InMemoryCallRepository();
    vi.spyOn(repository, "ping").mockRejectedValueOnce(
      new Error("postgres://private-user:private-password@internal-host")
    );
    const service = new CallService(repository);
    const app = buildApp({
      service,
      allowAnonymousCallsForTesting: true,
      logger: false
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/ready" });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("private");
    expect(response.json()).toEqual({
      status: "not_ready",
      checks: { database: "unavailable" }
    });
  });

  it("does not retain the ambiguous legacy health route", async () => {
    const app = createApp();
    expect((await app.inject({ method: "GET", url: "/health" })).statusCode)
      .toBe(404);
  });

  it("adds HSTS only to a production API", async () => {
    const service = new CallService(new InMemoryCallRepository());
    const app = buildApp({
      service,
      allowAnonymousCallsForTesting: true,
      logger: false,
      production: true
    });
    apps.push(app);

    const response = await app.inject({ method: "GET", url: "/health/live" });
    expect(response.headers["strict-transport-security"]).toBe(
      "max-age=31536000; includeSubDomains"
    );
  });

  it("rejects oversized JSON before application parsing", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/api/call-preparations",
      payload: { objective: "x".repeat(256 * 1_024) }
    });
    expect(response.statusCode).toBe(413);
  });

  it("applies the origin boundary before an unsafe route is dispatched", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/not-a-route",
      headers: { origin: "https://attacker.example" },
      payload: {}
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toEqual({ error: "INVALID_ORIGIN" });
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000"])(
    "allows the local web origin %s",
    async (origin) => {
      const app = createApp();
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/call-preparations",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers": "content-type"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
    }
  );

  it.each(["PUT", "DELETE"])(
    "allows browser preflight for %s requests",
    async (method) => {
      const app = createApp();
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/call-briefs/call-id",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": method,
          "access-control-request-headers": "content-type"
        }
      });

      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-methods"]).toContain(method);
    }
  );

  it("does not expose Twilio webhooks on the internal API", async () => {
    const app = createApp();
    const response = await app.inject({
      method: "POST",
      url: "/webhooks/twilio/voice",
      payload: "CallSid=CA123",
      headers: { "content-type": "application/x-www-form-urlencoded" }
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns a gateway error when the telephony provider cannot start", async () => {
    const failingProvider: TelephonyProvider = {
      mode: "twilio",
      async startCall() {
        throw new Error("Twilio unavailable");
      },
      async stopCall() {},
      async startRecording() {
        throw new Error("Twilio unavailable");
      },
      async getRecordingMedia() {
        throw new Error("Twilio unavailable");
      },
      async deleteRecording() {}
    };
    const service = new CallService(
      new InMemoryCallRepository(),
      failingProvider,
      () => undefined
    );
    const app = buildApp({
      service,
      allowAnonymousCallsForTesting: true,
      logger: false
    });
    apps.push(app);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+41523686688",
      objective: "Test a provider failure",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await service.approveCompilation(brief.id);
    const response = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${brief.id}/start`
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "TELEPHONY_START_FAILED" });
    expect((await service.get(brief.id))?.brief.status).toBe("failed");
  });

  it("rate-limits call operation endpoint families and returns Retry-After", async () => {
    const service = new CallService(
      new InMemoryCallRepository(),
      undefined,
      () => undefined
    );
    const oneRequest = { userLimit: 1, ipLimit: 1, windowMs: 60_000 };
    const policy: EndpointRateLimitPolicy = {
      briefPreparation: oneRequest,
      callStart: oneRequest,
      promoRedemption: oneRequest,
      recordingDownload: oneRequest,
      transcriptionRetry: oneRequest,
      dataExport: oneRequest,
      callDataDeletion: oneRequest,
      accountDeletion: oneRequest
    };
    const app = buildApp({
      service,
      allowAnonymousCallsForTesting: true,
      logger: false,
      endpointRateLimiter: new ApplicationRateLimiter(() => 1_000),
      endpointRateLimitPolicy: policy
    });
    apps.push(app);
    const payload: CreateCallBriefInput = {
      recipientName: "Rate limit office",
      phoneNumber: "+41523686688",
      objective: "Verify expensive endpoint rate limits",
      assistantProfileId: "sebastian",
      representedPersonFirstName: "Nina",
      representedPersonLastName: "Keller",
      assistanceReason: "speech_impairment",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    };

    const created = await service.create(payload);
    const callId = created.id;

    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve`
    })).statusCode).toBe(200);
    expect((await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/start`
    })).statusCode).toBe(200);
    const limitedStart = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/approve-and-start`
    });
    expectRateLimited(limitedStart);

    const unavailableRecording = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}/recording`
    });
    expect(unavailableRecording.statusCode).toBe(409);
    expectRateLimited(await app.inject({
      method: "GET",
      url: `/api/call-briefs/${callId}/recording`
    }));

    const unavailableRetry = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/final-transcript/retry`
    });
    expect(unavailableRetry.statusCode).toBe(409);
    expectRateLimited(await app.inject({
      method: "POST",
      url: `/api/call-briefs/${callId}/final-transcript/retry`
    }));
  });
});

function expectRateLimited(response: {
  statusCode: number;
  headers: Record<string, string | string[] | number | undefined>;
  json(): unknown;
}) {
  expect(response.statusCode).toBe(429);
  expect(response.headers["retry-after"]).toBe("60");
  expect(response.json()).toEqual({ error: "RATE_LIMITED" });
}
