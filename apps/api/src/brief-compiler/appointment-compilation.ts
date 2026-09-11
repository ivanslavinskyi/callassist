import { appointmentAuthorizationSchema, appointmentDateSchema, getAppointmentAuthorization, supportedTextLanguage, type AppointmentAuthorization, type CompiledCallBrief, type RawCallBrief } from "@callassist/contracts";
import { MODEL_APPOINTMENT_SCHEDULE_JSON_SCHEMA, resolveAppointmentSchedule } from "./appointment-schedule";

/** Development mock heuristic only. Production uses the model's evidenced semantic interpretation. */
export function deterministicMockAppointmentIntent(raw: RawCallBrief): AppointmentAuthorization["operation"] | null {
  const objective = [raw.objective, ...raw.clarificationAnswers.map(({ answer }) => answer)].join("\n");
  const restrictions = `${objective}\n${raw.context}`;
  const noBooking = /(?:do not|don't|never|not authorised to)\s+(?:book|reserve|schedule|make\s+(?:\w+\s+){0,2}appointment)|(?:nicht|kein\w*)\s+(?:\w+\s+){0,3}(?:buch|vereinbar)|(?:не|не потрібно)\s+(?:запис|брон)|(?:ne pas|sans)\s+(?:réserv|reserv|prendre)|non\s+(?:prenot|fiss)/iu.test(restrictions);
  const noConfirmation = /(?:do not|don't|never|not authorised to)\s+(?:(?:book|reserve|schedule)\s+(?:or|and)\s+)?confirm|(?:nicht|kein\w*)\s+(?:\w+\s+){0,3}bestätig|(?:не|не потрібно)\s+(?:подтверж|підтвердж)|(?:ne pas|sans)\s+confirm|non\s+conferm/iu.test(restrictions);
  const existing = /(?:confirm|bestätig|подтвер|підтверд|conferm).{0,65}(?:appointment|booking|termin|запис|при[её]м|брон|rendez-vous|appuntament)|(?:appointment|booking|termin|запис|при[её]м|брон|rendez-vous|appuntament).{0,65}(?:confirm|bestätig|подтвер|підтверд|conferm)/iu;
  if (!noBooking && /(?:^|[.!?\n]\s*|\b(?:please|to|and|can you|could you)\s+)(?:book|reserve|schedule)\b|\b(?:book|reserve|schedule)\s+(?:me|us|my|our|an?|the)\b|(?:make|arrange).{0,35}appointment|(?:^|[.!?\n]\s*)(?:I|we)\s+(?:need|want|would like)\s+(?:an?|the|my|our|a new)\s+appointment|(?:termin.{0,45}(?:vereinbar|buch)|(?:vereinbar|buch|brauche|benötige|möchte|wünsche).{0,45}termin)|запи(?:ши|сать|саться)|запис(?:ати|атися)|(?:нужн[ао]|хочу).{0,30}(?:запис|при[её]м)|(?:pren(?:dre|ez|ds)|réserv|reserv|fix(?:er|ez)|voudrais).{0,45}rendez-vous|(?:prenot|fiss|vorrei).{0,45}appuntament/iu.test(objective)) return "book";
  const attendance = /\bconfirm\s+(?:(?:my|our|the|his|her)\s+)?(?:attendance|participation)\b|bestätig\w*\s+(?:(?:meine|unsere|die)\s+)?(?:teilnahme|anwesenheit)/iu;
  if (!noConfirmation && (existing.test(objective) || attendance.test(objective))) return "confirm_existing";
  return null;
}

/** Only unambiguous ISO/Swiss dates may be compared canonically; references and slash dates stay exact. */
export function canonicalAppointmentDate(identifier: string): string | null {
  const swiss = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(identifier);
  const canonical = swiss ? `${swiss[3]}-${swiss[2]!.padStart(2, "0")}-${swiss[1]!.padStart(2, "0")}` : identifier;
  return appointmentDateSchema.safeParse(canonical).success ? canonical : null;
}

/** Calendar provenance includes excluded days inside the interpreted domain, never arbitrary narrative dates. */
export function isAuthorizedAppointmentDateIdentifier(identifier: string, authorization: AppointmentAuthorization | null, calendarDates: readonly string[] = []) {
  const canonical = canonicalAppointmentDate(identifier);
  return canonical !== null && ((authorization?.windows.some((window) => window.date === canonical) ?? false) || calendarDates.includes(canonical));
}

export type AppointmentCompilationContext = {
  intent: "none" | AppointmentAuthorization["operation"];
  calendarDates: string[];
  missingSchedulingConstraints: boolean;
  authorizationMismatch: boolean;
};

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function exactKeys(value: Record<string, unknown>, keys: string[]) {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** This envelope is compilation-only and is never written into immutable plan/snapshot JSON. */
export function prepareAppointmentModelOutput(modelOutput: unknown, raw: RawCallBrief, now: Date):
  | { success: true; output: Record<string, unknown>; context: AppointmentCompilationContext }
  | { success: false; path: string; message: string } {
  const envelope = record(modelOutput);
  if (!envelope || !Object.hasOwn(envelope, "appointmentAuthorization")) {
    return { success: false, path: "appointmentAuthorization", message: "Return required nullable appointmentAuthorization" };
  }
  const interpretation = record(envelope.schedulingInterpretation);
  if (!interpretation || !exactKeys(interpretation, ["intent", "authorityEvidence", "schedule"]) ||
    typeof interpretation.intent !== "string" || !["none", "book", "confirm_existing"].includes(interpretation.intent)) {
    return { success: false, path: "schedulingInterpretation", message: "Return the required structured intent, authorityEvidence and nullable schedule" };
  }
  const { schedulingInterpretation: _intermediate, ...output } = envelope;
  const context: AppointmentCompilationContext = {
    intent: interpretation.intent as AppointmentCompilationContext["intent"], calendarDates: [], missingSchedulingConstraints: false, authorizationMismatch: false
  };
  if (interpretation.intent === "none") {
    context.authorizationMismatch = output.appointmentAuthorization !== null || interpretation.schedule !== null || interpretation.authorityEvidence !== null;
    return { success: true, output: { ...output, appointmentAuthorization: null }, context };
  }
  const evidence = record(interpretation.authorityEvidence);
  const index = evidence?.clarificationAnswerIndex;
  const evidenceSource = evidence?.source === "objective" && index === null ? raw.objective
    : evidence?.source === "clarification_answer" && Number.isSafeInteger(index) && (index as number) >= 0
      ? raw.clarificationAnswers[index as number]?.answer : undefined;
  if (!evidence || !exactKeys(evidence, ["source", "clarificationAnswerIndex", "quote"]) ||
    typeof evidence.quote !== "string" || evidence.quote.trim().length === 0 || evidence.quote.length > 2_000 || !evidenceSource?.includes(evidence.quote)) {
    return { success: false, path: "schedulingInterpretation.authorityEvidence", message: "Quote the exact requested scheduling authority from objective or the indexed clarification answer; background context cannot grant authority" };
  }
  if (interpretation.schedule === null) {
    context.missingSchedulingConstraints = true;
    return { success: true, output: { ...output, appointmentAuthorization: null }, context };
  }
  const schedule = resolveAppointmentSchedule(interpretation.schedule, now);
  if (!schedule.ok) {
    if (["invalid_schedule", "invalid_clock", "invalid_time_zone", "invalid_date", "invalid_time_range"].includes(schedule.reason)) {
      return { success: false, path: "schedulingInterpretation.schedule", message: `Return a valid structured calendar interpretation (${schedule.reason}); do not invent missing user constraints` };
    }
    context.missingSchedulingConstraints = true;
    return { success: true, output: { ...output, appointmentAuthorization: null }, context };
  }
  context.calendarDates = schedule.calendarDates;
  if (output.appointmentAuthorization === null) {
    context.missingSchedulingConstraints = true;
    return { success: true, output, context };
  }
  const metadata = output.appointmentAuthorization;
  const metadataObject = metadata !== null && typeof metadata === "object" && !Array.isArray(metadata) ? metadata as Record<string, unknown> : null;
  const authorization = metadataObject && !Object.hasOwn(metadataObject, "windows")
    ? appointmentAuthorizationSchema.safeParse({ ...metadataObject, windows: schedule.windows }) : null;
  if (!authorization?.success) {
    return { success: false, path: "appointmentAuthorization", message: "Return valid bounded appointment metadata without windows; confirm_existing requires one known exact date and time in schedule" };
  }
  context.authorizationMismatch = authorization.data.operation !== interpretation.intent ||
    authorization.data.timeZone !== (interpretation.schedule as { timeZone: string }).timeZone;
  return { success: true, output: { ...output, appointmentAuthorization: authorization.data }, context };
}

const copy = {
  en: { clarify: "Which date and time may I agree to? Please give the acceptable start-time range; times are Europe/Zurich unless you specify another time zone.", success: "The recipient explicitly confirms the authorized arrangement", unresolved: "The arrangement remains tentative or no approved time is available", stop: "Do not agree outside the approved start-time windows, with someone other than the called recipient, or to new financial terms" },
  de: { clarify: "Welches Datum und welche Uhrzeit darf ich zusagen? Bitte nennen Sie das zulässige Zeitfenster für den Beginn; ohne andere Angabe gilt Europe/Zurich.", success: "Die angerufene Person bestätigt die freigegebene Vereinbarung ausdrücklich", unresolved: "Die Vereinbarung ist unverbindlich oder keine freigegebene Zeit ist verfügbar", stop: "Keine Zusage ausserhalb der freigegebenen Startzeiten, mit einer anderen als der angerufenen Person oder zu neuen finanziellen Bedingungen" },
  fr: { clarify: "Quelles dates et heures puis-je accepter ? Indiquez la plage de début autorisée ; sauf indication contraire, le fuseau est Europe/Zurich.", success: "Le destinataire confirme explicitement l’accord autorisé", unresolved: "L’accord reste provisoire ou aucune heure autorisée n’est disponible", stop: "Ne pas accepter un début hors des plages autorisées, un accord avec une autre personne que le destinataire ou de nouvelles conditions financières" },
  it: { clarify: "Quali date e orari posso accettare? Indichi la fascia di inizio consentita; salvo diversa indicazione, il fuso è Europe/Zurich.", success: "Il destinatario conferma esplicitamente l’accordo autorizzato", unresolved: "L’accordo resta provvisorio o non è disponibile un orario autorizzato", stop: "Non accettare un inizio fuori dalle fasce autorizzate, accordi con persone diverse dal destinatario o nuove condizioni finanziarie" },
  ru: { clarify: "На какую дату и время можно согласиться? Укажите допустимый интервал начала; если не указано иначе, время — Europe/Zurich.", success: "Собеседник явно подтвердил разрешённую договорённость", unresolved: "Договорённость остаётся предварительной или разрешённого времени нет", stop: "Не соглашаться на начало вне разрешённых интервалов, договорённости с другими собеседниками или новые финансовые условия" },
  uk: { clarify: "На яку дату й час можна погодитися? Вкажіть дозволений проміжок початку; якщо не зазначено інше, час — Europe/Zurich.", success: "Співрозмовник явно підтвердив дозволену домовленість", unresolved: "Домовленість залишається попередньою або дозволеного часу немає", stop: "Не погоджуватися на початок поза дозволеними проміжками, домовленості з іншими співрозмовниками чи нові фінансові умови" }
} as const;
function language(raw: RawCallBrief, sourceLanguage?: string) {
  const detected = supportedTextLanguage(sourceLanguage);
  if (detected) return detected;
  if (/[іїєґ]/iu.test(raw.objective)) return "uk";
  if (/[а-яё]/iu.test(raw.objective)) return "ru";
  return raw.locale.split("-")[0] as keyof typeof copy;
}
export function appointmentClarification(raw: RawCallBrief, sourceLanguage?: string) { return (copy[language(raw, sourceLanguage)] ?? copy.en).clarify; }

/** Confirmation is an execution rule and a post-call criterion, not an extra scripted question. */
export function enforceAppointmentPlan(raw: RawCallBrief, compiled: CompiledCallBrief): CompiledCallBrief {
  if (!getAppointmentAuthorization(compiled)) return compiled;
  const text = copy[raw.locale.split("-")[0] as keyof typeof copy] ?? copy.en;
  if ((compiled.successCriteria.length >= 10 && !compiled.successCriteria.includes(text.success)) ||
    (compiled.unresolvedCriteria.length >= 10 && !compiled.unresolvedCriteria.includes(text.unresolved)) ||
    (compiled.stopConditions.length >= 10 && !compiled.stopConditions.includes(text.stop))) {
    return compiled.blockingIssues.length >= 6 ? compiled : { ...compiled,
      blockingIssues: [...compiled.blockingIssues, { code: "conflicting_instructions", question: appointmentClarification(raw, compiled.sourceLanguage) }] };
  }
  return { ...compiled,
    successCriteria: [...new Set([...compiled.successCriteria, text.success])],
    unresolvedCriteria: [...new Set([...compiled.unresolvedCriteria, text.unresolved])],
    stopConditions: [...new Set([...compiled.stopConditions, text.stop])]
  };
}

export const modelAppointmentAuthorizationJsonSchema = {
  anyOf: [{ type: "null" }, {
    type: "object", additionalProperties: false,
    required: ["operation", "serviceDescription", "providerScope", "timeZone", "selection", "maxAppointments", "financialPolicy"],
    properties: {
      operation: { type: "string", enum: ["book", "confirm_existing"] }, serviceDescription: { type: "string" },
      providerScope: { type: "string", enum: ["called_recipient"] }, timeZone: { type: "string" },
      selection: { type: "string", enum: ["first_matching"] }, maxAppointments: { type: "integer", enum: [1] },
      financialPolicy: { type: "string", enum: ["no_new_financial_terms"] }
    }
  }]
} as const;


export const modelSchedulingInterpretationJsonSchema = {
  type: "object", additionalProperties: false,
  required: ["intent", "authorityEvidence", "schedule"],
  properties: {
    intent: { type: "string", enum: ["none", "book", "confirm_existing"] },
    authorityEvidence: { anyOf: [{ type: "null" }, {
      type: "object", additionalProperties: false,
      required: ["source", "clarificationAnswerIndex", "quote"],
      properties: {
        source: { type: "string", enum: ["objective", "clarification_answer"] },
        clarificationAnswerIndex: { type: ["integer", "null"] },
        quote: { type: "string" }
      }
    }] },
    schedule: { anyOf: [{ type: "null" }, MODEL_APPOINTMENT_SCHEDULE_JSON_SCHEMA] }
  }
} as const;
