import type { CallBrief } from "@callassist/contracts";

export const TWILIO_CALL_STATUSES = [
  "queued",
  "ringing",
  "in-progress",
  "canceled",
  "completed",
  "failed",
  "busy",
  "no-answer"
] as const;

export type TwilioCallStatus = (typeof TWILIO_CALL_STATUSES)[number];

export type StartTelephonyCallResult = {
  providerCallId: string | null;
  providerStatus: string;
};

export interface TelephonyProvider {
  readonly mode: "mock" | "twilio";
  startCall(brief: CallBrief): Promise<StartTelephonyCallResult>;
  stopCall(providerCallId: string): Promise<void>;
}

export function mapTwilioStatusToCallStatus(
  status: TwilioCallStatus
): CallBrief["status"] {
  switch (status) {
    case "queued":
    case "ringing":
      return "dialing";
    case "in-progress":
      return "in_progress";
    case "completed":
      return "completed";
    case "canceled":
    case "failed":
    case "busy":
    case "no-answer":
      return "failed";
  }
}

export function isTwilioCallStatus(value: string): value is TwilioCallStatus {
  return (TWILIO_CALL_STATUSES as readonly string[]).includes(value);
}
