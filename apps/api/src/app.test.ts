import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import type { TelephonyProvider } from "./telephony/telephony-provider";

const apps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function createApp() {
  const service = new CallService(new InMemoryCallRepository());
  const app = buildApp({ service, logger: false });
  apps.push(app);
  return app;
}

describe("call API", () => {
  it("creates and returns a persisted call brief", async () => {
    const app = createApp();
    const createResponse = await app.inject({
      method: "POST",
      url: "/api/call-briefs",
      payload: {
        recipientName: "Cabinet Medical Geneve",
        phoneNumber: "+41225550123",
        objective: "Prendre un rendez-vous de controle la semaine prochaine",
        locale: "fr-CH",
        allowLanguageSwitch: true,
        fallbackLocale: "de-CH",
        allowedFacts: []
      }
    });

    expect(createResponse.statusCode).toBe(201);
    const created = createResponse.json<{ id: string; locale: string }>();
    expect(created.locale).toBe("fr-CH");

    const getResponse = await app.inject({
      method: "GET",
      url: `/api/call-briefs/${created.id}`
    });
    expect(getResponse.statusCode).toBe(200);
    expect(getResponse.json().brief.id).toBe(created.id);
  });

  it("reports the active storage mode", async () => {
    const app = createApp();
    const response = await app.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ok",
      mode: "memory",
      telephony: "mock"
    });
  });

  it.each(["http://localhost:3000", "http://127.0.0.1:3000"])(
    "allows the local web origin %s",
    async (origin) => {
      const app = createApp();
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/call-briefs",
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
      async stopCall() {}
    };
    const service = new CallService(
      new InMemoryCallRepository(),
      failingProvider,
      () => undefined
    );
    const app = buildApp({ service, logger: false });
    apps.push(app);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+442079460000",
      objective: "Test a provider failure",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/call-briefs/${brief.id}/start`
    });

    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "TELEPHONY_START_FAILED" });
    expect((await service.get(brief.id))?.brief.status).toBe("failed");
  });
});
