export const uiLocales = ["en", "de"] as const;
export type UiLocale = (typeof uiLocales)[number];

const enFormCopy = {
  newBrief: "New call plan",
  editBrief: "Edit call plan",
  defaultHeading: "Who are we calling, and why?",
  aiCall: "AI call",
  recipient: "Organisation or recipient",
  recipientPlaceholder: "e.g. Dr. Schmidt or Example Council",
  recipientHistoryLoading: "Loading previous recipients…",
  recipientHistoryError: "Previous recipients could not be loaded. You can keep typing.",
  recipientNoHistory: "No previous recipients yet.",
  recipientNoMatches: "No matching previous recipients.",
  phone: "Phone number",
  callLanguage: "Call language",
  objective: "What should the assistant do?",
  objectivePlaceholder: "Describe the goal naturally, in any language.",
  objectiveHelp: "Formal addressing, tone, and spoken-answer handling use safe defaults.",
  assistant: "AI assistant",
  maleVoice: "Male voice",
  femaleVoice: "Female voice",
  assistanceReason: "Reason for assistance",
  noAssistanceDisclosure: "Do not disclose a reason",
  speechImpairment: "Speech impairment",
  languageBarrier: "Language barrier",
  assistanceDisclosureWarning: "If selected, this reason may be shared with the person called.",
  representedPersonFirstName: "Represented person's first name",
  representedPersonFirstNamePlaceholder: "e.g. John",
  representedPersonLastName: "Represented person's last name",
  representedPersonLastNamePlaceholder: "e.g. Doe",
  optionsHelp: "Safe defaults work for most calls. Change only what matters for this conversation.",
  result: "Result",
  captureResult: "Save the spoken answer in SHPROHLI",
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
  whatWillDo: string; callSettings: string; opening: string; questions: string;
  addMissingDetail: string; clarificationHelp: string; blockedReason: string;
  edit: string; starting: string; approveAndCall: string; successMeans: string;
  approvedInformation: string; none: string; guardrails: string;
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
    howItWorks: string;
    imprint: string;
    optOut: string;
    footerProduct: string;
    footerLegal: string;
    publicBeta: string;
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
    preparationError: string;
    preparationUnavailable: string;
    preparationInvalid: string;
    preparationNotFound: string;
    preparationNotEditable: string;
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
    male: string; assistanceReason: string; noAssistanceDisclosure: string; languageBarrier: string;
    speechImpairment: string; audioRetention: string; untilFinalTranscript: string;
    retentionDays: (days: number) => string; assistant: string;
    finalEyebrow: string; finalTitle: string; finalHelp: string;
    preparingPdf: string; pdfFailed: string; downloadPdf: string; pdfFailedAnnouncement: string;
    unassignedSpeaker: string; fullRecordingTranscript: string; transcriptMethod: string;
    structuredTranscriptNote: string;
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
  changesNeeded: "This call needs changes", whatWillDo: "What SHPROHLI will do", callSettings: "Call settings",
  opening: "How the call starts", questions: "Questions it may ask",
  addMissingDetail: "Add the missing detail here",
  clarificationHelp: "Your existing call plan will be updated. You will not need to fill it in again.",
  blockedReason: "What needs to change", edit: "Edit", starting: "Starting…",
  approveAndCall: "Approve & call", successMeans: "A successful result",
  approvedInformation: "Approved information", none: "None", guardrails: "Safety rules", updating: "Updating…",
  continue: "Continue",
  tone: { formal: "Formal tone", neutral: "Neutral tone", friendly: "Friendly tone" },
  addressing: { formal: "Formal addressing", informal: "Informal addressing" },
  result: { capture_in_callassist: "Answers saved in SHPROHLI", request_external_delivery: "External delivery requested", message_only: "Message only" },
  assumption: {
    spoken_answers_saved_in_callassist: "Spoken answers are saved in SHPROHLI.",
    addressing_inferred: "Addressing is inferred from the relationship and recipient.",
    tone_inferred: "Tone is inferred from the relationship and purpose.",
    no_detailed_voicemail: "No call details are left on voicemail.",
    neutral_voicemail_only: "Only a neutral voicemail message may be left.",
    respect_refusal_and_end: "A refusal is respected and the call ends politely."
  },
  reason: {
    input_moderation_flagged: "SHPROHLI could not prepare this request safely. Edit the request and try again.",
    model_refusal: "SHPROHLI could not prepare this request safely. Edit the request and try again.",
    prohibited_content: "This request is outside the supported low-risk uses. Edit it before trying again.",
    material_ambiguity: "The request is unclear in a way that could change the call. Add the missing detail.",
    required_information_missing: "Required information is missing.",
    fact_integrity_failure: "SHPROHLI could not preserve the approved information reliably. Edit the request and try again.",
    plan_constraint_failure: "SHPROHLI could not apply one of the selected call settings. Review the request and try again.",
    unsupported_task: "This type of call is not currently supported."
  }
};

const deReview: ReviewCopy = {
  preview: "Anrufvorschau", ready: "Bereit zum Anrufen", clarificationNeeded: "Eine Angabe fehlt",
  changesNeeded: "Dieser Anruf muss geändert werden", whatWillDo: "Was SHPROHLI tun wird", callSettings: "Anrufeinstellungen",
  opening: "So beginnt der Anruf", questions: "Mögliche Fragen",
  addMissingDetail: "Fehlende Angabe ergänzen",
  clarificationHelp: "Ihr bestehender Anrufplan wird aktualisiert. Sie müssen ihn nicht erneut ausfüllen.",
  blockedReason: "Was geändert werden muss", edit: "Bearbeiten",
  starting: "Wird gestartet…", approveAndCall: "Genehmigen und anrufen",
  successMeans: "Ein erfolgreiches Ergebnis", approvedInformation: "Freigegebene Informationen",
  none: "Keine", guardrails: "Sicherheitsregeln", updating: "Wird aktualisiert…", continue: "Weiter",
  tone: { formal: "Formeller Ton", neutral: "Neutraler Ton", friendly: "Freundlicher Ton" },
  addressing: { formal: "Formelle Anrede", informal: "Informelle Anrede" },
  result: { capture_in_callassist: "Antworten werden in SHPROHLI gespeichert", request_external_delivery: "Externe Zustellung angefragt", message_only: "Nur Nachricht" },
  assumption: {
    spoken_answers_saved_in_callassist: "Gesprochene Antworten werden in SHPROHLI gespeichert.",
    addressing_inferred: "Die Anrede wird aus Beziehung und empfangender Person abgeleitet.",
    tone_inferred: "Der Ton wird aus Beziehung und Zweck abgeleitet.",
    no_detailed_voicemail: "Auf der Mailbox werden keine Anrufdetails hinterlassen.",
    neutral_voicemail_only: "Es darf nur eine neutrale Mailbox-Nachricht hinterlassen werden.",
    respect_refusal_and_end: "Eine Ablehnung wird respektiert und der Anruf höflich beendet."
  },
  reason: {
    input_moderation_flagged: "SHPROHLI konnte diese Anfrage nicht sicher vorbereiten. Bearbeiten Sie die Anfrage und versuchen Sie es erneut.",
    model_refusal: "SHPROHLI konnte diese Anfrage nicht sicher vorbereiten. Bearbeiten Sie die Anfrage und versuchen Sie es erneut.",
    prohibited_content: "Diese Anfrage liegt ausserhalb der unterstützten risikoarmen Nutzung. Bearbeiten Sie sie und versuchen Sie es erneut.",
    material_ambiguity: "Die Anfrage ist an einer entscheidenden Stelle unklar. Ergänzen Sie die fehlende Angabe.",
    required_information_missing: "Erforderliche Informationen fehlen.",
    fact_integrity_failure: "SHPROHLI konnte die freigegebenen Angaben nicht zuverlässig übernehmen. Bearbeiten Sie die Anfrage und versuchen Sie es erneut.",
    plan_constraint_failure: "SHPROHLI konnte eine gewählte Anrufeinstellung nicht übernehmen. Prüfen Sie die Anfrage und versuchen Sie es erneut.",
    unsupported_task: "Diese Art von Anruf wird derzeit nicht unterstützt."
  }
};

const en: Messages = {
  app: {
    homeLabel: "SHPROHLI — home",
    interfaceLanguage: "Interface language",
    switchToLightTheme: "Switch to light theme",
    switchToDarkTheme: "Switch to dark theme",
    skipToContent: "Skip to main content",
    defaultTitle: "SHPROHLI — AI-assisted phone calls",
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
    howItWorks: "How it works",
    imprint: "Imprint",
    optOut: "Stop calls",
    footerProduct: "Product",
    footerLegal: "Legal",
    publicBeta: "Public beta",
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
    deleteAudioTitle: "Permanently delete this recording?",
    deleteAudioBody:
      "The recording will be permanently deleted and cannot be recovered. The transcript is not deleted.",
    deleteAudioConfirm: "Delete recording permanently"
  },
  dashboard: {
    eyebrow: "AI-assisted phone calls",
    titleStart: "Every call under",
    titleAccent: " your control.",
    lead: "SHPROHLI handles the conversation, shows a live transcript and creates a final transcript after the call.",
    historyEyebrow: "History",
    historyTitle: "Recent calls",
    emptyTitle: "Your calls will appear here",
    emptyText: "Create your first call plan to get started.",
    privacyTitle: "The recipient chooses.",
    privacyText: "The recipient is told that an AI assistant is calling and is asked for consent before the conversation is processed or recorded.",
    openBrief: (recipient: string) => `Open call plan for ${recipient}`,
    loading: "Loading recent calls…",
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
    disclosurePreview: "If shared, the assistant may say:",
    disclosureHelp: "The assistant always identifies itself as AI and asks the recipient for consent separately.",
    preparingTitle: "AI is reviewing your call plan…",
    preparingText: "This can take around a minute. Keep this page open; your entries are preserved if it fails.",
    phoneValid: "Valid Swiss phone number",
    phoneInvalid: "During the public beta SHPROHLI can only call Swiss phone numbers, for example +41710000000",
    requiredComplete: "All required fields complete",
    requiredRemaining: (count: number) => `${count} required ${count === 1 ? "field" : "fields"} remaining`,
    rateLimited: "Too many call-planning requests. Wait a moment and try again.",
    preparationError: "SHPROHLI could not prepare this request safely. Edit the request and try again.",
    preparationUnavailable: "Call preparation is temporarily unavailable. Your entries are preserved. Try again shortly.",
    preparationInvalid: "Some call details need attention. Check your entries and try again.",
    preparationNotFound: "This call plan no longer exists. Return to your calls and create a new one.",
    preparationNotEditable: "This call plan can no longer be edited.",
    navigationError: "The call plan was prepared, but its review page could not be opened. Select Review call again to open it.",
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
    recipientSuppressed: "Calls to this number are blocked.",
    outboundCallsDisabled: "New calls are temporarily paused. Try again later.",
    callLimitReached: "Your public-beta call limit has been reached. Try again later.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    loadError: "This call could not be loaded. Check your connection and try again.",
    copied: "Copied",
    copyFailed: "Copy failed — retry",
    copyTranscript: "Copy transcript",
    copiedAnnouncement: "Final transcript copied to clipboard.",
    copyFailedAnnouncement: "The final transcript could not be copied.",
    showObjective: "Show full objective",
    hideObjective: "Collapse objective",
    breadcrumbLabel: "Breadcrumb",
    allCallBriefs: "All calls",
    callPageTitle: (recipient: string) => `${recipient} — SHPROHLI`,
    status: {
      review_required: "Ready to call", needs_clarification: "Needs one detail",
      blocked: "Needs changes", ready: "Ready to start", dialing: "Dialing",
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
    loadingBrief: "Loading call plan…", unavailableTitle: "Call plan unavailable",
    returnDashboard: "Return to dashboard", activeBrief: "Active call plan",
    startCall: "Start call", stopCall: "Stop call", updateHeading: "Update this call",
    updatePlan: "Update call plan", legacyBrief: "Earlier call plan",
    legacyTitle: "This call plan cannot be started",
    legacyHelp: "This call plan uses an older format. Recreate it from the dashboard before starting the call.",
    liveTranscriptEyebrow: "During the call", liveCaptions: "Live transcript",
    liveTranscriptHelp: "Appears during the call. Fast, provisional, and may contain recognition errors.",
    transcriptEmptyTitle: "The transcript will appear here",
    transcriptEmptyHelp: "After the recipient consents, each turn will appear here in real time. This fast transcript may contain recognition errors.",
    liveTime: "live", decisionRequired: "Decision required", assistantWillSay: "The assistant will say",
    approve: "Approve", doNotDisclose: "Do not disclose",
    terminalHelp: "This call has ended. Review the call results below.",
    safetyActive: "Protected information", safetyHelp: "The assistant can share only the information you approved.",
    briefEyebrow: "Call plan", objectiveTitle: "Call objective", primaryLanguage: "Primary language",
    languageSwitching: "Language switching", disabled: "Disabled", voice: "Voice",
    female: "Female", male: "Male", assistanceReason: "Reason for assistance",
    noAssistanceDisclosure: "No reason disclosed", languageBarrier: "Language barrier", speechImpairment: "Speech impairment",
    audioRetention: "Audio retention", untilFinalTranscript: "Until final transcript",
    retentionDays: (days: number) => `${days} days`, assistant: "Assistant",
    finalEyebrow: "After the call", finalTitle: "Final transcript",
    finalHelp: "Created from the call recording after the conversation ended.",
    preparingPdf: "Preparing PDF…", pdfFailed: "PDF failed — retry", downloadPdf: "Download PDF",
    pdfFailedAnnouncement: "The PDF could not be created.", unassignedSpeaker: "Unassigned speaker",
    fullRecordingTranscript: "Transcript",
    transcriptMethod: "How this transcript was created",
    structuredTranscriptNote: "The final transcript was created from the recording. Speaker labels and times may be approximate.",
    plainTranscriptNote: "The final transcript was created from the recording. Speaker labels and times were not available for this call.",
    aiWarning: "AI-generated. Check important names, dates, numbers and commitments against the recording.",
    regenerateTranscript: "Regenerate final transcript", finalFailed: "Final transcription failed",
    finalFailedHelp: "The recording is still available. You can retry safely.", retryTranscription: "Retry transcription",
    creatingFinal: "Creating the final transcript", creatingFinalHelp: "The call recording is being processed.",
    recordingNotStarted: "Recording was not started", recordingNotStartedHelp: "The conversation did not continue after consent.",
    noRecording: "No recording available", noRecordingHelp: "The call ended before a consent-gated recording was started.",
    availableAfterCall: "Available after the call", availableAfterCallHelp: "Recording begins only after consent. The final transcript is created when the recording is available.",
    consentAudio: "Recording", deleted: "Deleted", available: "Available",
    audioUnsupported: "Your browser does not support audio playback.", deleteAudioNow: "Delete audio now",
    audioDeleted: "The recording has been permanently deleted.",
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
    dataDeletionText: "Permanently deletes this call plan, recording, transcripts, approval text and feedback comment. The call disappears from your history and data export.",
    dataDeletionRetained: "This cannot be undone. Some limited records may be retained where necessary for security, abuse prevention, accounting or legal obligations.",
    dataDeletionPassword: "Current password",
    dataDeletionConfirmation: "Type DELETE to confirm",
    dataDeletionConfirmationHint: "Enter the exact uppercase word DELETE.",
    dataDeletionAction: "Delete call data permanently",
    dataDeletionBusy: "Deleting call data…",
    dataDeletionInvalidPassword: "The current password is incorrect.",
    dataDeletionError: "The call data could not be deleted. Wait a moment and try again."
  }
};

const de: Messages = {
  app: {
    homeLabel: "SHPROHLI — Startseite",
    interfaceLanguage: "Sprache der Benutzeroberfläche",
    switchToLightTheme: "Zum hellen Design wechseln",
    switchToDarkTheme: "Zum dunklen Design wechseln",
    skipToContent: "Zum Hauptinhalt springen",
    defaultTitle: "SHPROHLI — KI-unterstützte Telefonanrufe",
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
    howItWorks: "So funktioniert es",
    imprint: "Impressum",
    optOut: "Anrufe sperren",
    footerProduct: "Produkt",
    footerLegal: "Rechtliches",
    publicBeta: "Öffentliche Beta",
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
    eyebrow: "KI-unterstützte Telefonanrufe",
    titleStart: "Jeder Anruf unter",
    titleAccent: " Ihrer Kontrolle.",
    lead: "SHPROHLI führt das Gespräch, zeigt ein Live-Transkript und erstellt nach dem Anruf ein Endtranskript.",
    historyEyebrow: "Verlauf",
    historyTitle: "Letzte Anrufe",
    emptyTitle: "Ihre Anrufe erscheinen hier",
    emptyText: "Erstellen Sie Ihren ersten Anrufplan.",
    privacyTitle: "Die angerufene Person entscheidet.",
    privacyText: "Die angerufene Person wird darüber informiert, dass ein KI-Assistent anruft, und vor der Verarbeitung oder Aufzeichnung des Gesprächs um Zustimmung gebeten.",
    openBrief: (recipient: string) => `Anrufplan für ${recipient} öffnen`,
    loading: "Letzte Anrufe werden geladen…",
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
    disclosurePreview: "Falls dieser Grund genannt wird, kann der Assistent sagen:",
    disclosureHelp: "Der Assistent gibt sich immer als KI zu erkennen und fragt die angerufene Person separat nach ihrer Zustimmung.",
    preparingTitle: "Die KI prüft Ihren Anrufplan…",
    preparingText: "Dies kann etwa eine Minute dauern. Lassen Sie diese Seite geöffnet; bei einem Fehler bleiben Ihre Eingaben erhalten.",
    phoneValid: "Gültige Schweizer Telefonnummer",
    phoneInvalid: "Während der öffentlichen Beta kann SHPROHLI nur Schweizer Telefonnummern anrufen, zum Beispiel +41710000000",
    requiredComplete: "Alle Pflichtfelder sind ausgefüllt",
    requiredRemaining: (count: number) => `${count} ${count === 1 ? "Pflichtfeld ist" : "Pflichtfelder sind"} noch offen`,
    rateLimited: "Zu viele Anfragen zur Anrufplanung. Warten Sie kurz und versuchen Sie es erneut.",
    preparationError: "SHPROHLI konnte diese Anfrage nicht sicher vorbereiten. Bearbeiten Sie die Anfrage und versuchen Sie es erneut.",
    preparationUnavailable: "Die Anrufvorbereitung ist vorübergehend nicht verfügbar. Ihre Eingaben bleiben erhalten. Versuchen Sie es später erneut.",
    preparationInvalid: "Einige Anrufangaben müssen geprüft werden. Korrigieren Sie Ihre Eingaben und versuchen Sie es erneut.",
    preparationNotFound: "Dieser Anrufplan ist nicht mehr vorhanden. Kehren Sie zu Ihren Anrufen zurück und erstellen Sie einen neuen.",
    preparationNotEditable: "Dieser Anrufplan kann nicht mehr bearbeitet werden.",
    navigationError: "Der Anrufplan wurde erstellt, aber die Pr\u00fcfseite konnte nicht ge\u00f6ffnet werden. W\u00e4hlen Sie erneut \u201eAnruf pr\u00fcfen\u201c, um ihn zu \u00f6ffnen.",
    callOptions: "Anrufoptionen",
    copy: {
      newBrief: "Neuer Anrufplan",
      editBrief: "Anrufplan bearbeiten",
      defaultHeading: "Wen rufen wir an und warum?",
      aiCall: "KI-Anruf",
      recipient: "Organisation oder empfangende Person",
      recipientPlaceholder: "z. B. Dr. Schmidt oder Beispielgemeinde",
      recipientHistoryLoading: "Frühere Empfänger werden geladen…",
      recipientHistoryError: "Frühere Empfänger konnten nicht geladen werden. Sie können weiter tippen.",
      recipientNoHistory: "Noch keine früheren Empfänger vorhanden.",
      recipientNoMatches: "Keine passenden früheren Empfänger gefunden.",
      phone: "Telefonnummer",
      callLanguage: "Anrufsprache",
      objective: "Was soll der Assistent tun?",
      objectivePlaceholder: "Beschreiben Sie das Ziel in einer beliebigen Sprache.",
      objectiveHelp: "Formelle Anrede, Ton und Verarbeitung gesprochener Antworten verwenden sichere Standardwerte.",
      assistant: "KI-Assistent",
      maleVoice: "Männliche Stimme",
      femaleVoice: "Weibliche Stimme",
      assistanceReason: "Grund für die Unterstützung",
      noAssistanceDisclosure: "Keinen Grund angeben",
      speechImpairment: "Sprechbeeinträchtigung",
      languageBarrier: "Sprachbarriere",
      assistanceDisclosureWarning: "Diese Information wird der angerufenen Person mitgeteilt.",
      representedPersonFirstName: "Vorname der vertretenen Person",
      representedPersonFirstNamePlaceholder: "z. B. Max",
      representedPersonLastName: "Nachname der vertretenen Person",
      representedPersonLastNamePlaceholder: "z. B. Mustermann",
      optionsHelp: "Sichere Standardwerte passen für die meisten Anrufe. Ändern Sie nur, was für dieses Gespräch wichtig ist.",
      result: "Ergebnis",
      captureResult: "Gesprochene Antwort in SHPROHLI speichern",
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
    recipientSuppressed: "Anrufe an diese Nummer sind gesperrt.",
    outboundCallsDisabled: "Neue Anrufe sind vorübergehend pausiert. Versuchen Sie es später erneut.",
    callLimitReached: "Ihr Anruflimit für die öffentliche Beta ist erreicht. Versuchen Sie es später erneut.",
    rateLimited: "Zu viele Anfragen. Warten Sie kurz und versuchen Sie es erneut.",
    loadError: "Dieser Anruf konnte nicht geladen werden. Prüfen Sie Ihre Verbindung und versuchen Sie es erneut.",
    copied: "Kopiert",
    copyFailed: "Kopieren fehlgeschlagen — erneut versuchen",
    copyTranscript: "Transkript kopieren",
    copiedAnnouncement: "Das endgültige Transkript wurde in die Zwischenablage kopiert.",
    copyFailedAnnouncement: "Das endgültige Transkript konnte nicht kopiert werden.",
    showObjective: "Vollständiges Ziel anzeigen",
    hideObjective: "Ziel einklappen",
    breadcrumbLabel: "Brotkrümelnavigation",
    allCallBriefs: "Alle Anrufe",
    callPageTitle: (recipient: string) => `${recipient} — SHPROHLI`,
    status: {
      review_required: "Bereit zum Anrufen", needs_clarification: "Eine Angabe fehlt",
      blocked: "Muss geändert werden", ready: "Startbereit", dialing: "Wird gewählt",
      in_progress: "Anruf läuft", awaiting_approval: "Entscheidung ausstehend",
      completed: "Anruf abgeschlossen", stopped: "Anruf gestoppt", failed: "Anruf fehlgeschlagen"
    },
    recordingStatus: {
      starting: "Wird gestartet", recording: "Aufnahme läuft", processing: "Wird verarbeitet",
      available: "Verfügbar", failed: "Fehlgeschlagen", deleted: "Gelöscht"
    },
    finalTranscriptStatus: {
      processing: "Wird verarbeitet", completed: "Abgeschlossen", failed: "Fehlgeschlagen"
    },
    loadingBrief: "Anrufplan wird geladen…", unavailableTitle: "Anrufplan nicht verfügbar",
    returnDashboard: "Zur Übersicht", activeBrief: "Aktiver Anrufplan",
    startCall: "Anruf starten", stopCall: "Anruf stoppen", updateHeading: "Diesen Anruf aktualisieren",
    updatePlan: "Anrufplan aktualisieren", legacyBrief: "Früherer Anrufplan",
    legacyTitle: "Dieser Anrufplan kann nicht gestartet werden",
    legacyHelp: "Dieser Anrufplan verwendet ein älteres Format. Erstellen Sie ihn in der Übersicht neu, bevor Sie den Anruf starten.",
    liveTranscriptEyebrow: "Während des Anrufs", liveCaptions: "Live-Transkript",
    liveTranscriptHelp: "Erscheint während des Anrufs. Schnell, vorläufig und möglicherweise fehlerhaft.",
    transcriptEmptyTitle: "Das Transkript erscheint hier",
    transcriptEmptyHelp: "Nach der Einwilligung erscheint jeder Gesprächsbeitrag in Echtzeit. Dieses schnelle Transkript kann Erkennungsfehler enthalten.",
    liveTime: "live", decisionRequired: "Entscheidung erforderlich", assistantWillSay: "Der Assistent sagt",
    approve: "Genehmigen", doNotDisclose: "Nicht offenlegen",
    terminalHelp: "Dieser Anruf ist beendet. Prüfen Sie unten die Ergebnisse des Anrufs.",
    safetyActive: "Geschützte Informationen", safetyHelp: "Der Assistent darf nur die von Ihnen freigegebenen Informationen weitergeben.",
    briefEyebrow: "Anrufplan", objectiveTitle: "Anrufziel", primaryLanguage: "Hauptsprache",
    languageSwitching: "Sprachwechsel", disabled: "Deaktiviert", voice: "Stimme",
    female: "Weiblich", male: "Männlich", assistanceReason: "Grund für die Unterstützung",
    noAssistanceDisclosure: "Kein Grund angegeben", languageBarrier: "Sprachbarriere", speechImpairment: "Sprechbeeinträchtigung",
    audioRetention: "Audioaufbewahrung", untilFinalTranscript: "Bis zum endgültigen Transkript",
    retentionDays: (days: number) => `${days} Tage`, assistant: "Assistent",
    finalEyebrow: "Nach dem Anruf", finalTitle: "Endtranskript",
    finalHelp: "Wird nach dem Gespräch aus der Anrufaufnahme erstellt.",
    preparingPdf: "PDF wird vorbereitet…", pdfFailed: "PDF fehlgeschlagen — erneut versuchen", downloadPdf: "PDF herunterladen",
    pdfFailedAnnouncement: "Das PDF konnte nicht erstellt werden.", unassignedSpeaker: "Nicht zugeordnete Stimme",
    fullRecordingTranscript: "Transkript",
    transcriptMethod: "So wurde dieses Transkript erstellt",
    structuredTranscriptNote: "Das Endtranskript wurde aus der Aufnahme erstellt. Sprecherzuordnung und Zeitangaben können ungefähr sein.",
    plainTranscriptNote: "Das Endtranskript wurde aus der Aufnahme erstellt. Sprecherzuordnung und Zeitangaben waren für diesen Anruf nicht verfügbar.",
    aiWarning: "Mit KI erstellt. Prüfen Sie wichtige Namen, Daten, Zahlen und Zusagen anhand der Aufnahme.",
    regenerateTranscript: "Endgültiges Transkript neu erstellen", finalFailed: "Endgültige Transkription fehlgeschlagen",
    finalFailedHelp: "Die Aufnahme ist weiterhin verfügbar. Sie können den Vorgang sicher wiederholen.", retryTranscription: "Transkription wiederholen",
    creatingFinal: "Endtranskript wird erstellt", creatingFinalHelp: "Die Anrufaufnahme wird verarbeitet.",
    recordingNotStarted: "Aufnahme wurde nicht gestartet", recordingNotStartedHelp: "Das Gespräch wurde nach der Einwilligung nicht fortgesetzt.",
    noRecording: "Keine Aufnahme verfügbar", noRecordingHelp: "Der Anruf endete, bevor eine Aufnahme mit Einwilligung gestartet wurde.",
    availableAfterCall: "Nach dem Anruf verfügbar", availableAfterCallHelp: "Die Aufnahme beginnt erst nach der Zustimmung. Das Endtranskript wird erstellt, sobald die Aufnahme verfügbar ist.",
    consentAudio: "Aufnahme", deleted: "Gelöscht", available: "Verfügbar",
    audioUnsupported: "Ihr Browser unterstützt die Audiowiedergabe nicht.", deleteAudioNow: "Audio jetzt löschen",
    audioDeleted: "Die Aufnahme wurde endgültig gelöscht.",
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
    dataDeletionText: "Löscht Anrufplan, Aufnahme, Transkripte, Freigabetexte und Feedback-Kommentar dauerhaft. Der Anruf verschwindet aus Verlauf und Datenexport.",
    dataDeletionRetained: "Dies kann nicht rückgängig gemacht werden. Bestimmte begrenzte Angaben dürfen aufbewahrt werden, soweit dies für Sicherheit, Missbrauchsschutz, Abrechnung oder rechtliche Pflichten erforderlich ist.",
    dataDeletionPassword: "Aktuelles Passwort",
    dataDeletionConfirmation: "Zur Bestätigung DELETE eingeben",
    dataDeletionConfirmationHint: "Geben Sie das exakte grossgeschriebene Wort DELETE ein.",
    dataDeletionAction: "Anrufdaten dauerhaft löschen",
    dataDeletionBusy: "Anrufdaten werden gelöscht…",
    dataDeletionInvalidPassword: "Das aktuelle Passwort ist falsch.",
    dataDeletionError: "Die Anrufdaten konnten nicht gelöscht werden. Warten Sie einen Moment und versuchen Sie es erneut."
  }
};

export const messages: Record<UiLocale, Messages> = { en, de };

export function isUiLocale(value: string): value is UiLocale {
  return uiLocales.includes(value as UiLocale);
}
