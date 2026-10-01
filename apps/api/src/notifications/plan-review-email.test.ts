import { describe, it, expect } from "vitest";
import { uiLocales } from "@callassist/contracts";
import { planReviewNotificationEmail, type PlanReviewReport } from "./plan-review-email";
const report: PlanReviewReport = { caseId: "case-id", callId: "call-id", userId: "user-id", revision: 2,
  occurredAt: "2026-10-01T12:00:00.000Z", decision: "blocked", category: "technical_failure", reasons: ["fact_integrity_failure"],
  locale: "de-CH", compilerVersion: "compiler-test", policyVersion: "policy-test", model: "<script>alert(1)</script>", repeats: 1 };
describe("plan review alerts", () => {
  it.each(uiLocales)("renders bounded evidence in %s without executing untrusted strings", locale => {
    const content = planReviewNotificationEmail(report, { siteUrl: "https://example.test" }, locale);
    expect(content.html).toContain(`lang="${locale}"`); expect(content.text).not.toContain("undefined");
    expect(content.html).toContain("&lt;script&gt;"); expect(content.html).not.toContain("<script>");
    expect(content.text).toContain("fact_integrity_failure"); expect(content.text).toContain("/admin/safety/plan-reviews/case-id");
    expect(content.html).toContain('<a href="https://example.test/admin/safety/plan-reviews/case-id"');
    expect(content.attachments).toHaveLength(1);
  });
});
