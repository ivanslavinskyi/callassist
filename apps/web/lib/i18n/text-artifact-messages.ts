import type { UiLocale } from "./messages";

export const textArtifactMessages = {
  en: {
    original: "Original", translated: "Translation", originalPlan: "In the call language",
    loading: "Preparing the translation…", failed: "The translation is unavailable. Try again or explicitly choose the original.",
    stale: "The source changed. This translation cannot be used for the current version.",
    refresh: "Refresh", retry: "Try again", translateTo: "Translate to",
    translationUnavailable: "The translation is unavailable. The original is shown below.",
    summary: "Call result", summaryLoading: "Preparing the call result…", summaryMissing: "The call result is not available yet.",
    createSummary: "Create result", summaryFailed: "The call result could not be prepared.",
    nextSteps: "Next steps", unresolved: "Still unclear", evidence: "Source", reported: "Reported in the call",
    conditional: "Conditional", unknown: "Not established", noAnswers: "No supported answers were found.",
    originalSource: "Original transcript", translationNote: "AI translation. The original remains available for checking details.",
    generationError: "This text could not be prepared. Please try again.",
    unsupported: "This language or translation direction is not available yet.",
    checkingAvailability: "Checking available text features…", availabilityError: "Text feature availability could not be checked. Refresh to try again.",
    generationDisabled: "New translations and call results are currently disabled. Saved text and the original remain available.",
    rateLimited: "The translation limit has been reached. Please try again later.",
    pending: "Still processing. You can refresh the status or return later.",
    sourceRevision: "Source revision", copy: "Copy displayed text", copied: "Copied", exportPdf: "Download PDF", exporting: "Preparing PDF…", exportError: "Export failed. Please try again."
  },
  de: {
    original: "Original", translated: "Übersetzung", originalPlan: "In der Anrufsprache",
    loading: "Die Übersetzung wird erstellt…", failed: "Die Übersetzung ist nicht verfügbar. Versuchen Sie es erneut oder wählen Sie ausdrücklich das Original.",
    stale: "Die Quelle wurde geändert. Diese Übersetzung kann nicht für die aktuelle Version verwendet werden.",
    refresh: "Aktualisieren", retry: "Erneut versuchen", translateTo: "Übersetzen auf",
    translationUnavailable: "Die Übersetzung ist nicht verfügbar. Das Original wird unten angezeigt.",
    summary: "Gesprächsergebnis", summaryLoading: "Das Gesprächsergebnis wird erstellt…", summaryMissing: "Das Gesprächsergebnis ist noch nicht verfügbar.",
    createSummary: "Ergebnis erstellen", summaryFailed: "Das Gesprächsergebnis konnte nicht erstellt werden.",
    nextSteps: "Nächste Schritte", unresolved: "Noch unklar", evidence: "Quelle", reported: "Im Gespräch genannt",
    conditional: "An Bedingungen geknüpft", unknown: "Nicht geklärt", noAnswers: "Es wurden keine belegten Antworten gefunden.",
    originalSource: "Originaltranskript", translationNote: "KI-Übersetzung. Das Original bleibt zum Prüfen von Details verfügbar.",
    generationError: "Dieser Text konnte nicht erstellt werden. Bitte versuchen Sie es erneut.",
    unsupported: "Diese Sprache oder Übersetzungsrichtung ist noch nicht verfügbar.",
    checkingAvailability: "Verfügbare Textfunktionen werden geprüft…", availabilityError: "Die Verfügbarkeit der Textfunktionen konnte nicht geprüft werden. Aktualisieren Sie die Ansicht, um es erneut zu versuchen.",
    generationDisabled: "Neue Übersetzungen und Gesprächsergebnisse sind derzeit deaktiviert. Gespeicherte Texte und das Original bleiben verfügbar.",
    rateLimited: "Das Übersetzungslimit wurde erreicht. Bitte versuchen Sie es später erneut.",
    pending: "Die Verarbeitung läuft noch. Sie können den Status aktualisieren oder später zurückkehren.",
    sourceRevision: "Quellversion", copy: "Angezeigten Text kopieren", copied: "Kopiert", exportPdf: "PDF herunterladen", exporting: "PDF wird erstellt…", exportError: "Export fehlgeschlagen. Bitte versuchen Sie es erneut."
  }
} satisfies Record<UiLocale, Record<string, string>>;
