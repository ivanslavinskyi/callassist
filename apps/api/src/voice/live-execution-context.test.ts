import { expect, it } from "vitest";
import { approvedCall } from "./voice-test-helpers";
import { executionData, liveExecutionContext } from "./live-managed-tools";

it("gives Live complete approved fields in bounded, independently readable fragments", async () => {
  const call = await approvedCall();
  try {
    const snapshot = structuredClone(call.snapshot);
    snapshot.plan.backgroundSummary = "Контекст задачи 🙂 ".repeat(200);
    snapshot.plan.conditionalFollowUps = [{ condition: "If unknown", question: "Who can answer?" }];
    const chunks = liveExecutionContext(snapshot);
    const values: Record<string, string> = {};
    for (const chunk of chunks) {
      expect(Buffer.byteLength(chunk)).toBeLessThanOrEqual(450);
      const item = JSON.parse(chunk);
      values[item.approvedTaskField] = (values[item.approvedTaskField] ?? "") + item.value;
    }
    expect(values["task.background"]).toBe(snapshot.plan.backgroundSummary);
    expect(values["task.questions.0.required"]).toBe("true");
    expect(values["task.questions.0.purpose"]).toBe(snapshot.plan.orderedQuestions[0].purpose);
    expect(values["task.followUps.0.condition"]).toBe("If unknown");
    for (const field of ["success", "unresolved", "stop", "facts", "prohibited"]) {
      expect(values[`task.${field}.0`]).toBe((executionData(snapshot) as any)[field][0]);
    }
    expect(values["task.application.audioRetentionDays"]).toBe("0");
  } finally { await call.service.close(); }
});
