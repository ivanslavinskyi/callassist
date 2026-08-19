import type {
  ApprovalDecision,
  CallBrief,
  CallSnapshot,
  CreditUsage,
  CreateCallBriefInput,
  LoginInput,
  PhoneVerificationInput,
  RegistrationInput,
  User,
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
    const payload = (await response.json().catch(() => null)) as
      | { error?: string; issues?: ValidationIssues }
      | null;
    throw new ApiError(
      payload?.error ?? `HTTP_${response.status}`,
      response.status,
      payload?.issues
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
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

export async function getCreditUsage() {
  return apiRequest<CreditUsage>("/api/usage");
}

export async function logout() {
  return apiRequest<void>("/api/auth/logout", { method: "POST" });
}

export function getCallPreparationErrorMessage(error: unknown) {
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
