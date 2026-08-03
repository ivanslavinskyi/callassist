import { afterEach, describe, expect, it } from "vitest";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";

const services: CallService[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.close()));
});

function createService() {
  const service = new CallService(new InMemoryCallRepository());
  services.push(service);
  return service;
}

describe("CallService", () => {
  it("creates a ready call with the selected locale", async () => {
    const service = createService();
    const brief = await service.create({
      recipientName: "Gemeinde Aadorf",
      phoneNumber: "+41523686688",
      objective: "Уточнить возможность отправки документов по электронной почте",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    expect(brief.status).toBe("ready");
    expect(brief.locale).toBe("de-CH");
    expect((await service.get(brief.id))?.transcript).toEqual([]);
  });

  it("stops a call without losing its brief", async () => {
    const service = createService();
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+442079460000",
      objective: "Ask whether the application can be submitted by email",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await service.start(brief.id);
    const snapshot = await service.stop(brief.id);

    expect(snapshot.brief.status).toBe("stopped");
    expect(snapshot.brief.id).toBe(brief.id);
  });
});
