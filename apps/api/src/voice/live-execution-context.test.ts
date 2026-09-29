import { expect, it } from "vitest";
import { approvedCall } from "./voice-test-helpers";
import { executionData, liveExecutionContext, liveManagedTools, type LiveExecutionParties } from "./live-managed-tools";

it("gives Live bounded, self-contained approved task sections", async () => {
  const call = await approvedCall();
  try {
    const snapshot = structuredClone(call.snapshot);
    snapshot.plan.backgroundSummary = "Long multilingual task context 🙂 ".repeat(200);
    snapshot.plan.orderedQuestions[0].text = "A deliberately long approved question. ".repeat(100);
    snapshot.plan.conditionalFollowUps = [{ condition: "If unknown", question: "Who can answer?" }];
    const parties: LiveExecutionParties = { representedPerson: "Nina Keller", recipientName: "Example AG" };
    const chunks = liveExecutionContext(snapshot, parties);
    const sections = chunks.map(chunk => {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(1_200);
      return JSON.parse(chunk).approvedTaskContext as {
        section: string; index?: number; part?: number; value: unknown;
      };
    });

    expect(sections.find(item => item.section === "parties")?.value).toEqual(parties);
    expect(sections.find(item => item.section === "conversation")?.value).toMatchObject({
      locale: snapshot.plan.callLocale,
      resultHandling: snapshot.plan.resultHandling
    });
    expect(sections.find(item => item.section === "questions.required" && item.index === 0)?.value).toBe(true);
    expect(sections.find(item => item.section === "questions.purpose" && item.index === 0)?.value)
      .toBe(snapshot.plan.orderedQuestions[0].purpose);
    const question = sections
      .filter(item => item.section === "questions.text" && item.index === 0)
      .sort((left, right) => (left.part ?? 0) - (right.part ?? 0))
      .map(item => item.value)
      .join("");
    expect(question).toBe(snapshot.plan.orderedQuestions[0].text);
    const followUps = sections.find(item => item.section === "followUps")?.value;
    expect(Array.isArray(followUps) ? followUps[0] : followUps)
      .toEqual(snapshot.plan.conditionalFollowUps[0]);

    const background = sections
      .filter(item => item.section === "background")
      .sort((left, right) => (left.part ?? 0) - (right.part ?? 0))
      .map(item => item.value)
      .join("");
    expect(background).toBe(snapshot.plan.backgroundSummary);

    const data = executionData(snapshot, parties);
    for (const section of ["success", "unresolved", "stop", "facts", "prohibited"] as const) {
      const value = sections.find(item => item.section === section)?.value;
      expect(Array.isArray(value) ? value[0] : value).toBe(data[section][0]);
    }
    expect(sections.find(item => item.section === "application")?.value)
      .toMatchObject({ audioRetentionDays: 0 });
  } finally {
    await call.service.close();
  }
});

it("requires a bounded factual result summary when the backend requests hangup", async () => {
  const call = await approvedCall();
  try {
    const endCall = liveManagedTools(call.snapshot, true).find(tool => tool.name === "end_call")!;
    expect(endCall.parameters).toMatchObject({
      required: ["reason", "resultSummary"],
      additionalProperties: false,
      properties: { resultSummary: { type: "string", minLength: 2, maxLength: 400 } }
    });
  } finally {
    await call.service.close();
  }
});
