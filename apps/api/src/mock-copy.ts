import type { CallLocale } from "@callassist/contracts";

type MockCopy = {
  greeting: string;
  recipientReply: string;
  approvalTitle: string;
  approvalReason: string;
  proposedSpeech: string;
  declinedSpeech: string;
};

type MockCopyTemplate = Omit<MockCopy, "greeting"> & {
  greeting: (representedPerson: string) => string;
};

const copy: Record<CallLocale, MockCopyTemplate> = {
  "de-CH": {
    greeting: (representedPerson) =>
      `Guten Tag. Ich bin ein KI-Sprachassistent im Auftrag von ${representedPerson}. Ich rufe mit einer kurzen Frage zu den Unterlagen an.`,
    recipientReply:
      "Guten Tag. Wir können das prüfen. Haben Sie eine E-Mail-Adresse für die schriftliche Antwort?",
    approvalTitle: "E-Mail-Adresse freigeben?",
    approvalReason:
      "Die Gemeinde benötigt die E-Mail-Adresse, um schriftlich zu antworten.",
    proposedSpeech: "Sie können die Antwort an reply@example.com senden.",
    declinedSpeech:
      "Ich kann die E-Mail-Adresse gerade nicht freigeben. Bitte nennen Sie mir eine öffentliche Kontaktadresse."
  },
  "de-DE": {
    greeting: (representedPerson) =>
      `Guten Tag. Ich bin ein KI-Sprachassistent im Auftrag von ${representedPerson} und habe eine kurze Frage zu den Unterlagen.`,
    recipientReply:
      "Guten Tag. Haben Sie eine E-Mail-Adresse, an die wir schriftlich antworten können?",
    approvalTitle: "E-Mail-Adresse freigeben?",
    approvalReason: "Die Stelle bittet um eine Adresse für die schriftliche Antwort.",
    proposedSpeech: "Sie können die Antwort an reply@example.com senden.",
    declinedSpeech: "Ich kann die E-Mail-Adresse derzeit nicht freigeben."
  },
  "fr-CH": {
    greeting: (representedPerson) =>
      `Bonjour. Je suis un assistant vocal IA qui appelle au nom de ${representedPerson} au sujet de documents.`,
    recipientReply:
      "Bonjour. Pourriez-vous nous donner une adresse e-mail pour notre réponse écrite ?",
    approvalTitle: "Partager l’adresse e-mail ?",
    approvalReason: "La commune demande une adresse pour répondre par écrit.",
    proposedSpeech: "Vous pouvez envoyer la réponse à reply@example.com.",
    declinedSpeech: "Je ne peux pas partager l’adresse e-mail pour le moment."
  },
  "it-CH": {
    greeting: (representedPerson) =>
      `Buongiorno. Sono un assistente vocale IA e chiamo per conto di ${representedPerson} riguardo ad alcuni documenti.`,
    recipientReply:
      "Buongiorno. Può indicarci un indirizzo e-mail per la risposta scritta?",
    approvalTitle: "Condividere l’indirizzo e-mail?",
    approvalReason: "Il comune chiede un indirizzo per rispondere per iscritto.",
    proposedSpeech: "Potete inviare la risposta a reply@example.com.",
    declinedSpeech: "Al momento non posso condividere l’indirizzo e-mail."
  },
  "en-GB": {
    greeting: (representedPerson) =>
      `Good afternoon. I’m an AI voice assistant calling on behalf of ${representedPerson} with a short question about some documents.`,
    recipientReply: "Certainly. Do you have an email address for our written response?",
    approvalTitle: "Share the email address?",
    approvalReason: "The office needs an email address for its written response.",
    proposedSpeech: "You can send the response to reply@example.com.",
    declinedSpeech: "I’m not authorised to share the email address at the moment."
  },
  "en-US": {
    greeting: (representedPerson) =>
      `Hello. I’m an AI voice assistant calling on behalf of ${representedPerson} with a quick question about some documents.`,
    recipientReply: "Sure. Can you provide an email address for our written response?",
    approvalTitle: "Share the email address?",
    approvalReason: "The office needs an email address for its written response.",
    proposedSpeech: "You can send the response to reply@example.com.",
    declinedSpeech: "I’m not authorized to share the email address right now."
  },
  "ru-RU": {
    greeting: (representedPerson) =>
      `Добрый день. Я голосовой ИИ-ассистент, звонящий от имени ${representedPerson}. У меня есть короткий вопрос по поводу документов.`,
    recipientReply:
      "Добрый день. Сообщите, пожалуйста, адрес электронной почты для письменного ответа.",
    approvalTitle: "Сообщить адрес электронной почты?",
    approvalReason:
      "Организации нужен адрес электронной почты для письменного ответа.",
    proposedSpeech: "Ответ можно отправить на reply@example.com.",
    declinedSpeech:
      "Сейчас я не могу сообщить адрес электронной почты."
  }
};

export function getMockCopy(
  locale: CallLocale,
  representedPerson: string
): MockCopy {
  const template = copy[locale];
  return {
    ...template,
    greeting: template.greeting(representedPerson)
  };
}
