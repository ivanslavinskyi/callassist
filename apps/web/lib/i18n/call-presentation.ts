import { callBriefStatusSchema, callStage, type CallBriefStatus, type CallStage, type CallAiAssessmentState, type GoalAssessmentStatus } from "@callassist/contracts";

export const callPresentationCopy = {
  en: {
    state: "Call state", technicalState: "Technical state", all: "All calls", result: "Call outcome", unknown: "Outcome unknown",
    goal: "Goal achievement", ai: "AI", user: "You", adminUser: "User", notRated: "Not rated yet",
    loading: "Loading rating…", unavailable: "Rating could not be loaded", mismatch: "Assessments differ",
    callScope: "Rating for the call; not compared with this attempt", clear: "Clear filter",
    legacy: "Previous filter", completed: "Completed attempts", stopped: "Stopped attempts", failed: "Failed attempts",
    stages: { review_required: "Awaiting plan review", needs_clarification: "Needs clarification", blocked: "Cannot start",
      ready: "Ready to call", dialing: "Dialing", in_progress: "Call in progress", awaiting_approval: "Awaiting your decision", ended: "Call ended" },
    aiStates: { pending: "Assessing…", ready: "Assessed", unavailable: "Could not assess", not_assessed: "Not assessed", not_applicable: "Not applicable" },
    goals: { achieved: "Achieved", partial: "Partly achieved", not_achieved: "Not achieved", uncertain: "Uncertain" }
  },
  de: {
    state: "Anrufstatus", technicalState: "Technischer Status", all: "Alle Anrufe", result: "Anrufergebnis", unknown: "Ergebnis unklar",
    goal: "Zielerreichung", ai: "KI", user: "Sie", adminUser: "Nutzer", notRated: "Noch nicht bewertet",
    loading: "Bewertung wird geladen…", unavailable: "Bewertung konnte nicht geladen werden", mismatch: "Bewertungen weichen ab",
    callScope: "Bewertung des Anrufs; kein Vergleich mit diesem Versuch", clear: "Filter zurücksetzen",
    legacy: "Bisheriger Filter", completed: "Beendete Versuche", stopped: "Gestoppte Versuche", failed: "Fehlgeschlagene Versuche",
    stages: { review_required: "Planprüfung ausstehend", needs_clarification: "Klärung erforderlich", blocked: "Start nicht möglich",
      ready: "Bereit zum Anrufen", dialing: "Wird gewählt", in_progress: "Anruf läuft", awaiting_approval: "Ihre Entscheidung ausstehend", ended: "Anruf beendet" },
    aiStates: { pending: "Wird bewertet…", ready: "Bewertet", unavailable: "Bewertung nicht möglich", not_assessed: "Nicht bewertet", not_applicable: "Nicht zutreffend" },
    goals: { achieved: "Erreicht", partial: "Teilweise erreicht", not_achieved: "Nicht erreicht", uncertain: "Unklar" }
  }
} satisfies Record<"en" | "de", {
  state: string; technicalState: string; all: string; result: string; unknown: string; goal: string; ai: string; user: string; adminUser: string;
  notRated: string; loading: string; unavailable: string; mismatch: string; callScope: string; clear: string;
  legacy: string; completed: string; stopped: string; failed: string;
  stages: Record<CallStage, string>; aiStates: Record<CallAiAssessmentState, string>; goals: Record<GoalAssessmentStatus, string>;
}>;

export function legacyCallStatusLabel(status: CallBriefStatus, locale: "en" | "de") {
  const copy = callPresentationCopy[locale];
  return status === "completed" || status === "stopped" || status === "failed" ? copy[status] : copy.stages[callStage(status)];
}
export function callStatusMessages(locale: "en" | "de"): Record<CallBriefStatus, string> {
  return Object.fromEntries(callBriefStatusSchema.options.map(status => [status, callPresentationCopy[locale].stages[callStage(status)]])) as Record<CallBriefStatus, string>;
}
