import { describe, expect, it } from "vitest";
import { CallStore } from "./call-store";

describe("CallStore", () => {
  it("creates a ready call with the selected locale", () => {
    const store = new CallStore();
    const brief = store.create({
      recipientName: "Gemeinde Aadorf",
      phoneNumber: "+41523686688",
      objective: "Уточнить возможность отправки документов по электронной почте",
      locale: "de-CH",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    expect(brief.status).toBe("ready");
    expect(brief.locale).toBe("de-CH");
    expect(store.get(brief.id)?.transcript).toEqual([]);
  });

  it("stops a call without losing its brief", () => {
    const store = new CallStore();
    const brief = store.create({
      recipientName: "Example office",
      phoneNumber: "+442079460000",
      objective: "Ask whether the application can be submitted by email",
      locale: "en-GB",
      allowLanguageSwitch: false,
      allowedFacts: []
    });

    store.start(brief.id);
    const snapshot = store.stop(brief.id);

    expect(snapshot.brief.status).toBe("stopped");
    expect(snapshot.brief.id).toBe(brief.id);
  });
});
