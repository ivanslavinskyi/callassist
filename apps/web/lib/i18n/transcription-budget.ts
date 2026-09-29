import type { UiLocale } from "./registry";

export const transcriptionBudgetMessages: Record<UiLocale, { title: string; help: string }> = {
  en: { title: "Transcription is waiting", help: "The service's processing budget is temporarily unavailable. We will retry automatically. The recording remains subject to your retention settings." },
  de: { title: "Transkription wartet", help: "Das Verarbeitungsbudget des Dienstes ist vorübergehend nicht verfügbar. Wir versuchen es automatisch erneut. Für die Aufnahme gelten weiterhin Ihre Aufbewahrungseinstellungen." },
  fr: { title: "Transcription en attente", help: "Le budget de traitement du service est temporairement indisponible. Nous réessaierons automatiquement. Vos paramètres de conservation restent applicables à l’enregistrement." },
  it: { title: "Trascrizione in attesa", help: "Il budget di elaborazione del servizio è temporaneamente non disponibile. Riproveremo automaticamente. Le impostazioni di conservazione continuano ad applicarsi alla registrazione." },
  rm: { title: "La transcripziun spetga", help: "Il budget d’elavuraziun dal servetsch n’è temporarmain betg disponibel. Nus empruvain automaticamain anc ina giada. Vossas configuraziuns da conservaziun valan vinavant per la registraziun." },
  ru: { title: "Расшифровка ожидает обработки", help: "Бюджет обработки сервиса временно недоступен. Мы повторим попытку автоматически. Для записи продолжают действовать выбранные сроки хранения." },
  uk: { title: "Розшифровка очікує на обробку", help: "Бюджет обробки сервісу тимчасово недоступний. Ми повторимо спробу автоматично. Для запису продовжують діяти вибрані строки зберігання." }
};

export function isTranscriptionBudgetBlocked(reason: string | null | undefined) {
  return reason === "BETA_BUDGET_EXHAUSTED" || reason === "BETA_BUDGET_UNCONFIGURED" || reason === "BETA_SPENDING_PAUSED";
}
