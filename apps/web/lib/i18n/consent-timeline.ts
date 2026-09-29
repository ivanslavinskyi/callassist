import type { UiLocale } from "@callassist/contracts";

export const consentTimeline: Record<UiLocale, { system: string; granted: string; voice: string; dtmf: string }> = {
  en: { system: "Call event", granted: "Consent to recording and transcription received", voice: "Voice confirmation", dtmf: "Keypad confirmation" },
  de: { system: "Anrufereignis", granted: "Einwilligung zur Aufnahme und Transkription erhalten", voice: "Mündliche Bestätigung", dtmf: "Bestätigung per Telefontaste" },
  fr: { system: "Événement de l’appel", granted: "Consentement à l’enregistrement et à la transcription reçu", voice: "Confirmation vocale", dtmf: "Confirmation par touche" },
  it: { system: "Evento della chiamata", granted: "Consenso alla registrazione e trascrizione ricevuto", voice: "Conferma vocale", dtmf: "Conferma tramite tastiera" },
  ru: { system: "Событие звонка", granted: "Получено согласие на запись и транскрипцию", voice: "Голосовое подтверждение", dtmf: "Подтверждение клавишей" },
  uk: { system: "Подія дзвінка", granted: "Отримано згоду на запис і транскрипцію", voice: "Голосове підтвердження", dtmf: "Підтвердження клавішею" },
  rm: { system: "Eveniment dal telefonat", granted: "Consentiment per registrar e transcriver retschavì", voice: "Conferma a bucca", dtmf: "Conferma cun tasta" }
};
