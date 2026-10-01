import { formatDateTime, formatNumber, type UiLocale } from "@callassist/contracts";
import type { EmailBranding } from "../auth/email-branding";
import { renderEmail } from "../auth/email-templates";

export type PlanReviewReport = {
  caseId: string; callId: string; userId: string | null; revision: number; occurredAt: string;
  decision: "blocked" | "needs_clarification"; category: "policy_signal" | "clarification" | "unsupported_task" | "technical_failure";
  reasons: string[]; locale: string; compilerVersion: string; policyVersion: string; model: string; repeats: number;
};
const values: Record<UiLocale, readonly string[]> = {
  en: ["Call plan returned for changes", "Decision", "Category", "Reasons", "Plan revision", "Time", "Call language", "Other returned revisions", "Open plan review", "A policy signal requires review; it does not establish abuse. Sensitive evidence is available to a superadmin in the console.", "Blocked", "Clarification required", "Policy signal", "Clarification", "Unsupported task", "Technical preparation failure"],
  de: ["Anrufplan zur Überarbeitung zurückgegeben", "Entscheidung", "Kategorie", "Gründe", "Planversion", "Zeit", "Anrufsprache", "Weitere zurückgegebene Versionen", "Planprüfung öffnen", "Ein Richtliniensignal muss geprüft werden und belegt keinen Missbrauch. Vertrauliche Belege sind für Superadmins in der Konsole verfügbar.", "Blockiert", "Klärung erforderlich", "Richtliniensignal", "Klärung", "Nicht unterstützte Aufgabe", "Technischer Vorbereitungsfehler"],
  fr: ["Plan d’appel renvoyé pour modification", "Décision", "Catégorie", "Motifs", "Version du plan", "Date", "Langue de l’appel", "Autres versions renvoyées", "Ouvrir l’examen du plan", "Un signal de politique nécessite un examen et ne prouve pas un abus. Les éléments confidentiels sont accessibles aux superadministrateurs dans la console.", "Bloqué", "Précisions nécessaires", "Signal de politique", "Précisions", "Tâche non prise en charge", "Échec technique de préparation"],
  it: ["Piano di chiamata restituito per modifiche", "Decisione", "Categoria", "Motivi", "Versione del piano", "Data", "Lingua della chiamata", "Altre versioni restituite", "Apri la revisione del piano", "Un segnale relativo alle regole richiede una verifica e non dimostra un abuso. Le informazioni riservate sono disponibili ai superamministratori nella console.", "Bloccato", "Chiarimenti necessari", "Segnale relativo alle regole", "Chiarimenti", "Attività non supportata", "Errore tecnico di preparazione"],
  rm: ["Plan da telefonat returnà per midadas", "Decisiun", "Categoria", "Motivs", "Versiun dal plan", "Data", "Lingua dal telefonat", "Autras versiuns returnadas", "Avrir la controlla dal plan", "In signal davart las reglas sto vegnir examinà e na cumprova betg in abus. Las infurmaziuns confidenzialas èn accessiblas als superadministraturs en la consola.", "Blocca", "Scleriment necessari", "Signal davart las reglas", "Scleriment", "Incumbensa betg sustegnida", "Errur tecnica da preparaziun"],
  ru: ["План звонка возвращён на доработку", "Решение", "Категория", "Причины", "Версия плана", "Время", "Язык звонка", "Другие возвращённые версии", "Открыть проверку плана", "Сигнал политики требует проверки и не доказывает злоупотребление. Чувствительные данные доступны суперадминистратору в админке.", "Заблокирован", "Требуется уточнение", "Сигнал политики", "Уточнение", "Неподдерживаемая задача", "Технический сбой подготовки"],
  uk: ["План дзвінка повернено на доопрацювання", "Рішення", "Категорія", "Причини", "Версія плану", "Час", "Мова дзвінка", "Інші повернуті версії", "Відкрити перевірку плану", "Сигнал політики потребує перевірки й не доводить зловживання. Чутливі дані доступні суперадміністратору в адмінці.", "Заблоковано", "Потрібне уточнення", "Сигнал політики", "Уточнення", "Непідтримуване завдання", "Технічний збій підготовки"]
};
export function planReviewNotificationEmail(report: PlanReviewReport, branding: EmailBranding, locale: UiLocale) {
  const c = values[locale];
  const category = ["policy_signal", "clarification", "unsupported_task", "technical_failure"].indexOf(report.category);
  const url = new URL(`/admin/safety/plan-reviews/${encodeURIComponent(report.caseId)}`, branding.siteUrl).href;
  const pair = (label: string | undefined, value: string) => `${label}: ${value}`;
  // Only server-validated decision metadata is emailed. Raw prompts and transcripts
  // remain behind the audited evidence endpoint; renderEmail escapes all text.
  const content = renderEmail(locale, c[0]!, [
    pair(c[1], c[report.decision === "blocked" ? 10 : 11]!), pair(c[2], c[12 + category]!), pair(c[3], report.reasons.join(", ")),
    pair(c[4], formatNumber(report.revision, locale)), pair(c[5], formatDateTime(report.occurredAt, locale, { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "long" })),
    pair(c[6], report.locale), pair(c[7], formatNumber(report.repeats, locale)),
    `Case ID: ${report.caseId}`, `Call ID: ${report.callId}`, `User ID: ${report.userId ?? "—"}`,
    `Compiler: ${report.compilerVersion}; model: ${report.model}; policy: ${report.policyVersion}`, c[9]!, pair(c[8], url)
  ], branding);
  const escapedUrl = escapeHtml(url);
  content.html = content.html.replace(escapedUrl, `<a href="${escapedUrl}" style="color:#35614b">${escapeHtml(c[8]!)}</a>`);
  return content;
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}
