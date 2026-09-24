import { betaMessages } from "./i18n/beta-messages";
import type {
  AccountDeletionInput,
  AccountDeletionResponse,
  AccountNameUpdateInput,
  AccountNameUpdateResponse,
  AccountSessionList,
  AccountStatusAction,
  ApprovalDecision,
  AdminCreditGrantInput,
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  AdminCallInspector,
  AdminCallCostBreakdown,
  AdminCallPreparationInspector,
  AdminCallList,
  AdminCallListFilters,
  AdminCallSensitiveContent,
  AdminDurableJobRetryInput,
  AdminOperationsOverview,
  AdminOperationsWindow,
  AdminOutboundCallControlInput,
  AdminSystemView,
  AdminOutboundCallControlView,
  AdminEditorialRevision,
  AdminUserCreditLedger,
  AdminUserList,
  CallBrief,
  CallHistoryList,
  CallHistoryStage,
  CallLanguageContext,
  CallTextArtifact,
  CompilationReviewApprovalInput,
  CallPreparation,
  CallDataDeletionInput,
  CallDataDeletionResult,
  CallOutcomeView,
  CallSnapshot,
  ContentLocale,
  ContentDraftUpdateInput,
  ContentPageKey,
  EditorialCollectionKey,
  EditorialDraftUpdateInput,
  EditorialRevisionSummary,
  CreditUsage,
  EmailChangeConfirmInput,
  EmailChangeConfirmResponse,
  EmailChangeStartInput,
  EmailChangeStartResponse,
  EmailVerificationStartInput,
  EmailVerificationStartResponse,
  EmailVerificationConfirmInput,
  EmailVerificationConfirmResponse,
  CreateCallBriefInput,
  TaskLanguagePreferences,
  TextLanguage,
  TextArtifactKind,
  LoginInput,
  OnboardingAcceptanceInput,
  OnboardingStatus,
  OwnerCallFeedbackInput,
  PasswordRecoveryCompleteInput,
  PasswordRecoveryCompleteResponse,
  PasswordRecoveryStartInput,
  PasswordRecoveryStartResponse,
  PasswordRecoveryVerifyInput,
  PasswordRecoveryVerifyResponse,
  PhoneChangeConfirmInput,
  PhoneChangeConfirmResponse,
  PhoneChangeStartInput,
  PhoneChangeStartResponse,
  PhoneVerificationInput,
  PromoCodeCreateInput,
  PromoCodeSummary,
  PromoRedemptionInput,
  PublishedContentIndex,
  PublishedFaq,
  PublishedLanding,
  PublishedNavigation,
  RecipientOptOutConfirmation,
  RecipientOptOutRequest,
  RecipientSuggestionList,
  RegistrationInput,
  StaffRecipientSuppression,
  StaffRecipientSuppressionLift,
  SessionRevocationAction,
  User,
  UserRole,
  UserStatus,
  VerificationResendInput,
  UnverifiedPhoneCorrectionInput
} from "@callassist/contracts";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

type ValidationIssues = {
  formErrors?: string[];
  fieldErrors?: Record<string, string[] | undefined>;
};

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    readonly issues?: ValidationIssues,
    readonly retryAfterSeconds?: number
  ) {
    super(code);
    this.name = "ApiError";
  }
}

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    signal: init?.signal ?? (path.startsWith("/api/auth/") ? AbortSignal.timeout(30_000) : undefined),
    credentials: "include",
    headers
  });

  if (!response.ok) {
    const error = await apiErrorFromResponse(response);
    if (error.code === "AUTHENTICATION_REQUIRED" && typeof window !== "undefined") {
      window.dispatchEvent(new Event("callassist:session-ended"));
    }
    throw error;
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function getBetaControls() {
  return apiRequest<import("@callassist/contracts").BetaControlsView>("/api/admin/system/beta", { cache: "no-store" });
}
export function updateBetaControls(settings: import("@callassist/contracts").BetaSettings, expectedRevision: number, reason: string) {
  return apiRequest<{ updated: true }>("/api/admin/system/beta", { method: "PUT", body: JSON.stringify({ settings, expectedRevision, reason }) });
}
export function createBetaInvitation(reason: string) {
  return apiRequest<{ id: string; code: string; expiresAt: string }>("/api/admin/system/beta/invitations", { method: "POST", body: JSON.stringify({ reason }) });
}
export function revokeBetaInvitation(id: string, reason: string) {
  return apiRequest<{ revoked: true }>(`/api/admin/system/beta/invitations/${encodeURIComponent(id)}/revoke`, { method: "POST", body: JSON.stringify({ reason }) });
}

async function apiErrorFromResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; issues?: ValidationIssues }
    | null;
  return new ApiError(
    payload?.error ?? `HTTP_${response.status}`,
    response.status,
    payload?.issues,
    Math.min(86_400, Math.max(1, Number(response.headers.get("retry-after")) || 60))
  );
}

export async function registerAccount(input: RegistrationInput) {
  return apiRequest<{ status: "verification_required" }>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function resendPhoneVerification(input: VerificationResendInput) {
  return apiRequest<{ status: "verification_required" }>(
    "/api/auth/verification/resend",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function correctUnverifiedPhone(input: UnverifiedPhoneCorrectionInput) {
  return apiRequest<{ status: "verification_required" }>("/api/auth/verification/phone", {
    method: "POST", body: JSON.stringify(input)
  });
}

export async function verifyPhone(input: PhoneVerificationInput) {
  return apiRequest<{ user: User }>("/api/auth/verify-phone", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function login(input: LoginInput) {
  return apiRequest<{ user: User }>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function startPasswordRecovery(input: PasswordRecoveryStartInput) {
  return apiRequest<PasswordRecoveryStartResponse>("/api/auth/recovery/start", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function verifyPasswordRecovery(input: PasswordRecoveryVerifyInput) {
  return apiRequest<PasswordRecoveryVerifyResponse>(
    "/api/auth/recovery/verify",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function completePasswordRecovery(
  input: PasswordRecoveryCompleteInput
) {
  return apiRequest<PasswordRecoveryCompleteResponse>(
    "/api/auth/recovery/complete",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function startPhoneChange(input: PhoneChangeStartInput) {
  return apiRequest<PhoneChangeStartResponse>(
    "/api/auth/phone-change/start",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function confirmPhoneChange(input: PhoneChangeConfirmInput) {
  return apiRequest<PhoneChangeConfirmResponse>(
    "/api/auth/phone-change/confirm",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function getCurrentUser() {
  return apiRequest<{ user: User }>("/api/auth/me", { cache: "no-store" });
}

/** A server-confirmed terminal preparation failure may be retried with a new operation key. */
export class CallPreparationFailedError extends ApiError {
  constructor(code: string) {
    super(code, 502);
    this.name = "CallPreparationFailedError";
  }
}

export async function updateLanguagePreferences(input: {
  uiLocale?: string;
  preferredContentLanguage?: TextLanguage | null;
}) {
  return apiRequest<{ user: User }>("/api/account/language-preferences", {
    method: "PATCH", body: JSON.stringify(input)
  });
}

export async function updateCallContentLanguage(id: string, input: {
  targetLanguage: TextLanguage;
  expectedSelectionRevision: number;
}) {
  return apiRequest<CallLanguageContext>(`/api/call-briefs/${id}/content-language`, {
    method: "PATCH", body: JSON.stringify(input)
  });
}

export async function requestPlanReview(id: string, input: {
  compilationId: string; revision: number; snapshotHash: string; targetLanguage: TextLanguage;
}) {
  return apiRequest<CallTextArtifact>(`/api/call-briefs/${id}/plan-review`, {
    method: "POST", body: JSON.stringify(input)
  });
}

export type LanguageCapabilities = {
  textLanguages: TextLanguage[];
  selectableCallLanguages: string[];
  textGenerationEnabled: boolean;
  operations: Array<{ kind: TextArtifactKind; sourceLanguage: string; targetLanguage: TextLanguage | "*" }>;
  processorMode: "mock" | "openai";
};

export async function getLanguageCapabilities() {
  return apiRequest<LanguageCapabilities>("/api/language-capabilities");
}

export async function listCallTextArtifacts(id: string) {
  return apiRequest<{ items: CallTextArtifact[] }>(`/api/call-briefs/${id}/text-artifacts`);
}

export async function getCallTextArtifact(id: string, artifactId: string) {
  return apiRequest<CallTextArtifact>(`/api/call-briefs/${id}/text-artifacts/${artifactId}`);
}

export async function requestTranscriptTranslation(id: string, input: { sourceRevisionId: string; targetLanguage: TextLanguage }) {
  return apiRequest<CallTextArtifact>(`/api/call-briefs/${id}/final-transcript/translations`, {
    method: "POST", body: JSON.stringify(input)
  });
}

export async function requestCallSummary(id: string, input: { sourceRevisionId: string; targetLanguage: TextLanguage }) {
  return apiRequest<CallTextArtifact>(`/api/call-briefs/${id}/summaries`, {
    method: "POST", body: JSON.stringify(input)
  });
}

export async function retryCallTextArtifact(id: string, artifactId: string) {
  return apiRequest<CallTextArtifact>(`/api/call-briefs/${id}/text-artifacts/${artifactId}/retry`, { method: "POST" });
}

export async function startEmailVerification(input: EmailVerificationStartInput) {
  return apiRequest<EmailVerificationStartResponse>("/api/auth/email-verification/start", { method: "POST", body: JSON.stringify(input) });
}
export async function confirmEmailVerification(input: EmailVerificationConfirmInput) {
  return apiRequest<EmailVerificationConfirmResponse>("/api/auth/email-verification/confirm", { method: "POST", body: JSON.stringify(input) });
}

export async function startEmailChange(input: EmailChangeStartInput) {
  return apiRequest<EmailChangeStartResponse>(
    "/api/auth/email-change/start",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function confirmEmailChange(input: EmailChangeConfirmInput) {
  return apiRequest<EmailChangeConfirmResponse>(
    "/api/auth/email-change/confirm",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function updateOwnName(input: AccountNameUpdateInput) {
  return apiRequest<AccountNameUpdateResponse>("/api/account/profile/name", {
    method: "PATCH",
    body: JSON.stringify(input)
  });
}

export async function getOnboardingStatus(locale: ContentLocale) {
  return apiRequest<OnboardingStatus>(
    `/api/onboarding/status?locale=${encodeURIComponent(locale)}`
  );
}

export async function acceptOnboarding(input: OnboardingAcceptanceInput) {
  return apiRequest<OnboardingStatus>("/api/onboarding/accept", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getCreditUsage() {
  return apiRequest<CreditUsage>("/api/usage");
}

export async function requestAccountDataExport() {
  const response = await fetch(`${API_URL}/api/account/data-export`, {
    method: "POST",
    credentials: "include"
  });
  if (!response.ok) throw await apiErrorFromResponse(response);
  const disposition = response.headers.get("Content-Disposition") ?? "";
  const filename = disposition.match(/filename="([^"]+)"/i)?.[1]
    ?? "shprohli-data.json";
  return { blob: await response.blob(), filename };
}

export async function getAccountDeletion() {
  return apiRequest<AccountDeletionResponse>("/api/account/deletion");
}

export async function requestAccountDeletion(input: AccountDeletionInput) {
  return apiRequest<AccountDeletionResponse>("/api/account/deletion", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function getPublishedContentIndex() {
  return apiRequest<PublishedContentIndex>("/api/content/index");
}

export async function getPublishedFaq(locale: ContentLocale) {
  return apiRequest<{ faq: PublishedFaq }>(`/api/content/faq?locale=${locale}`);
}

export async function getPublishedLanding(locale: ContentLocale) {
  return apiRequest<{ landing: PublishedLanding }>(
    `/api/content/landing?locale=${locale}`
  );
}

export async function getPublishedNavigation(locale: ContentLocale) {
  return apiRequest<{ navigation: PublishedNavigation }>(
    `/api/content/navigation?locale=${locale}`
  );
}

export async function listAdminContentPages() {
  return apiRequest<{ pages: AdminContentPageSummary[] }>(
    "/api/admin/content/pages"
  );
}

export async function getAdminContentPage(
  key: ContentPageKey,
  locale: ContentLocale
) {
  return apiRequest<{
    published: AdminContentLocalizedRevision | null;
    draft: AdminContentLocalizedRevision | null;
  }>(`/api/admin/content/pages/${key}?locale=${locale}`);
}

export async function listAdminContentRevisions(key: ContentPageKey) {
  return apiRequest<{ revisions: AdminContentRevisionSummary[] }>(
    `/api/admin/content/pages/${key}/revisions`
  );
}

export async function createAdminContentDraft(key: ContentPageKey) {
  return apiRequest<{ draft: AdminContentRevisionSummary }>(
    `/api/admin/content/pages/${key}/drafts`,
    { method: "POST" }
  );
}

export async function updateAdminContentDraft(
  key: ContentPageKey,
  input: ContentDraftUpdateInput
) {
  return apiRequest<{ draft: AdminContentLocalizedRevision }>(
    `/api/admin/content/pages/${key}/draft`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function publishAdminContentDraft(
  key: ContentPageKey,
  reason: string
) {
  return apiRequest<{ revision: AdminContentRevisionSummary }>(
    `/api/admin/content/pages/${key}/publish`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function rollbackAdminContentRevision(
  key: ContentPageKey,
  revisionNumber: number,
  reason: string
) {
  return apiRequest<{ draft: AdminContentRevisionSummary }>(
    `/api/admin/content/pages/${key}/revisions/${revisionNumber}/rollback`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function getAdminEditorialCollection(key: EditorialCollectionKey) {
  return apiRequest<{
    published: AdminEditorialRevision | null;
    draft: AdminEditorialRevision | null;
  }>(`/api/admin/content/editorial/${key}`);
}

export async function listAdminEditorialRevisions(
  key: EditorialCollectionKey
) {
  return apiRequest<{ revisions: EditorialRevisionSummary[] }>(
    `/api/admin/content/editorial/${key}/revisions`
  );
}

export async function createAdminEditorialDraft(key: EditorialCollectionKey) {
  return apiRequest<{ draft: EditorialRevisionSummary }>(
    `/api/admin/content/editorial/${key}/drafts`,
    { method: "POST" }
  );
}

export async function updateAdminEditorialDraft(
  key: EditorialCollectionKey,
  input: EditorialDraftUpdateInput
) {
  return apiRequest<{ draft: AdminEditorialRevision }>(
    `/api/admin/content/editorial/${key}/draft`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function publishAdminEditorialDraft(
  key: EditorialCollectionKey,
  reason: string
) {
  return apiRequest<{ revision: EditorialRevisionSummary }>(
    `/api/admin/content/editorial/${key}/publish`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function rollbackAdminEditorialRevision(
  key: EditorialCollectionKey,
  revisionNumber: number,
  reason: string
) {
  return apiRequest<{ draft: EditorialRevisionSummary }>(
    `/api/admin/content/editorial/${key}/revisions/${revisionNumber}/rollback`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function listAdminUsers(options: {
  cursor?: string;
  limit?: number;
  search?: string;
  role?: UserRole;
  status?: UserStatus;
} = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  if (options.search) query.set("search", options.search);
  if (options.role) query.set("role", options.role);
  if (options.status) query.set("status", options.status);
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiRequest<AdminUserList>(`/api/admin/users${suffix}`);
}

export async function listAdminCalls(options: AdminCallListFilters & {
  cursor?: string;
  limit?: number;
} = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  if (options.status) query.set("status", options.status);
  if (options.outcome) query.set("outcome", options.outcome);
  if (options.consent) query.set("consent", options.consent);
  if (options.failureStage) query.set("failureStage", options.failureStage);
  if (options.locale) query.set("locale", options.locale);
  if (options.dateFrom) query.set("dateFrom", options.dateFrom);
  if (options.dateTo) query.set("dateTo", options.dateTo);
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiRequest<AdminCallList>(`/api/admin/calls${suffix}`);
}

export async function getAdminCallInspector(id: string) {
  return apiRequest<AdminCallInspector>(
    `/api/admin/calls/${encodeURIComponent(id)}`
  );
}

export async function accessAdminCallSensitiveContent(
  id: string,
  reason: string
) {
  return apiRequest<AdminCallSensitiveContent>(
    `/api/admin/calls/${encodeURIComponent(id)}/sensitive-access`,
    { method: "POST", body: JSON.stringify({ reason }) }
  );
}

export async function getAdminOperationsOverview(
  window: AdminOperationsWindow = "24h"
) {
  return apiRequest<AdminOperationsOverview>(
    `/api/admin/operations/overview?window=${encodeURIComponent(window)}`
  );
}

export async function getAdminSystemStatus() {
  return apiRequest<AdminSystemView>("/api/admin/system");
}

export async function getAdminOutboundCalls() {
  return apiRequest<AdminOutboundCallControlView>("/api/admin/system/outbound-calls");
}

export async function setAdminOutboundCalls(
  input: AdminOutboundCallControlInput
) {
  return apiRequest<AdminOutboundCallControlView>(
    "/api/admin/system/outbound-calls",
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function retryAdminDurableJob(
  jobId: string,
  input: AdminDurableJobRetryInput
) {
  return apiRequest<AdminSystemView>(
    `/api/admin/system/jobs/${encodeURIComponent(jobId)}/retry`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function getAdminUserCreditLedger(userId: string) {
  return apiRequest<AdminUserCreditLedger>(
    `/api/admin/users/${encodeURIComponent(userId)}/credits`
  );
}

export async function changeAdminUserStatus(
  userId: string,
  input: AccountStatusAction
) {
  return apiRequest<{ user: User }>(
    `/api/admin/users/${encodeURIComponent(userId)}/status`,
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function revokeAdminUserSessions(
  userId: string,
  input: SessionRevocationAction
) {
  return apiRequest<{ status: "queued" }>(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions/revoke`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function retryAdminAccountDeletion(
  userId: string,
  requestId: string,
  input: SessionRevocationAction
) {
  return apiRequest<void>(
    `/api/admin/users/${encodeURIComponent(userId)}/account-deletion/${encodeURIComponent(requestId)}/retry`,
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function redeemPromoCode(input: PromoRedemptionInput) {
  const result = await apiRequest<{ applied: boolean; usage: CreditUsage }>(
    "/api/credits/promo-redemptions",
    { method: "POST", body: JSON.stringify(input) }
  );
  notifyUsageChanged();
  return result;
}

export async function createPromoCode(input: PromoCodeCreateInput) {
  return apiRequest<{ created: boolean; promoCode: PromoCodeSummary }>(
    "/api/admin/promo-codes",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function grantCreditsAsAdmin(input: AdminCreditGrantInput) {
  const result = await apiRequest<{ applied: boolean; usage: CreditUsage }>(
    "/api/admin/credit-grants",
    { method: "POST", body: JSON.stringify(input) }
  );
  notifyUsageChanged();
  return result;
}

export async function logout() {
  await apiRequest<void>("/api/auth/logout", { method: "POST" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("callassist:session-ended"));
}

export async function revokeAllOwnSessions() {
  await apiRequest<void>("/api/auth/sessions/revoke", { method: "POST" });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("callassist:session-ended"));
}

export async function listOwnSessions() {
  return apiRequest<AccountSessionList>("/api/auth/sessions");
}

export async function revokeOwnSession(sessionId: string) {
  return apiRequest<void>(
    `/api/auth/sessions/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

export async function requestRecipientOptOut(input: RecipientOptOutRequest) {
  return apiRequest<{ status: "verification_required"; challengeToken: string }>(
    "/api/recipient-opt-out/verification",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function confirmRecipientOptOut(
  input: RecipientOptOutConfirmation
) {
  return apiRequest<{ status: "suppressed" | "already_suppressed" }>(
    "/api/recipient-opt-out/confirm",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function suppressRecipientAsStaff(
  input: StaffRecipientSuppression
) {
  return apiRequest<{ status: "suppressed" }>(
    "/api/admin/recipient-suppressions",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export async function liftRecipientSuppressionAsStaff(
  input: StaffRecipientSuppressionLift
) {
  return apiRequest<{ status: "lifted" | "not_suppressed" }>(
    "/api/admin/recipient-suppressions/lift",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function getCallPreparationErrorMessage(
  error: unknown,
  options: Partial<{
    generic: string;
    unavailable: string;
    spendingPaused: string;
    budgetUnconfigured: string;
    budgetExhausted: string;
    pending: string;
    invalid: string;
    notFound: string;
    notEditable: string;
    swissDestinationRequired: string;
    callLanguageForbidden: string;
    rateLimited: string;
  }> = {}
) {
  const copy = {
    generic: "The call plan could not be prepared. Your entries are preserved. Try again.",
    unavailable: "Call preparation is temporarily unavailable. Your entries are preserved. Try again shortly.",
    spendingPaused: betaMessages.en.spendingPaused,
    budgetUnconfigured: betaMessages.en.budgetUnconfigured,
    budgetExhausted: betaMessages.en.budgetExhausted,
    pending: "Plan preparation is taking longer than expected. Your entries are preserved. Try again to check its progress.",
    invalid: "Some call details need attention. Check your entries and try again.",
    notFound: "This call plan no longer exists. Return to your calls and create a new one.",
    notEditable: "This call plan can no longer be edited.",
    swissDestinationRequired: "During the public beta SHPROHLI can only call Swiss phone numbers.",
    callLanguageForbidden: "This call language is not available for your account. Choose another language and prepare the plan again.",
    rateLimited: "Too many requests. Wait a moment and try again.",
    ...options
  };
  if (!(error instanceof ApiError)) {
    return copy.generic;
  }

  if (error.code === "BETA_BUDGET_UNCONFIGURED") return copy.budgetUnconfigured;
  if (error.code === "BETA_BUDGET_EXHAUSTED") return copy.budgetExhausted;
  if (error.code === "BETA_SPENDING_PAUSED") return copy.spendingPaused;
  if (error.code === "BRIEF_COMPILER_UNAVAILABLE") {
    return copy.unavailable;
  }
  if (error.code === "CALL_PREPARATION_TIMEOUT") {
    return copy.pending;
  }
  if (error.code === "BRIEF_COMPILER_RESPONSE_INVALID") {
    return copy.generic;
  }
  if (error.code === "INVALID_CALL_BRIEF") {
    return copy.invalid;
  }
  if (error.code === "CALL_LANGUAGE_FORBIDDEN") {
    return copy.callLanguageForbidden;
  }
  if (error.code === "CALL_NOT_FOUND") {
    return copy.notFound;
  }
  if (error.code === "CALL_NOT_EDITABLE") {
    return copy.notEditable;
  }
  if (error.code === "SWISS_DESTINATION_REQUIRED") {
    return copy.swissDestinationRequired;
  }
  if (error.code === "RATE_LIMITED") {
    return copy.rateLimited;
  }
  return copy.generic;
}

export async function getAdminCallCostBreakdown(id: string) {
  return apiRequest<AdminCallCostBreakdown>(
    `/api/admin/calls/${encodeURIComponent(id)}/cost`
  );
}

export async function getAdminCallPreparationInspector(id: string) {
  return apiRequest<AdminCallPreparationInspector>(
    `/api/admin/call-preparations/${encodeURIComponent(id)}`
  );
}

export async function listCallBriefs(options: {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: CallBrief["status"];
  stage?: CallHistoryStage;
} = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  if (options.search) query.set("search", options.search);
  if (options.status) query.set("status", options.status);
  if (options.stage) query.set("stage", options.stage);
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiRequest<CallHistoryList>(
    `/api/call-briefs${suffix}`
  );
}

export async function listRecipientSuggestions(options: {
  query?: string;
  limit?: number;
} = {}) {
  const query = new URLSearchParams();
  if (options.query) query.set("query", options.query);
  if (options.limit) query.set("limit", String(options.limit));
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiRequest<RecipientSuggestionList>(
    `/api/recipient-suggestions${suffix}`
  );
}

export async function createCallBrief(
  input: CreateCallBriefInput,
  idempotencyKey = crypto.randomUUID(),
  languagePreferences?: TaskLanguagePreferences,
  onProgress?: (progress: CallPreparationProgress) => void
) {
  const request = () => apiRequest<CallPreparation>("/api/call-preparations", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(languagePreferences
      ? { requestVersion: 2, brief: input, languagePreferences }
      : input)
  });

  const preparation = await waitForCallPreparation(request, onProgress);
  const snapshot = await getCallSnapshot(preparation.callBriefId!);
  return snapshot.brief;
}

export type CallPreparationProgress = "queued" | "preparing" | "retrying" | "delayed";

// The worker can take three 120-second attempts, with backoff and queue time.
// A browser timeout is resumable; it must not turn an active job into a failed attempt.
const CALL_PREPARATION_WAIT_MS = 8 * 60_000;

async function waitForCallPreparation(
  request: () => Promise<CallPreparation>,
  onProgress?: (progress: CallPreparationProgress) => void
) {
  let preparation: CallPreparation;
  try {
    preparation = await request();
  } catch (error) {
    if (!isUncertainCallPreparationResponse(error)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 300));
    preparation = await request();
  }

  const startedAt = Date.now();
  const deadline = startedAt + CALL_PREPARATION_WAIT_MS;
  let lastProgress: CallPreparationProgress | undefined;
  while (preparation.status !== "succeeded") {
    if (preparation.status === "failed") {
      throw new CallPreparationFailedError(preparation.failureCode ?? "BRIEF_COMPILATION_FAILED");
    }
    if (preparation.status === "cancelled") {
      throw new ApiError("CALL_PREPARATION_CANCELLED", 409);
    }
    if (Date.now() >= deadline) {
      throw new ApiError("CALL_PREPARATION_TIMEOUT", 504);
    }
    const elapsed = Date.now() - startedAt;
    const progress: CallPreparationProgress = preparation.status === "retrying" || preparation.attemptCount > 1
      ? "retrying"
      : elapsed >= 60_000 ? "delayed"
      : preparation.status === "queued" ? "queued" : "preparing";
    if (progress !== lastProgress) {
      onProgress?.(progress);
      lastProgress = progress;
    }
    await new Promise((resolve) => setTimeout(resolve,
      Math.min(elapsed < 10_000 ? 500 : 2_000, deadline - Date.now())));
    preparation = await apiRequest<CallPreparation>(
      `/api/call-preparations/${preparation.id}`,
      { cache: "no-store", signal: AbortSignal.timeout(30_000) }
    );
  }
  return preparation;
}

function isUncertainCallPreparationResponse(error: unknown) {
  if (!(error instanceof ApiError)) return true;
  return (error.status === 408 || error.status === 425 || error.status >= 500) &&
    error.code === `HTTP_${error.status}`;
}

export async function getCallSnapshot(id: string) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}`);
}

export async function getCallOutcome(id: string) {
  return apiRequest<CallOutcomeView>(`/api/call-briefs/${id}/outcome`);
}

export async function submitCallFeedback(
  id: string,
  input: OwnerCallFeedbackInput
) {
  return apiRequest<CallOutcomeView>(`/api/call-briefs/${id}/feedback`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function recompileCallBrief(
  id: string,
  input: CreateCallBriefInput,
  idempotencyKey = crypto.randomUUID(),
  languagePreferences?: TaskLanguagePreferences,
  onProgress?: (progress: CallPreparationProgress) => void
) {
  const request = () => apiRequest<CallPreparation>(`/api/call-briefs/${id}`, {
    method: "PUT",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(languagePreferences
      ? { requestVersion: 2, brief: input, languagePreferences }
      : input)
  });

  const preparation = await waitForCallPreparation(request, onProgress);
  return getCallSnapshot(preparation.callBriefId!);
}

export async function startCall(id: string) {
  const snapshot = await apiRequest<CallSnapshot>(`/api/call-briefs/${id}/start`, {
    method: "POST"
  });
  notifyUsageChanged();
  return snapshot;
}

export async function approveCallBrief(
  id: string,
  approval: CompilationReviewApprovalInput
) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}/approve`, {
    method: "POST",
    body: JSON.stringify(approval)
  });
}

export async function approveAndStartCall(
  id: string,
  approval: CompilationReviewApprovalInput
) {
  const snapshot = await apiRequest<CallSnapshot>(
    `/api/call-briefs/${id}/approve-and-start`,
    { method: "POST", body: JSON.stringify(approval) }
  );
  notifyUsageChanged();
  return snapshot;
}

export async function stopCall(id: string) {
  const snapshot = await apiRequest<CallSnapshot>(`/api/call-briefs/${id}/stop`, {
    method: "POST"
  });
  notifyUsageChanged();
  return snapshot;
}

function notifyUsageChanged() {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("callassist:usage-changed"));
  }
}

export function callRecordingUrl(id: string) {
  return `${API_URL}/api/call-briefs/${id}/recording`;
}

export async function deleteCallRecording(id: string) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}/recording`, {
    method: "DELETE"
  });
}

export async function deleteCallData(
  id: string,
  input: CallDataDeletionInput
) {
  return apiRequest<CallDataDeletionResult>(
    `/api/call-briefs/${encodeURIComponent(id)}/data-deletion`,
    {
      method: "POST",
      body: JSON.stringify(input)
    }
  );
}

export async function retryFinalTranscript(id: string) {
  return apiRequest<CallSnapshot>(
    `/api/call-briefs/${id}/final-transcript/retry`,
    { method: "POST", body: "{}" }
  );
}

export async function decideApproval(
  callId: string,
  approvalId: string,
  decision: ApprovalDecision["decision"]
) {
  return apiRequest<CallSnapshot>(
    `/api/call-briefs/${callId}/approvals/${approvalId}`,
    {
      method: "POST",
      body: JSON.stringify({ decision })
    }
  );
}

export function callEventsUrl(id: string) {
  return `${API_URL}/api/call-briefs/${id}/events`;
}
import { notificationViewSchema, type NotificationSettingsUpdate } from "@callassist/contracts";

export async function getNotificationSettings() {
  return notificationViewSchema.parse(await apiRequest("/api/admin/system/notifications", { cache: "no-store" }));
}
export async function updateNotificationSettings(input: NotificationSettingsUpdate) {
  return apiRequest<{ updated: true }>("/api/admin/system/notifications", { method: "PUT", body: JSON.stringify(input) });
}

export function getAnalyticsSettings() {
  return apiRequest<import("@callassist/contracts").AnalyticsSettingsView>("/api/admin/system/analytics", { cache: "no-store" });
}
export function saveAnalyticsSettings(input: { settings: import("@callassist/contracts").AnalyticsSettings; expectedRevision: number }) {
  return apiRequest<{ updated: true }>("/api/admin/system/analytics", { method: "PUT", body: JSON.stringify(input) });
}
export function getPublicAnalyticsSettings() {
  return apiRequest<import("@callassist/contracts").AnalyticsSettings>("/api/analytics", { cache: "no-store", credentials: "omit" });
}

export async function listTelemetryExports(cursor?: string) {
  const { telemetryExportListSchema } = await import("@callassist/contracts");
  return telemetryExportListSchema.parse(await apiRequest(`/api/admin/telemetry-exports${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { cache: "no-store" }));
}
export async function createTelemetryExport(input: import("@callassist/contracts").TelemetryExportInput) {
  return apiRequest<import("@callassist/contracts").TelemetryExportView>("/api/admin/telemetry-exports", { method: "POST", body: JSON.stringify(input) });
}
export async function changeTelemetryExport(id: string, action: "cancel" | "retry") {
  return apiRequest<import("@callassist/contracts").TelemetryExportView>(`/api/admin/telemetry-exports/${encodeURIComponent(id)}/${action}`, { method: "POST", body: "{}" });
}
export function telemetryExportDownloadUrl(id: string) {
  return `${API_URL}/api/admin/telemetry-exports/${encodeURIComponent(id)}/download`;
}

export function getAdminOgImages() {
  return apiRequest<{ locales: import("@callassist/contracts").OgLocaleState[] }>("/api/admin/content/og", { cache: "no-store" });
}
export function getPublicOgImages() {
  return apiRequest<{ images: import("@callassist/contracts").PublishedOgImage[] }>("/api/content/og", { cache: "no-store" });
}
export function generateOgImage(locale: string, slogan: string, expectedRevision: number) {
  return apiRequest<import("@callassist/contracts").OgLocaleState>(`/api/admin/content/og/${locale}/generate`, {
    method: "POST", body: JSON.stringify({ slogan, expectedRevision })
  });
}
export function uploadOgImage(locale: string, input: import("@callassist/contracts").OgUploadInput) {
  return apiRequest<import("@callassist/contracts").OgLocaleState>(`/api/admin/content/og/${locale}/upload`, {
    method: "POST", body: JSON.stringify(input)
  });
}
export function publishOgImage(locale: string, versionId: string, expectedRevision: number) {
  return apiRequest<import("@callassist/contracts").OgLocaleState>(`/api/admin/content/og/${locale}/publish`, {
    method: "POST", body: JSON.stringify({ versionId, expectedRevision })
  });
}
export async function getOgPreview(version: import("@callassist/contracts").OgImageVersion) {
  const response = await fetch(`${API_URL}/api/admin/content/og/${version.locale}/images/${version.hash}.png`, { credentials: "include", cache: "no-store" });
  if (!response.ok) throw await apiErrorFromResponse(response);
  return response.blob();
}
