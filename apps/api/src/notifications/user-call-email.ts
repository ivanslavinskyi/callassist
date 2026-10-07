import { formatDateTime, type FinalTranscriptRevision, type GoalAssessmentStatus, type UiLocale } from "@callassist/contracts";
import { renderEmail, type EmailBlock } from "../auth/email-templates";
import type { EmailBranding } from "../auth/email-branding";

type Copy = { subject: string; recipient: string; date: string; assessment: string; unavailable: string; open: string;
  transcript: string; partial: string; assistant: string; other: string; system: string; unknown: string;
  goals: Record<GoalAssessmentStatus, string> };
export const userCallEmailMessages: Record<UiLocale, Copy> = {
  en: { subject: "Your call result", recipient: "Recipient", date: "Call date", assessment: "AI assessment", unavailable: "AI assessment unavailable", open: "Open call result", transcript: "Original transcript", partial: "The saved transcript is incomplete.", assistant: "Assistant", other: "Recipient", system: "System", unknown: "Unassigned speaker", goals: { achieved: "Goal achieved", partial: "Goal partially achieved", not_achieved: "Goal not achieved", uncertain: "Insufficient information" } },
  de: { subject: "Ihr Anrufergebnis", recipient: "Angerufene Person", date: "Anrufdatum", assessment: "KI-Einschätzung", unavailable: "KI-Einschätzung nicht verfügbar", open: "Anrufergebnis öffnen", transcript: "Originaltranskript", partial: "Das gespeicherte Transkript ist unvollständig.", assistant: "Assistent", other: "Angerufene Person", system: "System", unknown: "Nicht zugeordnete Stimme", goals: { achieved: "Ziel erreicht", partial: "Ziel teilweise erreicht", not_achieved: "Ziel nicht erreicht", uncertain: "Nicht genügend Informationen" } },
  fr: { subject: "Le résultat de votre appel", recipient: "Destinataire", date: "Date de l’appel", assessment: "Évaluation de l’IA", unavailable: "Évaluation de l’IA indisponible", open: "Voir le résultat de l’appel", transcript: "Transcription originale", partial: "La transcription enregistrée est incomplète.", assistant: "Assistant", other: "Destinataire", system: "Système", unknown: "Voix non identifiée", goals: { achieved: "Objectif atteint", partial: "Objectif partiellement atteint", not_achieved: "Objectif non atteint", uncertain: "Informations insuffisantes" } },
  it: { subject: "Il risultato della sua chiamata", recipient: "Destinatario", date: "Data della chiamata", assessment: "Valutazione dell’IA", unavailable: "Valutazione dell’IA non disponibile", open: "Apri il risultato della chiamata", transcript: "Trascrizione originale", partial: "La trascrizione salvata è incompleta.", assistant: "Assistente", other: "Destinatario", system: "Sistema", unknown: "Voce non identificata", goals: { achieved: "Obiettivo raggiunto", partial: "Obiettivo parzialmente raggiunto", not_achieved: "Obiettivo non raggiunto", uncertain: "Informazioni insufficienti" } },
  rm: { subject: "Il resultat da tes clom", recipient: "Persuna clamada", date: "Data dal clom", assessment: "Valitaziun da l’IA", unavailable: "Valitaziun da l’IA betg disponibla", open: "Avrir il resultat dal clom", transcript: "Transcripziun originala", partial: "La transcripziun memorisada è incumpletta.", assistant: "Assistent", other: "Persuna clamada", system: "Sistem", unknown: "Vusch betg attribuida", goals: { achieved: "Finamira cuntanschida", partial: "Finamira cuntanschida per part", not_achieved: "Finamira betg cuntanschida", uncertain: "Infurmaziuns insuffizientas" } },
  ru: { subject: "Результат вашего звонка", recipient: "Получатель звонка", date: "Дата звонка", assessment: "Оценка ИИ", unavailable: "Оценка ИИ недоступна", open: "Открыть результат звонка", transcript: "Оригинальный транскрипт", partial: "Сохраненный транскрипт неполный.", assistant: "Ассистент", other: "Собеседник", system: "Система", unknown: "Неопределенный участник", goals: { achieved: "Цель достигнута", partial: "Цель частично достигнута", not_achieved: "Цель не достигнута", uncertain: "Недостаточно данных" } },
  uk: { subject: "Результат вашого дзвінка", recipient: "Отримувач дзвінка", date: "Дата дзвінка", assessment: "Оцінка ШІ", unavailable: "Оцінка ШІ недоступна", open: "Відкрити результат дзвінка", transcript: "Оригінальна розшифровка", partial: "Збережена розшифровка неповна.", assistant: "Асистент", other: "Співрозмовник", system: "Система", unknown: "Невизначений учасник", goals: { achieved: "Мети досягнуто", partial: "Мети частково досягнуто", not_achieved: "Мети не досягнуто", uncertain: "Недостатньо даних" } }
};

export type UserCallReport = {
  callId: string; attemptId: string; locale: UiLocale; recipient: string; endedAt: string;
  callLanguage: string; assessmentLanguage?: string; goal: GoalAssessmentStatus | null;
  assessmentParagraphs: string[]; transcript: FinalTranscriptRevision; partial: boolean;
};

export function userCallEmail(report: UserCallReport, branding: EmailBranding) {
  const c = userCallEmailMessages[report.locale];
  const url = new URL(`/${report.locale}/app/calls/${encodeURIComponent(report.callId)}`, branding.siteUrl).href;
  const metadata = [`${c.recipient}: ${report.recipient}`, `${c.date}: ${formatDateTime(report.endedAt, report.locale)}`];
  const goal = report.goal ? c.goals[report.goal] : c.unavailable;
  const transcript = report.transcript.segments.length ? report.transcript.segments.map(segment => {
    const speaker = segment.role === "assistant" ? c.assistant : segment.role === "recipient" ? c.other : segment.role === "system" ? c.system : c.unknown;
    const seconds = segment.startSeconds === null ? null : Math.floor(segment.startSeconds);
    const offset = seconds === null ? "" : ` [${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}]`;
    return `${speaker}${offset}\n${segment.text}`;
  }) : [report.transcript.text];
  const paragraphs = [...metadata, `${c.assessment}: ${goal}`, ...report.assessmentParagraphs, `${c.open}: ${url}`,
    c.transcript, ...(report.partial ? [c.partial] : []), ...transcript];
  const blocks: EmailBlock[] = [
    ...metadata.map(text => ({ kind: "paragraph" as const, text })),
    { kind: "assessment", title: c.assessment, status: goal, paragraphs: report.assessmentParagraphs, lang: report.assessmentLanguage },
    { kind: "button", label: c.open, url }, { kind: "heading", text: c.transcript },
    ...(report.partial ? [{ kind: "paragraph" as const, text: c.partial }] : []),
    ...transcript.map(text => ({ kind: "paragraph" as const, text, lang: report.callLanguage }))
  ];
  // The only MIME asset is the existing inline logo. The full transcript is in both bodies.
  return renderEmail(report.locale, c.subject, paragraphs, branding, undefined, blocks);
}
