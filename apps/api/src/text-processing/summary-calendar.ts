import { callSummaryPayloadSchema, summarySourceContextSchema, calendarDateDetails, type CallTextArtifact, type CallSummaryPayload, type SummarySourceContext, type TextLanguage } from "@callassist/contracts";
import { APPOINTMENT_CALENDAR_VERSION, evaluateAppointmentCalendar, type CalendarEvaluation } from "../appointments/appointment-calendar";
import { textPayloadHash } from "../storage/call-text-repository";

const copy: Record<TextLanguage, { label: string; within: string; outside: string; unknown: string; source: string; unconfirmed: string; confirmed: string }> = {
  en: { label: "Permitted date and time", within: "The date and time match the approved schedule.", outside: "The date or time falls outside the approved schedule.", unknown: "The agreed date and time could not be matched unambiguously to the approved schedule.", source: "Approved schedule", unconfirmed: "The action was not confirmed in the application.", confirmed: "The application recorded the recipient's confirmation." },
  ru: { label: "Допустимое время", within: "Дата и время соответствуют утверждённому расписанию.", outside: "Дата или время выходят за пределы утверждённого расписания.", unknown: "Не удалось однозначно сопоставить согласованные дату и время с утверждённым расписанием.", source: "Утверждённое расписание", unconfirmed: "Подтверждение действия в приложении не завершено.", confirmed: "В приложении сохранено подтверждение собеседника." },
  de: { label: "Zulässiger Termin", within: "Datum und Uhrzeit entsprechen dem genehmigten Zeitplan.", outside: "Datum oder Uhrzeit liegen außerhalb des genehmigten Zeitplans.", unknown: "Der vereinbarte Termin lässt sich nicht eindeutig dem genehmigten Zeitplan zuordnen.", source: "Genehmigter Zeitplan", unconfirmed: "Die Aktion wurde in der Anwendung nicht bestätigt.", confirmed: "Die Bestätigung des Gesprächspartners wurde in der Anwendung erfasst." },
  fr: { label: "Créneau autorisé", within: "La date et l'heure respectent les créneaux approuvés.", outside: "La date ou l'heure ne respecte pas les créneaux approuvés.", unknown: "La date et l'heure convenues ne peuvent pas être comparées sans ambiguïté aux créneaux approuvés.", source: "Créneaux approuvés", unconfirmed: "L'action n'a pas été confirmée dans l'application.", confirmed: "L'application a enregistré la confirmation de l'interlocuteur." },
  it: { label: "Orario consentito", within: "La data e l'ora rispettano gli orari approvati.", outside: "La data o l'ora non rispettano gli orari approvati.", unknown: "Non è possibile confrontare senza ambiguità la data e l'ora concordate con gli orari approvati.", source: "Orari approvati", unconfirmed: "L'azione non è stata confermata nell'applicazione.", confirmed: "L'applicazione ha registrato la conferma dell'interlocutore." },
  uk: { label: "Допустимий час", within: "Дата й час відповідають затвердженому розкладу.", outside: "Дата або час виходять за межі затвердженого розкладу.", unknown: "Не вдалося однозначно зіставити погоджені дату й час із затвердженим розкладом.", source: "Затверджений розклад", unconfirmed: "Підтвердження дії в застосунку не завершено.", confirmed: "У застосунку збережено підтвердження співрозмовника." }
};

/** Publication repeats the provenance/computation check, including cached chunks. */
export function assertSummaryArtifactOutput(artifact: CallTextArtifact, payload: unknown) {
  if (artifact.kind !== "call_summary" || !artifact.generatorVersion.startsWith("summary-v4:")) return;
  const context = summarySourceContextSchema.parse(artifact.sourceContext);
  const parsed = callSummaryPayloadSchema.parse(payload);
  if (parsed.schemaVersion !== 3 || artifact.contextHash !== textPayloadHash(context) ||
      context.compilationId !== artifact.compilationId || context.transcriptRevisionId !== artifact.transcriptRevisionId || context.transcriptSourceHash !== artifact.sourceHash ||
      textPayloadHash(composeCalendarSummary(parsed, context, artifact.targetLanguage)) !== textPayloadHash(parsed))
    throw new Error("SUMMARY_CONTEXT_INVALID");
}

/** Server-owned projection. It never upgrades a spoken offer to a confirmed action. */
export function composeCalendarSummary(summary: CallSummaryPayload, context: SummarySourceContext, language: TextLanguage): CallSummaryPayload {
  const result = structuredClone(summary);
  if (summary.schemaVersion !== 3 || !summary.appointmentExtraction) return result;
  result.unresolved = [...new Set((summary.unresolvedDetails ?? []).map(d => d.text))];
  if (!context.appointmentAuthorization) return callSummaryPayloadSchema.parse(result);
  const candidates = summary.appointmentExtraction.candidates;
  const superseded = new Set(candidates.flatMap(c => c.supersedes));
  const active = candidates.filter(c => !superseded.has(c.id) && c.status !== "corrected");
  const distinct = new Set(active.map(c => JSON.stringify([c.date, c.startTime, c.timeZone])));
  const chosen = distinct.size === 1 && active.every(c => c.status !== "ambiguous")
    ? active.find(c => c.status === "reported_confirmed") ?? active[0] : undefined;
  const evaluation: CalendarEvaluation = active.length && !chosen
    ? { eligibility: "unknown", reason: "conflicting_candidates", windowIndex: null, startsAt: null, pastAtReference: null }
    : evaluateAppointmentCalendar({ authorization: context.appointmentAuthorization, candidate: chosen ?? null,
      referenceAt: context.callConnectedAt ?? context.callCreatedAt });
  const words = copy[language];
  const verdictText = evaluation.eligibility === "within" ? words.within : evaluation.eligibility === "outside" ? words.outside : words.unknown;
  const candidateText = chosen?.date && chosen.startTime ? `${calendarDateDetails(chosen.date, language).dateLabel}, ${chosen.startTime}. ` : "";
  const text = candidateText + verdictText;
  const action = context.actionEvidence;
  const actionMatches = !!chosen && !!action && action.date === chosen.date && action.startTime === chosen.startTime && action.timeZone === chosen.timeZone;
  const actionState = actionMatches ? action.state : "unconfirmed";
  const windows = evaluation.windowIndex === null ? context.appointmentAuthorization.windows : [context.appointmentAuthorization.windows[evaluation.windowIndex]!];
  const sourceText = windows.map(w => `${calendarDateDetails(w.date, language).dateLabel}, ${w.startTime}–${w.endTime}`).join("; ");
  result.calendar = { version: APPOINTMENT_CALENDAR_VERSION, contextHash: textPayloadHash(context), candidateId: chosen?.id ?? null,
    ...evaluation, sourceSegmentIds: chosen?.sourceSegmentIds ?? [], label: words.label, text,
    sourceLabel: words.source, sourceText, actionState, actionText: actionState === "confirmed" ? words.confirmed : words.unconfirmed };
  for (const condition of summary.appointmentExtraction.conditions) {
    const finding = result.findings.find(f => f.id === condition.checkId);
    if (!finding) throw new Error("SUMMARY_CALENDAR_CONDITION_INVALID");
    const applicable = !!chosen && condition.candidateId === chosen.id;
    const status = applicable && evaluation.eligibility === "within" ? "achieved" : applicable && evaluation.eligibility === "outside" ? "not_achieved" : "uncertain";
    if (condition.kind === "calendar_only") {
      // certainty retains its meaning (speech). The computed calendar is displayed
      // separately, without representing a server calculation as recipient speech.
      result.overview = result.overview.map(item => ({ ...item, findingIds: item.findingIds.filter(id => id !== finding.id) }))
        .filter(item => item.findingIds.length);
    }
    const criterion = result.assessment?.criteria.find(c => c.id === condition.checkId);
    if (criterion && (condition.kind === "calendar_only" || status !== "achieved")) {
      criterion.status = status;
      criterion.sourceSegmentIds = chosen?.sourceSegmentIds ?? [];
    }
  }
  if (result.assessment) {
    const a = result.assessment;
    // Calendar membership is a mandatory guard regardless of model decomposition.
    const satisfied = evaluation.eligibility === "within" && evaluation.pastAtReference !== true &&
      chosen?.status === "reported_confirmed" && actionState === "confirmed";
    if (a.goal.status === "achieved" && (!satisfied || a.criteria.some(c => c.status !== "achieved")))
      a.goal.status = a.conversation.status === "confirmed" ? "partial" : "uncertain";
  }
  return callSummaryPayloadSchema.parse(result);
}
