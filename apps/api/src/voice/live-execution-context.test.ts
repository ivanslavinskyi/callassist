import { expect, it } from "vitest";
import { SUPPORTED_CALL_LOCALES } from "@callassist/contracts";
import { approvedCall, authorization } from "./voice-test-helpers";
import { executionData, liveExecutionContext, liveManagedTools, managedBackendInstructions, type LiveExecutionParties } from "./live-managed-tools";

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

it.each(SUPPORTED_CALL_LOCALES)("shares derived weekdays with Live and its backend in %s without changing authority", async locale => {
  const call = await approvedCall(authorization, undefined, locale);
  try {
    const before = JSON.stringify(call.snapshot);
    const data = executionData(call.snapshot);
    const sections = liveExecutionContext(call.snapshot).map(chunk => JSON.parse(chunk).approvedTaskContext);
    expect(sections.find(section => section.section === "appointmentCalendar").value).toEqual(data.appointmentCalendar);
    expect(data.appointment).toEqual(authorization);
    expect(data.appointmentCalendar[0]).toMatchObject({ date: authorization.windows[0]!.date, weekdayIso: 3 });
    const backend = managedBackendInstructions(call.snapshot);
    expect(backend).toContain(JSON.stringify(data));
    expect(backend).toContain("If weekday, date, time or zone conflict");
    expect(JSON.stringify(call.snapshot)).toBe(before);
  } finally { await call.service.close(); }
});

it("keeps 31 calendar dates self-contained and bounded, deduplicating dates without merging windows", async () => {
  const call = await approvedCall(authorization);
  try {
    const dates = Array.from({ length: 31 }, (_, i) => `2099-01-${String(i + 1).padStart(2, "0")}`);
    const snapshot = { ...structuredClone(call.snapshot), plan: { ...structuredClone(call.snapshot.plan),
      appointmentAuthorization: { ...authorization, windows: dates.map(date => ({ date, startTime: "09:00", endTime: "18:00" })) } } };
    const chunks = liveExecutionContext(snapshot);
    const calendar = chunks.flatMap(chunk => {
      expect(Buffer.byteLength(chunk, "utf8")).toBeLessThanOrEqual(1_200);
      const section = JSON.parse(chunk).approvedTaskContext;
      return section.section === "appointmentCalendar" ? (Array.isArray(section.value) ? section.value : [section.value]) : [];
    });
    expect(calendar.map(day => day.date)).toEqual(dates);
    expect(calendar.every(day => day.dateLabel.includes(day.weekdayLabel))).toBe(true);
    snapshot.plan.appointmentAuthorization.windows = [
      { date: dates[0]!, startTime: "09:00", endTime: "10:00" }, { date: dates[0]!, startTime: "14:00", endTime: "15:00" }
    ];
    const data = executionData(snapshot);
    expect(data.appointmentCalendar).toHaveLength(1);
    expect(data.appointment!.windows).toHaveLength(2);
    const noAuthority = { ...snapshot, plan: { ...snapshot.plan, appointmentAuthorization: null } };
    expect(executionData(noAuthority).appointmentCalendar).toEqual([]);
    expect(liveManagedTools(noAuthority, true).some(tool => tool.name === "request_appointment")).toBe(false);
  } finally { await call.service.close(); }
});
