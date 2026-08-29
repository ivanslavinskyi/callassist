import { describe, expect, it } from "vitest";
import { ConsentFlow } from "./consent-flow";

describe("ConsentFlow", () => {
  it("grants immediately on clear voice consent", () => {
    const flow = new ConsentFlow();
    expect(flow.decide("affirmative")).toBe("grant_voice");
    expect(flow.stage).toBe("resolved");
  });

  it("rejects immediately on clear negative consent", () => {
    const flow = new ConsentFlow();
    expect(flow.decide("negative")).toBe("reject");
    expect(flow.stage).toBe("resolved");
  });

  it("allows one clarification and then offers DTMF", () => {
    const flow = new ConsentFlow();
    expect(flow.decide("unclear")).toBe("play_clarification");
    expect(flow.timeout()).toBe("play_dtmf_fallback");
    expect(flow.acceptDtmfOne()).toBe(true);
    expect(flow.stage).toBe("resolved");
  });

  it("ends after the bounded fallback", () => {
    const flow = new ConsentFlow();
    expect(flow.timeout()).toBe("play_clarification");
    expect(flow.timeout()).toBe("play_dtmf_fallback");
    expect(flow.timeout()).toBe("reject");
  });
});
