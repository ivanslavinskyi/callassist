import { describe, expect, it } from "vitest";
import { appointmentAuthorizationSchema, callSummaryPayloadSchema } from "@callassist/contracts";
import { buildDemoPdf, demoReducer, demoScenarioIds, getDemoScenario, initialDemoState, type DemoState } from "./interactive-demo";
import { demoMessages } from "./i18n/demo-messages";
import { uiLocaleRegistry } from "./i18n/registry";

describe("interactive demo approval and playback", () => {
  it("never crosses the approval gate on a timer or the Next control", () => {
    let state = demoReducer(initialDemoState, { type: "start" });
    for (let i = 0; i < 60; i++) state = demoReducer(state, { type: "tick", turnCount: 5 });
    expect(state.phase).toBe("review");
    expect(demoReducer(state, { type: "next", turnCount: 5 })).toEqual(state);
    expect(demoReducer(state, { type: "approve" }).phase).toBe("dialing");
    expect(demoReducer(initialDemoState, { type: "approve" })).toEqual(initialDemoState);
  });
  it("pauses automatic playback while allowing deliberate manual advance", () => {
    const paused: DemoState = { phase: "live", tick: 1, paused: true };
    expect(demoReducer(paused, { type: "tick", turnCount: 5 })).toEqual(paused);
    expect(demoReducer(paused, { type: "next", turnCount: 5 })).toEqual({ ...paused, tick: 2 });
    expect(demoReducer(paused, { type: "pause" }).paused).toBe(false);
    expect(demoReducer(paused, { type: "reset" })).toEqual(initialDemoState);
  });
  it("shows consent before every task turn and completes with a final transcript", () => {
    let state: DemoState = { phase: "review", tick: 0, paused: false };
    state = demoReducer(state, { type: "approve" });
    state = demoReducer(state, { type: "next", turnCount: 5 });
    expect(state.phase).toBe("consent");
    for (let i = 0; i < 2; i++) state = demoReducer(state, { type: "next", turnCount: 5 });
    expect(state).toMatchObject({ phase: "consent", tick: 2 });
    state = demoReducer(state, { type: "next", turnCount: 5 });
    expect(state.phase).toBe("live");
    for (let i = 0; i < 5; i++) state = demoReducer(state, { type: "next", turnCount: 5 });
    expect(state.phase).toBe("finalizing");
    state = demoReducer(state, { type: "next", turnCount: 5 });
    expect(state.phase).toBe("result");
    expect(demoReducer(state, { type: "tick", turnCount: 5 })).toEqual(state);
  });
});

for (const locale of Object.keys(uiLocaleRegistry) as Array<keyof typeof uiLocaleRegistry>) {
  describe(`complete ${locale} demo fixtures`, () => {
    for (const id of demoScenarioIds) it(`${id}: real contracts, traceable answers and an explicitly fictional PDF`, () => {
      const scenario = getDemoScenario(locale, id);
      expect(callSummaryPayloadSchema.safeParse(scenario.summary).success).toBe(true);
      if (id === "appointment") {
        expect(appointmentAuthorizationSchema.safeParse(scenario.plan.appointmentAuthorization).success).toBe(true);
        expect(scenario.summary.findings[0]!.sourceSegmentIds).toEqual(["demo-3"]);
      } else expect(scenario.plan.appointmentAuthorization).toBeUndefined();
      for (const finding of [...scenario.summary.findings, ...scenario.summary.nextSteps]) {
        for (const source of finding.sourceSegmentIds) expect(scenario.turns.find(turn => turn.id === source)?.role).toBe("recipient");
      }
      const definition = buildDemoPdf(locale, scenario);
      const content = JSON.stringify(definition.content);
      for (const turn of scenario.turns) expect(content).toContain(JSON.stringify(turn.text));
      expect(content).toContain(demoMessages[locale].pdfNote);
      expect(content).toContain(demoMessages[locale].pdfVariant);
      expect(definition.language).toBe(locale);
    });
  });
}
