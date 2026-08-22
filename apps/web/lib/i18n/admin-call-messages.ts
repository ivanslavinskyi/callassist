import type {
  CallBriefStatus,
  CallFailureStage,
  CallGoalResult,
  CallLocale,
  CallOutcomeProvenance,
  SemanticCallOutcome,
  TranscriptQualityRating
} from "@callassist/contracts";
import type { UiLocale } from "./messages";

const en = {
  eyebrow: "Call operations",
  title: "Admin Calls",
  intro: "Filter the privacy-minimized operational read model and open a technical Inspector. Call text, phone numbers and private comments are excluded by default.",
  privacyNote: "Default access contains technical metadata only. Sensitive content requires a separate superadmin action and immutable audit evidence.",
  loading: "Loading calls…",
  forbidden: "Administrator access is required.",
  signIn: "Sign in",
  filters: "Operational filters",
  status: "Status",
  outcome: "Outcome",
  consent: "Consent",
  failureStage: "Failure stage",
  language: "Call language",
  dateFrom: "Created from",
  dateTo: "Created to",
  all: "All",
  apply: "Apply filters",
  applying: "Applying…",
  clear: "Clear",
  loaded: (count: number) => `${count} ${count === 1 ? "call" : "calls"} loaded`,
  noCalls: "No calls match these filters.",
  loadMore: "Load more",
  loadingMore: "Loading…",
  inspect: "Open Inspector",
  owner: "Owner ID",
  created: "Created",
  duration: "Duration",
  eventCount: "Events",
  goalResult: "Goal feedback",
  transcriptQuality: "Transcript quality",
  notAvailable: "Not available",
  back: "Back to Admin Calls",
  inspectorEyebrow: "Technical Inspector",
  inspectorTitle: "Call Inspector",
  technical: "Technical state",
  connection: "Connection",
  recording: "Recording",
  transcription: "Transcription",
  failureCode: "Failure code",
  timeline: "Durable timeline",
  noTimeline: "No durable events are recorded for this call.",
  outcomeHistory: "Outcome provenance",
  noOutcomeHistory: "No outcome revisions are recorded.",
  revision: "Revision",
  sensitiveTitle: "Sensitive call content",
  sensitiveHelp: "Only superadmins can request this data. Enter the support or incident reason before access. The read is permanently audited.",
  sensitiveForbidden: "Your administrator role can inspect technical data but cannot access call content.",
  sensitiveReason: "Operational reason",
  sensitiveReasonPlaceholder: "e.g. Investigating support ticket 123",
  sensitiveAction: "Authorize and load content",
  sensitiveLoading: "Authorizing…",
  sensitiveWarning: "Sensitive content loaded under audited superadmin access. Do not copy it into unrelated systems.",
  recipient: "Recipient",
  phone: "Phone number",
  representedPerson: "Represented person",
  objective: "Objective",
  context: "Context",
  allowedFacts: "Allowed facts",
  liveTranscript: "Live transcript",
  finalTranscript: "Final transcript",
  feedbackComment: "Private feedback comment",
  empty: "None",
  listError: "Admin Calls could not be loaded. Check the filters and try again.",
  inspectorError: "The Call Inspector could not be loaded.",
  sensitiveError: "Sensitive content was not loaded. Check your permission and reason.",
  statuses: {
    review_required: "Review required",
    needs_clarification: "Needs clarification",
    blocked: "Blocked",
    ready: "Ready",
    dialing: "Dialing",
    in_progress: "In progress",
    awaiting_approval: "Awaiting approval",
    completed: "Completed",
    stopped: "Stopped",
    failed: "Failed"
  } satisfies Record<CallBriefStatus, string>,
  outcomes: {
    resolved: "Resolved",
    partially_resolved: "Partially resolved",
    unresolved: "Unresolved",
    wrong_recipient: "Wrong recipient",
    voicemail: "Voicemail",
    declined: "Declined",
    technical_failure: "Technical failure"
  } satisfies Record<SemanticCallOutcome, string>,
  consents: {
    not_recorded: "Not recorded",
    granted: "Granted",
    failed: "Failed"
  },
  failures: {
    policy: "Policy",
    provider: "Provider",
    consent: "Consent",
    recording: "Recording",
    realtime: "Realtime",
    transcription: "Transcription",
    recovery: "Recovery"
  } satisfies Record<CallFailureStage, string>,
  provenance: {
    system: "System",
    user: "User",
    staff: "Staff"
  } satisfies Record<CallOutcomeProvenance, string>,
  goalResults: { yes: "Yes", partly: "Partly", no: "No" } satisfies Record<
    CallGoalResult,
    string
  >,
  transcriptRatings: {
    good: "Good",
    some_errors: "Some errors",
    poor: "Poor"
  } satisfies Record<TranscriptQualityRating, string>,
  connections: { confirmed: "Confirmed", not_confirmed: "Not confirmed" },
  processStates: {
    not_recorded: "Not recorded",
    started: "Started",
    completed: "Completed",
    failed: "Failed"
  },
  languages: {
    "de-CH": "German (CH)",
    "de-DE": "German (DE)",
    "fr-CH": "French (CH)",
    "it-CH": "Italian (CH)",
    "en-GB": "English (UK)",
    "en-US": "English (US)",
    "ru-RU": "Russian"
  } satisfies Record<CallLocale, string>
} as const;

type StructuredMessageKey =
  "loaded" | "statuses" | "outcomes" | "consents" | "failures" |
  "provenance" | "goalResults" | "transcriptRatings" | "connections" |
  "processStates" | "languages";

type AdminCallMessages = {
  [Key in Exclude<keyof typeof en, StructuredMessageKey>]: string;
} & {
  loaded: (count: number) => string;
  statuses: Record<CallBriefStatus, string>;
  outcomes: Record<SemanticCallOutcome, string>;
  consents: Record<"not_recorded" | "granted" | "failed", string>;
  failures: Record<CallFailureStage, string>;
  provenance: Record<CallOutcomeProvenance, string>;
  goalResults: Record<CallGoalResult, string>;
  transcriptRatings: Record<TranscriptQualityRating, string>;
  connections: Record<"confirmed" | "not_confirmed", string>;
  processStates: Record<"not_recorded" | "started" | "completed" | "failed", string>;
  languages: Record<CallLocale, string>;
};

const de: AdminCallMessages = {
  ...en,
  eyebrow: "Anrufbetrieb",
  title: "Admin-Anrufe",
  intro: "Filtern Sie das datensparsame Betriebsmodell und öffnen Sie den technischen Inspector. Gesprächstext, Telefonnummern und private Kommentare sind standardmässig ausgeschlossen.",
  privacyNote: "Der Standardzugriff enthält nur technische Metadaten. Sensible Inhalte erfordern eine separate Superadmin-Aktion und einen unveränderlichen Auditnachweis.",
  loading: "Anrufe werden geladen…",
  forbidden: "Administratorzugriff ist erforderlich.",
  signIn: "Anmelden",
  filters: "Betriebsfilter",
  status: "Status",
  outcome: "Ergebnis",
  consent: "Einwilligung",
  failureStage: "Fehlerstufe",
  language: "Anrufsprache",
  dateFrom: "Erstellt ab",
  dateTo: "Erstellt bis",
  all: "Alle",
  apply: "Filter anwenden",
  applying: "Wird angewendet…",
  clear: "Zurücksetzen",
  loaded: (count) => `${count} Anrufe geladen`,
  noCalls: "Keine Anrufe entsprechen diesen Filtern.",
  loadMore: "Mehr laden",
  loadingMore: "Wird geladen…",
  inspect: "Inspector öffnen",
  owner: "Eigentümer-ID",
  created: "Erstellt",
  duration: "Dauer",
  eventCount: "Ereignisse",
  goalResult: "Zielbewertung",
  transcriptQuality: "Transkriptqualität",
  notAvailable: "Nicht verfügbar",
  back: "Zurück zu Admin-Anrufen",
  inspectorEyebrow: "Technischer Inspector",
  inspectorTitle: "Anruf-Inspector",
  technical: "Technischer Zustand",
  connection: "Verbindung",
  recording: "Aufzeichnung",
  transcription: "Transkription",
  failureCode: "Fehlercode",
  timeline: "Beständige Timeline",
  noTimeline: "Für diesen Anruf sind keine beständigen Ereignisse gespeichert.",
  outcomeHistory: "Ergebnisprovenienz",
  noOutcomeHistory: "Es sind keine Ergebnisrevisionen gespeichert.",
  revision: "Revision",
  sensitiveTitle: "Sensible Anrufinhalte",
  sensitiveHelp: "Nur Superadmins können diese Daten anfordern. Geben Sie vor dem Zugriff den Support- oder Vorfallgrund ein. Der Lesezugriff wird dauerhaft protokolliert.",
  sensitiveForbidden: "Ihre Administratorrolle kann technische Daten prüfen, aber nicht auf Anrufinhalte zugreifen.",
  sensitiveReason: "Betrieblicher Grund",
  sensitiveReasonPlaceholder: "z. B. Prüfung von Support-Ticket 123",
  sensitiveAction: "Autorisieren und Inhalte laden",
  sensitiveLoading: "Wird autorisiert…",
  sensitiveWarning: "Sensible Inhalte wurden unter protokolliertem Superadmin-Zugriff geladen. Kopieren Sie diese nicht in sachfremde Systeme.",
  recipient: "Empfänger",
  phone: "Telefonnummer",
  representedPerson: "Vertretene Person",
  objective: "Ziel",
  context: "Kontext",
  allowedFacts: "Erlaubte Fakten",
  liveTranscript: "Live-Transkript",
  finalTranscript: "Endgültiges Transkript",
  feedbackComment: "Privater Feedback-Kommentar",
  empty: "Keine",
  listError: "Admin-Anrufe konnten nicht geladen werden. Prüfen Sie die Filter und versuchen Sie es erneut.",
  inspectorError: "Der Anruf-Inspector konnte nicht geladen werden.",
  sensitiveError: "Sensible Inhalte wurden nicht geladen. Prüfen Sie Berechtigung und Grund.",
  statuses: {
    review_required: "Prüfung erforderlich",
    needs_clarification: "Klärung erforderlich",
    blocked: "Blockiert",
    ready: "Bereit",
    dialing: "Wird gewählt",
    in_progress: "Läuft",
    awaiting_approval: "Wartet auf Freigabe",
    completed: "Abgeschlossen",
    stopped: "Gestoppt",
    failed: "Fehlgeschlagen"
  },
  outcomes: {
    resolved: "Gelöst",
    partially_resolved: "Teilweise gelöst",
    unresolved: "Ungelöst",
    wrong_recipient: "Falscher Empfänger",
    voicemail: "Mailbox",
    declined: "Abgelehnt",
    technical_failure: "Technischer Fehler"
  },
  consents: {
    not_recorded: "Nicht erfasst",
    granted: "Erteilt",
    failed: "Fehlgeschlagen"
  },
  failures: {
    policy: "Richtlinie",
    provider: "Anbieter",
    consent: "Einwilligung",
    recording: "Aufzeichnung",
    realtime: "Realtime",
    transcription: "Transkription",
    recovery: "Wiederherstellung"
  },
  provenance: { system: "System", user: "Benutzer", staff: "Mitarbeitende" },
  goalResults: { yes: "Ja", partly: "Teilweise", no: "Nein" },
  transcriptRatings: {
    good: "Gut",
    some_errors: "Einige Fehler",
    poor: "Schlecht"
  },
  connections: { confirmed: "Bestätigt", not_confirmed: "Nicht bestätigt" },
  processStates: {
    not_recorded: "Nicht erfasst",
    started: "Gestartet",
    completed: "Abgeschlossen",
    failed: "Fehlgeschlagen"
  },
  languages: {
    "de-CH": "Deutsch (CH)",
    "de-DE": "Deutsch (DE)",
    "fr-CH": "Französisch (CH)",
    "it-CH": "Italienisch (CH)",
    "en-GB": "Englisch (UK)",
    "en-US": "Englisch (US)",
    "ru-RU": "Russisch"
  }
};

export const adminCallMessages: Record<UiLocale, AdminCallMessages> = {
  en,
  de
};
