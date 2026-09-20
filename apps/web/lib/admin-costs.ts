import { formatLocale } from "@callassist/contracts";
import type { AdminOperationsOverview } from "@callassist/contracts";

export type AdminCost = AdminOperationsOverview["cost"];
export type UsageComponent = AdminCost["providerUsage"]["components"]["realtime"];
export type ExpenseCategory = "realtime" | "preparation" | "translation" | "summary" | "transcription" | "twilio";

/** One money presentation across admin. Unknown and a real zero stay distinct. */
export function formatAdminMoney(micros: number | null, locale: "en" | "de" = "en", precise = false, currency = "USD") {
  if (micros === null) return "—";
  const formatter = new Intl.NumberFormat(formatLocale(locale), {
    style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: precise ? 6 : 2, maximumFractionDigits: precise ? 6 : 2
  });
  if (!precise && micros !== 0 && Math.abs(micros) < 10_000) return `${micros < 0 ? "−" : ""}<${formatter.format(.01)}`;
  return formatter.format(micros / 1_000_000);
}
export function expenseCategory(operationType: string): ExpenseCategory | null {
  return ({ realtime_response: "realtime", brief_compilation: "preparation", text_translation: "translation", call_summary: "summary", transcription: "transcription", telephony_leg: "twilio" } as Record<string, ExpenseCategory>)[operationType] ?? null;
}
export function expenseGroups(cost: AdminCost) {
  const c = cost.providerUsage.components;
  const groups: Array<{ key: ExpenseCategory; icon: string; parts: UsageComponent[] }> = [
    { key: "realtime", icon: "phone", parts: [c.realtime] },
    { key: "preparation", icon: "document-text", parts: [c.briefCompilation] },
    { key: "translation", icon: "language", parts: c.textTranslation ? [c.textTranslation] : [] },
    { key: "summary", icon: "clipboard-document-list", parts: c.callSummary ? [c.callSummary] : [] },
    { key: "transcription", icon: "microphone", parts: [c.realtimeTranscription, c.postCallTranscription] },
    { key: "twilio", icon: "signal", parts: [c.telephony] }
  ];
  return groups.map(group => {
    const amounts = group.parts.map(p => p.calculatedUsdMicros).filter((v): v is number => v !== null);
    const billing = cost.billing.find(b => b.provider === "twilio");
    return { ...group, amount: group.key === "twilio" ? billing?.totalMicros ?? cost.providerReported.usdMicros : amounts.length ? amounts.reduce((a, b) => a + b, 0) : null,
      requests: group.parts.reduce((sum, p) => sum + p.requests, 0),
      incomplete: group.key === "twilio" ? cost.providerReported.pendingOperations : group.parts.reduce((sum, p) => sum + p.incompleteRecords, 0),
      models: [...new Set(group.parts.flatMap(p => p.models))],
      records: group.parts.reduce((sum, p) => sum + p.usageRecords, 0) };
  });
}
