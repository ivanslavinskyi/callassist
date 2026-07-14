import { afterEach, describe, expect, it, vi } from "vitest";
import { CallService } from "./call-service";
import { InMemoryCallRepository } from "./storage/in-memory-call-repository";
import type { TelephonyProvider } from "./telephony/telephony-provider";

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

  it("reserves one attempt before concurrent provider starts", async () => {
    const startCall = vi.fn().mockResolvedValue({
      providerCallId: "CA-concurrent",
      providerStatus: "queued"
    });
    const provider: TelephonyProvider = {
      mode: "twilio",
      startCall,
      async stopCall() {}
    };
    const service = new CallService(new InMemoryCallRepository(), provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+442079460000",
      objective: "Prevent duplicate outbound calls",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    await Promise.allSettled([service.start(brief.id), service.start(brief.id)]);

    expect(startCall).toHaveBeenCalledTimes(1);
    expect((await service.get(brief.id))?.brief.status).toBe("dialing");
  });

  it("ends a provider call that starts after the user stops it", async () => {
    let resolveStart!: (value: {
      providerCallId: string;
      providerStatus: string;
    }) => void;
    const startCall = vi.fn(
      () =>
        new Promise<{
          providerCallId: string;
          providerStatus: string;
        }>((resolve) => {
          resolveStart = resolve;
        })
    );
    const stopCall = vi.fn().mockResolvedValue(undefined);
    const provider: TelephonyProvider = {
      mode: "twilio",
      startCall,
      stopCall
    };
    const service = new CallService(new InMemoryCallRepository(), provider);
    services.push(service);
    const brief = await service.create({
      recipientName: "Example office",
      phoneNumber: "+442079460000",
      objective: "Stop while the provider is creating a call",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    const starting = service.start(brief.id);
    await vi.waitFor(() => expect(startCall).toHaveBeenCalledOnce());
    await service.stop(brief.id);
    resolveStart({ providerCallId: "CA-late", providerStatus: "queued" });
    const snapshot = await starting;

    expect(stopCall).toHaveBeenCalledWith("CA-late");
    expect(snapshot.brief.status).toBe("stopped");
    expect((await service.get(brief.id))?.brief.status).toBe("stopped");
  });
});
