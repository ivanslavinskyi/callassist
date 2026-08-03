import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";

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
    expect(response.json()).toEqual({ status: "ok", mode: "memory" });
  });
});
