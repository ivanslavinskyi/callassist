import type { CallLocale } from "@callassist/contracts";

type TwilioGreeting = {
  language: "de-DE" | "en-GB" | "en-US" | "fr-FR" | "it-IT";
  text: string;
};

const greetings: Record<CallLocale, TwilioGreeting> = {
  "de-CH": {
    language: "de-DE",
    text: "Guten Tag. Ich bin der digitale Assistent von Ivan. Dieser Testanruf bestätigt die Telefonverbindung. Der Gesprächsassistent wird im nächsten Schritt aktiviert. Auf Wiederhören."
  },
  "de-DE": {
    language: "de-DE",
    text: "Guten Tag. Ich bin der digitale Assistent von Ivan. Dieser Testanruf bestätigt die Telefonverbindung. Der Gesprächsassistent wird im nächsten Schritt aktiviert. Auf Wiederhören."
  },
  "fr-CH": {
    language: "fr-FR",
    text: "Bonjour. Je suis l’assistant numérique d’Ivan. Cet appel de test confirme la connexion téléphonique. L’assistant conversationnel sera activé à l’étape suivante. Au revoir."
  },
  "it-CH": {
    language: "it-IT",
    text: "Buongiorno. Sono l’assistente digitale di Ivan. Questa chiamata di prova conferma la connessione telefonica. L’assistente conversazionale sarà attivato nella fase successiva. Arrivederci."
  },
  "en-GB": {
    language: "en-GB",
    text: "Hello. I am Ivan’s digital assistant. This test call confirms the telephone connection. The conversational assistant will be enabled in the next step. Goodbye."
  },
  "en-US": {
    language: "en-US",
    text: "Hello. I am Ivan’s digital assistant. This test call confirms the telephone connection. The conversational assistant will be enabled in the next step. Goodbye."
  }
};

export function getTwilioGreeting(locale: CallLocale) {
  return greetings[locale];
}
