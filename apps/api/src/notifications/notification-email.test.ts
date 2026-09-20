import { describe, expect, it } from "vitest";
import { uiLocales, uiLocaleRegistry, formatNumber } from "@callassist/contracts";
import { callNotificationEmail, registrationNotificationEmail, type CallReport } from "./notification-email";
import { notificationDetailMessages } from "./notification-details";

const branding={siteUrl:"https://example.test"};
const report:CallReport={callId:"11111111-1111-4111-8111-111111111111",attemptId:"22222222-2222-4222-8222-222222222222",
  user:"Nina",recipient:"Office",phone:"+41710000000",language:"ru-RU",objective:"Уточнить время приёма",status:"completed",failure:null,
  startedAt:"2026-09-18T10:00:00.000Z",endedAt:"2026-09-18T10:01:00.000Z",connectedSeconds:45,elapsedSeconds:60,
  assessmentStatus:"Ready",assessment:{conversation:{status:"confirmed",category:"task_answer",questionSegmentId:"q",answerSegmentId:"a",answerQuote:"Да"},
    goal:{status:"achieved",sourceSegmentIds:["a"]},criteria:[{id:"criterion.0",status:"achieved",sourceSegmentIds:["a"]}]},criteria:["Узнать время"],
  summary:{schemaVersion:2,overview:[{label:"Итог",text:"Приём завтра в 10:00 <script>alert(1)</script>",findingIds:["1"]}],findings:[],nextSteps:[],unresolved:[]},
  costs:[{label:"Attempt — AI",amountMicros:125,currency:"USD",basis:"usage estimate"},{label:"Attempt — Telephony",amountMicros:null,currency:"USD",basis:"pending"}],
  costsIncomplete:true,preparedAt:"2026-09-18T10:02:00.000Z"};
it.each(uiLocales)("renders notification emails and currency in %s", locale => {
  expect(Object.keys(notificationDetailMessages[locale])).toEqual(Object.keys(notificationDetailMessages.en));
  expect(Object.values(notificationDetailMessages[locale]).every(value => typeof value === "string" && value.length > 0)).toBe(true);
  const content = callNotificationEmail(report, branding, locale);
  expect(content.html).toContain(`lang="${locale}"`);
  expect(content.text).toContain(uiLocaleRegistry[locale].slogan);
  expect(content.text).toContain(formatNumber(0.000125, locale, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 6 }));
  expect(content.text).not.toContain("undefined");
  expect(content.text).toContain(report.objective);
});
describe("English superadmin email templates",()=>{
  it("keeps source languages unchanged, escapes HTML and links to the protected inspector",()=>{
    const email=callNotificationEmail(report,branding);
    expect(email.html).toContain('lang="en"');
    expect(email.text).toContain("Итог: Приём завтра в 10:00");
    expect(email.text).toContain("Criterion 1: Узнать время — Achieved");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain(`href="https://example.test/admin/calls/${report.callId}"`);
    expect(email.text).toContain("US$0.000125");
    expect(email.text).toContain("Telephony: Unavailable");
    expect(email.text).not.toContain("US$0.000000");
  });
  it("distinguishes missing analysis from failure to reach the goal",()=>{
    const email=callNotificationEmail({...report,assessment:null,assessmentStatus:"Unavailable (generation_failed)",summary:null},branding);
    expect(email.text).toContain("AI assessment: Unavailable (generation_failed)");
    expect(email.text).not.toContain("Goal: Not achieved");
  });
  it("reports SMS completion without implying email verification",()=>{
    const email=registrationNotificationEmail({userId:report.callId,name:"Élodie <Example>",email:"elodie@example.test",phone:"+41710000000",
      language:"fr",createdAt:report.startedAt,verifiedAt:report.endedAt,emailVerified:false},branding);
    expect(email.subject).toBe("New registration confirmed");
    expect(email.text).toContain("Email verified: No");
    expect(email.html).toContain("Élodie &lt;Example&gt;");
    expect(email.html).toContain(`/admin/users?userId=${report.callId}`);
  });
});
