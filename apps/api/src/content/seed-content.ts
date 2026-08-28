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
const refreshedLandingPublishedAt = "2026-08-25T00:00:00.000Z";

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
        summary: "How the local SHPROHLI beta processes account, call, recording, and transcript data.",
        seoTitle: "Privacy notice | SHPROHLI",
        seoDescription: "Privacy information for the SHPROHLI public beta.",
        sections: [
          {
            heading: "Local pre-beta notice",
            paragraphs: ["This implementation draft describes the current product behavior. It must receive Swiss legal and privacy review before a public launch."],
            bullets: []
          },
          {
            heading: "Data we process",
            paragraphs: ["SHPROHLI processes the information needed to create an account and carry out a supervised call."],
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
        summary: "Wie die lokale SHPROHLI-Beta Konto-, Anruf-, Aufnahme- und Transkriptdaten verarbeitet.",
        seoTitle: "Datenschutzhinweise | SHPROHLI",
        seoDescription: "Datenschutzinformationen für die öffentliche SHPROHLI-Beta.",
        sections: [
          {
            heading: "Hinweis zur lokalen Vorab-Beta",
            paragraphs: ["Dieser Implementierungsentwurf beschreibt das aktuelle Produktverhalten. Vor einem öffentlichen Start ist eine schweizerische Rechts- und Datenschutzprüfung erforderlich."],
            bullets: []
          },
          {
            heading: "Verarbeitete Daten",
            paragraphs: ["SHPROHLI verarbeitet die Daten, die für ein Konto und einen begleiteten Anruf erforderlich sind."],
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
        summary: "The conditions for using the supervised SHPROHLI local public-beta implementation.",
        seoTitle: "Beta terms of use | SHPROHLI",
        seoDescription: "Terms for using the supervised SHPROHLI beta.",
        sections: [
          { heading: "Local pre-beta notice", paragraphs: ["Version 1 is an implementation draft and is not a substitute for the legal terms that must be reviewed before launch."], bullets: [] },
          { heading: "Your account", paragraphs: ["Use accurate first and last names and keep account access secure. You are responsible for activity performed through your active sessions."], bullets: ["One person may not create accounts to bypass limits", "A verified mobile number is required", "SHPROHLI may suspend access for safety, abuse, or security reasons"] },
          { heading: "Supervised beta service", paragraphs: ["SHPROHLI is an experimental assistant for limited everyday outbound calls. You must review each compiled plan and approve the real call. AI and transcripts may be incomplete or wrong."], bullets: [] },
          { heading: "Credits and availability", paragraphs: ["The current beta includes three promotional call credits and no payments. A credit is charged only after a provider-confirmed connection. Availability, limits, supported languages, and destinations may change during the beta."], bullets: [] },
          { heading: "Your responsibilities", paragraphs: ["You must have a legitimate reason to contact the recipient, provide only information you are entitled to use, respect refusals and opt-outs, and follow the Acceptable Use Policy."], bullets: [] },
          { heading: "Changes and termination", paragraphs: ["A materially changed published Terms or Acceptable Use revision requires acceptance again before calls can continue. You may stop using the service at any time. Account deletion and complete data-export workflows are still under development."], bullets: [] }
        ]
      },
      de: {
        slug: "nutzungsbedingungen",
        title: "Beta-Nutzungsbedingungen",
        summary: "Bedingungen für die Nutzung der begleiteten lokalen SHPROHLI-Beta-Implementierung.",
        seoTitle: "Beta-Nutzungsbedingungen | SHPROHLI",
        seoDescription: "Bedingungen für die Nutzung der begleiteten SHPROHLI-Beta.",
        sections: [
          { heading: "Hinweis zur lokalen Vorab-Beta", paragraphs: ["Version 1 ist ein Implementierungsentwurf und ersetzt nicht die vor dem Start erforderliche rechtliche Prüfung."], bullets: [] },
          { heading: "Ihr Konto", paragraphs: ["Verwenden Sie korrekte Vor- und Nachnamen und schützen Sie den Kontozugriff. Sie sind für Aktivitäten Ihrer aktiven Sitzungen verantwortlich."], bullets: ["Konten dürfen nicht zur Umgehung von Limiten vervielfacht werden", "Eine bestätigte Mobilnummer ist erforderlich", "SHPROHLI kann den Zugriff aus Sicherheits- oder Missbrauchsgründen sperren"] },
          { heading: "Begleiteter Beta-Dienst", paragraphs: ["SHPROHLI ist ein experimenteller Assistent für begrenzte alltägliche ausgehende Anrufe. Sie müssen jeden erstellten Plan prüfen und den echten Anruf genehmigen. KI und Transkripte können unvollständig oder falsch sein."], bullets: [] },
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
        summary: "The tasks and conduct allowed in the deliberately limited SHPROHLI beta.",
        seoTitle: "Acceptable Use Policy | SHPROHLI",
        seoDescription: "Safety and acceptable-use rules for SHPROHLI calls.",
        sections: [
          { heading: "Supported use", paragraphs: ["Use SHPROHLI for low-risk, legitimate everyday communication where the recipient may reasonably be contacted."], bullets: ["Request routine information", "Coordinate an appointment", "Ask about a document, application, or status", "Deliver a neutral message"] },
          { heading: "Never use SHPROHLI for", paragraphs: ["The following uses are outside the beta and may lead to immediate suspension."], bullets: ["Emergencies or urgent safety situations", "Harassment, threats, coercion, deception, or impersonation", "Spam, bulk marketing, sales campaigns, or political persuasion", "High-stakes legal, medical, financial, contractual, or employment negotiation", "Obtaining unrelated private data or bypassing a recipient's refusal or opt-out"] },
          { heading: "Identity and facts", paragraphs: ["The assistant identifies itself as an AI assistant acting for the named user. Use your actual first and last names and approve only verified facts that may be shared."], bullets: [] },
          { heading: "Consent and recording", paragraphs: ["The recipient must receive the disclosure and press 1 before conversation processing and recording begin. Do not attempt to bypass or misrepresent this boundary."], bullets: [] },
          { heading: "Beta limits", paragraphs: ["Calls are restricted to supported Swiss destinations, quotas, one active call per user, suppression checks, and the global safety switch."], bullets: [] }
        ]
      },
      de: {
        slug: "nutzungsregeln",
        title: "Regeln zur akzeptablen Nutzung",
        summary: "Erlaubte Aufgaben und Verhaltensregeln für die bewusst begrenzte SHPROHLI-Beta.",
        seoTitle: "Regeln zur akzeptablen Nutzung | SHPROHLI",
        seoDescription: "Sicherheits- und Nutzungsregeln für SHPROHLI-Anrufe.",
        sections: [
          { heading: "Unterstützte Nutzung", paragraphs: ["Nutzen Sie SHPROHLI für legitime alltägliche Kommunikation mit geringem Risiko, bei der die empfangende Person vernünftigerweise kontaktiert werden darf."], bullets: ["Routinemässige Informationen anfragen", "Einen Termin koordinieren", "Nach Dokument, Antrag oder Status fragen", "Eine neutrale Nachricht übermitteln"] },
          { heading: "SHPROHLI darf nie verwendet werden für", paragraphs: ["Die folgenden Nutzungen liegen ausserhalb der Beta und können zur sofortigen Sperrung führen."], bullets: ["Notfälle oder dringende Gefahrensituationen", "Belästigung, Drohung, Zwang, Täuschung oder Identitätsvortäuschung", "Spam, Massenwerbung, Verkaufskampagnen oder politische Überzeugungsarbeit", "Rechtliche, medizinische, finanzielle, vertragliche oder arbeitsbezogene Verhandlungen mit hohem Risiko", "Beschaffung sachfremder privater Daten oder Umgehung einer Ablehnung oder Sperre"] },
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
        seoTitle: "Support and safety | SHPROHLI",
        seoDescription: "Support, privacy, and abuse-reporting guidance for SHPROHLI.",
        sections: [
          { heading: "Not an emergency service", paragraphs: ["Do not use SHPROHLI in an emergency. Contact the appropriate local emergency service directly."], bullets: [] },
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
        seoTitle: "Support und Sicherheit | SHPROHLI",
        seoDescription: "Hinweise zu Support, Datenschutz und Missbrauchsmeldungen bei SHPROHLI.",
        sections: [
          { heading: "Kein Notfalldienst", paragraphs: ["Verwenden Sie SHPROHLI nicht in einem Notfall. Kontaktieren Sie direkt den zuständigen lokalen Notfalldienst."], bullets: [] },
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
        summary: "Answers about how SHPROHLI behaves before, during, and after a beta call.",
        seoTitle: "Frequently asked questions | SHPROHLI",
        seoDescription: "Common questions about using the SHPROHLI beta.",
        sections: [
          { heading: "Does the recipient know it is an AI call?", paragraphs: ["Yes. The assistant states that it is an AI assistant acting for the named user before asking for consent."], bullets: [] },
          { heading: "Can SHPROHLI say something I did not approve?", paragraphs: ["You approve the objective, facts and prepared call plan, not every sentence word for word. SHPROHLI may phrase ordinary questions naturally, but it is instructed not to invent concrete facts or make commitments outside the reviewed plan."], bullets: [] },
          { heading: "What happens if the recipient asks an unexpected question?", paragraphs: ["SHPROHLI must not guess. It can ask a short clarifying question. If the answer is not in the objective or approved facts, it says that the information is unavailable and can offer to pass the question back to you."], bullets: [] },
          { heading: "Which phone numbers can I call during the beta?", paragraphs: ["The beta accepts valid Swiss destination numbers only."], bullets: [] },
          { heading: "What happens if nobody answers?", paragraphs: ["The attempt ends as unanswered and the reserved beta credit is refunded. A credit is charged only after the phone provider confirms a connection."], bullets: [] },
          { heading: "When does processing and recording begin?", paragraphs: ["Recipient audio is not sent to the conversation model and recording does not begin until the recipient hears the disclosure and presses 1 to consent."], bullets: [] },
          { heading: "Can I delete retained audio and my call data?", paragraphs: ["Yes. Retained audio can be deleted manually from the call detail. For a completed call, password-confirmed call-data deletion removes provider audio and redacts the call brief, transcripts, approval text and feedback comment; minimized credit, consent, safety, technical and audit evidence remains."], bullets: [] }
        ]
      },
      de: {
        slug: "faq",
        title: "Häufig gestellte Fragen",
        summary: "Antworten dazu, wie sich SHPROHLI vor, während und nach einem Beta-Anruf verhält.",
        seoTitle: "Häufig gestellte Fragen | SHPROHLI",
        seoDescription: "Häufige Fragen zur Nutzung der SHPROHLI-Beta.",
        sections: [
          { heading: "Weiss die angerufene Person, dass ein KI-Assistent anruft?", paragraphs: ["Ja. Der Assistent erklärt vor der Einwilligung, dass er als KI-Assistent für die namentlich genannte Person anruft."], bullets: [] },
          { heading: "Kann SHPROHLI etwas sagen, das ich nicht freigegeben habe?", paragraphs: ["Sie geben Ziel, Fakten und den vorbereiteten Gesprächsplan frei, nicht jeden Satz Wort für Wort. SHPROHLI kann gewöhnliche Fragen natürlich formulieren, darf aber keine konkreten Fakten erfinden oder Zusagen ausserhalb des geprüften Plans machen."], bullets: [] },
          { heading: "Was passiert bei einer unerwarteten Rückfrage?", paragraphs: ["SHPROHLI darf nicht raten. Der Assistent kann kurz nachfragen. Fehlt die Antwort in Ziel oder freigegebenen Fakten, sagt er, dass diese Information nicht vorliegt, und kann anbieten, die Frage an Sie weiterzugeben."], bullets: [] },
          { heading: "Welche Telefonnummern kann ich während der Beta anrufen?", paragraphs: ["Die Beta akzeptiert nur gültige Schweizer Zielnummern."], bullets: [] },
          { heading: "Was passiert, wenn niemand abnimmt?", paragraphs: ["Der Versuch endet als unbeantwortet und das reservierte Beta-Guthaben wird zurückerstattet. Ein Guthaben wird erst belastet, wenn der Telefonanbieter eine Verbindung bestätigt."], bullets: [] },
          { heading: "Wann beginnen Verarbeitung und Aufzeichnung?", paragraphs: ["Das Audio der angerufenen Person wird erst an das Gesprächsmodell gesendet und aufgezeichnet, nachdem sie die Offenlegung gehört und mit der Taste 1 zugestimmt hat."], bullets: [] },
          { heading: "Kann ich gespeicherte Audiodaten und meine Anrufdaten löschen?", paragraphs: ["Ja. Gespeicherte Audiodaten können in der Anrufansicht manuell gelöscht werden. Bei einem abgeschlossenen Anruf entfernt die passwortbestätigte Löschung das Audio beim Anbieter und redigiert Gesprächsplan, Transkripte, Freigabetext und Feedback-Kommentar; minimierte Guthaben-, Einwilligungs-, Sicherheits-, Technik- und Auditnachweise bleiben erhalten."], bullets: [] }
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
    eyebrow: localized(
      "PHONE CALLS WITHOUT THE SPEAKING BARRIER",
      "TELEFONIEREN OHNE SPRACHBARRIERE"
    ),
    title: localized(
      "Need to make a phone call, but speaking is the hard part?",
      "Sie müssen telefonieren, aber das Sprechen ist die eigentliche Hürde?"
    ),
    supportingTitle: localized(
      "SHPROHLI can make it for you.",
      "SHPROHLI kann den Anruf für Sie übernehmen."
    ),
    lead: localized(
      "Tell SHPROHLI what you need, review what it may say, and let the AI assistant place the call on your behalf.",
      "Beschreiben Sie, was Sie erreichen möchten, prüfen Sie vorher, was der Assistent sagen darf, und lassen Sie SHPROHLI den Anruf in Ihrem Namen führen."
    ),
    secondaryText: localized(
      "Built for people with speech difficulties and for anyone who needs help calling in a local language.",
      "Für Menschen mit Sprach- oder Sprechschwierigkeiten und für alle, denen Telefonate in einer lokalen Sprache schwerfallen."
    ),
    badges: localizedList(
      ["Free public beta", "3 calls included", "Swiss numbers only"],
      ["Kostenlose öffentliche Beta", "3 Anrufe inklusive", "Nur Schweizer Nummern"]
    ),
    primaryCtaLabel: localized("Try the beta", "Beta ausprobieren"),
    secondaryCtaLabel: localized("See how it works", "So funktioniert es"),
    seoTitle: localized(
      "SHPROHLI — phone calls without the speaking barrier",
      "SHPROHLI — telefonieren ohne Sprachbarriere"
    ),
    seoDescription: localized(
      "Prepare, review and approve everyday phone calls made by an AI assistant on your behalf.",
      "Alltägliche Telefonate vorbereiten, prüfen und freigeben, die ein KI-Assistent in Ihrem Namen führt."
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000008",
    blockType: "problem",
    sortOrder: 1,
    enabled: true,
    eyebrow: localized("WHY SHPROHLI", "WARUM SHPROHLI"),
    title: localized(
      "Some calls are harder than they should be.",
      "Manche Telefonate sind schwieriger, als sie sein sollten."
    ),
    items: [
      landingContentItem(
        11,
        "Speaking on the phone is difficult",
        "Sprechen am Telefon ist schwierig",
        "You know what you want to say, but a speech impairment, fatigue or another communication difficulty can make phone calls stressful or impractical.",
        "Sie wissen genau, was Sie sagen möchten, aber eine Sprechbeeinträchtigung, Erschöpfung oder eine andere Kommunikationshürde macht Telefonate belastend oder praktisch unmöglich."
      ),
      landingContentItem(
        12,
        "The local language is the barrier",
        "Die lokale Sprache ist die Hürde",
        "You may manage everyday life well, but explaining a problem, understanding questions and reacting quickly on the phone can still be difficult.",
        "Im Alltag kommen Sie vielleicht gut zurecht. Am Telefon ein Problem zu erklären, Fragen spontan zu verstehen und sofort zu reagieren, kann trotzdem schwierig sein."
      )
    ]
  },
  {
    id: "72000000-0000-4000-8000-000000000003",
    blockType: "use_cases",
    sortOrder: 2,
    enabled: true,
    eyebrow: localized("EVERYDAY CALLS", "ALLTÄGLICHE TELEFONATE"),
    title: localized(
      "Calls SHPROHLI can help with",
      "Bei solchen Anrufen kann SHPROHLI helfen"
    ),
    text: localized(
      "Straightforward calls with a clear, practical objective.",
      "Konkrete Telefonate mit einem klaren, praktischen Ziel."
    ),
    items: [
      landingContentItem(21, "Doctor's practice", "Arztpraxis", "Ask for an appointment or find out which documents you need to bring.", "Einen Termin vereinbaren oder fragen, welche Unterlagen mitgebracht werden müssen."),
      landingContentItem(22, "Gemeinde or public office", "Gemeinde oder Behörde", "Check whether an application arrived or ask what information is still missing.", "Nachfragen, ob ein Antrag eingegangen ist oder welche Angaben noch fehlen."),
      landingContentItem(23, "School or course provider", "Schule oder Kursanbieter", "Clarify a schedule, registration, payment or another straightforward question.", "Zeiten, Anmeldung, Zahlung oder eine andere konkrete Frage klären."),
      landingContentItem(24, "Landlord or repair service", "Vermieter oder Reparaturdienst", "Describe an issue and arrange the next practical step.", "Ein Problem schildern und den nächsten Schritt vereinbaren."),
      landingContentItem(25, "Insurance or service provider", "Versicherung oder Dienstleister", "Ask about the status of a straightforward request or document.", "Den Stand einer einfachen Anfrage oder eines Dokuments abklären.")
    ]
  },
  {
    id: "72000000-0000-4000-8000-000000000009",
    blockType: "example",
    sortOrder: 3,
    enabled: true,
    title: localized(
      "From one sentence to a completed call",
      "Von einem Satz zum erledigten Telefonat"
    ),
    items: [
      landingContentItem(31, "Your request", "Ihre Anfrage", "Call my Gemeinde and ask whether they received my residence form. If anything is missing, ask what I need to send.", "Rufen Sie meine Gemeinde an und fragen Sie, ob mein Aufenthaltsformular angekommen ist. Falls etwas fehlt, fragen Sie bitte, was ich noch senden muss."),
      landingContentItem(32, "SHPROHLI prepares", "SHPROHLI bereitet den Anruf vor", "SHPROHLI turns the request into a bounded call plan. You review the facts, objective and what the assistant may say.", "SHPROHLI erstellt daraus einen klar begrenzten Gesprächsplan. Sie prüfen Ziel, Fakten und was der Assistent sagen darf."),
      landingContentItem(33, "The call", "Der Anruf", "Hello. I'm an AI assistant calling on behalf of Anna Keller. She asked me to check whether her residence form has been received.", "Guten Tag. Ich bin ein KI-Assistent und rufe im Auftrag von Anna Keller an. Sie möchte wissen, ob ihr Aufenthaltsformular eingegangen ist."),
      landingContentItem(34, "Result", "Ergebnis", "Form received. A copy of the passport is still required and can be sent by email.", "Das Formular ist eingegangen. Eine Passkopie fehlt noch und kann per E-Mail eingereicht werden.")
    ]
  },
  {
    id: "72000000-0000-4000-8000-000000000002",
    blockType: "how_it_works",
    sortOrder: 4,
    enabled: true,
    eyebrow: localized("HOW IT WORKS", "SO FUNKTIONIERT ES"),
    title: localized(
      "You stay in control from start to finish.",
      "Sie behalten von Anfang bis Ende die Kontrolle."
    ),
    steps: [
      landingStep(1, "Tell us what you need", "Beschreiben Sie Ihr Anliegen", "Write naturally. You do not need to prepare a script.", "Schreiben Sie einfach in Ihren eigenen Worten. Sie brauchen kein fertiges Telefonskript."),
      landingStep(2, "Check the plan", "Prüfen Sie den Gesprächsplan", "SHPROHLI turns your request into a bounded call brief that you can review and change.", "SHPROHLI erstellt daraus einen klar begrenzten Anruf, den Sie vorab prüfen und ändern können."),
      landingStep(3, "Approve the call", "Geben Sie den Anruf frei", "The assistant dials only after you explicitly approve the prepared call.", "Erst nach Ihrer ausdrücklichen Freigabe wird die Nummer gewählt."),
      landingStep(4, "See what happened", "Sehen Sie das Ergebnis", "Follow the call live and review the final transcript and result afterwards.", "Verfolgen Sie den Anruf live und prüfen Sie danach Ergebnis und Transkript.")
    ]
  },
  {
    id: "72000000-0000-4000-8000-000000000004",
    blockType: "safety_privacy",
    sortOrder: 5,
    enabled: true,
    eyebrow: localized("CONTROL AND TRANSPARENCY", "KONTROLLE UND TRANSPARENZ"),
    title: localized(
      "A phone assistant, not an autonomous stranger.",
      "Ein Telefonassistent, kein autonom handelnder Fremder."
    ),
    text: localized(
      "SHPROHLI is designed for ordinary, low-risk calls. It is not intended for emergencies, harassment, mass marketing or high-stakes legal, medical or financial decisions.",
      "SHPROHLI ist für gewöhnliche, risikoarme Telefonate gedacht. Nicht vorgesehen sind Notfälle, Belästigung, Massenwerbung sowie rechtlich, medizinisch oder finanziell folgenreiche Verhandlungen."
    ),
    limitsTitle: localized("Your safeguards", "Ihre Schutzvorkehrungen"),
    limits: localizedList(
      ["You approve every call first.", "The recipient is told that an AI assistant is calling.", "Conversation processing and recording begin only after consent.", "You decide how long retained call audio is kept."],
      ["Sie geben jeden Anruf vorher frei.", "Die angerufene Person wird darüber informiert, dass ein KI-Assistent anruft.", "Gesprächsverarbeitung und Aufzeichnung beginnen erst nach Zustimmung.", "Sie bestimmen, wie lange gespeicherte Audioaufnahmen aufbewahrt werden."]
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000005",
    blockType: "languages",
    sortOrder: 6,
    enabled: true,
    title: localized(
      "Use the language that's easiest for you.",
      "Nutzen Sie die Sprache, die für Sie am einfachsten ist."
    ),
    text: localized(
      "The language of the website does not determine the language of the call. Choose the appropriate supported language separately for each conversation.",
      "Die Sprache der Website bestimmt nicht die Sprache des Telefonats. Für jeden Anruf wählen Sie die passende unterstützte Gesprächssprache separat aus."
    )
  },
  {
    id: "72000000-0000-4000-8000-000000000006",
    blockType: "faq",
    sortOrder: 7,
    enabled: true,
    eyebrow: localized("Frequently asked questions", "Häufig gestellte Fragen"),
    title: localized("What happens when SHPROHLI makes a call?", "Was passiert, wenn SHPROHLI einen Anruf führt?"),
    itemLimit: 7
  },
  {
    id: "72000000-0000-4000-8000-000000000007",
    blockType: "cta",
    sortOrder: 8,
    enabled: true,
    title: localized(
      "There's a call you've been putting off?",
      "Gibt es einen Anruf, den Sie schon länger vor sich herschieben?"
    ),
    text: localized(
      "Try SHPROHLI with three beta calls and see whether it can make that conversation easier.",
      "Probieren Sie SHPROHLI mit drei Beta-Anrufen aus und sehen Sie, ob der nächste Anruf dadurch einfacher wird."
    ),
    primaryCtaLabel: localized("Create an account", "Konto erstellen")
  }
];

export const seededEditorialCollections: SeedEditorialCollection[] = [
  {
    collectionId: "80000000-0000-4000-8000-000000000001",
    revision: {
      key: "faq",
      id: "81000000-0000-4000-8000-000000000011",
      number: 2,
      status: "published",
      createdByUserId: null,
      createdAt: refreshedLandingPublishedAt,
      updatedAt: refreshedLandingPublishedAt,
      publishedAt: refreshedLandingPublishedAt,
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
      id: "81000000-0000-4000-8000-000000000013",
      number: 2,
      status: "published",
      createdByUserId: null,
      createdAt: refreshedLandingPublishedAt,
      updatedAt: refreshedLandingPublishedAt,
      publishedAt: refreshedLandingPublishedAt,
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

function landingContentItem(
  sequence: number,
  enTitle: string,
  deTitle: string,
  enText: string,
  deText: string
) {
  return {
    id: `74000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    title: localized(enTitle, deTitle),
    text: localized(enText, deText)
  };
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
