export const uiLocales = ["en", "de"] as const;
export type UiLocale = (typeof uiLocales)[number];

const enFormCopy = {
  newBrief: "New call brief",
  editBrief: "Edit call brief",
  defaultHeading: "Who are we calling, and why?",
  aiCall: "AI call",
  recipient: "Organisation or recipient",
  recipientPlaceholder: "e.g. Dr. Schmidt or Example Council",
  phone: "Phone number",
  callLanguage: "Call language",
  objective: "What should the assistant do?",
  objectivePlaceholder: "Describe the goal naturally, in any language.",
  objectiveHelp: "Formal addressing, tone, and spoken-answer handling use safe defaults.",
  assistant: "AI assistant",
  maleVoice: "Male voice",
  femaleVoice: "Female voice",
  assistanceReason: "Reason for assistance",
  speechImpairment: "Speech impairment",
  languageBarrier: "Language barrier",
  representedPersonFirstName: "Represented person's first name",
  representedPersonFirstNamePlaceholder: "e.g. John",
  representedPersonLastName: "Represented person's last name",
  representedPersonLastNamePlaceholder: "e.g. Doe",
  optionsHelp: "Safe defaults work for most calls. Change only what matters for this conversation.",
  result: "Result",
  captureResult: "Save the spoken answer in CallAssist",
  externalDelivery: "Ask the recipient to send something",
  messageOnly: "Deliver a message only",
  addressing: "Addressing",
  formalDefault: "Formal (default)",
  automaticRelationship: "Automatic by relationship",
  informal: "Informal",
  tone: "Tone",
  automatic: "Automatic",
  formal: "Formal",
  neutral: "Neutral",
  friendly: "Friendly",
  voicemail: "Voicemail",
  noCallDetails: "Do not leave call details",
  neutralMessage: "Leave a neutral message",
  deliveryInstruction: "Delivery instruction",
  deliveryPlaceholder: "For example: ask them to send it to John via the agreed channel",
  audioRetention: "Audio retention",
  deleteAfterTranscript: "Delete after final transcript",
  keepSevenDays: "Keep for 7 days",
  keepThirtyDays: "Keep for 30 days",
  additionalContext: "Additional context",
  contextPlaceholder: "Relevant background, correspondence or organisation details",
  allowLanguageSwitching: "Allow language switching",
  languageSwitchHelp: "The assistant may use one selected fallback language.",
  fallbackLanguage: "Fallback language",
  shareableInformation: "Information the assistant may share",
  shareableInformationHelp: "Optional. Enter actual verified facts, one per line. Examples are never prefilled.",
  approvedInformation: "Approved information",
  approvedInformationPlaceholder: "Full name: John Doe\nRequest sent: 12 July 2026",
  cancel: "Cancel",
  preparing: "Preparing…",
  reviewCall: "Review call"
} as const;

type FormCopy = { [Key in keyof typeof enFormCopy]: string };

type ReviewCopy = {
  preview: string; ready: string; clarificationNeeded: string; changesNeeded: string;
  conversationSettings: string; opening: string; questions: string;
  addMissingDetail: string; clarificationHelp: string; blockedReason: string;
  edit: string; starting: string; approveAndCall: string; technicalDetails: string;
  originalObjective: string; successMeans: string; defaultsUsed: string;
  approvedInformation: string; none: string; guardrails: string;
  revision: string; schema: string; policy: string; compiler: string; snapshot: string;
  updating: string; continue: string;
  tone: Record<"formal" | "neutral" | "friendly", string>;
  addressing: Record<"formal" | "informal", string>;
  result: Record<"capture_in_callassist" | "request_external_delivery" | "message_only", string>;
  assumption: Record<
    "spoken_answers_saved_in_callassist" | "addressing_inferred" | "tone_inferred" |
    "no_detailed_voicemail" | "neutral_voicemail_only" | "respect_refusal_and_end", string>;
  reason: Record<import("@callassist/contracts").CallCompilation["policyDecision"]["reasonCodes"][number], string>;
};

export type Messages = {
  app: {
    homeLabel: string;
    consoleLabel: string;
    interfaceLanguage: string;
    switchToLightTheme: string;
    switchToDarkTheme: string;
    skipToContent: string;
    defaultTitle: string;
    newCall: string;
    history: string;
    account: string;
    signIn: string;
    createAccount: string;
    privacy: string;
    terms: string;
    acceptableUse: string;
    support: string;
    faq: string;
    optOut: string;
    redeem: string;
    adminPortal: string;
    creditsRemaining: (count: number) => string;
  };
  dialog: {
    cancel: string;
  };
  call: {
    approveTitle: string;
    approveBody: (recipient: string) => string;
    approveConfirm: string;
    deleteAudioTitle: string;
    deleteAudioBody: string;
    deleteAudioConfirm: string;
  };
  dashboard: {
    eyebrow: string;
    titleStart: string;
    titleAccent: string;
    lead: string;
    historyEyebrow: string;
    historyTitle: string;
    emptyTitle: string;
    emptyText: string;
    privacyTitle: string;
    privacyText: string;
    openBrief: (recipient: string) => string;
    loading: string;
    loadErrorTitle: string;
    loadErrorText: string;
    retry: string;
    searchLabel: string;
    searchPlaceholder: string;
    statusLabel: string;
    allStatuses: string;
    loadMore: string;
    loadingMore: string;
    noMatchesTitle: string;
    noMatchesText: string;
    status: Record<import("@callassist/contracts").CallBriefStatus, string>;
  };
  form: {
    disclosurePreview: string;
    disclosureHelp: string;
    preparingTitle: string;
    preparingText: string;
    phoneValid: string;
    phoneInvalid: string;
    requiredComplete: string;
    requiredRemaining: (count: number) => string;
    rateLimited: string;
    navigationError: string;
    callOptions: string;
    copy: FormCopy;
  };
  review: ReviewCopy;
  live: {
    connecting: string;
    connected: string;
    reconnecting: string;
    jumpToLatest: string;
    actionError: string;
    insufficientCredits: string;
    concurrentCall: string;
    recipientSuppressed: string;
    outboundCallsDisabled: string;
    callLimitReached: string;
    rateLimited: string;
    loadError: string;
    copied: string;
    copyFailed: string;
    copyTranscript: string;
    copiedAnnouncement: string;
    copyFailedAnnouncement: string;
    showObjective: string;
    hideObjective: string;
    breadcrumbLabel: string;
    allCallBriefs: string;
    callPageTitle: (recipient: string) => string;
    status: Record<import("@callassist/contracts").CallBriefStatus, string>;
    recordingStatus: Record<import("@callassist/contracts").CallRecordingStatus, string>;
    finalTranscriptStatus: Record<import("@callassist/contracts").FinalTranscriptStatus, string>;
    loadingBrief: string; unavailableTitle: string; returnDashboard: string;
    activeBrief: string; startCall: string; stopCall: string;
    updateHeading: string; updatePlan: string; legacyBrief: string;
    legacyTitle: string; legacyHelp: string; liveTranscriptEyebrow: string;
    liveCaptions: string; liveTranscriptHelp: string; transcriptEmptyTitle: string;
    transcriptEmptyHelp: string; liveTime: string; decisionRequired: string;
    assistantWillSay: string; approve: string; doNotDisclose: string;
    terminalHelp: string; safetyActive: string; safetyHelp: string;
    briefEyebrow: string; objectiveTitle: string; primaryLanguage: string;
    languageSwitching: string; disabled: string; voice: string; female: string;
    male: string; assistanceReason: string; languageBarrier: string;
    speechImpairment: string; audioRetention: string; untilFinalTranscript: string;
    retentionDays: (days: number) => string; assistant: string;
    finalEyebrow: string; finalTitle: string; finalHelp: string;
    preparingPdf: string; pdfFailed: string; downloadPdf: string; pdfFailedAnnouncement: string;
    unassignedSpeaker: string; fullRecordingTranscript: string; structuredTranscriptNote: string;
    plainTranscriptNote: string; aiWarning: string; regenerateTranscript: string;
    finalFailed: string; finalFailedHelp: string; retryTranscription: string;
    creatingFinal: string; creatingFinalHelp: string; recordingNotStarted: string;
    recordingNotStartedHelp: string; noRecording: string; noRecordingHelp: string;
    availableAfterCall: string; availableAfterCallHelp: string; consentAudio: string;
    deleted: string; available: string; audioUnsupported: string; deleteAudioNow: string;
    audioDeleted: string; retentionImmediate: string;
    retentionScheduled: (date: string) => string; retentionAutomatic: (days: number) => string;
    feedbackEyebrow: string; feedbackTitle: string; feedbackHelp: string;
    feedbackGoalQuestion: string;
    feedbackGoal: Record<import("@callassist/contracts").CallGoalResult, string>;
    feedbackTranscriptQuestion: string;
    feedbackTranscriptQuality: Record<import("@callassist/contracts").TranscriptQualityRating, string>;
    feedbackTranscriptUnavailable: string; feedbackCommentLabel: string;
    feedbackCommentPlaceholder: string; feedbackCommentHint: string;
    feedbackSave: string; feedbackUpdate: string; feedbackSaving: string;
    feedbackSaved: string; feedbackError: string;
    dataDeletionTitle: string; dataDeletionText: string;
    dataDeletionRetained: string; dataDeletionPassword: string;
    dataDeletionConfirmation: string; dataDeletionConfirmationHint: string;
    dataDeletionAction: string; dataDeletionBusy: string;
    dataDeletionInvalidPassword: string; dataDeletionError: string;
  };
};

const enReview: ReviewCopy = {
  preview: "Call preview", ready: "Ready to call", clarificationNeeded: "One detail is needed",
  changesNeeded: "This call needs changes", conversationSettings: "Conversation settings",
  opening: "How the assistant will open the call", questions: "What the assistant will ask or say",
  addMissingDetail: "Add the missing detail here",
  clarificationHelp: "Your existing brief will be updated. You will not need to fill it in again.",
  blockedReason: "Why this cannot be called yet", edit: "Edit brief", starting: "Starting…",
  approveAndCall: "Approve & call", technicalDetails: "Technical details",
  originalObjective: "Original objective", successMeans: "Success means",
  defaultsUsed: "Product defaults used", approvedInformation: "Approved information",
  none: "None", guardrails: "Guardrails", revision: "Revision", schema: "Schema",
  policy: "Policy", compiler: "Compiler", snapshot: "Snapshot", updating: "Updating…",
  continue: "Continue",
  tone: { formal: "Formal tone", neutral: "Neutral tone", friendly: "Friendly tone" },
  addressing: { formal: "Formal addressing", informal: "Informal addressing" },
  result: { capture_in_callassist: "Answers saved in CallAssist", request_external_delivery: "External delivery requested", message_only: "Message only" },
  assumption: {
    spoken_answers_saved_in_callassist: "Spoken answers are saved in CallAssist.",
    addressing_inferred: "Addressing is inferred from the relationship and recipient.",
    tone_inferred: "Tone is inferred from the relationship and purpose.",
    no_detailed_voicemail: "No call details are left on voicemail.",
    neutral_voicemail_only: "Only a neutral voicemail message may be left.",
    respect_refusal_and_end: "A refusal is respected and the call ends politely."
  },
  reason: {
    input_moderation_flagged: "The source brief was flagged by input moderation.",
    model_refusal: "The compiler refused to create an executable plan.",
    prohibited_content: "The brief contains a category outside the current low-risk scope.",
    material_ambiguity: "A legacy brief contains an unresolved material ambiguity.",
    required_information_missing: "Required information is missing.",
    fact_integrity_failure: "Approved information was not preserved exactly.",
    plan_constraint_failure: "The generated plan did not preserve a selected call option.",
    unsupported_task: "This task type is outside the current MVP scope."
  }
};

const deReview: ReviewCopy = {
  preview: "Anrufvorschau", ready: "Bereit zum Anrufen", clarificationNeeded: "Eine Angabe fehlt",
  changesNeeded: "Dieser Anruf muss geändert werden", conversationSettings: "Gesprächseinstellungen",
  opening: "So beginnt der Assistent den Anruf", questions: "Was der Assistent fragt oder sagt",
  addMissingDetail: "Fehlende Angabe ergänzen",
  clarificationHelp: "Ihr bestehender Entwurf wird aktualisiert. Sie müssen ihn nicht erneut ausfüllen.",
  blockedReason: "Warum dieser Anruf noch nicht möglich ist", edit: "Entwurf bearbeiten",
  starting: "Wird gestartet…", approveAndCall: "Genehmigen und anrufen",
  technicalDetails: "Technische Details", originalObjective: "Ursprüngliches Ziel",
  successMeans: "Erfolg bedeutet", defaultsUsed: "Verwendete Produktstandardwerte",
  approvedInformation: "Freigegebene Informationen", none: "Keine", guardrails: "Schutzregeln",
  revision: "Revision", schema: "Schema", policy: "Richtlinie", compiler: "Compiler",
  snapshot: "Snapshot", updating: "Wird aktualisiert…", continue: "Weiter",
  tone: { formal: "Formeller Ton", neutral: "Neutraler Ton", friendly: "Freundlicher Ton" },
  addressing: { formal: "Formelle Anrede", informal: "Informelle Anrede" },
  result: { capture_in_callassist: "Antworten werden in CallAssist gespeichert", request_external_delivery: "Externe Zustellung angefragt", message_only: "Nur Nachricht" },
  assumption: {
    spoken_answers_saved_in_callassist: "Gesprochene Antworten werden in CallAssist gespeichert.",
    addressing_inferred: "Die Anrede wird aus Beziehung und empfangender Person abgeleitet.",
    tone_inferred: "Der Ton wird aus Beziehung und Zweck abgeleitet.",
    no_detailed_voicemail: "Auf der Mailbox werden keine Anrufdetails hinterlassen.",
    neutral_voicemail_only: "Es darf nur eine neutrale Mailbox-Nachricht hinterlassen werden.",
    respect_refusal_and_end: "Eine Ablehnung wird respektiert und der Anruf höflich beendet."
  },
  reason: {
    input_moderation_flagged: "Der Ausgangsentwurf wurde von der Inhaltsprüfung markiert.",
    model_refusal: "Der Compiler hat keinen ausführbaren Plan erstellt.",
    prohibited_content: "Der Entwurf liegt ausserhalb des derzeit erlaubten risikoarmen Bereichs.",
    material_ambiguity: "Ein älterer Entwurf enthält eine ungeklärte wesentliche Mehrdeutigkeit.",
    required_information_missing: "Erforderliche Informationen fehlen.",
    fact_integrity_failure: "Freigegebene Informationen wurden nicht exakt bewahrt.",
    plan_constraint_failure: "Der erstellte Plan hat eine gewählte Anrufoption nicht bewahrt.",
    unsupported_task: "Dieser Aufgabentyp liegt ausserhalb des aktuellen MVP-Umfangs."
  }
};

const en: Messages = {
  app: {
    homeLabel: "CallAssist — home",
    consoleLabel: "Private call console",
    interfaceLanguage: "Interface language",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    skipToContent: "Skip to main content",
    defaultTitle: "CallAssist — controlled AI phone calls",
    newCall: "New call",
    history: "History",
    account: "Account",
    signIn: "Sign in",
    createAccount: "Try the beta",
    privacy: "Privacy",
    terms: "Terms",
    acceptableUse: "Acceptable use",
    support: "Support",
    faq: "FAQ",
    optOut: "Stop calls",
    redeem: "Redeem",
    adminPortal: "Admin",
    creditsRemaining: (count: number) =>
      `${count} call ${count === 1 ? "credit" : "credits"}`
  },
  dialog: {
    cancel: "Cancel"
  },
  call: {
    approveTitle: "Start this phone call?",
    approveBody: (recipient: string) =>
      `You are approving the reviewed plan and immediately starting a real phone call to ${recipient}.`,
    approveConfirm: "Approve & start call",
    deleteAudioTitle: "Permanently delete this audio?",
    deleteAudioBody:
      "The consent-gated recording will be permanently deleted and cannot be recovered. The transcript is not deleted.",
    deleteAudioConfirm: "Delete audio permanently"
  },
  dashboard: {
    eyebrow: "Personal voice agent",
    titleStart: "Every call under",
    titleAccent: " your control.",
    lead: "Set the objective and language. CallAssist handles the conversation, streams a live draft, and creates a more accurate transcript after the call.",
    historyEyebrow: "History",
    historyTitle: "Recent call briefs",
    emptyTitle: "Your calls will appear here",
    emptyText: "Create your first brief to get started.",
    privacyTitle: "Consent first.",
    privacyText: "Audio recording starts only after the recipient presses 1 and is deleted according to the selected retention period.",
    openBrief: (recipient: string) => `Open call brief for ${recipient}`,
    loading: "Loading recent call briefs…",
    loadErrorTitle: "Could not load call history",
    loadErrorText: "Check the API connection and try again.",
    retry: "Try again",
    searchLabel: "Search call history",
    searchPlaceholder: "Search by recipient",
    statusLabel: "Filter by status",
    allStatuses: "All statuses",
    loadMore: "Load more",
    loadingMore: "Loading…",
    noMatchesTitle: "No matching calls",
    noMatchesText: "Change the search or status filter and try again.",
    status: {
      review_required: "Ready to call", needs_clarification: "Needs one detail",
      blocked: "Blocked", ready: "Ready", dialing: "Dialing",
      in_progress: "In progress", awaiting_approval: "Decision required",
      completed: "Completed", stopped: "Stopped", failed: "Failed"
    }
  },
  form: {
    disclosurePreview: "Disclosure preview",
    disclosureHelp: "Generated automatically from the selected call language and assistance reason.",
    preparingTitle: "AI is reviewing your call plan…",
    preparingText: "This can take around a minute. Keep this page open; your entries are preserved if it fails.",
    phoneValid: "Valid Swiss phone number",
    phoneInvalid: "During the public beta CallAssist can only call Swiss phone numbers, for example +41710000000",
    requiredComplete: "All required fields complete",
    requiredRemaining: (count: number) => `${count} required ${count === 1 ? "field" : "fields"} remaining`,
    rateLimited: "Too many call-planning requests. Wait a moment and try again.",
    navigationError: "The call was prepared, but its review page could not be opened. Select Review call again to open the existing brief.",
    callOptions: "Call options",
    copy: enFormCopy
  },
  review: enReview,
  live: {
    connecting: "Connecting to live updates…",
    connected: "Live updates connected",
    reconnecting: "Live updates interrupted — reconnecting…",
    jumpToLatest: "Jump to latest",
    actionError: "The action could not be completed. Try again.",
    insufficientCredits: "You have no call credits remaining.",
    concurrentCall: "Finish your active call before starting another one.",
    recipientSuppressed: "This recipient has opted out and cannot be called.",
    outboundCallsDisabled: "New calls are temporarily paused. Try again later.",
    callLimitReached: "Your public-beta call limit has been reached. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    loadError: "The call brief was not found or the API is unavailable.",
    copied: "Copied",
    copyFailed: "Copy failed — retry",
    copyTranscript: "Copy transcript",
    copiedAnnouncement: "Final transcript copied to clipboard.",
    copyFailedAnnouncement: "The final transcript could not be copied.",
    showObjective: "Show full objective",
    hideObjective: "Collapse objective",
    breadcrumbLabel: "Breadcrumb",
    allCallBriefs: "All call briefs",
    callPageTitle: (recipient: string) => `${recipient} — CallAssist`,
    status: {
      review_required: "Ready to call", needs_clarification: "Needs one detail",
      blocked: "Blocked by policy", ready: "Ready to start", dialing: "Dialing",
      in_progress: "Call in progress", awaiting_approval: "Awaiting decision",
      completed: "Call completed", stopped: "Call stopped", failed: "Call failed"
    },
    recordingStatus: {
      starting: "Starting", recording: "Recording", processing: "Processing",
      available: "Available", failed: "Failed", deleted: "Deleted"
    },
    finalTranscriptStatus: {
      processing: "Processing", completed: "Completed", failed: "Failed"
    },
    loadingBrief: "Loading call brief…", unavailableTitle: "Call brief unavailable",
    returnDashboard: "Return to dashboard", activeBrief: "Active call brief",
    startCall: "Start call", stopCall: "Stop call", updateHeading: "Update this call",
    updatePlan: "Update call plan", legacyBrief: "Legacy call brief",
    legacyTitle: "This brief cannot be started",
    legacyHelp: "It was created before the compiler and policy boundary. Recreate it from the dashboard to generate a reviewable call plan.",
    liveTranscriptEyebrow: "Live transcript · realtime draft", liveCaptions: "Live captions",
    liveTranscriptHelp: "Appears during the call. Fast, provisional, and may contain recognition errors.",
    transcriptEmptyTitle: "The transcript will appear here",
    transcriptEmptyHelp: "After the recipient consents, each turn will appear here in real time. This fast transcript may contain recognition errors.",
    liveTime: "live", decisionRequired: "Decision required", assistantWillSay: "The assistant will say",
    approve: "Approve", doNotDisclose: "Do not disclose",
    terminalHelp: "This call has ended. Review the call results below.",
    safetyActive: "Safety gate active", safetyHelp: "Private data cannot enter the conversation without your approval.",
    briefEyebrow: "Call brief", objectiveTitle: "Call objective", primaryLanguage: "Primary language",
    languageSwitching: "Language switching", disabled: "Disabled", voice: "Voice",
    female: "Female", male: "Male", assistanceReason: "Reason for assistance",
    languageBarrier: "Language barrier", speechImpairment: "Speech impairment",
    audioRetention: "Audio retention", untilFinalTranscript: "Until final transcript",
    retentionDays: (days: number) => `${days} days`, assistant: "Assistant",
    finalEyebrow: "Final transcript · recording-based", finalTitle: "Post-call transcription",
    finalHelp: "Created after the call from the complete consented recording.",
    preparingPdf: "Preparing PDF…", pdfFailed: "PDF failed — retry", downloadPdf: "Download PDF",
    pdfFailedAnnouncement: "The PDF could not be created.", unassignedSpeaker: "Unassigned speaker",
    fullRecordingTranscript: "Full-recording transcript",
    structuredTranscriptNote: "The wording comes only from the consented recording. Roles are determined by the separate call channels and timestamps are approximate; live draft words are never copied.",
    plainTranscriptNote: "The wording comes from one complete-recording pass and is not merged with the live draft. A reliable role/time alignment was not available for this call.",
    aiWarning: "The result remains AI-generated; check critical details against the audio.",
    regenerateTranscript: "Regenerate final transcript", finalFailed: "Final transcription failed",
    finalFailedHelp: "The recording is still available. You can retry safely.", retryTranscription: "Retry transcription",
    creatingFinal: "Creating the final transcript", creatingFinalHelp: "The complete recording is being processed after the call.",
    recordingNotStarted: "Recording was not started", recordingNotStartedHelp: "The conversation did not continue after consent.",
    noRecording: "No recording available", noRecordingHelp: "The call ended before a consent-gated recording was started.",
    availableAfterCall: "Available after the call", availableAfterCallHelp: "Recording begins only after consent. The final transcript is generated when the provider finishes the recording.",
    consentAudio: "Consent-gated audio", deleted: "Deleted", available: "Available",
    audioUnsupported: "Your browser does not support audio playback.", deleteAudioNow: "Delete audio now",
    audioDeleted: "The provider audio has been permanently deleted.",
    retentionImmediate: "Deleted automatically after the final transcript is created.",
    retentionScheduled: (date: string) => `Scheduled for deletion on ${date}.`,
    retentionAutomatic: (days: number) => `Deleted automatically ${days} days after the final transcript is created.`,
    feedbackEyebrow: "Your assessment",
    feedbackTitle: "How did this call go?",
    feedbackHelp: "Your answer describes the task result. A completed phone connection alone is never treated as success.",
    feedbackGoalQuestion: "Was the call goal achieved?",
    feedbackGoal: { yes: "Yes", partly: "Partly", no: "No" },
    feedbackTranscriptQuestion: "How accurate is the final transcript?",
    feedbackTranscriptQuality: {
      good: "Good",
      some_errors: "Some errors",
      poor: "Poor"
    },
    feedbackTranscriptUnavailable: "Transcript quality can be rated after the final transcript is available.",
    feedbackCommentLabel: "Optional comment",
    feedbackCommentPlaceholder: "What worked, or what should be improved?",
    feedbackCommentHint: "Maximum 500 characters. This comment remains private.",
    feedbackSave: "Save feedback",
    feedbackUpdate: "Update feedback",
    feedbackSaving: "Saving…",
    feedbackSaved: "Feedback saved.",
    feedbackError: "Feedback could not be saved. Try again.",
    dataDeletionTitle: "Delete this call's data",
    dataDeletionText: "Permanently removes the call brief, transcripts, approval text, feedback comment, and provider audio. This call disappears from your history and exports.",
    dataDeletionRetained: "Minimized credit, consent, safety, technical, and audit evidence is retained without the call content. This cannot be undone.",
    dataDeletionPassword: "Current password",
    dataDeletionConfirmation: "Type DELETE to confirm",
    dataDeletionConfirmationHint: "Enter the exact uppercase word DELETE.",
    dataDeletionAction: "Delete call data permanently",
    dataDeletionBusy: "Deleting call data…",
    dataDeletionInvalidPassword: "The current password is incorrect.",
    dataDeletionError: "The call data could not be deleted. No success was recorded; wait and retry."
  }
};

const de: Messages = {
  app: {
    homeLabel: "CallAssist — Startseite",
    consoleLabel: "Private Anrufkonsole",
    interfaceLanguage: "Sprache der Benutzeroberfläche",
    switchToLightTheme: "Zum hellen Design wechseln",
    switchToDarkTheme: "Zum dunklen Design wechseln",
    skipToContent: "Zum Hauptinhalt springen",
    defaultTitle: "CallAssist — kontrollierte KI-Telefonanrufe",
    newCall: "Neuer Anruf",
    history: "Verlauf",
    account: "Konto",
    signIn: "Anmelden",
    createAccount: "Beta testen",
    privacy: "Datenschutz",
    terms: "Bedingungen",
    acceptableUse: "Nutzungsregeln",
    support: "Support",
    faq: "FAQ",
    optOut: "Anrufe sperren",
    redeem: "Code einlösen",
    adminPortal: "Admin",
    creditsRemaining: (count: number) => `${count} Anrufguthaben`
  },
  dialog: {
    cancel: "Abbrechen"
  },
  call: {
    approveTitle: "Diesen Anruf starten?",
    approveBody: (recipient: string) =>
      `Sie genehmigen den geprüften Plan und starten sofort einen echten Telefonanruf an ${recipient}.`,
    approveConfirm: "Genehmigen und anrufen",
    deleteAudioTitle: "Diese Aufnahme endgültig löschen?",
    deleteAudioBody:
      "Die nach der Einwilligung erstellte Aufnahme wird endgültig gelöscht und kann nicht wiederhergestellt werden. Das Transkript bleibt erhalten.",
    deleteAudioConfirm: "Aufnahme endgültig löschen"
  },
  dashboard: {
    eyebrow: "Persönlicher Sprachassistent",
    titleStart: "Jeder Anruf unter",
    titleAccent: " Ihrer Kontrolle.",
    lead: "Legen Sie Ziel und Sprache fest. CallAssist führt das Gespräch, zeigt einen Live-Entwurf und erstellt danach ein genaueres Transkript.",
    historyEyebrow: "Verlauf",
    historyTitle: "Letzte Anrufentwürfe",
    emptyTitle: "Ihre Anrufe erscheinen hier",
    emptyText: "Erstellen Sie den ersten Anrufentwurf.",
    privacyTitle: "Einwilligung zuerst.",
    privacyText: "Die Audioaufnahme beginnt erst, nachdem die empfangende Person die 1 gedrückt hat, und wird gemäss der gewählten Aufbewahrungsfrist gelöscht.",
    openBrief: (recipient: string) => `Anrufentwurf für ${recipient} öffnen`,
    loading: "Letzte Anrufentwürfe werden geladen…",
    loadErrorTitle: "Anrufverlauf konnte nicht geladen werden",
    loadErrorText: "Prüfen Sie die API-Verbindung und versuchen Sie es erneut.",
    retry: "Erneut versuchen",
    searchLabel: "Anrufverlauf durchsuchen",
    searchPlaceholder: "Nach empfangender Person suchen",
    statusLabel: "Nach Status filtern",
    allStatuses: "Alle Status",
    loadMore: "Mehr laden",
    loadingMore: "Wird geladen…",
    noMatchesTitle: "Keine passenden Anrufe",
    noMatchesText: "Ändern Sie Suche oder Statusfilter und versuchen Sie es erneut.",
    status: {
      review_required: "Bereit zum Anrufen", needs_clarification: "Eine Angabe fehlt",
      blocked: "Blockiert", ready: "Bereit", dialing: "Wird gewählt",
      in_progress: "Anruf läuft", awaiting_approval: "Entscheidung erforderlich",
      completed: "Abgeschlossen", stopped: "Gestoppt", failed: "Fehlgeschlagen"
    }
  },
  form: {
    disclosurePreview: "Vorschau der Offenlegung",
    disclosureHelp: "Wird automatisch aus Anrufsprache und Unterstützungsgrund erstellt.",
    preparingTitle: "Die KI prüft Ihren Anrufplan…",
    preparingText: "Dies kann etwa eine Minute dauern. Lassen Sie diese Seite geöffnet; bei einem Fehler bleiben Ihre Eingaben erhalten.",
    phoneValid: "Gültige Schweizer Telefonnummer",
    phoneInvalid: "Während der öffentlichen Beta kann CallAssist nur Schweizer Telefonnummern anrufen, zum Beispiel +41710000000",
    requiredComplete: "Alle Pflichtfelder sind ausgefüllt",
    requiredRemaining: (count: number) => `${count} ${count === 1 ? "Pflichtfeld ist" : "Pflichtfelder sind"} noch offen`,
    rateLimited: "Zu viele Anfragen zur Anrufplanung. Warten Sie kurz und versuchen Sie es erneut.",
    navigationError: "Der Anrufentwurf wurde erstellt, aber die Pr\u00fcfseite konnte nicht ge\u00f6ffnet werden. W\u00e4hlen Sie erneut \u201eAnruf pr\u00fcfen\u201c, um den bestehenden Entwurf zu \u00f6ffnen.",
    callOptions: "Anrufoptionen",
    copy: {
      newBrief: "Neuer Anrufentwurf",
      editBrief: "Anrufentwurf bearbeiten",
      defaultHeading: "Wen rufen wir an und warum?",
      aiCall: "KI-Anruf",
      recipient: "Organisation oder empfangende Person",
      recipientPlaceholder: "z. B. Dr. Schmidt oder Beispielgemeinde",
      phone: "Telefonnummer",
      callLanguage: "Anrufsprache",
      objective: "Was soll der Assistent tun?",
      objectivePlaceholder: "Beschreiben Sie das Ziel in einer beliebigen Sprache.",
      objectiveHelp: "Formelle Anrede, Ton und Verarbeitung gesprochener Antworten verwenden sichere Standardwerte.",
      assistant: "KI-Assistent",
      maleVoice: "Männliche Stimme",
      femaleVoice: "Weibliche Stimme",
      assistanceReason: "Grund für die Unterstützung",
      speechImpairment: "Sprechbeeinträchtigung",
      languageBarrier: "Sprachbarriere",
      representedPersonFirstName: "Vorname der vertretenen Person",
      representedPersonFirstNamePlaceholder: "z. B. Max",
      representedPersonLastName: "Nachname der vertretenen Person",
      representedPersonLastNamePlaceholder: "z. B. Mustermann",
      optionsHelp: "Sichere Standardwerte passen für die meisten Anrufe. Ändern Sie nur, was für dieses Gespräch wichtig ist.",
      result: "Ergebnis",
      captureResult: "Gesprochene Antwort in CallAssist speichern",
      externalDelivery: "Die empfangende Person um eine Zusendung bitten",
      messageOnly: "Nur eine Nachricht übermitteln",
      addressing: "Anrede",
      formalDefault: "Formell (Standard)",
      automaticRelationship: "Automatisch nach Beziehung",
      informal: "Informell",
      tone: "Ton",
      automatic: "Automatisch",
      formal: "Formell",
      neutral: "Neutral",
      friendly: "Freundlich",
      voicemail: "Mailbox",
      noCallDetails: "Keine Anrufdetails hinterlassen",
      neutralMessage: "Neutrale Nachricht hinterlassen",
      deliveryInstruction: "Anweisung zur Zustellung",
      deliveryPlaceholder: "Zum Beispiel: um Zustellung an Max über den vereinbarten Kanal bitten",
      audioRetention: "Audioaufbewahrung",
      deleteAfterTranscript: "Nach dem endgültigen Transkript löschen",
      keepSevenDays: "7 Tage aufbewahren",
      keepThirtyDays: "30 Tage aufbewahren",
      additionalContext: "Zusätzlicher Kontext",
      contextPlaceholder: "Relevante Hintergründe, Korrespondenz oder Organisationsdetails",
      allowLanguageSwitching: "Sprachwechsel erlauben",
      languageSwitchHelp: "Der Assistent darf eine ausgewählte Ausweichsprache verwenden.",
      fallbackLanguage: "Ausweichsprache",
      shareableInformation: "Informationen, die der Assistent teilen darf",
      shareableInformationHelp: "Optional. Geben Sie bestätigte Fakten zeilenweise ein. Beispiele werden nie vorausgefüllt.",
      approvedInformation: "Freigegebene Informationen",
      approvedInformationPlaceholder: "Vollständiger Name: Max Mustermann\nAnfrage gesendet: 12. Juli 2026",
      cancel: "Abbrechen",
      preparing: "Wird vorbereitet…",
      reviewCall: "Anruf prüfen"
    }
  },
  review: deReview,
  live: {
    connecting: "Verbindung zu Live-Aktualisierungen wird hergestellt…",
    connected: "Live-Aktualisierungen verbunden",
    reconnecting: "Live-Verbindung unterbrochen — Verbindung wird wiederhergestellt…",
    jumpToLatest: "Zum neuesten Beitrag",
    actionError: "Die Aktion konnte nicht abgeschlossen werden. Versuchen Sie es erneut.",
    insufficientCredits: "Sie haben kein Anrufguthaben mehr.",
    concurrentCall: "Beenden Sie den aktiven Anruf, bevor Sie einen weiteren starten.",
    recipientSuppressed: "Dieser Empfänger hat widersprochen und kann nicht angerufen werden.",
    outboundCallsDisabled: "Neue Anrufe sind vorübergehend pausiert. Versuchen Sie es später erneut.",
    callLimitReached: "Ihr Anruflimit für die öffentliche Beta ist erreicht. Versuchen Sie es später erneut.",
    rateLimited: "Zu viele Anfragen. Warten Sie kurz und versuchen Sie es erneut.",
    loadError: "Der Anrufentwurf wurde nicht gefunden oder die API ist nicht erreichbar.",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen — erneut versuchen",
    copyTranscript: "Transkript kopieren",
    copiedAnnouncement: "Das endgültige Transkript wurde in die Zwischenablage kopiert.",
    copyFailedAnnouncement: "Das endgültige Transkript konnte nicht kopiert werden.",
    showObjective: "Vollständiges Ziel anzeigen",
    hideObjective: "Ziel einklappen",
    breadcrumbLabel: "Brotkrümelnavigation",
    allCallBriefs: "Alle Anrufentwürfe",
    callPageTitle: (recipient: string) => `${recipient} — CallAssist`,
    status: {
      review_required: "Bereit zum Anrufen", needs_clarification: "Eine Angabe fehlt",
      blocked: "Durch Richtlinie blockiert", ready: "Startbereit", dialing: "Wird gewählt",
      in_progress: "Anruf läuft", awaiting_approval: "Entscheidung ausstehend",
      completed: "Anruf abgeschlossen", stopped: "Anruf gestoppt", failed: "Anruf fehlgeschlagen"
    },
    recordingStatus: {
      starting: "Wird gestartet", recording: "Aufnahme lÃ¤uft", processing: "Wird verarbeitet",
      available: "VerfÃ¼gbar", failed: "Fehlgeschlagen", deleted: "GelÃ¶scht"
    },
    finalTranscriptStatus: {
      processing: "Wird verarbeitet", completed: "Abgeschlossen", failed: "Fehlgeschlagen"
    },
    loadingBrief: "Anrufentwurf wird geladen…", unavailableTitle: "Anrufentwurf nicht verfügbar",
    returnDashboard: "Zur Übersicht", activeBrief: "Aktiver Anrufentwurf",
    startCall: "Anruf starten", stopCall: "Anruf stoppen", updateHeading: "Diesen Anruf aktualisieren",
    updatePlan: "Anrufplan aktualisieren", legacyBrief: "Älterer Anrufentwurf",
    legacyTitle: "Dieser Entwurf kann nicht gestartet werden",
    legacyHelp: "Er wurde vor der Compiler- und Richtliniengrenze erstellt. Erstellen Sie ihn in der Übersicht neu, um einen prüfbaren Anrufplan zu erzeugen.",
    liveTranscriptEyebrow: "Live-Transkript · Echtzeitentwurf", liveCaptions: "Live-Untertitel",
    liveTranscriptHelp: "Erscheint während des Anrufs. Schnell, vorläufig und möglicherweise fehlerhaft.",
    transcriptEmptyTitle: "Das Transkript erscheint hier",
    transcriptEmptyHelp: "Nach der Einwilligung erscheint jeder Gesprächsbeitrag in Echtzeit. Dieses schnelle Transkript kann Erkennungsfehler enthalten.",
    liveTime: "live", decisionRequired: "Entscheidung erforderlich", assistantWillSay: "Der Assistent sagt",
    approve: "Genehmigen", doNotDisclose: "Nicht offenlegen",
    terminalHelp: "Dieser Anruf ist beendet. Prüfen Sie unten die Ergebnisse des Anrufs.",
    safetyActive: "Sicherheitsfreigabe aktiv", safetyHelp: "Private Daten können ohne Ihre Freigabe nicht in das Gespräch gelangen.",
    briefEyebrow: "Anrufentwurf", objectiveTitle: "Anrufziel", primaryLanguage: "Hauptsprache",
    languageSwitching: "Sprachwechsel", disabled: "Deaktiviert", voice: "Stimme",
    female: "Weiblich", male: "Männlich", assistanceReason: "Grund für die Unterstützung",
    languageBarrier: "Sprachbarriere", speechImpairment: "Sprechbeeinträchtigung",
    audioRetention: "Audioaufbewahrung", untilFinalTranscript: "Bis zum endgültigen Transkript",
    retentionDays: (days: number) => `${days} Tage`, assistant: "Assistent",
    finalEyebrow: "Endgültiges Transkript · aufnahmebasiert", finalTitle: "Transkription nach dem Anruf",
    finalHelp: "Wird nach dem Anruf aus der vollständigen Aufnahme mit Einwilligung erstellt.",
    preparingPdf: "PDF wird vorbereitet…", pdfFailed: "PDF fehlgeschlagen — erneut versuchen", downloadPdf: "PDF herunterladen",
    pdfFailedAnnouncement: "Das PDF konnte nicht erstellt werden.", unassignedSpeaker: "Nicht zugeordnete Stimme",
    fullRecordingTranscript: "Transkript der vollständigen Aufnahme",
    structuredTranscriptNote: "Der Wortlaut stammt nur aus der Aufnahme mit Einwilligung. Die Rollen werden durch die getrennten Anrufkanäle bestimmt, die Zeitangaben sind ungefähr; Wörter aus dem Live-Entwurf werden nie kopiert.",
    plainTranscriptNote: "Der Wortlaut stammt aus einem Durchlauf der vollständigen Aufnahme und wird nicht mit dem Live-Entwurf vermischt. Für diesen Anruf war keine zuverlässige Rollen- und Zeitausrichtung verfügbar.",
    aiWarning: "Das Ergebnis wurde von KI erstellt; prüfen Sie kritische Details anhand der Aufnahme.",
    regenerateTranscript: "Endgültiges Transkript neu erstellen", finalFailed: "Endgültige Transkription fehlgeschlagen",
    finalFailedHelp: "Die Aufnahme ist weiterhin verfügbar. Sie können den Vorgang sicher wiederholen.", retryTranscription: "Transkription wiederholen",
    creatingFinal: "Endgültiges Transkript wird erstellt", creatingFinalHelp: "Die vollständige Aufnahme wird nach dem Anruf verarbeitet.",
    recordingNotStarted: "Aufnahme wurde nicht gestartet", recordingNotStartedHelp: "Das Gespräch wurde nach der Einwilligung nicht fortgesetzt.",
    noRecording: "Keine Aufnahme verfügbar", noRecordingHelp: "Der Anruf endete, bevor eine Aufnahme mit Einwilligung gestartet wurde.",
    availableAfterCall: "Nach dem Anruf verfügbar", availableAfterCallHelp: "Die Aufnahme beginnt erst nach der Einwilligung. Das endgültige Transkript wird erstellt, sobald der Anbieter die Aufnahme abgeschlossen hat.",
    consentAudio: "Audioaufnahme mit Einwilligung", deleted: "Gelöscht", available: "Verfügbar",
    audioUnsupported: "Ihr Browser unterstützt die Audiowiedergabe nicht.", deleteAudioNow: "Audio jetzt löschen",
    audioDeleted: "Die Audioaufnahme des Anbieters wurde endgültig gelöscht.",
    retentionImmediate: "Wird nach Erstellung des endgültigen Transkripts automatisch gelöscht.",
    retentionScheduled: (date: string) => `Löschung geplant für ${date}.`,
    retentionAutomatic: (days: number) => `Wird ${days} Tage nach Erstellung des endgültigen Transkripts automatisch gelöscht.`,
    feedbackEyebrow: "Ihre Einschätzung",
    feedbackTitle: "Wie ist dieser Anruf verlaufen?",
    feedbackHelp: "Ihre Antwort beschreibt das Aufgabenergebnis. Eine hergestellte Telefonverbindung allein gilt nie als Erfolg.",
    feedbackGoalQuestion: "Wurde das Anrufziel erreicht?",
    feedbackGoal: { yes: "Ja", partly: "Teilweise", no: "Nein" },
    feedbackTranscriptQuestion: "Wie genau ist das endgültige Transkript?",
    feedbackTranscriptQuality: {
      good: "Gut",
      some_errors: "Einige Fehler",
      poor: "Schlecht"
    },
    feedbackTranscriptUnavailable: "Die Transkriptqualität kann bewertet werden, sobald das endgültige Transkript verfügbar ist.",
    feedbackCommentLabel: "Optionaler Kommentar",
    feedbackCommentPlaceholder: "Was hat funktioniert oder sollte verbessert werden?",
    feedbackCommentHint: "Maximal 500 Zeichen. Dieser Kommentar bleibt privat.",
    feedbackSave: "Feedback speichern",
    feedbackUpdate: "Feedback aktualisieren",
    feedbackSaving: "Wird gespeichert…",
    feedbackSaved: "Feedback gespeichert.",
    feedbackError: "Das Feedback konnte nicht gespeichert werden. Versuchen Sie es erneut.",
    dataDeletionTitle: "Daten dieses Anrufs löschen",
    dataDeletionText: "Entfernt den Anrufentwurf, Transkripte, Freigabetexte, den Feedback-Kommentar und die Anbieter-Aufnahme dauerhaft. Der Anruf verschwindet aus Verlauf und Exporten.",
    dataDeletionRetained: "Minimierte Guthaben-, Einwilligungs-, Sicherheits-, technische und Audit-Nachweise bleiben ohne Anrufinhalt erhalten. Dies kann nicht rückgängig gemacht werden.",
    dataDeletionPassword: "Aktuelles Passwort",
    dataDeletionConfirmation: "Zur Bestätigung DELETE eingeben",
    dataDeletionConfirmationHint: "Geben Sie das exakte grossgeschriebene Wort DELETE ein.",
    dataDeletionAction: "Anrufdaten dauerhaft löschen",
    dataDeletionBusy: "Anrufdaten werden gelöscht…",
    dataDeletionInvalidPassword: "Das aktuelle Passwort ist falsch.",
    dataDeletionError: "Die Anrufdaten konnten nicht gelöscht werden. Es wurde kein Erfolg protokolliert; warten Sie und versuchen Sie es erneut."
  }
};

export const messages: Record<UiLocale, Messages> = { en, de };

export function isUiLocale(value: string): value is UiLocale {
  return uiLocales.includes(value as UiLocale);
}
