"use client";

import { isLiveTranscript } from "@callassist/contracts";
import { ASSISTANT_DISPLAY_NAME } from "@/lib/assistant-identity";
import { transcriptSourceCopy, transcriptSourceDescription } from "@/lib/i18n/transcript-source-copy";

import { consentTimeline } from "@/lib/i18n/consent-timeline";
import { answeringMessages } from "@/lib/i18n/answering-messages";
import { buildInitialDisclosure, formatPersonName, answeringApproval, canRepeatUnansweredCall, appointmentPlanExpired, createCallBriefInputSchema, formatLocale } from "@callassist/contracts";
import { registrationCallMessages } from "@/lib/i18n/registration-call-messages";
import { betaInsufficientCreditMessages } from "@/lib/i18n/beta-credit-messages";
import { systemMessages } from "@/lib/i18n/system-messages";
import { callStatusClass, callStatusLabel } from "@/lib/call-status";
import { PreviousCallResult } from "./previous-call-result";
import { CallLifecycleSummary } from "./call-lifecycle-summary";
import { betaErrorMessage, betaMessages } from "@/lib/i18n/beta-messages";
import { emailVerificationMessages } from "@/lib/i18n/email-verification-messages";

import {
  ASSISTANT_PROFILES,
  TEXT_LANGUAGES,
  isCallLanguageAvailable,
  supportedTextLanguage,
  type CallBrief,
  type CallEvent,
  type CallBriefStatus,
  type CallSnapshot,
  type ClarificationAnswer,
  type CreateCallBriefInput,
  type TaskLanguagePreferences,
  type TextLanguage,
  type ReviewEvidence,
  type UserRole
} from "@callassist/contracts";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "./app-shell";
import { designMessages } from "@/lib/i18n/design-messages";
import { CallFeedback } from "./call-feedback";
import { CompilationReview } from "./compilation-review";
import { TranslatedPlanReview } from "./translated-plan-review";
import { CallTranscriptResult } from "./call-transcript-result";
import { transcriptTabs } from "@/lib/i18n/transcript-tabs";
import { ConfirmDialog } from "./confirm-dialog";
import { CreateCallForm } from "./create-call-form";
import { CallPreparationStatus } from "./call-preparation-status";
import { CallActivityStatus } from "./call-activity-status";
import { callActivityPhase } from "@/lib/call-activity";
import { callActivityMessages } from "@/lib/i18n/call-activity-messages";
import { useUiLocale } from "./ui-locale-provider";
import { useCallDraftStore } from "./call-draft-provider";
import { getCallLanguageLabel, getTextLanguageLabel, languageMessages } from "@/lib/i18n/language-messages";
import { isTerminalCallStatus } from "@/lib/call-status";
import { useTranscriptFollowing } from "./use-transcript-following";
import { applyLiveTranscriptEvent, emptyLiveTranscript, mergeTranscriptSegments, liveTranscriptRows } from "@/lib/live-transcript-state";
import { currentCallSnapshot } from "@/lib/current-call-snapshot";
import { compilationApprovalInput } from "@/lib/compilation-approval";
import { isPlanPreparationFailure } from "@/lib/plan-preparation-failure";
import {
  callRecordingUrl,
  callEventsUrl,
  approveAndStartCall,
  deleteCallData,
  deleteCallRecording,
  decideApproval,
  getCallPreparationErrorMessage,
  getCallSnapshot,
  recompileCallBrief,
  retryFinalTranscript,
  repeatUnansweredCall,
  startCall,
  stopCall,
  updateCallContentLanguage,
  ApiError,
  type CallPreparationProgress
} from "@/lib/api";
import {
  consumeCallPreparationAttempt,
  getCallPreparationSessionStorage,
  prepareCallBriefCreation,
  type CallPreparationAttempt
} from "@/lib/call-preparation-attempt";

const activeStatuses = new Set<CallBriefStatus>([
  "dialing",
  "in_progress",
  "awaiting_approval"
]);

function editableInputFromStoredBrief(brief: CallBrief): CreateCallBriefInput {
  const fallbackProfile = ASSISTANT_PROFILES.find(
    ({ voiceGender }) => voiceGender === brief.voiceGender
  )!;
  return {
    recipientName: brief.recipientName,
    phoneNumber: brief.phoneNumber,
    objective: brief.objective,
    assistantProfileId: brief.assistantProfileId ?? fallbackProfile.id,
    representedPersonFirstName: brief.representedPersonFirstName,
    representedPersonLastName: brief.representedPersonLastName,
    assistanceReason: brief.assistanceReason,
    context: brief.context,
    locale: brief.locale,
    audioRetentionDays: brief.audioRetentionDays,
    allowLanguageSwitch: brief.allowLanguageSwitch,
    ...(brief.fallbackLocale ? { fallbackLocale: brief.fallbackLocale } : {}),
    allowedFacts: brief.allowedFacts,
    resultHandling: "capture_in_callassist",
    addressingMode: "formal",
    tonePreference: "neutral",
    voicemailPolicy: "do_not_leave_details",
    deliveryInstruction: "",
    clarificationAnswers: []
  };
}

export function LiveCall({ callId, userId, userRole }: { callId: string; userId: string; userRole: UserRole }) {
  const router = useRouter();
  const { locale: uiLocale, localizeHref, messages } = useUiLocale();

  const languageCopy = languageMessages[uiLocale];
  const draftStore = useCallDraftStore();
  const [snapshot, setSnapshot] = useState<CallSnapshot | null>(null);
  const sourceCopy=transcriptSourceCopy[uiLocale];
  const tabCopy=transcriptTabs[uiLocale];
  const copy={...messages.live, finalTitle:sourceCopy.title,
    finalHelp:snapshot?.finalTranscript?.status === "completed" ? transcriptSourceDescription(uiLocale,snapshot.finalTranscript.source) : sourceCopy.pending,
    creatingFinal:sourceCopy.preparing,creatingFinalHelp:sourceCopy.pending,availableAfterCallHelp:sourceCopy.pending,
    structuredTranscriptNote:transcriptSourceDescription(uiLocale,snapshot?.finalTranscript?.source),
    plainTranscriptNote:transcriptSourceDescription(uiLocale,snapshot?.finalTranscript?.source)};
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [startingCall, setStartingCall] = useState(false);
  const [preparationProgress, setPreparationProgress] = useState<CallPreparationProgress | null>(null);
  const [editingBrief, setEditingBrief] = useState(() => Boolean(draftStore.forOwner(userId).get(userId, callId)));
  const [confirmingAudioDelete, setConfirmingAudioDelete] = useState(false);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionConfirmation, setDeletionConfirmation] = useState("");
  const [deletionBusy, setDeletionBusy] = useState(false);
  const [deletionError, setDeletionError] = useState<
    "invalid-password" | "failed" | null
  >(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [customTargetLanguage, setCustomTargetLanguage] = useState("");
  const [connectionStatus, setConnectionStatus] = useState<
    "connecting" | "connected" | "reconnecting"
  >("connecting");
  const { following: followLiveTranscript, listRef: transcriptListRef, follow: followTranscript } = useTranscriptFollowing(Boolean(snapshot && activeStatuses.has(snapshot.brief.status)));
  const [showFullObjective, setShowFullObjective] = useState(false);
  const [transcriptView, setTranscriptView] = useState<"live" | "recording">("live");
  const transcriptCardRef = useRef<HTMLElement>(null);
  const actionErrorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!actionError || startingCall) return;
    const frame = window.requestAnimationFrame(() => {
      actionErrorRef.current?.focus({ preventScroll: true });
      actionErrorRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionError, startingCall]);
  const deletionRequestIdRef = useRef<string | null>(null);
  const clarificationAttemptRef = useRef<CallPreparationAttempt | null>(null);
  const [liveTranscript, setLiveTranscript] = useState(emptyLiveTranscript);
  const partialTranscript = liveTranscript.partials;
  const eventSegments = useRef<CallSnapshot["transcript"]>([]);
  const readVersion = useRef(0);

  const refresh = useCallback(async (reportError = true) => {
    const version = ++readVersion.current;
    try {
      const nextSnapshot = await getCallSnapshot(callId);
      if (version !== readVersion.current) return;
      if (nextSnapshot.compilation) {
        nextSnapshot.transcript = mergeTranscriptSegments(nextSnapshot.transcript, eventSegments.current);
      } else {
        eventSegments.current = [];
      }
      setSnapshot((current) => currentCallSnapshot(current, nextSnapshot));
      if (!activeStatuses.has(nextSnapshot.brief.status)) setLiveTranscript(current => ({ ...current, partials: {} }));
      consumeCallPreparationAttempt(getCallPreparationSessionStorage(), callId);
      setLoadError(null);
    } catch {
      if (version === readVersion.current && reportError) setLoadError(messages.live.loadError);
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [callId, messages.live.loadError]);

  useEffect(() => {
    void refresh();
    const events = new EventSource(callEventsUrl(callId), {
      withCredentials: true
    });
    events.onopen = () => {
      setConnectionStatus("connected");
      // SSE resumes with a fresh snapshot; partial text from the lost stream is not authoritative.
      setLiveTranscript(current => ({ ...current, partials: {} }));
      void refresh(false);
    };
    events.onmessage = (message) => {
      let event: CallEvent;
      try {
        event = JSON.parse(message.data) as CallEvent;
      } catch {
        return;
      }

      if (event.type === "transcript.delta" || event.type === "transcript.discarded") {
        setLiveTranscript(current => applyLiveTranscriptEvent(current, event));
        return;
      }

      if (event.type === "transcript.added") {
        setLiveTranscript(current => applyLiveTranscriptEvent(current, event));
        eventSegments.current = mergeTranscriptSegments(eventSegments.current, [event.segment]);
        setSnapshot(current => current ? { ...current, transcript: mergeTranscriptSegments(current.transcript, [event.segment]) } : current);
        return;
      }
      void refresh(false);
    };
    events.onerror = () => setConnectionStatus("reconnecting");
    return () => { events.close(); readVersion.current += 1; };
  }, [callId, refresh]);

  useEffect(() => {
    const terminal = ["completed","failed","stopped"].includes(snapshot?.brief.status ?? "");
    const transcriptsPending=snapshot?.recordingTranscript?.status==='processing' && ['queued','processing'].includes(snapshot.recordingTranscriptRequest?.status??'') ||
      terminal && !!snapshot?.nativeTranscriptCapture && !snapshot.finalTranscript;
    if (!transcriptsPending && snapshot?.brief.lifecycle?.assessment?.status !== "pending" && !(terminal && snapshot?.brief.lifecycle?.credit === "reserved")) return;
    const timer = window.setInterval(() => { void refresh(false); }, 3000);
    return () => window.clearInterval(timer);
  }, [snapshot?.brief.lifecycle?.assessment?.status, snapshot?.brief.lifecycle?.credit, snapshot?.brief.status, snapshot?.recordingTranscript?.status, snapshot?.recordingTranscriptRequest?.status, snapshot?.nativeTranscriptCapture, snapshot?.finalTranscript, refresh]);

  useEffect(() => {
    if (!snapshot?.brief.recipientName) return;
    document.title = messages.live.callPageTitle(snapshot.brief.recipientName);
    return () => {
      document.title = messages.app.defaultTitle;
    };
  }, [messages.app.defaultTitle, messages.live, snapshot?.brief.recipientName]);

  const language = useMemo(
    () => snapshot?.brief.locale
      ? { label: getCallLanguageLabel(snapshot.brief.locale, uiLocale) }
      : null,
    [snapshot?.brief.locale, uiLocale]
  );

  function revealLiveTranscript() {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        transcriptCardRef.current?.focus({ preventScroll: true });
        transcriptCardRef.current?.scrollIntoView({
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "auto"
            : "smooth",
          block: "start"
        });
      });
    });
  }

  async function runAction(
    action: () => Promise<CallSnapshot>,
    onSuccess?: () => void
  ) {
    setBusy(true);
    setActionError(null);
    try {
      const next = await action();
      setSnapshot((current) => currentCallSnapshot(current, next));
      onSuccess?.();
    } catch (error) {
      if (error instanceof ApiError && ["CALL_COMPILATION_STALE", "CALL_REVIEW_STALE"].includes(error.code)) {
        const refreshed = await getCallSnapshot(callId).catch(() => null);
        if (refreshed) setSnapshot(refreshed);
        setActionError(answeringMessages[uiLocale].reviewAgain);
        return;
      }
      setActionError(
        betaErrorMessage(error, uiLocale) ?? (
        error instanceof ApiError && error.code === "CALL_LANGUAGE_FORBIDDEN"
          ? languageCopy.callLanguageForbidden
          : error instanceof ApiError && error.code === "EMAIL_VERIFICATION_REQUIRED"
          ? emailVerificationMessages[uiLocale].banner
          : error instanceof ApiError && error.code === "INSUFFICIENT_CREDITS"
          ? betaInsufficientCreditMessages[uiLocale]
          : error instanceof ApiError && error.code === "CONCURRENT_CALL_LIMIT"
            ? messages.live.concurrentCall
            : error instanceof ApiError && error.code === "RECIPIENT_SUPPRESSED"
              ? messages.live.recipientSuppressed
              : error instanceof ApiError && error.code === "OUTBOUND_CALLS_DISABLED"
                ? messages.live.outboundCallsDisabled
                : error instanceof ApiError && [
                    "HOURLY_CALL_LIMIT",
                    "DAILY_CALL_LIMIT",
                    "RECIPIENT_REPEAT_LIMIT"
                  ].includes(error.code)
                  ? messages.live.callLimitReached
                  : error instanceof ApiError && error.code === "RATE_LIMITED"
                      ? messages.live.rateLimited
                      : error instanceof ApiError &&
                          error.code === "CALL_COMPILATION_RECOMPILE_REQUIRED"
                        ? messages.live.legacyHelp
                      : messages.live.actionError)
      );
    } finally {
      setBusy(false);
    }
  }

  async function launchCall(action: () => Promise<CallSnapshot>) {
    setStartingCall(true);
    revealLiveTranscript();
    try { await runAction(action); }
    finally { setStartingCall(false); }
  }

  async function saveEditedBrief(
    input: CreateCallBriefInput,
    idempotencyKey?: string,
    languagePreferences?: TaskLanguagePreferences,
    onProgress?: (progress: CallPreparationProgress) => void
  ) {
    if (snapshot?.compilation && JSON.stringify(createCallBriefInputSchema.parse(input)) === JSON.stringify(createCallBriefInputSchema.parse(snapshot.compilation.rawBrief))) {
      if (languagePreferences?.mode === "manual" && languagePreferences.targetLanguage && snapshot.languageContext && languagePreferences.targetLanguage !== snapshot.languageContext.taskContentLanguage) {
        await updateCallContentLanguage(callId, { targetLanguage: languagePreferences.targetLanguage, expectedSelectionRevision: snapshot.languageContext.selectionRevision });
        setSnapshot(await getCallSnapshot(callId));
      }
      setEditingBrief(false); setActionError(null); return snapshot.brief;
    }
    const updated = await recompileCallBrief(callId, input, idempotencyKey, languagePreferences, onProgress);
    setSnapshot((current) => currentCallSnapshot(current, updated));
    setEditingBrief(false);
    setActionError(null);
    return updated.brief;
  }

  async function answerClarifications(answers: ClarificationAnswer[]) {
    if (!snapshot?.compilation) return;
    setBusy(true);
    setPreparationProgress("preparing");
    setActionError(null);
    try {
      const previousAnswers = snapshot.compilation.rawBrief.clarificationAnswers ?? [];
      const answerCodes = new Set(answers.map(({ issueCode }) => issueCode));
      const input = {
        ...snapshot.compilation.rawBrief,
        clarificationAnswers: [
          ...previousAnswers.filter(({ issueCode }) => !answerCodes.has(issueCode)),
          ...answers
        ]
      };
      const languagePreferences: TaskLanguagePreferences = snapshot.languageContext
        ? { mode: "manual", targetLanguage: snapshot.languageContext.taskContentLanguage }
        : { mode: "auto" };
      const acceptSnapshot = (updated: CallSnapshot) => {
        setSnapshot((current) => currentCallSnapshot(current, updated));
        return updated.brief;
      };
      await prepareCallBriefCreation({
        input,
        languagePreferences,
        scope: `clarifications:${callId}:${snapshot.compilation.revision}:${snapshot.compilation.snapshotHash}`,
        userId,
        current: clarificationAttemptRef.current,
        storage: getCallPreparationSessionStorage(),
        onAttempt: (attempt) => { clarificationAttemptRef.current = attempt; },
        save: async (value, idempotencyKey) => acceptSnapshot(
          await recompileCallBrief(callId, value, idempotencyKey, languagePreferences, setPreparationProgress)
        ),
        load: async (id) => acceptSnapshot(await getCallSnapshot(id))
      });
    } catch (error) {
      setActionError(getCallPreparationErrorMessage(error, {
        ...betaMessages[uiLocale],
        generic: messages.form.preparationError,
        callLanguageForbidden: languageCopy.callLanguageForbidden,
        unavailable: messages.form.preparationUnavailable,
        pending: messages.form.preparationPending,
        invalid: messages.form.preparationInvalid,
        notFound: messages.form.preparationNotFound,
        notEditable: messages.form.preparationNotEditable,
        swissDestinationRequired: messages.form.phoneInvalid,
        rateLimited: messages.live.rateLimited
      }));
    } finally {
      setBusy(false);
      setPreparationProgress(null);
    }
  }

  async function changeTaskLanguage(targetLanguage: TextLanguage, disclosure?: HTMLDetailsElement | null) {
    if (!snapshot?.languageContext) return;
    setBusy(true); setActionError(null);
    try {
      const languageContext = await updateCallContentLanguage(callId, {
        targetLanguage, expectedSelectionRevision: snapshot.languageContext.selectionRevision
      });
      setSnapshot((current) => current && current.compilation?.revision === languageContext.compilationRevision &&
        (current.languageContext?.selectionRevision ?? 0) <= languageContext.selectionRevision ? { ...current, languageContext } : current);
      if (disclosure) disclosure.open = false;
      setCustomTargetLanguage("");
    } catch { setActionError(languageCopy.saveError); }
    finally { setBusy(false); }
  }

  async function permanentlyDeleteCallData() {
    setDeletionBusy(true);
    setDeletionError(null);
    try {
      deletionRequestIdRef.current ??= crypto.randomUUID();
      await deleteCallData(callId, {
        requestId: deletionRequestIdRef.current,
        password: deletionPassword,
        confirmation: "DELETE"
      });
      router.replace(localizeHref("/app"));
      router.refresh();
    } catch (error) {
      setDeletionError(
        error instanceof ApiError && error.code === "INVALID_CREDENTIALS"
          ? "invalid-password"
          : "failed"
      );
      setDeletionBusy(false);
    }
  }

  if (loading) {
    return (
      <AppShell>
        <main className="live-page" id="main-content" tabIndex={-1}><div className="loading-card">{copy.loadingBrief}</div></main>
      </AppShell>
    );
  }

  if (!snapshot) {
    return (
      <AppShell>
        <main className="live-page" id="main-content" tabIndex={-1}>
          <div className="loading-card">
            <strong>{copy.unavailableTitle}</strong>
            <p>{loadError}</p>
            <Link href={localizeHref("/app")}>{copy.returnDashboard}</Link>
          </div>
        </main>
      </AppShell>
    );
  }

  const {
    brief,
    compilation,
    transcript,
    pendingApproval,
    recording,
    finalTranscript
  } = snapshot;
  const isActive = activeStatuses.has(brief.status);
  const isTerminal = isTerminalCallStatus(brief.status);
  const pendingCallStart = startingCall && !isActive && !isTerminal;
  const activityPhase = callActivityPhase(brief.status, startingCall, connectionStatus, brief.lifecycle);
  const hasTranscript = transcript.length > 0 || Object.keys(partialTranscript).length > 0;
  const silentAutomatedCall = isTerminal && !!brief.lifecycle?.answering && brief.lifecycle.answering.decision !== "consent" && !recording && !hasTranscript;
  const callLanguageForbidden = !isCallLanguageAvailable(brief.locale, userRole) ||
    Boolean(brief.fallbackLocale && !isCallLanguageAvailable(brief.fallbackLocale, userRole));
  const preparationFailed = compilation ? isPlanPreparationFailure(compilation.policyDecision) : false;
  const hasImmutableExecutionPlan =
    snapshot.executionPlanSource === "immutable";

  const reviewProps = compilation ? {
    busy: busy || callLanguageForbidden, compilation, onAnswerClarifications: answerClarifications,
    onApproveAndCall: (review?: ReviewEvidence) => {
      if (appointmentPlanExpired(compilation)) { setActionError(registrationCallMessages[uiLocale].appointmentExpired); return; }
      void launchCall(() => approveAndStartCall(callId, compilationApprovalInput(compilation, review)));
    },
    onEdit: () => setEditingBrief(true), recipientName: brief.recipientName,
    onRetryPreparation: () => { void answerClarifications([]); },
    callDetails: [
      { label: designMessages[uiLocale].recipient, value: brief.recipientName },
      { label: designMessages[uiLocale].phoneNumber, value: brief.phoneNumber },
      { label: copy.primaryLanguage, value: language?.label ?? brief.locale },
      { label: copy.voice, value: brief.voiceGender === "female" ? copy.female : copy.male },
      { label: copy.audioRetention, value: brief.audioRetentionDays === 0 ? copy.untilFinalTranscript : copy.retentionDays(brief.audioRetentionDays) }
    ],
    initialDisclosure: snapshot.initialDisclosure
      ? { text: snapshot.initialDisclosure.text, locale: snapshot.initialDisclosure.locale }
      : !isTerminal && !isActive && compilation.compiledBrief
        ? { text: buildInitialDisclosure(compilation.compiledBrief.callLocale,
            formatPersonName(brief.representedPersonFirstName, brief.representedPersonLastName),
            brief.voiceGender, brief.assistanceReason).text, locale: compilation.compiledBrief.callLocale }
        : null,
    showActions: !isTerminal && !isActive
  } : null;

  const reviewPanel = compilation ? (
    <>
    {snapshot.languageContext && !isTerminal && !isActive && !compilation.approvedAt ? <details className="review-language-settings">
      <summary>
        <span>{languageCopy.taskLanguage}: <strong>{getTextLanguageLabel(snapshot.languageContext.taskContentLanguage, uiLocale)}</strong></span>
        <span className="language-change-label">{languageCopy.change}</span>
      </summary>
      <label className="field">
        <span className="sr-only">{languageCopy.taskLanguage}</span>
        <select disabled={busy}
          value={snapshot.languageContext.taskContentLanguage}
          onChange={(event) => { void changeTaskLanguage(event.target.value, event.currentTarget.closest("details")); }}>
          {!TEXT_LANGUAGES.some((value) => value === snapshot.languageContext!.taskContentLanguage) ?
            <option value={snapshot.languageContext.taskContentLanguage}>{getTextLanguageLabel(snapshot.languageContext.taskContentLanguage, uiLocale)}</option> : null}
          {TEXT_LANGUAGES.map((value) => <option key={value} value={value}>{getTextLanguageLabel(value, uiLocale)}</option>)}
        </select>
      </label>
      <form onSubmit={(event) => {
        event.preventDefault();
        const target = supportedTextLanguage(customTargetLanguage);
        if (!target) { setActionError(languageCopy.customTagInvalid); return; }
        void changeTaskLanguage(target, event.currentTarget.closest("details"));
      }}>
        <label className="field"><span>{languageCopy.customTagLabel}</span>
          <input value={customTargetLanguage} onChange={(event) => setCustomTargetLanguage(event.target.value)}
            placeholder="es, pt-BR, zh-Hant" maxLength={35} autoComplete="off" disabled={busy} />
        </label>
        <button type="submit" disabled={busy || !customTargetLanguage.trim()}>{languageCopy.customTagApply}</button>
      </form>
    </details> : null}
    {snapshot.planSource && snapshot.languageContext && !preparationFailed ? <TranslatedPlanReview
      key={`${snapshot.planSource.compilationId}:${snapshot.languageContext.selectionRevision}`}
      {...reviewProps!} reuseExistingOnly={Boolean(brief.retrySourceCallId)} callId={callId} userId={userId} source={snapshot.planSource}
      languageContext={snapshot.languageContext} initialArtifacts={snapshot.textArtifacts}
    /> : <CompilationReview {...reviewProps!} />}
    </>
  ) : null;

  return (
    <AppShell>
      <main data-terminal={isTerminal} className="live-page" id="main-content" tabIndex={-1}>
        <div className="live-nav">
          <nav className="call-page-links" aria-label={messages.live.breadcrumbLabel}>
            <Link href={localizeHref("/app")}>{messages.app.newCall}</Link>
            <Link href={localizeHref("/app/history")}>{messages.app.history}</Link>
          </nav>
          <nav aria-label={messages.live.breadcrumbLabel} className="breadcrumbs">
            <ol>
              <li><Link href={localizeHref("/app/history")}>{messages.live.allCallBriefs}</Link></li>
              <li aria-current="page">{brief.recipientName}</li>
            </ol>
          </nav>

        </div>

        <section className="call-hero">
          <div>
            <span className="eyebrow">{copy.activeBrief}</span>
            <h1>{brief.recipientName}</h1>
            <div className="call-meta">
              <span>{brief.phoneNumber}</span>
              <span className="meta-divider" />
              <span>{language?.label ?? brief.locale}</span>
              <time dateTime={brief.createdAt}>{new Intl.DateTimeFormat(formatLocale(uiLocale), { day: "numeric", month: "short", year: "numeric" }).format(new Date(brief.createdAt))}</time>
              {isTerminal && recording?.durationSeconds != null ? <span>{formatDuration(recording.durationSeconds)}</span> : null}
            </div>
          </div>

          <div className="call-actions">
          {canRepeatUnansweredCall(brief) ? <button type="button" className="primary-button compact-button" disabled={busy} onClick={async () => {
            if (busy) return;
            setBusy(true); setActionError(null);
            try { const repeated = await repeatUnansweredCall(callId, uiLocale); router.push(localizeHref(`/app/calls/${repeated.id}`)); }
            catch { setActionError(registrationCallMessages[uiLocale].retryError); }
            finally { setBusy(false); }
          }}>{busy ? registrationCallMessages[uiLocale].retryBusy : registrationCallMessages[uiLocale].retryCall}</button> : null}

          <span className={`status-pill ${callStatusClass(brief)}`}>
            <span aria-hidden="true" /> {pendingCallStart ? callActivityMessages[uiLocale].starting.label : callStatusLabel(brief, uiLocale)}
          </span>
            {brief.status === "ready" && hasImmutableExecutionPlan ? (
              <button
                className="primary-button compact-button"
                disabled={busy || callLanguageForbidden || Boolean(compilation && appointmentPlanExpired(compilation))}
                onClick={() => launchCall(() => startCall(callId))}
                type="button"
              >
                <span className="button-signal" aria-hidden="true">◖</span>
                {copy.startCall}
              </button>
            ) : null}
            {isActive ? (
              <button
                className="danger-button"
                disabled={busy}
                onClick={() => runAction(() => stopCall(callId))}
                type="button"
              >
                <span aria-hidden="true">■</span> {copy.stopCall}
              </button>
            ) : null}
          </div>
        </section>

        {brief.retrySourceCallId && !isTerminal && !isActive ? <><p className="inline-notice">{registrationCallMessages[uiLocale].retryHelp}</p><PreviousCallResult callId={brief.retrySourceCallId} locale={uiLocale} /></> : null}
        {compilation && !isTerminal && !isActive && appointmentPlanExpired(compilation) ? <p role="alert" className="inline-notice">{registrationCallMessages[uiLocale].appointmentExpired}</p> : null}
        {actionError ? <div className="inline-notice" role="alert" tabIndex={-1} ref={actionErrorRef}>{actionError}</div> : null}
        {isTerminal ? <CallLifecycleSummary lifecycle={brief.lifecycle} locale={uiLocale} message={compilation?.compiledBrief ? answeringApproval(compilation.compiledBrief.voicemailAction, compilation.compiledBrief.callLocale).message : null} /> : null}
        {preparationProgress ? <CallPreparationStatus progress={preparationProgress} /> : null}
        {callLanguageForbidden && !isTerminal && !isActive ? (
          <div className="inline-notice" role="alert">
            <p>{languageCopy.callLanguageForbidden}</p>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => setEditingBrief(true)}>{copy.updatePlan}</button>
          </div>
        ) : null}

        {snapshot.executionPlanSource === "archived" ? (
          <section className="compilation-review decision-blocked">
            <span className="eyebrow">{copy.legacyBrief}</span>
            <h2>{copy.archivedPlanTitle}</h2>
            <p>{copy.archivedPlanHelp}</p>
          </section>
        ) : snapshot.executionPlanSource === "recompile_required" ? (
          <>
            <section className="compilation-review decision-blocked">
              <span className="eyebrow">{copy.legacyBrief}</span>
              <h2>{copy.recompilePlanTitle}</h2>
              <p>{copy.recompilePlanHelp}</p>
            </section>
            <CreateCallForm
              userId={userId}
              userRole={userRole}
              draftId={callId}
              initialLanguagePreferences={snapshot.languageContext ? { mode: "manual", targetLanguage: snapshot.languageContext.taskContentLanguage, uiLocaleHint: uiLocale } : undefined}
              heading={copy.updateHeading}
              initialValue={editableInputFromStoredBrief(brief)}
              onCreated={() => undefined}
              saveCallBrief={saveEditedBrief}
              submitLabel={copy.updatePlan}
            />
          </>
        ) : compilation && editingBrief ? (
          <CreateCallForm
            userId={userId}
            userRole={userRole}
            draftId={callId}
            initialLanguagePreferences={snapshot.languageContext ? { mode: "manual", targetLanguage: snapshot.languageContext.taskContentLanguage, uiLocaleHint: uiLocale } : undefined}
            heading={copy.updateHeading}
            initialValue={compilation.rawBrief}
            onCancel={() => setEditingBrief(false)}
            onCreated={() => undefined}
            saveCallBrief={saveEditedBrief}
            submitLabel={copy.updatePlan}
          />
        ) : compilation && !isTerminal && !isActive && !pendingCallStart ? (
          reviewPanel
        ) : !hasImmutableExecutionPlan ? (
          <section className="compilation-review decision-blocked">
            <span className="eyebrow">{copy.legacyBrief}</span>
            <h2>{copy.legacyTitle}</h2>
            <p>{copy.legacyHelp}</p>
          </section>
        ) : null}

        <div
          className={`live-grid ${
            !pendingCallStart && ["review_required", "needs_clarification", "blocked"].includes(
              brief.status
            )
              ? "precall-hidden"
              : ""
          }`}
        >
          <div className="transcript-column">
            {isTerminal && !silentAutomatedCall && brief.status !== "blocked" ? <nav className="transcript-version-nav" aria-label={copy.finalTitle}>
              <button type="button" aria-pressed={transcriptView === "live"} onClick={() => setTranscriptView("live")}>{snapshot.nativeTranscriptCapture||isLiveTranscript(finalTranscript?.source)?tabCopy.live:copy.finalTitle}</button>
              <button type="button" aria-pressed={transcriptView === "recording"} onClick={() => setTranscriptView("recording")}>{tabCopy.audio}</button>
              <a href="#call-feedback">{designMessages[uiLocale].rateCall}</a>
            </nav> : null}
            <section className="transcript-card" tabIndex={-1} hidden={silentAutomatedCall || (isTerminal && (transcriptView !== "live" || !!finalTranscript))} ref={transcriptCardRef}>
            <div className="transcript-heading">
              <div>
                <span className="eyebrow">{copy.liveTranscriptEyebrow}</span>
                <h2>{isTerminal ? tabCopy.live : copy.liveCaptions}</h2>
                <p className="transcript-subtitle">{copy.liveTranscriptHelp}</p>
              </div>
              {isActive ? (
                <div
                  className={`connection-status connection-${connectionStatus}`}
                  role="status"
                >
                  <span aria-hidden="true" />
                  {messages.live[connectionStatus]}
                </div>
              ) : null}
            </div>

            {activityPhase ? <CallActivityStatus phase={activityPhase} recipientName={brief.recipientName} compact={hasTranscript} /> : null}
            <div
              className={`transcript-list${isTerminal ? " transcript-list-completed" : ""}`}
              aria-live={isActive ? "polite" : "off"}
              tabIndex={isActive ? 0 : undefined}
              ref={transcriptListRef}
            >
              {!hasTranscript ? activityPhase ? null : (
                <div className="transcript-empty">
                  <span className="wave-placeholder" aria-hidden="true">
                    <i /><i /><i /><i /><i />
                  </span>
                  <strong>{copy.transcriptEmptyTitle}</strong>
                  <p>{copy.transcriptEmptyHelp}</p>
                </div>
              ) : (
                <>
                  {[...liveTranscriptRows(transcript, liveTranscript), ...(brief.lifecycle?.consent === "granted" && brief.lifecycle.consentAt ? [{
                    id: "consent-event", role: "system" as const, text: consentTimeline[uiLocale].granted + (brief.lifecycle.consentMethod ? ` - ${consentTimeline[uiLocale][brief.lifecycle.consentMethod]}` : ""),
                    createdAt: brief.lifecycle.consentAt, locale: brief.locale, final: true
                  }] : [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((segment) => (
                  <article className={`transcript-line role-${segment.role}`} key={segment.id}>
                    <div className="speaker-mark">
                      {segment.role === "system" ? "i" : segment.role === "assistant" ? "AI" : "RE"}
                    </div>
                    <div>
                      <div className="speaker-row">
                        <strong>
                          {segment.role === "system" ? consentTimeline[uiLocale].system : segment.role === "assistant" ? ASSISTANT_DISPLAY_NAME : brief.recipientName}
                        </strong>
                        <time>
                          {!segment.final && !segment.nativeTiming ? copy.liveTime : new Date(segment.createdAt).toLocaleTimeString(uiLocale, {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit"
                          })}
                        </time>
                      </div>
                      <p>{segment.text}</p>
                      {segment.role !== "system" ? <span className="locale-tag">{segment.locale}</span> : null}
                    </div>
                  </article>
                  ))}

                </>
              )}
            </div>
            {isActive && !followLiveTranscript &&
            (transcript.length > 0 || Object.keys(partialTranscript).length > 0) ? (
              <button
                className="jump-to-latest"
                onClick={followTranscript}
                type="button"
              >
                ↓ {messages.live.jumpToLatest}
              </button>
            ) : null}
            </section>

            {isTerminal && !silentAutomatedCall && (transcriptView==='recording'||finalTranscript||!hasTranscript) ? <CallTranscriptResult
              snapshot={snapshot} userId={userId} view={transcriptView} busy={busy}
              onRequest={()=>void runAction(()=>retryFinalTranscript(callId))} onViewRecording={()=>setTranscriptView('recording')} /> : null}
            {compilation && (isTerminal || isActive) ? <details className="call-plan-disclosure">
              <summary>{copy.briefEyebrow}</summary>{reviewPanel}
            </details> : null}
          </div>

          <aside className="call-sidebar">
            <section className="recording-section">              {recording ? (
                <div className="recording-panel">
                  <div>
                    <strong>{copy.consentAudio}</strong>
                    <span>
                      {recording.status === "deleted"
                        ? copy.deleted
                        : recording.status === "available"
                          ? `${copy.available}${recording.durationSeconds !== null ? ` · ${formatDuration(recording.durationSeconds)}` : ""}`
                          : copy.recordingStatus[recording.status]}
                    </span>
                  </div>
                  {recording.status === "available" ? (
                    <>
                      <audio controls crossOrigin="use-credentials" preload="metadata" src={callRecordingUrl(callId)}>
                        {copy.audioUnsupported}
                      </audio>
                      <button
                        className="text-button danger-text"
                        disabled={
                          busy
                        }
                        onClick={() => setConfirmingAudioDelete(true)}
                        type="button"
                      >
                        {copy.deleteAudioNow}
                      </button>
                    </>
                  ) : null}
                  <small>
                    {recording.status === "deleted"
                      ? copy.audioDeleted
                      : retentionLabel(brief.audioRetentionDays, recording.deleteAfter, uiLocale, copy)}
                  </small>
                </div>
              ) : null}
            </section>
            {isTerminalCallStatus(brief.status) && brief.status !== "blocked" ? (
              <CallFeedback
                brief={brief}
                callId={callId}
                hasCompletedTranscript={finalTranscript?.status === "completed"}
              />
            ) : null}

            {pendingApproval ? (
              <section className="approval-card">
                <div className="approval-icon" aria-hidden="true">!</div>
                <span className="eyebrow">{copy.decisionRequired}</span>
                <h2>{pendingApproval.title}</h2>
                <p>{pendingApproval.reason}</p>
                <div className="speech-preview">
                  <span>{copy.assistantWillSay}</span>
                  <blockquote>“{pendingApproval.proposedSpeech}”</blockquote>
                </div>
                <div className="approval-actions">
                  <button
                    className="approve-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "approved")
                      )
                    }
                    type="button"
                  >
                    {copy.approve}
                  </button>
                  <button
                    className="decline-button"
                    disabled={busy}
                    onClick={() =>
                      runAction(() =>
                        decideApproval(callId, pendingApproval.id, "declined")
                      )
                    }
                    type="button"
                  >
                    {copy.doNotDisclose}
                  </button>
                </div>
              </section>
            ) : isTerminal ? (
              <section className="guard-card terminal-summary">
                <div className="guard-visual" aria-hidden="true">
                  <span>{brief.lifecycle?.substantiveAnswerConfirmed ? "✓" : "—"}</span>
                </div>
                <h2>{callStatusLabel(brief, uiLocale)}</h2>
                <p>{copy.terminalHelp}</p>
              </section>
            ) : (
              <section className="guard-card">
                <div className="guard-visual" aria-hidden="true">
                  <span>✓</span>
                </div>
                <h2>{copy.safetyActive}</h2>
                <p>{copy.safetyHelp}</p>
              </section>
            )}

            <section className="brief-card">
              <span className="eyebrow">{copy.briefEyebrow}</span>
              <h2>{copy.objectiveTitle}</h2>
              <p className={showFullObjective ? "" : "objective-clamped"}>{brief.objective}</p>
              {brief.objective.length > 180 ? (
                <button
                  aria-expanded={showFullObjective}
                  className="objective-toggle"
                  onClick={() => setShowFullObjective((current) => !current)}
                  type="button"
                >
                  {showFullObjective
                    ? messages.live.hideObjective
                    : messages.live.showObjective}
                </button>
              ) : null}
              <dl>
                <div><dt>{copy.primaryLanguage}</dt><dd>{getCallLanguageLabel(brief.locale, uiLocale)}</dd></div>
                <div>
                  <dt>{copy.languageSwitching}</dt>
                  <dd>{brief.allowLanguageSwitch && brief.fallbackLocale ? getCallLanguageLabel(brief.fallbackLocale, uiLocale) : copy.disabled}</dd>
                </div>
                <div>
                  <dt>{copy.voice}</dt>
                  <dd>{brief.voiceGender === "female" ? copy.female : copy.male}</dd>
                </div>
                <div>
                  <dt>{copy.assistanceReason}</dt>
                  <dd>
                    {brief.assistanceReason === "none"
                      ? copy.noAssistanceDisclosure
                      : brief.assistanceReason === "language_barrier"
                        ? copy.languageBarrier
                        : copy.speechImpairment}
                  </dd>
                </div>
                <div>
                  <dt>{copy.audioRetention}</dt>
                  <dd>
                    {brief.audioRetentionDays === 0
                      ? copy.untilFinalTranscript
                      : copy.retentionDays(brief.audioRetentionDays)}
                  </dd>
                </div>
              </dl>
            </section>
            {isTerminalCallStatus(brief.status) || brief.status === "blocked" ? (
              <section className="call-data-deletion-card" aria-labelledby="call-data-deletion-title">
                <h2 id="call-data-deletion-title">{copy.dataDeletionTitle}</h2>
                <p>{copy.dataDeletionText}</p>
                <p className="account-muted">{copy.dataDeletionRetained}</p>
                <div className="call-data-deletion-fields">
                  <label>
                    <span>{copy.dataDeletionPassword}</span>
                    <input
                      autoComplete="current-password"
                      disabled={deletionBusy}
                      onChange={(event) => setDeletionPassword(event.target.value)}
                      type="password"
                      value={deletionPassword}
                    />
                  </label>
                  <label>
                    <span>{copy.dataDeletionConfirmation}</span>
                    <input
                      autoCapitalize="characters"
                      autoComplete="off"
                      disabled={deletionBusy}
                      onChange={(event) => setDeletionConfirmation(event.target.value)}
                      spellCheck={false}
                      type="text"
                      value={deletionConfirmation}
                    />
                    <small>{copy.dataDeletionConfirmationHint}</small>
                  </label>
                </div>
                <button
                  className="danger-button"
                  disabled={
                    deletionBusy ||
                    !deletionPassword ||
                    deletionConfirmation !== "DELETE"
                  }
                  onClick={() => void permanentlyDeleteCallData()}
                  type="button"
                >
                  {deletionBusy
                    ? copy.dataDeletionBusy
                    : copy.dataDeletionAction}
                </button>
                {deletionError ? (
                  <p className="form-error" role="alert">
                    {deletionError === "invalid-password"
                      ? copy.dataDeletionInvalidPassword
                      : copy.dataDeletionError}
                  </p>
                ) : null}
              </section>
            ) : null}

          </aside>
        </div>
        <ConfirmDialog
          busy={busy}
          confirmLabel={messages.call.deleteAudioConfirm}
          danger
          description={messages.call.deleteAudioBody}
          onCancel={() => setConfirmingAudioDelete(false)}
          onConfirm={() => {
            setConfirmingAudioDelete(false);
            void runAction(() => deleteCallRecording(callId));
          }}
          open={confirmingAudioDelete}
          title={messages.call.deleteAudioTitle}
        />
      </main>
    </AppShell>
  );
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}:${remainder.toString().padStart(2, "0")}`;
}

function formatOffset(seconds: number) {
  const rounded = Math.floor(seconds);
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${(rounded % 60).toString().padStart(2, "0")}`;
}

function retentionLabel(
  days: number,
  deleteAfter: string | null,
  locale: import("@callassist/contracts").UiLocale,
  copy: {
    retentionImmediate: string;
    retentionScheduled: (date: string) => string;
    retentionAutomatic: (days: number) => string;
  }
) {
  if (days === 0) return copy.retentionImmediate;
  if (deleteAfter) {
    const formattedDate = new Intl.DateTimeFormat(locale, {
      dateStyle: "medium"
    }).format(new Date(deleteAfter));
    return copy.retentionScheduled(formattedDate);
  }
  return copy.retentionAutomatic(days);
}
