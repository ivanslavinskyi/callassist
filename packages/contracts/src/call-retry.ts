import { answeringResultSchema } from "./call-answering";
import { getAppointmentAuthorization } from "./appointment";
import type { CallBrief, CallCompilation } from "./call-brief";

export function canRepeatUnansweredCall(brief: Pick<CallBrief, "status" | "lifecycle">) {
  const lifecycle = brief.lifecycle;
  if (!["failed", "stopped", "completed"].includes(brief.status) || !lifecycle ||
      lifecycle.credit === "reserved" || lifecycle.credit === "used" ||
      lifecycle.consent === "granted" || lifecycle.consent === "declined" ||
      lifecycle.conversationStartedAt || lifecycle.substantiveAnswerConfirmed) return false;
  if (!lifecycle.connected && ["no_answer", "busy", "canceled", "technical_failure"].includes(lifecycle.result ?? "")) return true;
  if (answeringResultSchema.safeParse(lifecycle.result).success || (lifecycle.result === "technical_failure" && lifecycle.answering && !lifecycle.answering.streamAdmitted && lifecycle.consent === "not_requested")) return true;
  // A voicemail or IVR can answer the telephone leg without a consenting conversation.
  return brief.status === "completed" && lifecycle.result === "consent_not_received";
}

export function appointmentPlanExpired(compilation: CallCompilation, now = new Date()) {
  const authorization = compilation.compiledBrief && getAppointmentAuthorization(compilation.compiledBrief);
  if (!authorization) return false;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: authorization.timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const date = `${part("year")}-${part("month")}-${part("day")}`;
  const time = `${part("hour")}:${part("minute")}`;
  return authorization.windows.some(window => window.date < date || (window.date === date && window.endTime < time));
}
