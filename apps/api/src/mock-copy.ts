import type { CallLocale } from "@callassist/contracts";

type MockCopy = {
  greeting: string;
  recipientReply: string;
  approvalTitle: string;
  approvalReason: string;
  proposedSpeech: string;
  declinedSpeech: string;
};

const copy: Record<CallLocale, MockCopy> = {
  "de-CH": {
    greeting:
      "Guten Tag. Ich bin ein KI-Sprachassistent im Auftrag von Ivan Slavinskyi. Ich rufe mit einer kurzen Frage zu den Unterlagen an.",
    recipientReply:
      "Guten Tag. Wir können das prüfen. Haben Sie eine E-Mail-Adresse für die schriftliche Antwort?",
    approvalTitle: "E-Mail-Adresse freigeben?",
    approvalReason:
      "Die Gemeinde benötigt die E-Mail-Adresse, um schriftlich zu antworten.",
    proposedSpeech: "Sie können die Antwort an ivan@example.com senden.",
    declinedSpeech:
      "Ich kann die E-Mail-Adresse gerade nicht freigeben. Bitte nennen Sie mir eine öffentliche Kontaktadresse."
  },
  "de-DE": {
    greeting:
      "Guten Tag. Ich bin ein KI-Sprachassistent im Auftrag von Ivan Slavinskyi und habe eine kurze Frage zu den Unterlagen.",
    recipientReply:
      "Guten Tag. Haben Sie eine E-Mail-Adresse, an die wir schriftlich antworten können?",
    approvalTitle: "E-Mail-Adresse freigeben?",
    approvalReason: "Die Stelle bittet um eine Adresse für die schriftliche Antwort.",
    proposedSpeech: "Sie können die Antwort an ivan@example.com senden.",
    declinedSpeech: "Ich kann die E-Mail-Adresse derzeit nicht freigeben."
  },
  "fr-CH": {
    greeting:
      "Bonjour. Je suis un assistant vocal IA qui appelle au nom d’Ivan Slavinskyi au sujet de documents.",
    recipientReply:
      "Bonjour. Pourriez-vous nous donner une adresse e-mail pour notre réponse écrite ?",
    approvalTitle: "Partager l’adresse e-mail ?",
    approvalReason: "La commune demande une adresse pour répondre par écrit.",
    proposedSpeech: "Vous pouvez envoyer la réponse à ivan@example.com.",
    declinedSpeech: "Je ne peux pas partager l’adresse e-mail pour le moment."
  },
  "it-CH": {
    greeting:
      "Buongiorno. Sono un assistente vocale IA e chiamo per conto di Ivan Slavinskyi riguardo ad alcuni documenti.",
    recipientReply:
      "Buongiorno. Può indicarci un indirizzo e-mail per la risposta scritta?",
    approvalTitle: "Condividere l’indirizzo e-mail?",
    approvalReason: "Il comune chiede un indirizzo per rispondere per iscritto.",
    proposedSpeech: "Potete inviare la risposta a ivan@example.com.",
    declinedSpeech: "Al momento non posso condividere l’indirizzo e-mail."
  },
  "en-GB": {
    greeting:
      "Good afternoon. I’m an AI voice assistant calling on behalf of Ivan Slavinskyi with a short question about some documents.",
    recipientReply: "Certainly. Do you have an email address for our written response?",
    approvalTitle: "Share the email address?",
    approvalReason: "The office needs an email address for its written response.",
    proposedSpeech: "You can send the response to ivan@example.com.",
    declinedSpeech: "I’m not authorised to share the email address at the moment."
  },
  "en-US": {
    greeting:
      "Hello. I’m an AI voice assistant calling on behalf of Ivan Slavinskyi with a quick question about some documents.",
    recipientReply: "Sure. Can you provide an email address for our written response?",
    approvalTitle: "Share the email address?",
    approvalReason: "The office needs an email address for its written response.",
    proposedSpeech: "You can send the response to ivan@example.com.",
    declinedSpeech: "I’m not authorized to share the email address right now."
  },
  "ru-RU": {
    greeting:
      "Добрый день. Я голосовой ИИ-ассистент Ивана Славинского. У меня есть короткий вопрос по поводу документов.",
    recipientReply:
      "Добрый день. Сообщите, пожалуйста, адрес электронной почты для письменного ответа.",
    approvalTitle: "Сообщить адрес электронной почты?",
    approvalReason:
      "Организации нужен адрес электронной почты для письменного ответа.",
    proposedSpeech: "Ответ можно отправить на ivan@example.com.",
    declinedSpeech:
      "Сейчас я не могу сообщить адрес электронной почты."
  }
};

export function getMockCopy(locale: CallLocale) {
  return copy[locale];
}
