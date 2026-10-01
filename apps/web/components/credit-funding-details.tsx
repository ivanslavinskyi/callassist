import { formatDateTime, type CreditFunding, type CreditTransaction, type UiLocale } from "@callassist/contracts";
import { betaAllowanceText, betaCreditMessages, betaExpiredLabel, betaLifetimeTransitionMessage } from "@/lib/i18n/beta-credit-messages";

export function CreditFundingDetails({ funding, locale }: { funding?: CreditFunding; locale: UiLocale }) {
  if (!funding) return null;
  const copy = betaCreditMessages[locale], allowance = funding.allowance;
  const date = (value: string) => formatDateTime(value, locale, { timeZone: "UTC" });
  return <div className="credit-funding-details">
    <dl className="account-usage-summary">
      <div><dt>{copy.persistent}</dt><dd>{funding.persistent}</dd></div>
      {allowance && allowance.period !== "lifetime" && <>
        <div><dt>{copy.available}</dt><dd>{allowance.available} / {allowance.limit}</dd></div>
        <div><dt>{copy.reserved}</dt><dd>{allowance.reserved}</dd></div>
        <div><dt>{copy.used}</dt><dd>{allowance.used}</dd></div>
        {allowance.endsAt && <div><dt>{copy.resets}</dt><dd><time dateTime={allowance.endsAt}>{date(allowance.endsAt)}</time></dd></div>}
      </>}
    </dl>
    {allowance && <p>{allowance.period === "lifetime" && allowance.lifetimeGrantAllowed === false
      ? betaLifetimeTransitionMessage[locale]
      : betaAllowanceText({ amount: allowance.limit, period: allowance.period }, locale)}{allowance.period !== "lifetime" ? `. ${copy.noCarry}` : ""}</p>}
    {allowance?.pending && <p>{copy.pending}: {allowance.pending.policy.period === "lifetime"
      ? betaLifetimeTransitionMessage[locale] : betaAllowanceText(allowance.pending.policy, locale)} · {date(allowance.pending.effectiveAt)} UTC</p>}
  </div>;
}
export function CreditSourceDetails({ transaction, locale }: { transaction: CreditTransaction; locale: UiLocale }) {
  const copy = betaCreditMessages[locale];
  return <small>{transaction.betaPeriodId ? <>{copy.credits}{transaction.expiresAt && <> · {Date.parse(transaction.expiresAt) <= Date.now() ? betaExpiredLabel[locale] : copy.expires}: <time dateTime={transaction.expiresAt}>{formatDateTime(transaction.expiresAt, locale, { timeZone: "UTC" })}</time></>}</> : copy.persistent}</small>;
}
