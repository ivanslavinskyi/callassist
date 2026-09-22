import type { TelemetryExportInput } from "@callassist/contracts";

const dayMs = 86_400_000;
const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Europe/Zurich", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
});
function parts(date: Date) {
  return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
}
function localDate(date: Date) {
  const p = parts(date); return `${p.year}-${p.month}-${p.day}`;
}
function shift(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * dayMs).toISOString().slice(0, 10);
}
export function zurichMidnight(date: string) {
  const wall = Date.parse(`${date}T00:00:00Z`);
  let instant = wall;
  for (let i = 0; i < 4; i++) {
    const p = parts(new Date(instant));
    const formatted = Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`);
    instant += wall - formatted;
  }
  return new Date(instant).toISOString();
}
export function resolveExportPeriod(input: TelemetryExportInput, now = new Date()) {
  const today = localDate(now);
  let first = today, end = now.toISOString(), days = 1;
  switch (input.preset) {
    case "yesterday": first = shift(today, -1); end = zurichMidnight(today); break;
    case "last7": first = shift(today, -6); days = 7; break;
    case "last30": first = shift(today, -29); days = 30; break;
    case "previousMonth": {
      const thisMonth = `${today.slice(0, 7)}-01`;
      first = `${shift(thisMonth, -1).slice(0, 7)}-01`;
      end = zurichMidnight(thisMonth);
      days = (Date.parse(thisMonth) - Date.parse(first)) / dayMs;
      break;
    }
    case "custom":
      if (!input.dateFrom || !input.dateTo) throw new Error("EXPORT_INVALID_PERIOD");
      first = input.dateFrom; end = zurichMidnight(shift(input.dateTo, 1));
      days = (Date.parse(input.dateTo) - Date.parse(first)) / dayMs + 1;
      break;
  }
  const from = zurichMidnight(first);
  if (days < 1 || days > 31 || from >= end || !Number.isFinite(Date.parse(from))) throw new Error("EXPORT_INVALID_PERIOD");
  return { from, to: end, timezone: "Europe/Zurich" as const };
}
