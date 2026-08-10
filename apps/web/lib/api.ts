import type {
  ApprovalDecision,
  CallBrief,
  CallSnapshot,
  CreateCallBriefInput
} from "@callassist/contracts";

export const API_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, "") ?? "http://localhost:4000";

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error ?? `HTTP_${response.status}`);
  }

  return response.json() as Promise<T>;
}

export async function listCallBriefs() {
  return apiRequest<{ items: CallBrief[] }>("/api/call-briefs");
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

export async function startCall(id: string) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}/start`, {
    method: "POST"
  });
}

export async function stopCall(id: string) {
  return apiRequest<CallSnapshot>(`/api/call-briefs/${id}/stop`, {
    method: "POST"
  });
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
