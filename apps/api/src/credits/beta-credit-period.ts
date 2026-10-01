import type { BetaCreditPolicy } from "@callassist/contracts";

/** Calendar boundaries are UTC, independent of the host, browser and DST. */
export function betaCreditPeriod(period: BetaCreditPolicy["period"], now: Date) {
  if (period === "lifetime") return null;
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (period === "week") start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7);
  if (period === "month") start.setUTCDate(1);
  const end = new Date(start);
  if (period === "month") end.setUTCMonth(end.getUTCMonth() + 1);
  else end.setUTCDate(end.getUTCDate() + (period === "week" ? 7 : 1));
  return { startsAt: start.toISOString(), endsAt: end.toISOString() };
}
