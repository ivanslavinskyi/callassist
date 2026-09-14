import type { CallSummaryPayload } from "@callassist/contracts";
import type { CallPlanPresentationData } from "@/components/call-plan-presentation";
import { landingDemo } from "./landing-demo";
import type { UiLocale } from "./i18n/registry";
import { demoMessages } from "./i18n/demo-messages";
import { buildTranscriptPdfLayout } from "./transcript-pdf-layout";

export const demoScenarioIds = ["documents", "repair", "appointment"] as const;
export type DemoScenarioId = typeof demoScenarioIds[number];
export type DemoTurn = { id: string; role: "assistant" | "recipient"; text: string; seconds: number };
export type DemoScenario = { id: DemoScenarioId; label: string; recipient: string; request: string; plan: CallPlanPresentationData; turns: DemoTurn[]; summary: CallSummaryPayload };
export type DemoPhase = "idle" | "typing" | "compiling" | "review" | "dialing" | "consent" | "live" | "finalizing" | "result";
export type DemoState = { phase: DemoPhase; tick: number; paused: boolean };
export type DemoAction = { type: "start" | "approve" | "pause" | "reset" } | { type: "tick" | "next"; turnCount: number };
export const initialDemoState: DemoState = { phase: "idle", tick: 0, paused: false };

// Only the review action can cross the approval gate. No provider/API operations.
export function demoReducer(state: DemoState, action: DemoAction): DemoState {
  if (action.type === "reset") return initialDemoState;
  if (action.type === "start") return { phase: "typing", tick: 0, paused: false };
  if (action.type === "approve") return state.phase === "review" ? { phase: "dialing", tick: 0, paused: false } : state;
  if (action.type === "pause") return { ...state, paused: !state.paused };
  if (action.type !== "next" && (action.type !== "tick" || state.paused)) return state;
  const limits: Partial<Record<DemoPhase, number>> = { typing: 28, compiling: 3, dialing: 2, consent: 3, live: action.turnCount, finalizing: 2 };
  const following: Partial<Record<DemoPhase, DemoPhase>> = { typing: "compiling", compiling: "review", dialing: "consent", consent: "live", live: "finalizing", finalizing: "result" };
  const limit = limits[state.phase];
  if (limit === undefined) return state;
  // Manual advance respects every recipient turn and the consent display.
  const nextTick = action.type === "next" && state.phase !== "live" && state.phase !== "consent" ? limit : state.tick + 1;
  return nextTick >= limit ? { phase: following[state.phase]!, tick: 0, paused: state.paused } : { ...state, tick: nextTick };
}
export function demoStep(phase: DemoPhase) {
  return phase === "idle" || phase === "typing" ? 0 : phase === "compiling" || phase === "review" ? 1 : phase === "dialing" || phase === "consent" ? 2 : phase === "live" ? 3 : 4;
}
export function demoDelay(phase: DemoPhase) { return phase === "typing" ? 75 : phase === "live" ? 2300 : phase === "consent" ? 1900 : 850; }

function buildDemoScenario(locale: "en" | "de", id: DemoScenarioId): DemoScenario {
  const de = locale === "de";
  const base = landingDemo[locale];
  let request: string, recipient: string, label: string, objective: string, questions: string[], facts: string[], limits: string[], replies: string[], findings: string[], nextStep: string;
  if (id === "documents") {
    return { id, label: de ? "Gemeinde" : "Documents", recipient: de ? "Gemeindeverwaltung" : "Municipal office", request: base.request, plan: base.plan,
      turns: [...base.excerpt.map((turn, index): DemoTurn => ({ id: `demo-${index}`, role: index % 2 ? "recipient" : "assistant", text: turn.text, seconds: 12 + index * 9 })),
        { id: "demo-4", role: "assistant", text: de ? "Vielen Dank für Ihre Hilfe. Auf Wiederhören." : "Thank you for your help. Goodbye.", seconds: 50 }], summary: base.summary };
  }
  if (id === "repair") {
    label = de ? "Werkstatt" : "Bike repair"; recipient = de ? "Velowerkstatt Seeblick" : "Seeblick bicycle workshop";
    request = de ? "Fragen Sie die Velowerkstatt, ob sie die hydraulischen Bremsen meines Velos repariert. Muss ich einen Termin buchen, und was soll ich mitbringen? Nur Auskunft einholen, nichts buchen." : "Ask the bicycle workshop whether they repair hydraulic brakes. Do I need an appointment, and what should I bring? Just ask for information; don’t make a booking.";
    objective = de ? "Reparaturmöglichkeiten und Vorbereitung für Anna Kellers Velo klären." : "Find out whether Anna Keller’s bicycle can be repaired and how to prepare.";
    questions = de ? ["Reparieren Sie hydraulische Velobremsen?", "Brauche ich dafür einen Termin, und was soll ich mitbringen?"] : ["Do you repair hydraulic bicycle brakes?", "Is an appointment needed, and what should Anna bring?"];
    facts = de ? ["Name: Anna Keller", "Das Velo hat hydraulische Bremsen."] : ["Name: Anna Keller", "The bicycle has hydraulic brakes."];
    limits = de ? ["Nur Informationen einholen. Keinen Auftrag erteilen, nichts buchen oder bezahlen."] : ["Ask for information only. Do not order repairs, book an appointment or pay."];
    replies = de ? ["Ja, solche Bremsen reparieren wir.", "Bitte vereinbaren Sie zuerst einen Termin. Bringen Sie das Velo und den Schlüssel für das Veloschloss mit."] : ["Yes, we repair those brakes.", "Please arrange an appointment first. Bring the bicycle and the key for its lock."];
    findings = de ? ["Hydraulische Bremsen können repariert werden.", "Termin nötig; Velo und Schlüssel mitbringen."] : ["The workshop repairs hydraulic brakes.", "Appointment required; bring the bicycle and lock key."];
    nextStep = de ? "Anna kann einen Termin mit der Werkstatt vereinbaren. In diesem Anruf wurde nichts gebucht." : "Anna can arrange an appointment with the workshop. Nothing was booked during this call.";
  } else {
    label = de ? "Termin" : "Appointment"; recipient = de ? "Optik Seeblick" : "Seeblick optician";
    request = de ? "Vereinbaren Sie für Anna Keller einen Sehtest am 22. September 2026 zwischen 14 und 16 Uhr in Zürich. Buchen Sie den ersten passenden angebotenen Termin. Keine Zahlungen oder neuen Gebühren akzeptieren." : "Book one eye test for Anna Keller on 22 September 2026 between 14:00 and 16:00 in Zurich. Choose the first offered time within that window. Don’t accept payments or new fees.";
    objective = de ? "Einen Sehtest im freigegebenen Zeitfenster vereinbaren." : "Book one eye test within the approved time window.";
    questions = de ? ["Haben Sie am 22. September 2026 zwischen 14 und 16 Uhr einen Termin für einen Sehtest?", "Können Sie den Termin für Anna Keller bestätigen?"] : ["Do you have an eye-test appointment on 22 September 2026 between 14:00 and 16:00?", "Can you confirm the appointment for Anna Keller?"];
    facts = de ? ["Name: Anna Keller", "22. September 2026, 14:00–16:00, Europe/Zurich."] : ["Name: Anna Keller", "22 September 2026, 14:00–16:00, Europe/Zurich."];
    limits = de ? ["Genau einen Termin buchen. Keine Zahlungen, Anzahlungen oder neuen Stornobedingungen akzeptieren."] : ["Book exactly one appointment. Do not accept payments, deposits or new cancellation terms."];
    replies = de ? ["Wir haben einen Termin um 14:30 Uhr frei.", "Ja, Anna Keller ist am 22. September 2026 um 14:30 Uhr für den Sehtest eingetragen."] : ["We have an appointment available at 14:30.", "Yes, Anna Keller is booked for an eye test on 22 September 2026 at 14:30."];
    findings = de ? ["Sehtest von der angerufenen Person bestätigt.", "22. September 2026, 14:30, Europe/Zurich."] : ["The recipient confirmed the eye-test appointment.", "22 September 2026, 14:30, Europe/Zurich."];
    nextStep = de ? "Den bestätigten Termin vormerken. SHPROHLI hat keinen Kalendereintrag erstellt." : "Make a note of the confirmed appointment. SHPROHLI has not created a calendar entry.";
  }
  const plan: CallPlanPresentationData = { ...base.plan, localizedObjective: objective, successCriteria: [objective],
    opening: { recipientAddress: de ? "Guten Tag." : "Hello.", purposeStatement: de ? "Ich rufe im Auftrag von Anna Keller an." : "I’m calling on behalf of Anna Keller.", readinessQuestion: de ? "Haben Sie kurz Zeit für ihr Anliegen?" : "Do you have a moment for her request?" },
    orderedQuestions: questions.map(text => ({ text, purpose: objective, required: true })), approvedFacts: facts.map(text => ({ sourceText: text, callLanguageText: text })), prohibitedActions: limits,
    ...(id === "appointment" ? { appointmentAuthorization: { operation: "book", serviceDescription: de ? "Sehtest" : "Eye test", providerScope: "called_recipient", timeZone: "Europe/Zurich", windows: [{ date: "2026-09-22", startTime: "14:00", endTime: "16:00" }], selection: "first_matching", maxAppointments: 1, financialPolicy: "no_new_financial_terms" } } : {}) };
  const secondQuestion = id === "appointment" ? (de ? "Bitte buchen Sie diesen Termin am 22. September 2026 um 14:30 Uhr für Anna Keller. Können Sie die Buchung bestätigen?" : "Please book that appointment on 22 September 2026 at 14:30 for Anna Keller. Can you confirm the booking?") : questions[1]!;
  return { id, label, recipient, request, plan, turns: [questions[0]!, replies[0]!, secondQuestion, replies[1]!, de ? "Vielen Dank. Auf Wiederhören." : "Thank you. Goodbye."].map((text, i) => ({ id: `demo-${i}`, role: i % 2 ? "recipient" : "assistant", text, seconds: 12 + i * 10 })),
    summary: { schemaVersion: 2, overview: findings.map((text, i) => ({ label: i === 0 ? (de ? "Antwort" : "Answer") : (de ? "Details" : "Details"), text, findingIds: [`finding-${i}`] })),
      findings: findings.map((text, i) => ({ id: `finding-${i}`, label: questions[i]!, text, certainty: "reported", sourceSegmentIds: [i === 0 && id !== "appointment" ? "demo-1" : "demo-3"] })),
      nextSteps: [{ text: nextStep, sourceSegmentIds: ["demo-3"] }], unresolved: id === "repair" ? [de ? "Preis und Reparaturdauer wurden nicht geklärt." : "The price and repair time were not established."] : [] } };
}

// Every enabled interface locale must provide all three complete fixtures.
// Adding a locale cannot silently select English scenario copy.
const scenarios: Record<UiLocale, Record<DemoScenarioId, DemoScenario>> = {
  en: { documents: buildDemoScenario("en", "documents"), repair: buildDemoScenario("en", "repair"), appointment: buildDemoScenario("en", "appointment") },
  de: { documents: buildDemoScenario("de", "documents"), repair: buildDemoScenario("de", "repair"), appointment: buildDemoScenario("de", "appointment") }
};
export function getDemoScenario(locale: UiLocale, id: DemoScenarioId): DemoScenario { return scenarios[locale][id]; }

export function buildDemoPdf(locale: UiLocale, scenario: DemoScenario, logoSvg?: string) {
  const copy = demoMessages[locale];
  return buildTranscriptPdfLayout({ logoSvg, title: copy.pdfTitle, description: copy.pdfNote, variant: copy.pdfVariant,
    recipient: scenario.recipient, language: locale, metadata: [{ label: copy.recipient, value: scenario.recipient }, { label: copy.taskLabel, value: scenario.plan.localizedObjective }],
    turns: scenario.turns.map(turn => ({ ...turn, speaker: turn.role === "assistant" ? copy.assistant : scenario.recipient, offset: `00:${String(turn.seconds).padStart(2, "0")}` })),
    text: "", notes: [copy.pdfNote, copy.consentGranted] });
}
