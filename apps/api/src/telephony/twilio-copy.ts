import type { CallBrief, CallLocale } from "@callassist/contracts";

type TwilioCopy = {
  language: "de-DE" | "en-GB" | "en-US" | "fr-FR" | "it-IT" | "ru-RU";
  introduction: (brief: CallBrief) => string;
  noConsent: string;
  recordingFailure: string;
};

const copy: Record<CallLocale, TwilioCopy> = {
  "de-CH": {
    language: "de-DE",
    introduction: (brief) =>
      `Guten Tag. Mein Name ist ${brief.agentName}. Ich bin ${brief.voiceGender === "female" ? "eine KI-Assistentin" : "ein KI-Assistent"} von ${brief.representedPerson}. ${brief.assistanceDisclosure} Nach Ihrer Zustimmung wird dieses Gespräch aufgezeichnet und automatisch transkribiert. ${retentionSentence(brief, "de")} Wenn Sie einverstanden sind, drücken Sie bitte die 1.`,
    noConsent:
      "Ohne Ihre Zustimmung kann ich das Gespräch nicht fortsetzen. Auf Wiederhören.",
    recordingFailure:
      "Die Aufnahme konnte nicht gestartet werden. Daher kann ich das Gespräch nicht fortsetzen. Auf Wiederhören."
  },
  "de-DE": {
    language: "de-DE",
    introduction: (brief) =>
      `Guten Tag. Mein Name ist ${brief.agentName}. Ich bin ${brief.voiceGender === "female" ? "eine KI-Assistentin" : "ein KI-Assistent"} von ${brief.representedPerson}. ${brief.assistanceDisclosure} Nach Ihrer Zustimmung wird dieses Gespräch aufgezeichnet und automatisch transkribiert. ${retentionSentence(brief, "de")} Wenn Sie einverstanden sind, drücken Sie bitte die 1.`,
    noConsent:
      "Ohne Ihre Zustimmung kann ich das Gespräch nicht fortsetzen. Auf Wiederhören.",
    recordingFailure:
      "Die Aufnahme konnte nicht gestartet werden. Daher kann ich das Gespräch nicht fortsetzen. Auf Wiederhören."
  },
  "fr-CH": {
    language: "fr-FR",
    introduction: (brief) =>
      `Bonjour. Je m’appelle ${brief.agentName}. Je suis ${brief.voiceGender === "female" ? "une assistante IA" : "un assistant IA"} de ${brief.representedPerson}. ${brief.assistanceDisclosure} Après votre consentement, cette conversation sera enregistrée et transcrite automatiquement. ${retentionSentence(brief, "fr")} Si vous êtes d’accord, appuyez sur la touche 1.`,
    noConsent:
      "Sans votre accord, je ne peux pas poursuivre cette conversation. Au revoir.",
    recordingFailure:
      "L’enregistrement n’a pas pu démarrer. Je ne peux donc pas poursuivre cette conversation. Au revoir."
  },
  "it-CH": {
    language: "it-IT",
    introduction: (brief) =>
      `Buongiorno. Mi chiamo ${brief.agentName}. Sono ${brief.voiceGender === "female" ? "un’assistente IA" : "un assistente IA"} di ${brief.representedPerson}. ${brief.assistanceDisclosure} Dopo il suo consenso, questa conversazione verrà registrata e trascritta automaticamente. ${retentionSentence(brief, "it")} Se acconsente, prema il tasto 1.`,
    noConsent:
      "Senza il suo consenso non posso proseguire la conversazione. Arrivederci.",
    recordingFailure:
      "Non è stato possibile avviare la registrazione. Non posso quindi proseguire la conversazione. Arrivederci."
  },
  "en-GB": {
    language: "en-GB",
    introduction: (brief) =>
      `Hello. My name is ${brief.agentName}. I am an AI assistant for ${brief.representedPerson}. ${brief.assistanceDisclosure} After you consent, this conversation will be recorded and transcribed automatically. ${retentionSentence(brief, "en")} If you consent, please press 1.`,
    noConsent: "I cannot continue without your consent. Goodbye.",
    recordingFailure:
      "The recording could not be started, so I cannot continue this conversation. Goodbye."
  },
  "en-US": {
    language: "en-US",
    introduction: (brief) =>
      `Hello. My name is ${brief.agentName}. I am an AI assistant for ${brief.representedPerson}. ${brief.assistanceDisclosure} After you consent, this conversation will be recorded and transcribed automatically. ${retentionSentence(brief, "en")} If you consent, please press 1.`,
    noConsent: "I cannot continue without your consent. Goodbye.",
    recordingFailure:
      "The recording could not be started, so I cannot continue this conversation. Goodbye."
  },
  "ru-RU": {
    language: "ru-RU",
    introduction: (brief) =>
      `Добрый день. Меня зовут ${brief.agentName}. Я ${brief.voiceGender === "female" ? "ИИ-ассистентка" : "ИИ-ассистент"} ${brief.representedPerson}. ${brief.assistanceDisclosure} После вашего согласия этот разговор будет записан и автоматически расшифрован. ${retentionSentence(brief, "ru")} Если вы согласны, нажмите 1.`,
    noConsent:
      "Без вашего согласия я не могу продолжить разговор. До свидания.",
    recordingFailure:
      "Не удалось начать запись, поэтому я не могу продолжить разговор. До свидания."
  }
};

export function getTwilioCopy(locale: CallLocale) {
  return copy[locale];
}

function retentionSentence(
  brief: CallBrief,
  language: "de" | "fr" | "it" | "en" | "ru"
) {
  const days = brief.audioRetentionDays;
  if (language === "de") {
    return days === 0
      ? "Die Audioaufnahme wird gelöscht, sobald die endgültige Transkription erstellt wurde."
      : `Die Audioaufnahme wird nach ${days} Tagen automatisch gelöscht.`;
  }
  if (language === "fr") {
    return days === 0
      ? "L’enregistrement audio sera supprimé dès que la transcription finale aura été créée."
      : `L’enregistrement audio sera supprimé automatiquement après ${days} jours.`;
  }
  if (language === "it") {
    return days === 0
      ? "La registrazione audio verrà eliminata non appena sarà stata creata la trascrizione finale."
      : `La registrazione audio verrà eliminata automaticamente dopo ${days} giorni.`;
  }
  if (language === "ru") {
    return days === 0
      ? "Аудиозапись будет удалена сразу после создания итоговой расшифровки."
      : `Аудиозапись будет автоматически удалена через ${days} дней.`;
  }
  return days === 0
    ? "The audio recording will be deleted as soon as the final transcript has been created."
    : `The audio recording will be deleted automatically after ${days} days.`;
}
