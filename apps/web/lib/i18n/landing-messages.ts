import type { UiLocale } from "./messages";

type LandingMessages = {
  creditDetails: string;
  prepareCall: string;
  checkingSession: string;
  retrySession: string;
  sessionUnavailable: string;
  founder: {
    eyebrow: string;
    title: string;
    paragraphs: readonly [string, string];
    name: string;
    role: string;
  };
};

export const landingMessages: Record<UiLocale, LandingMessages> = {
  en: {
    creditDetails: "When is a call credit used?",
    prepareCall: "Prepare a call",
    checkingSession: "Please wait…",
    retrySession: "Try again",
    sessionUnavailable: "We could not check your session.",
    founder: {
      eyebrow: "BEHIND SHPROHLI",
      title: "Calling and me: it’s complicated.",
      paragraphs: [
        "I’m Ivan Slavinskyi, the founder and developer of SHPROHLI. Because speaking is difficult for me, I know how quickly “I’ll just call the municipality or the doctor’s office” can turn into a whole project. And chances are, you know the feeling too: there’s always that call you keep putting off until “later” suddenly becomes urgent.",
        "That’s why I’m building SHPROHLI. You write down what you need, review the plan, and the assistant does the talking. The decisions stay with you. It helps when speaking is difficult, when you’re not confident in the language of the call, or when you simply prefer writing to calling."
      ],
      name: "Ivan Slavinskyi",
      role: "Founder and developer of SHPROHLI"
    }
  },
  de: {
    creditDetails: "Wann wird ein Anrufguthaben verbraucht?",
    prepareCall: "Anruf vorbereiten",
    checkingSession: "Bitte warten…",
    retrySession: "Erneut versuchen",
    sessionUnavailable: "Ihre Sitzung konnte nicht geprüft werden.",
    founder: {
      eyebrow: "HINTER SHPROHLI",
      title: "Telefonieren und ich: eine komplizierte Beziehung.",
      paragraphs: [
        "Ich bin Ivan Slavinskyi, Gründer und Entwickler von SHPROHLI. Weil mir das Sprechen schwerfällt, weiss ich, wie schnell aus «kurz bei der Gemeinde oder der Praxis anrufen» ein kleines Tagesprojekt werden kann. Vermutlich kennt aber fast jeder diese Telefonate, die man so lange vor sich herschiebt, bis «später» plötzlich ziemlich dringend wird.",
        "Deshalb entwickle ich SHPROHLI. Sie schreiben, worum es geht, prüfen den Plan, und der Assistent übernimmt das Reden. Die Entscheidungen bleiben bei Ihnen. Das hilft, wenn Sprechen schwierig ist, man sich in der nötigen Sprache nicht sicher fühlt oder schlicht lieber schreibt als telefoniert."
      ],
      name: "Ivan Slavinskyi",
      role: "Gründer und Entwickler von SHPROHLI"
    }
  }
};
