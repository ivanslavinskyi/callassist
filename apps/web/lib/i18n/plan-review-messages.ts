import type { UiLocale } from "./messages";

type PlanReviewCopy = {
  context: string; purpose: string; required: string; optional: string;
  followUps: string; condition: string; unresolved: string; stop: string; translated: string;
};

export const planReviewMessages: Record<UiLocale, PlanReviewCopy> = {
  en: { context: "Background and constraints", purpose: "Purpose", required: "Required", optional: "Optional",
    followUps: "Follow-up questions", condition: "When", unresolved: "When the task remains unresolved",
    stop: "When to end the conversation", translated: "This is a translation of the plan for your review. Call language:" },
  de: { context: "Hintergrund und Vorgaben", purpose: "Zweck", required: "Erforderlich", optional: "Optional",
    followUps: "Rückfragen", condition: "Wenn", unresolved: "Wann die Aufgabe ungeklärt bleibt",
    stop: "Wann das Gespräch beendet wird", translated: "Dies ist die Übersetzung des Plans zur Prüfung. Anrufsprache:" },
  fr: { context: "Contexte et contraintes", purpose: "Objectif", required: "Obligatoire", optional: "Facultatif",
    followUps: "Questions complémentaires", condition: "Si", unresolved: "Quand la demande reste sans réponse",
    stop: "Quand mettre fin à la conversation", translated: "Voici la traduction du plan pour vérification. Langue de l’appel :" },
  it: { context: "Contesto e vincoli", purpose: "Scopo", required: "Obbligatoria", optional: "Facoltativa",
    followUps: "Domande di approfondimento", condition: "Se", unresolved: "Quando la richiesta rimane irrisolta",
    stop: "Quando terminare la conversazione", translated: "Questa è la traduzione del piano da verificare. Lingua della chiamata:" },
  rm: { context: "Context e cundiziuns", purpose: "Intent", required: "Obligatoric", optional: "Facultativ",
    followUps: "Dumondas supplementaras", condition: "Sche", unresolved: "Cura che l’incumbensa resta nunsclerida",
    stop: "Cura terminar il discurs", translated: "Quai è la translaziun dal plan per controllar. Lingua dal clom:" },
  ru: { context: "Контекст и ограничения", purpose: "Для чего", required: "Обязательно", optional: "По возможности",
    followUps: "Уточняющие вопросы", condition: "Если", unresolved: "Когда задача останется нерешённой",
    stop: "Когда завершить разговор", translated: "Это перевод плана для вашей проверки. Язык звонка:" },
  uk: { context: "Контекст і обмеження", purpose: "Мета", required: "Обов’язково", optional: "За можливості",
    followUps: "Уточнювальні запитання", condition: "Якщо", unresolved: "Коли завдання залишиться невирішеним",
    stop: "Коли завершити розмову", translated: "Це переклад плану для вашої перевірки. Мова дзвінка:" }
};
