import { callSummaryPayloadSchema, summarySourceContextSchema, calendarDateDetails, nativeAppointmentRuleContains, type CallTextArtifact, type CallSummaryPayload, type SummarySourceContext, type TextLanguage } from "@callassist/contracts";
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

const unmatchedAction: Record<TextLanguage, string> = {
  en: "The saved action could not be matched unambiguously to the appointment in the conversation.",
  de: "Die gespeicherte Aktion lässt sich dem Termin im Gespräch nicht eindeutig zuordnen.",
  fr: "L'action enregistrée ne peut pas être reliée sans ambiguïté au rendez-vous évoqué.",
  it: "L'azione salvata non può essere associata in modo univoco all'appuntamento nella conversazione.",
  ru: "Не удалось однозначно сопоставить сохранённое действие с записью, обсуждённой в разговоре.",
  uk: "Не вдалося однозначно зіставити збережену дію із записом, обговореним у розмові."
};

/** Publication repeats the provenance/computation check, including cached chunks. */
export function assertSummaryArtifactOutput(artifact: CallTextArtifact, payload: unknown) {
  if (artifact.kind !== "call_summary" || !/^summary-v[45678]:/.test(artifact.generatorVersion)) return;
  const context = summarySourceContextSchema.parse(artifact.sourceContext);
  const parsed = callSummaryPayloadSchema.parse(payload);
  if (parsed.schemaVersion !== 3 || artifact.contextHash !== textPayloadHash(context) ||
      context.compilationId !== artifact.compilationId || context.transcriptRevisionId !== artifact.transcriptRevisionId || context.transcriptSourceHash !== artifact.sourceHash ||
      textPayloadHash(composeCalendarSummary(parsed, context, artifact.targetLanguage, artifact.generatorVersion)) !== textPayloadHash(parsed))
    throw new Error("SUMMARY_CONTEXT_INVALID");
}

/** Server-owned projection. It never upgrades a spoken offer to a confirmed action. */
export function composeCalendarSummary(summary: CallSummaryPayload, context: SummarySourceContext, language: TextLanguage,
  generatorVersion = "summary-v5:"): CallSummaryPayload {
  const result = structuredClone(summary);
  if (summary.schemaVersion !== 3 || !summary.appointmentExtraction) return result;
  result.unresolved = [...new Set((summary.unresolvedDetails ?? []).map(d => d.text))];
  if(context.version===2&&context.nativeAppointmentAuthorization)return /^summary-v[678]:/.test(generatorVersion)
    ? composeNativeSummary(result,context,language) : composeNativeCalendar(result,context,language,generatorVersion);
  if (!context.appointmentAuthorization) return callSummaryPayloadSchema.parse(result);
  const candidates = summary.appointmentExtraction.candidates;
  const superseded = new Set(candidates.flatMap(c => c.supersedes));
  const active = candidates.filter(c => !superseded.has(c.id) && c.status !== "corrected");
  // Preserve the projection pinned to historical artifacts and queued v4 jobs.
  const legacy = generatorVersion.startsWith("summary-v4:");
  const confirmed = active.filter(c => c.status === "reported_confirmed");
  // An unselected offer is not a second booking. Corrections were applied above;
  // conditions, ambiguity and competing confirmations must still block success.
  const relevant = !legacy && confirmed.length ? active.filter(c => c.status !== "offered") : active;
  const distinct = new Set(relevant.map(c => JSON.stringify([c.date, c.startTime, c.timeZone])));
  const chosen = distinct.size === 1 && relevant.every(c => c.status !== "ambiguous" && (legacy || c.status !== "conditional"))
    ? relevant.find(c => c.status === "reported_confirmed") ?? relevant[0] : undefined;
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
  const actionText = !legacy && action && !actionMatches ? unmatchedAction[language]
    : actionState === "confirmed" ? words.confirmed : words.unconfirmed;
  const windows = evaluation.windowIndex === null ? context.appointmentAuthorization.windows : [context.appointmentAuthorization.windows[evaluation.windowIndex]!];
  const sourceText = windows.map(w => `${calendarDateDetails(w.date, language).dateLabel}, ${w.startTime}–${w.endTime}`).join("; ");
  result.calendar = { version: APPOINTMENT_CALENDAR_VERSION, contextHash: textPayloadHash(context), candidateId: chosen?.id ?? null,
    ...evaluation, sourceSegmentIds: chosen?.sourceSegmentIds ?? [], label: words.label, text,
    sourceLabel: words.source, sourceText, actionState, actionText };
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

/** Native reports keep operation semantics and approved rules. The journal and
 * independently cited conversation must agree; neither can supply the other. */
function composeNativeSummary(summary: CallSummaryPayload, context: Extract<SummarySourceContext,{version:2}>, language: TextLanguage): CallSummaryPayload {
  const authority = context.nativeAppointmentAuthorization!, action = context.nativeAppointmentAction;
  const extraction = summary.appointmentExtraction!, outcome = extraction.nativeOutcome;
  if (!outcome || outcome.operation !== authority.operation) throw new Error("SUMMARY_NATIVE_OUTCOME_INVALID");
  const downgrade = () => {
    if (summary.assessment?.goal.status === "achieved")
      summary.assessment.goal.status = summary.assessment.conversation.status === "confirmed" ? "partial" : "uncertain";
  };
  if (outcome.disposition === "not_required" && !action && !extraction.candidates.some(c => c.status === "reported_confirmed")) {
    delete summary.calendar;
    if (summary.assessment?.criteria.some(c => c.status !== "achieved")) downgrade();
    return callSummaryPayloadSchema.parse(summary);
  }
  const superseded = new Set(extraction.candidates.flatMap(c => c.supersedes));
  const active = extraction.candidates.filter(c => !superseded.has(c.id) && c.status !== "corrected");
  const relevant = active.some(c => c.status === "reported_confirmed") ? active.filter(c => c.status !== "offered") : active;
  const distinct = new Set(relevant.map(c => JSON.stringify([c.date,c.startTime,c.timeZone])));
  const chosen = distinct.size === 1 && relevant.every(c => c.status !== "ambiguous" && c.status !== "conditional")
    ? relevant.find(c => c.id === outcome.candidateId) : undefined;
  const rule = chosen && authority.alternatives.flatMap(a => a.rules).find(r => nativeAppointmentRuleContains(r, chosen.date ?? "", chosen.startTime ?? undefined));
  const existing = authority.existingAppointment;
  // Project only the relevant approved rule into the shared timezone utility;
  // do not replace the frozen native context with fabricated point authority.
  const window = chosen?.date && (authority.operation === "book" || authority.operation === "reschedule")
    ? rule ? { date: chosen.date, startTime: rule.startTime, endTime: rule.endTime } : null
    : existing ? { date: existing.date, startTime: existing.startTime, endTime: existing.startTime } : null;
  const empty: CalendarEvaluation = {eligibility:"unknown",reason:active.length?"conflicting_candidates":"missing_date",windowIndex:null,startsAt:null,pastAtReference:null};
  const evaluation: CalendarEvaluation = !chosen ? empty : !chosen.date ? {...empty,reason:"missing_date"}
    : !chosen.startTime ? {...empty,reason:"missing_time"}
    : chosen.timeZone !== authority.timeZone ? {...empty,reason:"zone_conflict"} : !window
    ? {...empty,eligibility:"outside",reason:"outside_window"}
    : evaluateAppointmentCalendar({authorization:{operation:"book",serviceDescription:authority.serviceDescription,providerScope:"called_recipient",
      timeZone:authority.timeZone,windows:[window],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"},
      candidate:chosen,referenceAt:context.callConnectedAt??context.callCreatedAt});
  const proposal = action?.proposal;
  const sameAction = !!action && !!chosen && action.callAttemptId === context.callAttemptId && action.snapshotHash === context.compilationSnapshotHash &&
    proposal!.operation === authority.operation && proposal!.date === chosen.date && proposal!.startTime === chosen.startTime && proposal!.timeZone === chosen.timeZone;
  const approvedAction = sameAction && (authority.operation === "book" || authority.operation === "reschedule"
    ? authority.alternatives.some(a => a.id === proposal!.alternativeId && a.rules.some(r => nativeAppointmentRuleContains(r,proposal!.date,proposal!.startTime)))
    : proposal!.alternativeId === null && existing?.date === proposal!.date && existing.startTime === proposal!.startTime);
  const replacement = authority.operation !== "reschedule" || outcome.previousAppointmentReleased === true;
  const confirmed = approvedAction && action!.state === "confirmed" && outcome.disposition === "confirmed" &&
    chosen?.status === "reported_confirmed" && replacement && evaluation.eligibility === "within" && evaluation.pastAtReference === false;
  if (authority.operation === "cancel") {
    // A cancelled existing slot must never appear as a new calendar appointment.
    delete summary.calendar;
  } else {
    const words = copy[language];
    const actionState = sameAction ? action!.state === "authorized" ? "sending" : action!.state === "declined" ? "uncertain" : action!.state : "unconfirmed";
    summary.calendar = {version:APPOINTMENT_CALENDAR_VERSION,contextHash:textPayloadHash(context),candidateId:chosen?.id??null,...evaluation,
      sourceSegmentIds:chosen?.sourceSegmentIds??[],label:words.label,
      text:(chosen?.date&&chosen.startTime?`${calendarDateDetails(chosen.date,language).dateLabel}, ${chosen.startTime}. `:"")+
        (evaluation.eligibility==="within"?words.within:evaluation.eligibility==="outside"?words.outside:words.unknown),
      sourceLabel:words.source,sourceText:window?`${calendarDateDetails(window.date,language).dateLabel}, ${window.startTime}–${window.endTime}`:"",
      actionState:actionState==="confirmed"&&!confirmed?"unconfirmed":actionState,
      actionText:confirmed?words.confirmed:action&&!sameAction?unmatchedAction[language]:words.unconfirmed};
  }
  for (const condition of extraction.conditions) {
    const finding = summary.findings.find(f=>f.id===condition.checkId);
    if (!finding) throw new Error("SUMMARY_CALENDAR_CONDITION_INVALID");
    const applicable = !!chosen && condition.candidateId === chosen.id;
    const status = applicable && evaluation.eligibility === "within" ? "achieved" : applicable && evaluation.eligibility === "outside" ? "not_achieved" : "uncertain";
    if (condition.kind === "calendar_only") summary.overview = summary.overview.map(item=>({...item,findingIds:item.findingIds.filter(id=>id!==finding.id)})).filter(item=>item.findingIds.length);
    const criterion = summary.assessment?.criteria.find(c=>c.id===condition.checkId);
    if (criterion && (condition.kind === "calendar_only" || status !== "achieved")) { criterion.status=status;criterion.sourceSegmentIds=chosen?.sourceSegmentIds??[]; }
  }
  if (!confirmed || summary.assessment?.criteria.some(c=>c.status!=="achieved")) downgrade();
  return callSummaryPayloadSchema.parse(summary);
}

/** A native confirmation is an attributed provider statement, not a calendar API receipt.
 * The transcript must independently describe the same result; the journal never upgrades it. */
function composeNativeCalendar(summary:CallSummaryPayload,context:Extract<SummarySourceContext,{version:2}>,language:TextLanguage,generatorVersion:string):CallSummaryPayload {
  const authority=context.nativeAppointmentAuthorization!,action=context.nativeAppointmentAction;
  const matches=action&&action.snapshotHash===context.compilationSnapshotHash&&action.callAttemptId===context.callAttemptId&&action.proposal.operation===authority.operation;
  const proposal=matches?action.proposal:null;
  const permitted=proposal&&proposal.timeZone===authority.timeZone&&(authority.operation==="book"||authority.operation==="reschedule"
    ?authority.alternatives.some(a=>a.id===proposal.alternativeId&&a.rules.some(r=>nativeAppointmentRuleContains(r,proposal.date,proposal.startTime)))
    :authority.existingAppointment?.date===proposal.date&&authority.existingAppointment.startTime===proposal.startTime);
  if(!permitted||!action||authority.operation==="cancel") {
    if(summary.schemaVersion===3&&summary.assessment?.goal.status==="achieved"&&(!permitted||action?.state!=="confirmed"))
      summary.assessment.goal.status=summary.assessment.conversation.status==="confirmed"?"partial":"uncertain";
    // Cancellation concerns the old appointment. Never present it as a newly booked slot.
    if(summary.schemaVersion===3)delete summary.calendar;
    return callSummaryPayloadSchema.parse(summary);
  }
  const {nativeAppointmentAuthorization:_authority,nativeAppointmentAction:_action,...base}=context;
  const projected:SummarySourceContext={...base,version:1,appointmentAuthorization:{operation:"book",serviceDescription:authority.serviceDescription,
    providerScope:"called_recipient",timeZone:authority.timeZone,windows:[{date:proposal.date,startTime:proposal.startTime,endTime:proposal.startTime}],selection:"first_matching",maxAppointments:1,financialPolicy:"no_new_financial_terms"},
    actionEvidence:{id:action.id,version:action.revision,state:action.state==="authorized"?"sending":action.state==="declined"?"uncertain":action.state,
      date:proposal.date,startTime:proposal.startTime,timeZone:proposal.timeZone}};
  const result=composeCalendarSummary(summary,projected,language,generatorVersion);
  if(result.schemaVersion===3&&result.calendar)result.calendar.contextHash=textPayloadHash(context);
  return result;
}
