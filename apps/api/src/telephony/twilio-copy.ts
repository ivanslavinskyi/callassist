import {
  DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES,
  type CallBrief,
  type CallLocale
} from "@callassist/contracts";

type TwilioCopy = {
  language: "de-DE" | "en-GB" | "en-US" | "fr-FR" | "it-IT" | "ru-RU";
  introduction: (brief: CallBrief) => string;
  noConsent: string;
};

const copy: Record<CallLocale, TwilioCopy> = {
  "de-CH": {
    language: "de-DE",
    introduction: (brief) =>
      `Guten Tag. Mein Name ist ${brief.agentName}. Ich bin ein KI-Assistent von ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} Dieses Gespräch wird live transkribiert, aber nicht als Audio aufgezeichnet. Wenn Sie damit einverstanden sind, drücken Sie bitte die 1.`,
    noConsent: "Ohne Ihre Zustimmung kann ich das Gespräch nicht fortsetzen. Auf Wiederhören."
  },
  "de-DE": {
    language: "de-DE",
    introduction: (brief) =>
      `Guten Tag. Mein Name ist ${brief.agentName}. Ich bin ein KI-Assistent von ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} Dieses Gespräch wird live transkribiert, aber nicht als Audio aufgezeichnet. Wenn Sie damit einverstanden sind, drücken Sie bitte die 1.`,
    noConsent: "Ohne Ihre Zustimmung kann ich das Gespräch nicht fortsetzen. Auf Wiederhören."
  },
  "fr-CH": {
    language: "fr-FR",
    introduction: (brief) =>
      `Bonjour. Je m’appelle ${brief.agentName}. Je suis un assistant IA de ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} Cette conversation sera transcrite en direct, mais l’audio ne sera pas enregistré. Si vous êtes d’accord, appuyez sur la touche 1.`,
    noConsent: "Sans votre accord, je ne peux pas poursuivre cette conversation. Au revoir."
  },
  "it-CH": {
    language: "it-IT",
    introduction: (brief) =>
      `Buongiorno. Mi chiamo ${brief.agentName}. Sono un assistente IA di ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} Questa conversazione verrà trascritta in diretta, ma l’audio non verrà registrato. Se acconsente, prema il tasto 1.`,
    noConsent: "Senza il suo consenso non posso proseguire la conversazione. Arrivederci."
  },
  "en-GB": {
    language: "en-GB",
    introduction: (brief) =>
      `Hello. My name is ${brief.agentName}. I am an AI assistant for ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} This conversation will be transcribed live, but the audio will not be recorded. If you consent, please press 1.`,
    noConsent: "I cannot continue without your consent. Goodbye."
  },
  "en-US": {
    language: "en-US",
    introduction: (brief) =>
      `Hello. My name is ${brief.agentName}. I am an AI assistant for ${brief.representedPerson}. ${brief.speechImpairmentDisclosure} This conversation will be transcribed live, but the audio will not be recorded. If you consent, please press 1.`,
    noConsent: "I cannot continue without your consent. Goodbye."
  },
  "ru-RU": {
    language: "ru-RU",
    introduction: (brief) =>
      `Добрый день. Меня зовут ${brief.agentName}. Я ИИ-ассистент ${brief.representedPerson}. ${resolveDisclosure(brief)} Этот разговор будет транскрибироваться в реальном времени, но аудиозапись не ведётся. Если вы согласны, нажмите 1.`,
    noConsent: "Без вашего согласия я не могу продолжить разговор. До свидания."
  }
};

export function getTwilioCopy(locale: CallLocale) {
  return copy[locale];
}

function resolveDisclosure(brief: CallBrief) {
  const disclosure = brief.speechImpairmentDisclosure;
  return Object.values(DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES).includes(
    disclosure
  )
    ? DEFAULT_SPEECH_IMPAIRMENT_DISCLOSURES[brief.locale]
    : disclosure;
}
