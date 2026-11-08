import type { CallAssessmentSummary, CallSummaryPayload, UiLocale } from "@callassist/contracts";
import { summaryCoverageMessages } from "@callassist/contracts";

const labels: Record<UiLocale, readonly string[]> = {
  en: ["AI task assessment", "Achieved", "Partially achieved", "Not achieved", "Uncertain", "Assessment in progress", "Assessment unavailable"],
  de: ["KI-Bewertung der Aufgabenerfüllung", "Erfüllt", "Teilweise erfüllt", "Nicht erfüllt", "Unklar", "Bewertung läuft", "Bewertung nicht verfügbar"],
  fr: ["Évaluation de la tâche par l’IA", "Atteinte", "Partiellement atteinte", "Non atteinte", "Incertaine", "Évaluation en cours", "Évaluation indisponible"],
  it: ["Valutazione IA del compito", "Raggiunto", "Parzialmente raggiunto", "Non raggiunto", "Incerto", "Valutazione in corso", "Valutazione non disponibile"],
  rm: ["Valitaziun da l’incumbensa cun IA", "Ademplì", "Ademplì parzialmain", "Betg ademplì", "Intschert", "Valitaziun en curs", "Valitaziun betg disponibla"],
  ru: ["Оценка выполнения задания ИИ", "Выполнено", "Частично выполнено", "Не выполнено", "Не удалось определить", "Оценка готовится", "Оценка недоступна"],
  uk: ["Оцінка виконання завдання ШІ", "Виконано", "Частково виконано", "Не виконано", "Не вдалося визначити", "Оцінка готується", "Оцінка недоступна"]
};

/** Only a summary already validated against the exported revision may be passed here. */
export function transcriptAssessment(input: {
  locale: UiLocale; summary?: CallSummaryPayload | null; assessment?: CallAssessmentSummary | null;
  revisionId?: string; pending?: boolean;
}) {
  const copy = labels[input.locale];
  const saved = input.assessment?.transcriptRevisionId === input.revisionId ? input.assessment : null;
  const decision = input.summary?.assessment;
  const goal = decision && "goal" in decision ? decision.goal.status : saved?.status === "ready" ? saved.goal : null;
  const index = goal ? ({ achieved: 1, partial: 2, not_achieved: 3, uncertain: 4 } as const)[goal]
    : input.pending || saved?.status === "pending" ? 5 : 6;
  return { title: copy[0]!, status: copy[index]!,
    summary: input.summary?.overview?.[0]?.text ? excerpt(input.summary.overview[0].text) : undefined,
    note: input.summary?.evaluationCoverage?.status === "partial" ? summaryCoverageMessages[input.locale] : undefined };
}
function excerpt(text:string) { const chars=Array.from(text); return chars.length<=500?text:chars.slice(0,480).join("").replace(/\s+\S*$/,"")+"…"; }
