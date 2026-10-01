import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { creditTransactionSchema, uiLocales, type CreditFunding } from "@callassist/contracts";
import { CreditFundingDetails, CreditSourceDetails } from "./credit-funding-details";
import { betaCreditMessages, betaExpiredLabel, betaLifetimeTransitionMessage } from "@/lib/i18n/beta-credit-messages";

const periodId = "96000000-0000-4000-8000-000000000002";
const funding: CreditFunding = { persistent: 7, allowance: { policyId: periodId, period: "day", limit: 5,
  available: 3, reserved: 1, used: 1, startsAt: "2030-05-01T00:00:00.000Z", endsAt: "2030-05-02T00:00:00.000Z",
  lifetimeGrantAllowed: false, pending: { policy: { amount: 100, period: "lifetime" }, effectiveAt: "2030-05-02T00:00:00.000Z" } } };
afterEach(() => vi.useRealTimers());

describe("credit funding presentation", () => {
  it.each(uiLocales)("explains available, reserved and permanent sources and no extra lifetime grant in %s", locale => {
    const markup = renderToStaticMarkup(<CreditFundingDetails funding={funding} locale={locale} />);
    expect(markup).toContain(betaCreditMessages[locale].persistent);
    expect(markup).toContain(betaCreditMessages[locale].reserved);
    expect(markup).toContain(betaCreditMessages[locale].noCarry);
    expect(markup).toContain(betaLifetimeTransitionMessage[locale]);
    expect(markup).toContain('dateTime="2030-05-02T00:00:00.000Z"');
    expect(markup).not.toContain("100");
  });
  it("does not advertise a second lifetime grant after a cohort transition", () => {
    const markup = renderToStaticMarkup(<CreditFundingDetails locale="en" funding={{ ...funding,
      allowance: { ...funding.allowance!, period: "lifetime", limit: 100, available: 0, startsAt: null, endsAt: null, pending: null } }} />);
    expect(markup).toContain("Permanent credits"); expect(markup).toContain("no new one-time credit grant");
    expect(markup).not.toContain("100"); expect(markup).not.toContain("Next renewal");
  });
  it("labels a delayed refund with its original expired period, separately from permanent funds", () => {
    vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2030-05-03T00:00:00Z"));
    const refund = creditTransactionSchema.parse({ id: periodId, amount: 1, type: "call_refund", createdAt: "2030-05-03T00:00:00.000Z",
      callAttemptId: null, promoRedemptionId: null, adminId: null, reason: null, betaPeriodId: periodId, expiresAt: "2030-05-02T00:00:00.000Z" });
    const markup = renderToStaticMarkup(<CreditSourceDetails transaction={refund} locale="ru" />);
    expect(markup).toContain(betaExpiredLabel.ru); expect(markup).not.toContain(betaCreditMessages.ru.persistent);
    const permanent = renderToStaticMarkup(<CreditSourceDetails transaction={{ ...refund, betaPeriodId: null, expiresAt: null }} locale="ru" />);
    expect(permanent).toContain(betaCreditMessages.ru.persistent); expect(permanent).not.toContain(betaExpiredLabel.ru);
  });
});
