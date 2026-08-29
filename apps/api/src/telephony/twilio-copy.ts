import type { CallBrief, CallLocale } from "@callassist/contracts";

type TwilioCopy = {
  language: "de-DE" | "en-GB" | "en-US" | "fr-FR" | "it-IT" | "ru-RU";
  introduction: (brief: CallBrief) => string;
  clarification: string;
  dtmfFallback: string;
  noConsent: string;
  recordingFailure: string;
};

const copy: Record<CallLocale, TwilioCopy> = {
  "de-CH": germanCopy(),
  "de-DE": germanCopy(),
  "fr-CH": {
    language: "fr-FR",
    introduction: (brief) =>
      `Bonjour, je suis ${brief.voiceGender === "female" ? "une assistante IA" : "un assistant IA"} et j’appelle au nom de ${brief.representedPerson}. Puis-je enregistrer et transcrire automatiquement la conversation à des fins de documentation ?`,
    clarification:
      "Pardon, puis-je enregistrer et transcrire automatiquement cette conversation ?",
    dtmfFallback:
      "Si vous êtes d’accord, vous pouvez aussi appuyer sur la touche 1.",
    noConsent:
      "Sans votre accord, je ne peux pas poursuivre cette conversation. Au revoir.",
    recordingFailure:
      "L’enregistrement n’a pas pu démarrer. Je ne peux donc pas poursuivre cette conversation. Au revoir."
  },
  "it-CH": {
    language: "it-IT",
    introduction: (brief) =>
      `Buongiorno, sono ${brief.voiceGender === "female" ? "un’assistente IA" : "un assistente IA"} e chiamo per conto di ${brief.representedPerson}. Posso registrare e trascrivere automaticamente la conversazione a fini di documentazione?`,
    clarification:
      "Mi scusi, posso registrare e trascrivere automaticamente questa conversazione?",
    dtmfFallback:
      "Se acconsente, può anche premere il tasto 1.",
    noConsent:
      "Senza il suo consenso non posso proseguire la conversazione. Arrivederci.",
    recordingFailure:
      "Non è stato possibile avviare la registrazione. Non posso quindi proseguire la conversazione. Arrivederci."
  },
  "en-GB": englishCopy("en-GB"),
  "en-US": englishCopy("en-US"),
  "ru-RU": {
    language: "ru-RU",
    introduction: (brief) =>
      `Добрый день, я ${brief.voiceGender === "female" ? "ИИ-ассистентка" : "ИИ-ассистент"} и звоню от имени ${brief.representedPerson}. Разрешите записать и автоматически расшифровать этот разговор для документирования?`,
    clarification:
      "Извините, разрешите записать и автоматически расшифровать этот разговор?",
    dtmfFallback: "Если вы согласны, можете также нажать 1.",
    noConsent:
      "Без вашего согласия я не могу продолжить разговор. До свидания.",
    recordingFailure:
      "Не удалось начать запись, поэтому я не могу продолжить разговор. До свидания."
  }
};

export function getTwilioCopy(locale: CallLocale) {
  return copy[locale];
}

function germanCopy(): TwilioCopy {
  return {
    language: "de-DE",
    introduction: (brief) =>
      `Guten Tag, ich bin ${brief.voiceGender === "female" ? "eine KI-Assistentin" : "ein KI-Assistent"} und rufe im Auftrag von ${brief.representedPerson} an. Darf ich das Gespräch zur Dokumentation aufzeichnen und automatisch transkribieren?`,
    clarification:
      "Entschuldigung, darf ich das Gespräch aufzeichnen und automatisch transkribieren?",
    dtmfFallback:
      "Wenn Sie einverstanden sind, können Sie auch die 1 drücken.",
    noConsent:
      "Ohne Ihre Zustimmung kann ich das Gespräch nicht fortsetzen. Auf Wiederhören.",
    recordingFailure:
      "Die Aufnahme konnte nicht gestartet werden. Daher kann ich das Gespräch nicht fortsetzen. Auf Wiederhören."
  };
}

function englishCopy(language: "en-GB" | "en-US"): TwilioCopy {
  return {
    language,
    introduction: (brief) =>
      `Hello, I’m an AI assistant calling on behalf of ${brief.representedPerson}. May I record and automatically transcribe this conversation for documentation?`,
    clarification:
      "Sorry, may I record and automatically transcribe this conversation?",
    dtmfFallback: "If you consent, you can also press 1.",
    noConsent: "I cannot continue without your consent. Goodbye.",
    recordingFailure:
      "The recording could not be started, so I cannot continue this conversation. Goodbye."
  };
}
