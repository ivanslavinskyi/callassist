import type {
  ContentLocale,
  ContentPageKey,
  ContentSection,
  FaqItem,
  LandingBlock,
  NavigationItem
} from "@callassist/contracts";
import type {
  SeedContentPage,
  SeedEditorialCollection
} from "./content-repository";

type SeedTranslation = {
  slug: string;
  title: string;
  summary: string;
  seoTitle: string;
  seoDescription: string;
  sections: ContentSection[];
};

type SeedDefinition = {
  key: ContentPageKey;
  pageId: string;
  revisionId: string;
  requiresReacceptance: boolean;
  translations: Record<ContentLocale, SeedTranslation>;
};

const publishedAt = "2026-08-22T00:00:00.000Z";

const definitions: SeedDefinition[] = [
  {
    key: "privacy",
    pageId: "10000000-0000-4000-8000-000000000001",
    revisionId: "20000000-0000-4000-8000-000000000001",
    requiresReacceptance: false,
    translations: {
      en: {
        slug: "privacy",
        title: "Privacy notice",
        summary: "How the local CallAssist beta processes account, call, recording, and transcript data.",
        seoTitle: "Privacy notice | CallAssist",
        seoDescription: "Privacy information for the CallAssist public beta.",
        sections: [
          {
            heading: "Local pre-beta notice",
            paragraphs: ["This implementation draft describes the current product behavior. It must receive Swiss legal and privacy review before a public launch."],
            bullets: []
          },
          {
            heading: "Data we process",
            paragraphs: ["CallAssist processes the information needed to create an account and carry out a supervised call."],
            bullets: ["First and last name, email address, verified mobile number, account and session data", "Recipient name and phone number, call objective, approved facts, language and retention settings", "Consent evidence, provider status, recordings when enabled, live and final transcripts, and technical events", "Credit ledger, suppression, safety, and administrative audit records"]
          },
          {
            heading: "Why we process it",
            paragraphs: ["We use this data to authenticate users, compile and execute approved call plans, enforce consent and safety controls, provide transcripts, prevent abuse, reconcile credits, and operate the beta."],
            bullets: []
          },
          {
            heading: "Providers and international processing",
            paragraphs: ["Telephony and SMS verification use Twilio. AI conversation and transcription use OpenAI. Provider processing locations, contractual safeguards, and the final subprocessor list remain a launch-review item."],
            bullets: []
          },
          {
            heading: "Retention and deletion",
            paragraphs: ["Audio retention is selected per call: delete after the final transcript, retain 7 days, or retain 30 days. For a completed call, the account owner can use password-confirmed call-data deletion: provider audio is removed first, then the brief, transcripts, approval text, and feedback comment are redacted from the live service. Minimized credit, consent, safety, technical, and audit evidence remains. Account-wide anonymization and production backup-expiry procedures remain under development."],
            bullets: []
          },
          {
            heading: "Your choices and requests",
            paragraphs: ["You control the facts shared in a call, approve the compiled plan, choose recording retention, and may stop an active call. Use the Support page for access, correction, deletion, privacy, or abuse requests while the formal request workflow is being completed."],
            bullets: []
          }
        ]
      },
      de: {
        slug: "datenschutz",
        title: "Datenschutzhinweise",
        summary: "Wie die lokale CallAssist-Beta Konto-, Anruf-, Aufnahme- und Transkriptdaten verarbeitet.",
        seoTitle: "Datenschutzhinweise | CallAssist",
        seoDescription: "Datenschutzinformationen für die öffentliche CallAssist-Beta.",
        sections: [
          {
            heading: "Hinweis zur lokalen Vorab-Beta",
            paragraphs: ["Dieser Implementierungsentwurf beschreibt das aktuelle Produktverhalten. Vor einem öffentlichen Start ist eine schweizerische Rechts- und Datenschutzprüfung erforderlich."],
            bullets: []
          },
          {
            heading: "Verarbeitete Daten",
            paragraphs: ["CallAssist verarbeitet die Daten, die für ein Konto und einen begleiteten Anruf erforderlich sind."],
            bullets: ["Vor- und Nachname, E-Mail-Adresse, bestätigte Mobilnummer, Konto- und Sitzungsdaten", "Name und Telefonnummer des Empfängers, Anrufziel, freigegebene Fakten, Sprache und Aufbewahrungseinstellung", "Einwilligungsnachweis, Anbieterstatus, gegebenenfalls Aufnahmen, Live- und Endtranskripte sowie technische Ereignisse", "Guthaben-, Sperr-, Sicherheits- und administrative Auditdaten"]
          },
          {
            heading: "Zwecke",
            paragraphs: ["Wir nutzen diese Daten zur Authentifizierung, zur Ausführung genehmigter Anrufpläne, für Einwilligungs- und Sicherheitskontrollen, Transkripte, Missbrauchsschutz, Guthabenabgleich und den Betrieb der Beta."],
            bullets: []
          },
          {
            heading: "Anbieter und internationale Verarbeitung",
            paragraphs: ["Telefonie und SMS-Bestätigung verwenden Twilio. KI-Gespräch und Transkription verwenden OpenAI. Verarbeitungsorte, vertragliche Garantien und die endgültige Unterauftragsliste bleiben Teil der Startprüfung."],
            bullets: []
          },
          {
            heading: "Aufbewahrung und Löschung",
            paragraphs: ["Die Audioaufbewahrung wird pro Anruf gewählt: nach dem Endtranskript löschen, 7 Tage oder 30 Tage behalten. Bei einem abgeschlossenen Anruf kann die Kontoinhaberin oder der Kontoinhaber die passwortbestätigte Löschung der Anrufdaten nutzen: Zuerst wird die Anbieter-Aufnahme entfernt, danach werden Anrufentwurf, Transkripte, Freigabetexte und Feedback-Kommentar im aktiven Dienst unkenntlich gemacht. Minimierte Guthaben-, Einwilligungs-, Sicherheits-, technische und Audit-Nachweise bleiben erhalten. Die kontoübergreifende Anonymisierung und die produktiven Backup-Abläufe sind noch in Arbeit."],
            bullets: []
          },
          {
            heading: "Ihre Wahlmöglichkeiten und Anfragen",
            paragraphs: ["Sie bestimmen die freigegebenen Fakten, genehmigen den Anrufplan, wählen die Aufbewahrung und können einen aktiven Anruf stoppen. Nutzen Sie die Support-Seite für Auskunfts-, Korrektur-, Lösch-, Datenschutz- oder Missbrauchsanfragen."],
            bullets: []
          }
        ]
      }
    }
  },
  {
    key: "terms",
    pageId: "10000000-0000-4000-8000-000000000002",
    revisionId: "20000000-0000-4000-8000-000000000002",
    requiresReacceptance: true,
    translations: {
      en: {
        slug: "terms",
        title: "Beta terms of use",
        summary: "The conditions for using the supervised CallAssist local public-beta implementation.",
        seoTitle: "Beta terms of use | CallAssist",
        seoDescription: "Terms for using the supervised CallAssist beta.",
        sections: [
          { heading: "Local pre-beta notice", paragraphs: ["Version 1 is an implementation draft and is not a substitute for the legal terms that must be reviewed before launch."], bullets: [] },
          { heading: "Your account", paragraphs: ["Use accurate first and last names and keep account access secure. You are responsible for activity performed through your active sessions."], bullets: ["One person may not create accounts to bypass limits", "A verified mobile number is required", "CallAssist may suspend access for safety, abuse, or security reasons"] },
          { heading: "Supervised beta service", paragraphs: ["CallAssist is an experimental assistant for limited everyday outbound calls. You must review each compiled plan and approve the real call. AI and transcripts may be incomplete or wrong."], bullets: [] },
          { heading: "Credits and availability", paragraphs: ["The current beta includes three promotional call credits and no payments. A credit is charged only after a provider-confirmed connection. Availability, limits, supported languages, and destinations may change during the beta."], bullets: [] },
          { heading: "Your responsibilities", paragraphs: ["You must have a legitimate reason to contact the recipient, provide only information you are entitled to use, respect refusals and opt-outs, and follow the Acceptable Use Policy."], bullets: [] },
          { heading: "Changes and termination", paragraphs: ["A materially changed published Terms or Acceptable Use revision requires acceptance again before calls can continue. You may stop using the service at any time. Account deletion and complete data-export workflows are still under development."], bullets: [] }
        ]
      },
      de: {
        slug: "nutzungsbedingungen",
        title: "Beta-Nutzungsbedingungen",
        summary: "Bedingungen für die Nutzung der begleiteten lokalen CallAssist-Beta-Implementierung.",
        seoTitle: "Beta-Nutzungsbedingungen | CallAssist",
        seoDescription: "Bedingungen für die Nutzung der begleiteten CallAssist-Beta.",
        sections: [
          { heading: "Hinweis zur lokalen Vorab-Beta", paragraphs: ["Version 1 ist ein Implementierungsentwurf und ersetzt nicht die vor dem Start erforderliche rechtliche Prüfung."], bullets: [] },
          { heading: "Ihr Konto", paragraphs: ["Verwenden Sie korrekte Vor- und Nachnamen und schützen Sie den Kontozugriff. Sie sind für Aktivitäten Ihrer aktiven Sitzungen verantwortlich."], bullets: ["Konten dürfen nicht zur Umgehung von Limiten vervielfacht werden", "Eine bestätigte Mobilnummer ist erforderlich", "CallAssist kann den Zugriff aus Sicherheits- oder Missbrauchsgründen sperren"] },
          { heading: "Begleiteter Beta-Dienst", paragraphs: ["CallAssist ist ein experimenteller Assistent für begrenzte alltägliche ausgehende Anrufe. Sie müssen jeden erstellten Plan prüfen und den echten Anruf genehmigen. KI und Transkripte können unvollständig oder falsch sein."], bullets: [] },
          { heading: "Guthaben und Verfügbarkeit", paragraphs: ["Die aktuelle Beta enthält drei Aktionsguthaben und keine Zahlungen. Ein Guthaben wird erst nach einer vom Anbieter bestätigten Verbindung belastet. Verfügbarkeit, Limiten, Sprachen und Ziele können sich ändern."], bullets: [] },
          { heading: "Ihre Verantwortung", paragraphs: ["Sie benötigen einen legitimen Kontaktgrund, dürfen nur berechtigte Informationen verwenden, müssen Ablehnungen und Sperren respektieren und die Regeln zur akzeptablen Nutzung einhalten."], bullets: [] },
          { heading: "Änderungen und Beendigung", paragraphs: ["Eine wesentlich geänderte veröffentlichte Version der Bedingungen oder Nutzungsregeln muss vor weiteren Anrufen erneut akzeptiert werden. Kontolöschung und vollständiger Datenexport sind noch in Entwicklung."], bullets: [] }
        ]
      }
    }
  },
  {
    key: "acceptable_use",
    pageId: "10000000-0000-4000-8000-000000000003",
    revisionId: "20000000-0000-4000-8000-000000000003",
    requiresReacceptance: true,
    translations: {
      en: {
        slug: "acceptable-use",
        title: "Acceptable Use Policy",
        summary: "The tasks and conduct allowed in the deliberately limited CallAssist beta.",
        seoTitle: "Acceptable Use Policy | CallAssist",
        seoDescription: "Safety and acceptable-use rules for CallAssist calls.",
        sections: [
          { heading: "Supported use", paragraphs: ["Use CallAssist for low-risk, legitimate everyday communication where the recipient may reasonably be contacted."], bullets: ["Request routine information", "Coordinate an appointment", "Ask about a document, application, or status", "Deliver a neutral message"] },
          { heading: "Never use CallAssist for", paragraphs: ["The following uses are outside the beta and may lead to immediate suspension."], bullets: ["Emergencies or urgent safety situations", "Harassment, threats, coercion, deception, or impersonation", "Spam, bulk marketing, sales campaigns, or political persuasion", "High-stakes legal, medical, financial, contractual, or employment negotiation", "Obtaining unrelated private data or bypassing a recipient's refusal or opt-out"] },
          { heading: "Identity and facts", paragraphs: ["The assistant identifies itself as an AI assistant acting for the named user. Use your actual first and last names and approve only verified facts that may be shared."], bullets: [] },
          { heading: "Consent and recording", paragraphs: ["The recipient must receive the disclosure and press 1 before conversation processing and recording begin. Do not attempt to bypass or misrepresent this boundary."], bullets: [] },
          { heading: "Beta limits", paragraphs: ["Calls are restricted to supported Swiss destinations, quotas, one active call per user, suppression checks, and the global safety switch."], bullets: [] }
        ]
      },
      de: {
        slug: "nutzungsregeln",
        title: "Regeln zur akzeptablen Nutzung",
        summary: "Erlaubte Aufgaben und Verhaltensregeln für die bewusst begrenzte CallAssist-Beta.",
        seoTitle: "Regeln zur akzeptablen Nutzung | CallAssist",
        seoDescription: "Sicherheits- und Nutzungsregeln für CallAssist-Anrufe.",
        sections: [
          { heading: "Unterstützte Nutzung", paragraphs: ["Nutzen Sie CallAssist für legitime alltägliche Kommunikation mit geringem Risiko, bei der die empfangende Person vernünftigerweise kontaktiert werden darf."], bullets: ["Routinemässige Informationen anfragen", "Einen Termin koordinieren", "Nach Dokument, Antrag oder Status fragen", "Eine neutrale Nachricht übermitteln"] },
          { heading: "CallAssist darf nie verwendet werden für", paragraphs: ["Die folgenden Nutzungen liegen ausserhalb der Beta und können zur sofortigen Sperrung führen."], bullets: ["Notfälle oder dringende Gefahrensituationen", "Belästigung, Drohung, Zwang, Täuschung oder Identitätsvortäuschung", "Spam, Massenwerbung, Verkaufskampagnen oder politische Überzeugungsarbeit", "Rechtliche, medizinische, finanzielle, vertragliche oder arbeitsbezogene Verhandlungen mit hohem Risiko", "Beschaffung sachfremder privater Daten oder Umgehung einer Ablehnung oder Sperre"] },
          { heading: "Identität und Fakten", paragraphs: ["Der Assistent nennt sich als KI-Assistent des namentlich genannten Benutzers. Verwenden Sie Ihren tatsächlichen Vor- und Nachnamen und nur überprüfte, ausdrücklich freigegebene Fakten."], bullets: [] },
          { heading: "Einwilligung und Aufnahme", paragraphs: ["Die empfangende Person erhält zuerst die Offenlegung und muss die 1 drücken, bevor Gesprächsverarbeitung und Aufnahme beginnen. Diese Grenze darf nicht umgangen oder falsch dargestellt werden."], bullets: [] },
          { heading: "Beta-Limiten", paragraphs: ["Anrufe sind auf unterstützte Schweizer Ziele, Quoten, einen aktiven Anruf pro Benutzer, Sperrprüfungen und den globalen Sicherheitsschalter begrenzt."], bullets: [] }
        ]
      }
    }
  },
  {
    key: "support",
    pageId: "10000000-0000-4000-8000-000000000004",
    revisionId: "20000000-0000-4000-8000-000000000004",
    requiresReacceptance: false,
    translations: {
      en: {
        slug: "support",
        title: "Support and safety",
        summary: "How to get help with account access, privacy, call safety, or abuse during local beta development.",
        seoTitle: "Support and safety | CallAssist",
        seoDescription: "Support, privacy, and abuse-reporting guidance for CallAssist.",
        sections: [
          { heading: "Not an emergency service", paragraphs: ["Do not use CallAssist in an emergency. Contact the appropriate local emergency service directly."], bullets: [] },
          { heading: "Account and technical help", paragraphs: ["When reporting a problem, include the approximate time, call status, browser, and a short description. Never send passwords, verification codes, session cookies, or unnecessary transcript text."], bullets: [] },
          { heading: "Privacy or data request", paragraphs: ["Identify the account email and the request type: access, correction, deletion, or another privacy question. The formal verified request workflow and response targets are not yet launched."], bullets: [] },
          { heading: "Unwanted calls or abuse", paragraphs: ["Recipients can use Stop calls to verify control of a Swiss number and add it to the global suppression list. Complaint intake ownership and published response targets remain a release task."], bullets: [] },
          { heading: "Contact channel", paragraphs: ["A monitored public support address has not yet been configured for this local pre-beta build. This page must be updated with reviewed operator identity and contact details before launch."], bullets: [] }
        ]
      },
      de: {
        slug: "hilfe",
        title: "Support und Sicherheit",
        summary: "Hilfe bei Kontozugriff, Datenschutz, Anrufsicherheit oder Missbrauch während der lokalen Beta-Entwicklung.",
        seoTitle: "Support und Sicherheit | CallAssist",
        seoDescription: "Hinweise zu Support, Datenschutz und Missbrauchsmeldungen bei CallAssist.",
        sections: [
          { heading: "Kein Notfalldienst", paragraphs: ["Verwenden Sie CallAssist nicht in einem Notfall. Kontaktieren Sie direkt den zuständigen lokalen Notfalldienst."], bullets: [] },
          { heading: "Konto- und technische Hilfe", paragraphs: ["Nennen Sie bei Problemen den ungefähren Zeitpunkt, Anrufstatus, Browser und eine kurze Beschreibung. Senden Sie niemals Passwörter, Bestätigungscodes, Sitzungscookies oder unnötige Transkripttexte."], bullets: [] },
          { heading: "Datenschutz- oder Datenanfrage", paragraphs: ["Nennen Sie die Konto-E-Mail und die Art der Anfrage: Auskunft, Korrektur, Löschung oder eine andere Datenschutzfrage. Der formelle verifizierte Anfrageprozess ist noch nicht gestartet."], bullets: [] },
          { heading: "Unerwünschte Anrufe oder Missbrauch", paragraphs: ["Empfänger können über Anrufe sperren die Kontrolle über eine Schweizer Nummer bestätigen und sie global sperren. Verantwortlichkeit und Reaktionsziele für Beschwerden bleiben eine Startaufgabe."], bullets: [] },
          { heading: "Kontaktkanal", paragraphs: ["Für diesen lokalen Vorab-Beta-Build ist noch keine überwachte öffentliche Supportadresse konfiguriert. Vor dem Start müssen geprüfte Betreiber- und Kontaktdaten ergänzt werden."], bullets: [] }
        ]
      }
    }
  },
  {
    key: "faq",
    pageId: "10000000-0000-4000-8000-000000000005",
    revisionId: "20000000-0000-4000-8000-000000000005",
    requiresReacceptance: false,
    translations: {
      en: {
        slug: "faq",
        title: "Frequently asked questions",
        summary: "Answers about disclosure, consent, recording, transcripts, retention, Swiss destinations, and beta credits.",
        seoTitle: "Frequently asked questions | CallAssist",
        seoDescription: "Common questions about using the CallAssist beta.",
        sections: [
          { heading: "Does the recipient know it is an AI call?", paragraphs: ["Yes. The assistant states that it is an AI assistant acting for the named user before asking for consent."], bullets: [] },
          { heading: "When does processing and recording begin?", paragraphs: ["Recipient audio is not sent to the conversation model and recording does not begin until the recipient presses 1 after the disclosure."], bullets: [] },
          { heading: "Can I turn recording off?", paragraphs: ["Choose delete after final transcript for zero-day audio retention. The temporary consent-gated recording is used to create the final transcript and then deleted."], bullets: [] },
          { heading: "How long is audio retained?", paragraphs: ["The available choices are 0, 7, or 30 days. Retained audio can also be deleted manually from the call detail."], bullets: [] },
          { heading: "Are transcripts always accurate?", paragraphs: ["No. Live and final transcripts can contain errors. Verify important names, dates, numbers, and commitments independently."], bullets: [] },
          { heading: "Which numbers can be called?", paragraphs: ["The beta accepts valid Swiss destinations only. Production Twilio geographic permissions must also be restricted before launch."], bullets: [] },
          { heading: "How do credits work?", paragraphs: ["Phone verification grants three beta credits once. One credit is charged only after a provider-confirmed successful connection; busy, no-answer, cancellation, and pre-connection technical failure are refunded."], bullets: [] },
          { heading: "Are website and call languages the same?", paragraphs: ["No. The website is currently English or German. You select a supported call language separately for each brief and may allow one controlled fallback language."], bullets: [] }
        ]
      },
      de: {
        slug: "faq",
        title: "Häufig gestellte Fragen",
        summary: "Antworten zu Offenlegung, Einwilligung, Aufnahme, Transkripten, Aufbewahrung, Schweizer Zielen und Beta-Guthaben.",
        seoTitle: "Häufig gestellte Fragen | CallAssist",
        seoDescription: "Häufige Fragen zur Nutzung der CallAssist-Beta.",
        sections: [
          { heading: "Weiss die empfangende Person, dass es ein KI-Anruf ist?", paragraphs: ["Ja. Der Assistent nennt sich als KI-Assistent des namentlich genannten Benutzers, bevor er um Einwilligung bittet."], bullets: [] },
          { heading: "Wann beginnen Verarbeitung und Aufnahme?", paragraphs: ["Empfängeraudio wird erst nach der Offenlegung und dem Drücken der 1 an das Gesprächsmodell übertragen und aufgenommen."], bullets: [] },
          { heading: "Kann ich die Aufnahme ausschalten?", paragraphs: ["Wählen Sie Löschen nach Endtranskript für eine Audioaufbewahrung von null Tagen. Die temporäre Aufnahme dient dem Endtranskript und wird danach gelöscht."], bullets: [] },
          { heading: "Wie lange wird Audio aufbewahrt?", paragraphs: ["Zur Auswahl stehen 0, 7 oder 30 Tage. Gespeicherte Aufnahmen können zusätzlich manuell in der Anrufansicht gelöscht werden."], bullets: [] },
          { heading: "Sind Transkripte immer korrekt?", paragraphs: ["Nein. Live- und Endtranskripte können Fehler enthalten. Prüfen Sie wichtige Namen, Daten, Zahlen und Verpflichtungen unabhängig."], bullets: [] },
          { heading: "Welche Nummern können angerufen werden?", paragraphs: ["Die Beta akzeptiert nur gültige Schweizer Ziele. Vor dem Start müssen zusätzlich die geografischen Twilio-Berechtigungen eingeschränkt werden."], bullets: [] },
          { heading: "Wie funktioniert das Guthaben?", paragraphs: ["Die Telefonbestätigung vergibt einmalig drei Beta-Guthaben. Ein Guthaben wird erst nach einer bestätigten Verbindung belastet; Besetzt, keine Antwort, Abbruch und technische Fehler vor der Verbindung werden erstattet."], bullets: [] },
          { heading: "Sind Website- und Anrufsprache identisch?", paragraphs: ["Nein. Die Website ist derzeit auf Deutsch oder Englisch verfügbar. Die Anrufsprache wird pro Entwurf separat gewählt; optional ist eine kontrollierte Ausweichsprache möglich."], bullets: [] }
        ]
      }
    }
  }
];

export const seededContentPages: SeedContentPage[] = definitions.flatMap(
  (definition, pageIndex) =>
    (["en", "de"] as const).map((locale, localeIndex) => {
      const translation = definition.translations[locale];
      const sequence = pageIndex * 2 + localeIndex + 1;
      const suffix = String(sequence).padStart(12, "0");
      return {
        key: definition.key,
        pageType: "page",
        sourceLocale: "en",
        locale,
        slug: translation.slug,
        title: translation.title,
        summary: translation.summary,
        sections: translation.sections,
        seoTitle: translation.seoTitle,
        seoDescription: translation.seoDescription,
        revision: {
          id: definition.revisionId,
          number: 1,
          requiresReacceptance: definition.requiresReacceptance,
          sourceRevisionNumber: 1,
          publishedAt
        },
        pageId: definition.pageId,
        localizationId: `30000000-0000-4000-8000-${suffix}`,
        revisionLocalizationId: `40000000-0000-4000-8000-${suffix}`
      };
    })
);

const faqDefinition = definitions.find(({ key }) => key === "faq")!;
const faqItems: FaqItem[] = faqDefinition.translations.en.sections.map(
  (section, index) => ({
    id: `70000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    sortOrder: index,
    enabled: true,
    question: {
      en: section.heading,
      de: faqDefinition.translations.de.sections[index]!.heading
    },
    answer: {
      en: sectionAnswer(section),
      de: sectionAnswer(faqDefinition.translations.de.sections[index]!)
    }
  })
);

const navigationItems: NavigationItem[] = [
  navigationItem(1, "home", "header", "Home", "Start"),
  navigationItem(2, "faq", "header", "FAQ", "FAQ"),
  navigationItem(3, "support", "header", "Support", "Support"),
  navigationItem(4, "privacy", "footer", "Privacy", "Datenschutz"),
  navigationItem(5, "terms", "footer", "Terms", "Bedingungen"),
  navigationItem(6, "acceptable_use", "footer", "Acceptable Use", "Nutzungsregeln"),
  navigationItem(7, "faq", "footer", "FAQ", "FAQ"),
  navigationItem(8, "support", "footer", "Support", "Support"),
  navigationItem(9, "opt_out", "footer", "Block calls", "Anrufe sperren")
];

const landingBlocks: LandingBlock[] = [
  {
    id: "72000000-0000-4000-8000-000000000001",
    blockType: "hero",
    sortOrder: 0,
    enabled: true,
    eyebrow: localized("Accessible phone assistance", "Barrierefreie Telefonassistenz"),
    title: localized(
      "Your call. Your intent. An AI assistant that speaks for you.",
      "Ihr Anruf. Ihr Anliegen. Ein KI-Assistent, der für Sie spricht."
    ),
    lead: localized(
      "CallAssist helps people with speech impairments or local-language barriers prepare, review, and supervise everyday phone calls.",
      "CallAssist hilft Menschen mit Sprachbeeinträchtigung oder lokaler Sprachbarriere, alltägliche Telefonanrufe vorzubereiten, zu prüfen und zu begleiten."
    ),
    badges: localizedList(
      ["Free public beta", "3 calls included", "Switzerland only"],
      ["Kostenlose öffentliche Beta", "3 Anrufe inklusive", "Nur Schweiz"]
    ),
    primaryCtaLabel: localized("Try the beta", "Beta testen"),
    secondaryCtaLabel: localized("Sign in", "Anmelden"),
    seoTitle: localized(
      "CallAssist — AI phone assistance under your control",
      "CallAssist — KI-Telefonassistenz unter Ihrer Kontrolle"
    ),
    seoDescription: localized(
      "Supervised AI phone calls for people with speech impairments or local-language barriers.",
      "Begleitete KI-Telefonanrufe für Menschen mit Sprachbeeinträchtigung oder lokaler Sprachbarriere."
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000002",
    blockType: "how_it_works",
    sortOrder: 1,
    enabled: true,
    eyebrow: localized("How it works", "So funktioniert es"),
    title: localized(
      "You remain in control from brief to result.",
      "Vom Auftrag bis zum Ergebnis behalten Sie die Kontrolle."
    ),
    steps: [
      landingStep(1, "Describe", "Beschreiben", "Set the recipient, objective, language, and facts the assistant may share.", "Empfänger, Ziel, Sprache und freigegebene Fakten festlegen."),
      landingStep(2, "Review", "Prüfen", "CallAssist compiles a bounded plan for you to check and explicitly approve.", "CallAssist erstellt einen begrenzten Plan, den Sie prüfen und ausdrücklich genehmigen."),
      landingStep(3, "Call", "Anrufen", "The assistant identifies itself and waits for consent before conversation processing or recording.", "Der Assistent stellt sich vor und wartet vor Verarbeitung oder Aufnahme auf die Einwilligung."),
      landingStep(4, "Result", "Ergebnis", "Follow the live call, stop it at any time, and review the result and transcript.", "Anruf live verfolgen, jederzeit stoppen und Ergebnis sowie Transkript prüfen.")
    ]
  },
  {
    id: "72000000-0000-4000-8000-000000000003",
    blockType: "use_cases",
    sortOrder: 2,
    enabled: true,
    eyebrow: localized("Everyday assistance", "Hilfe im Alltag"),
    title: localized("Supported everyday tasks", "Unterstützte Alltagsaufgaben"),
    text: localized(
      "Use CallAssist for bounded, reviewable requests where you remain responsible for the approved facts and objective.",
      "Nutzen Sie CallAssist für begrenzte, prüfbare Anliegen, bei denen Sie für die freigegebenen Fakten und das Ziel verantwortlich bleiben."
    ),
    items: localizedList(
      ["Request information", "Arrange an appointment", "Check a document or status", "Deliver a neutral message"],
      ["Informationen anfragen", "Termin vereinbaren", "Dokument oder Status klären", "Neutrale Nachricht übermitteln"]
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000004",
    blockType: "safety_privacy",
    sortOrder: 3,
    enabled: true,
    eyebrow: localized("Designed for a limited beta", "Für eine begrenzte Beta konzipiert"),
    title: localized("Clear boundaries before every call.", "Klare Grenzen vor jedem Anruf."),
    text: localized(
      "Recording starts only after recipient consent. You choose 0, 7, or 30 days of audio retention and can delete retained audio manually. AI output can be wrong, so every call plan must be reviewed.",
      "Die Aufnahme startet erst nach der Einwilligung. Sie wählen 0, 7 oder 30 Tage Audioaufbewahrung und können gespeicherte Aufnahmen manuell löschen. KI kann Fehler machen, deshalb muss jeder Anrufplan geprüft werden."
    ),
    limitsTitle: localized("Not supported", "Nicht unterstützt"),
    limits: localizedList(
      ["Emergencies", "Harassment or deception", "Spam, bulk marketing, or political persuasion", "High-stakes legal, medical, or financial negotiation"],
      ["Notfälle", "Belästigung oder Täuschung", "Spam, Massenwerbung oder politische Überzeugungsarbeit", "Rechtliche, medizinische oder finanzielle Verhandlungen mit hohem Risiko"]
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000005",
    blockType: "languages",
    sortOrder: 4,
    enabled: true,
    title: localized(
      "Website and call language are separate",
      "Website- und Anrufsprache sind getrennt"
    ),
    text: localized(
      "Use the website in English or German, then choose the appropriate supported language for each call. A controlled fallback language is optional.",
      "Nutzen Sie die Website auf Deutsch oder Englisch und wählen Sie für jeden Anruf eine passende unterstützte Sprache. Eine kontrollierte Ausweichsprache ist optional."
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000006",
    blockType: "faq",
    sortOrder: 5,
    enabled: true,
    eyebrow: localized("Frequently asked questions", "Häufig gestellte Fragen"),
    title: localized("Know what to expect before you call.", "Wissen, was Sie vor dem Anruf erwartet."),
    itemLimit: 4
  },
  {
    id: "72000000-0000-4000-8000-000000000007",
    blockType: "cta",
    sortOrder: 6,
    enabled: true,
    title: localized(
      "Prepare your first supervised call.",
      "Bereiten Sie den ersten begleiteten Anruf vor."
    ),
    text: localized(
      "Create an account with your real first and last name, verify your mobile number, and receive three beta call credits.",
      "Erstellen Sie ein Konto mit Ihrem echten Vor- und Nachnamen, bestätigen Sie Ihre Mobilnummer und erhalten Sie drei Beta-Anrufguthaben."
    ),
    primaryCtaLabel: localized("Try the beta", "Beta testen")
  }
];

export const seededEditorialCollections: SeedEditorialCollection[] = [
  {
    collectionId: "80000000-0000-4000-8000-000000000001",
    revision: {
      key: "faq",
      id: "81000000-0000-4000-8000-000000000001",
      number: 1,
      status: "published",
      createdByUserId: null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt,
      items: faqItems
    }
  },
  {
    collectionId: "80000000-0000-4000-8000-000000000002",
    revision: {
      key: "navigation",
      id: "81000000-0000-4000-8000-000000000002",
      number: 1,
      status: "published",
      createdByUserId: null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt,
      items: navigationItems
    }
  },
  {
    collectionId: "80000000-0000-4000-8000-000000000003",
    revision: {
      key: "landing",
      id: "81000000-0000-4000-8000-000000000003",
      number: 1,
      status: "published",
      createdByUserId: null,
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt,
      items: landingBlocks
    }
  }
];

function sectionAnswer(section: ContentSection) {
  return [
    ...section.paragraphs,
    ...section.bullets.map((bullet) => `• ${bullet}`)
  ].join("\n\n");
}

function navigationItem(
  sequence: number,
  destination: NavigationItem["destination"],
  location: NavigationItem["location"],
  en: string,
  de: string
): NavigationItem {
  return {
    id: `71000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    sortOrder: sequence - 1,
    enabled: true,
    location,
    destination,
    label: { en, de }
  };
}

function localized(en: string, de: string) {
  return { en, de };
}

function localizedList(en: string[], de: string[]) {
  return { en, de };
}

function landingStep(
  sequence: number,
  enTitle: string,
  deTitle: string,
  enText: string,
  deText: string
) {
  return {
    id: `73000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    title: localized(enTitle, deTitle),
    text: localized(enText, deText)
  };
}
