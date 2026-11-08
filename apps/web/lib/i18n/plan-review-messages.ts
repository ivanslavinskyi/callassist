import type { UiLocale } from "./messages";

type PlanReviewCopy = {
  openingExample: string;
  afterReadiness: string; appendix: string;
  context: string; purpose: string; required: string; optional: string;
  followUps: string; condition: string; unresolved: string; stop: string; translated: string;
};

export const planReviewMessages: Record<UiLocale, PlanReviewCopy> = {
  en: { afterReadiness: "After the recipient agrees to speak:", appendix: "Additional reference material", openingExample: "Suggested opening", context: "Background and constraints", purpose: "Purpose", required: "Required", optional: "Optional",
    followUps: "Follow-up questions", condition: "When", unresolved: "When the task remains unresolved",
    stop: "When to end the conversation", translated: "This is a translation of the plan for your review. Call language:" },
  de: { afterReadiness: "Nachdem die angerufene Person dem Gespräch zugestimmt hat:", appendix: "Zusätzliche Informationen", openingExample: "Vorschlag für den Gesprächseinstieg", context: "Hintergrund und Vorgaben", purpose: "Zweck", required: "Erforderlich", optional: "Optional",
    followUps: "Rückfragen", condition: "Wenn", unresolved: "Wann die Aufgabe ungeklärt bleibt",
    stop: "Wann das Gespräch beendet wird", translated: "Dies ist die Übersetzung des Plans zur Prüfung. Anrufsprache:" },
  fr: { afterReadiness: "Après que la personne a accepté de parler :", appendix: "Informations complémentaires", openingExample: "Proposition d’introduction", context: "Contexte et contraintes", purpose: "Objectif", required: "Obligatoire", optional: "Facultatif",
    followUps: "Questions complémentaires", condition: "Si", unresolved: "Quand la demande reste sans réponse",
    stop: "Quand mettre fin à la conversation", translated: "Voici la traduction du plan pour vérification. Langue de l’appel :" },
  it: { afterReadiness: "Dopo che la persona ha accettato di parlare:", appendix: "Informazioni aggiuntive", openingExample: "Introduzione suggerita", context: "Contesto e vincoli", purpose: "Scopo", required: "Obbligatoria", optional: "Facoltativa",
    followUps: "Domande di approfondimento", condition: "Se", unresolved: "Quando la richiesta rimane irrisolta",
    stop: "Quando terminare la conversazione", translated: "Questa è la traduzione del piano da verificare. Lingua della chiamata:" },
  rm: { afterReadiness: "Suenter che la persuna ha acceptà da discurrer:", appendix: "Infurmaziuns supplementaras", openingExample: "Proposta per il cumenzament", context: "Context e cundiziuns", purpose: "Intent", required: "Obligatoric", optional: "Facultativ",
    followUps: "Dumondas supplementaras", condition: "Sche", unresolved: "Cura che l’incumbensa resta nunsclerida",
    stop: "Cura terminar il discurs", translated: "Quai è la translaziun dal plan per controllar. Lingua dal clom:" },
  ru: { afterReadiness: "После ответа, что сейчас удобно говорить:", appendix: "Дополнительные справочные сведения", openingExample: "Пример вступления", context: "Контекст и ограничения", purpose: "Для чего", required: "Обязательно", optional: "По возможности",
    followUps: "Уточняющие вопросы", condition: "Если", unresolved: "Когда задача останется нерешённой",
    stop: "Когда завершить разговор", translated: "Это перевод плана для вашей проверки. Язык звонка:" },
  uk: { afterReadiness: "Після відповіді, що зараз зручно говорити:", appendix: "Додаткові довідкові відомості", openingExample: "Приклад вступу", context: "Контекст і обмеження", purpose: "Мета", required: "Обов’язково", optional: "За можливості",
    followUps: "Уточнювальні запитання", condition: "Якщо", unresolved: "Коли завдання залишиться невирішеним",
    stop: "Коли завершити розмову", translated: "Це переклад плану для вашої перевірки. Мова дзвінка:" }
};
