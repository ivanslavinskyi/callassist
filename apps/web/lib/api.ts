import type {
  AccountSessionList,
  AccountStatusAction,
  ApprovalDecision,
  AdminCreditGrantInput,
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  AdminCallInspector,
  AdminCallList,
  AdminCallListFilters,
  AdminCallSensitiveContent,
  AdminDurableJobRetryInput,
  AdminOperationsOverview,
  AdminOperationsWindow,
  AdminOutboundCallControlInput,
  AdminSystemStatus,
  AdminEditorialRevision,
  AdminUserCreditLedger,
  AdminUserList,
  CallBrief,
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
  CreateCallBriefInput,
  LoginInput,
  OnboardingAcceptanceInput,
  OnboardingStatus,
  OwnerCallFeedbackInput,
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
  RegistrationInput,
  StaffRecipientSuppression,
  StaffRecipientSuppressionLift,
  SessionRevocationAction,
  User,
  UserRole,
  UserStatus,
  VerificationResendInput
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
    readonly issues?: ValidationIssues
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
    credentials: "include",
    headers
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function apiErrorFromResponse(response: Response) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: string; issues?: ValidationIssues }
    | null;
  return new ApiError(
    payload?.error ?? `HTTP_${response.status}`,
    response.status,
    payload?.issues
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

export async function getCurrentUser() {
  return apiRequest<{ user: User }>("/api/auth/me");
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
    ?? "callassist-data.json";
  return { blob: await response.blob(), filename };
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
  return apiRequest<AdminSystemStatus>("/api/admin/system");
}

export async function setAdminOutboundCalls(
  input: AdminOutboundCallControlInput
) {
  return apiRequest<AdminSystemStatus>(
    "/api/admin/system/outbound-calls",
    { method: "PUT", body: JSON.stringify(input) }
  );
}

export async function retryAdminDurableJob(
  jobId: string,
  input: AdminDurableJobRetryInput
) {
  return apiRequest<AdminSystemStatus>(
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
  return apiRequest<void>(
    `/api/admin/users/${encodeURIComponent(userId)}/sessions/revoke`,
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
  return apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export async function revokeAllOwnSessions() {
  return apiRequest<void>("/api/auth/sessions/revoke", { method: "POST" });
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
  return apiRequest<{ status: "verification_required" }>(
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
  options: { rateLimited?: string } = {}
) {
  if (!(error instanceof ApiError)) {
    return "Could not prepare the call. Your entries are preserved. Try again.";
  }

  if (error.code === "BRIEF_COMPILER_UNAVAILABLE") {
    return "The AI call planner is temporarily unavailable. Your entries are preserved. Try again.";
  }
  if (error.code === "BRIEF_COMPILER_RESPONSE_INVALID") {
    return "The AI call planner could not produce a valid plan after retrying. Your entries are preserved. Try again.";
  }
  if (error.code === "INVALID_CALL_BRIEF") {
    const firstFieldError = Object.entries(error.issues?.fieldErrors ?? {}).find(
      ([, messages]) => messages?.length
    );
    if (firstFieldError) {
      const [field, messages] = firstFieldError;
      return `Check ${humanizeFieldName(field)}: ${messages?.[0]}`;
    }
    return "Some call details are invalid. Check the highlighted fields and try again.";
  }
  if (error.code === "CALL_NOT_FOUND") {
    return "This call brief no longer exists. Return to the list and create a new one.";
  }
  if (error.code === "CALL_NOT_EDITABLE") {
    return "This call brief can no longer be edited.";
  }
  if (error.code === "SWISS_DESTINATION_REQUIRED") {
    return "During the public beta CallAssist can only call Swiss phone numbers.";
  }
  if (error.code === "RATE_LIMITED") {
    return options.rateLimited ?? "Too many requests. Wait a moment and try again.";
  }
  return "Could not prepare the call. Your entries are preserved. Try again.";
}

function humanizeFieldName(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}

export async function listCallBriefs(options: {
  cursor?: string;
  limit?: number;
  search?: string;
  status?: CallBrief["status"];
} = {}) {
  const query = new URLSearchParams();
  if (options.cursor) query.set("cursor", options.cursor);
  if (options.limit) query.set("limit", String(options.limit));
  if (options.search) query.set("search", options.search);
  if (options.status) query.set("status", options.status);
  const suffix = query.size > 0 ? `?${query}` : "";
  return apiRequest<{ items: CallBrief[]; nextCursor: string | null }>(
    `/api/call-briefs${suffix}`
  );
}

export async function createCallBrief(input: CreateCallBriefInput) {
  return apiRequest<CallBrief>("/api/call-briefs", {
    method: "POST",
    body: JSON.stringify(input)
  });
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
  input: CreateCallBriefInput
) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export async function startCall(id: string) {
  const snapshot = await apiRequest<CallSnapshot>(`/api/call-briefs/${id}/start`, {
    method: "POST"
  });
  notifyUsageChanged();
  return snapshot;
}

export async function approveCallBrief(id: string) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}/approve`, {
    method: "POST"
  });
}

export async function approveAndStartCall(id: string) {
  const snapshot = await apiRequest<CallSnapshot>(
    `/api/call-briefs/${id}/approve-and-start`,
    { method: "POST" }
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
