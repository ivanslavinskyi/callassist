import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uiLocales } from "@callassist/contracts";
import { CallPlanPresentation, type CallPlanPresentationData } from "../components/call-plan-presentation";
import { planReviewMessages } from "./i18n/plan-review-messages";

afterEach(() => vi.unstubAllGlobals());
const plan: CallPlanPresentationData = {
  localizedObjective: "Узнать статус заявления.", backgroundSummary: "Не соглашаться на дополнительные расходы.",
  successCriteria: ["Статус получен."], unresolvedCriteria: ["Статус неизвестен."], stopConditions: ["Получатель отказался."],
  conditionalFollowUps: [{ condition: "Заявление не получено.", question: "Куда отправить повторно?" }],
  tone: "formal", addressingStyle: "formal", resultHandling: "capture_in_callassist",
  opening: { recipientAddress: "Здравствуйте.", purposeStatement: "Звоню по поводу заявления.", readinessQuestion: "Удобно говорить?" },
  orderedQuestions: [{ text: "Заявление получено?", purpose: "Проверить доставку.", required: true },
    { text: "Когда ждать ответ?", purpose: "Уточнить срок.", required: false }],
  approvedFacts: [{ sourceText: "AUDIT ONLY SOURCE", callLanguageText: "Номер: A-17" }],
  prohibitedActions: ["Не оформлять запись."]
};

describe("complete readable call plan", () => {
  it.each(uiLocales)("shows computed weekdays in %s without mutating an existing plan", locale => {
    vi.stubGlobal("React", React);
    const appointmentPlan: CallPlanPresentationData = { ...plan, appointmentAuthorization: {
      operation: "book", serviceDescription: "Meeting", providerScope: "called_recipient", timeZone: "Pacific/Kiritimati",
      windows: [{ date: "2026-10-01", startTime: "09:00", endTime: "10:00" },
        { date: "2026-10-01", startTime: "14:00", endTime: "18:00" }],
      selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms"
    } };
    const before = JSON.stringify(appointmentPlan);
    const html = renderToStaticMarkup(React.createElement(CallPlanPresentation, { plan: appointmentPlan, uiLocale: locale }));
    const weekdays = { de: "Donnerstag", fr: "jeudi", it: "giovedì", rm: "gievgia", en: "Thursday", ru: "четверг", uk: "четвер" };
    expect(html).toContain(weekdays[locale]);
    expect(html.match(/dateTime="2026-10-01"/g)).toHaveLength(2);
    expect(html).toContain("09:00–10:00"); expect(html).toContain("14:00–18:00");
    expect(html).toContain("Pacific/Kiritimati"); expect(JSON.stringify(appointmentPlan)).toBe(before);
  });
  it.each(uiLocales)("shows every material detail with %s UI labels, without raw source text", locale => {
    vi.stubGlobal("React", React);
    const html = renderToStaticMarkup(React.createElement(CallPlanPresentation, { plan, uiLocale: locale }));
    for (const value of [plan.localizedObjective, plan.backgroundSummary!, ...Object.values(plan.opening),
      ...plan.successCriteria, ...plan.unresolvedCriteria!, ...plan.stopConditions!,
      ...plan.orderedQuestions.flatMap(q => [q.text, q.purpose]),
      ...plan.conditionalFollowUps!.flatMap(q => [q.condition, q.question]),
      ...plan.approvedFacts.map(f => f.callLanguageText), ...plan.prohibitedActions]) expect(html).toContain(value);
    expect(html).toContain(planReviewMessages[locale].required);
    expect(html).toContain(planReviewMessages[locale].optional);
    expect(html).not.toContain("AUDIT ONLY SOURCE");
    expect(html).not.toContain("undefined");
  });
});
