import type { CallBrief } from "@callassist/contracts";

export const TWILIO_CALL_RESOURCE_STATUSES = [
  "queued",
  "ringing",
  "in-progress",
  "canceled",
  "completed",
  "failed",
  "busy",
  "no-answer"
] as const;

export type TwilioCallResourceStatus =
  (typeof TWILIO_CALL_RESOURCE_STATUSES)[number];

export const TWILIO_CALL_STATUS_CALLBACK_VALUES = [
  "queued",
  "initiated",
  "ringing",
  "in-progress",
  "canceled",
  "completed",
  "failed",
  "busy",
  "no-answer"
] as const;

export type TwilioCallStatusCallbackValue =
  (typeof TWILIO_CALL_STATUS_CALLBACK_VALUES)[number];

export const TWILIO_RECORDING_STATUSES = [
  "in-progress",
  "completed",
  "absent"
] as const;

export type TwilioRecordingStatus =
  (typeof TWILIO_RECORDING_STATUSES)[number];

export type StartTelephonyCallResult = {
  providerCallId: string | null;
  providerStatus: string;
};

export type StartCallRecordingInput = {
  callBriefId: string;
  recordingId: string;
};

export type StartCallRecordingResult = {
  providerRecordingId: string;
  providerStatus: string;
};

export type RecordingMedia = {
  bytes: Uint8Array;
  contentType: string;
  fileName: string;
  channels?: 1 | 2;
};

export type ProviderCallStatus = {
  providerCallId: string;
  status: TwilioCallResourceStatus;
};

export type ProviderRecordingStatus = {
  providerRecordingId: string;
  status: TwilioRecordingStatus | "pending";
  durationSeconds?: number;
  channels?: number;
  startedAt?: string;
  failureReason?: string;
};

export interface TelephonyProvider {
  readonly mode: "mock" | "twilio";
  startCall(brief: CallBrief): Promise<StartTelephonyCallResult>;
  stopCall(providerCallId: string): Promise<void>;
  startRecording(
    providerCallId: string,
    input: StartCallRecordingInput
  ): Promise<StartCallRecordingResult>;
  getRecordingMedia(providerRecordingId: string): Promise<RecordingMedia>;
  deleteRecording(providerRecordingId: string): Promise<void>;
  getCallStatus?(providerCallId: string): Promise<ProviderCallStatus>;
  getRecordingStatus?(
    providerRecordingId: string
  ): Promise<ProviderRecordingStatus>;
}

export function mapTwilioStatusToCallStatus(
  status: TwilioCallStatusCallbackValue
): CallBrief["status"] {
  switch (status) {
    case "queued":
    case "initiated":
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

export function isTwilioCallResourceStatus(
  value: string
): value is TwilioCallResourceStatus {
  return (TWILIO_CALL_RESOURCE_STATUSES as readonly string[]).includes(value);
}

export function isTwilioCallStatusCallbackValue(
  value: string
): value is TwilioCallStatusCallbackValue {
  return (TWILIO_CALL_STATUS_CALLBACK_VALUES as readonly string[]).includes(
    value
  );
}

export function isTwilioRecordingStatus(
  value: string
): value is TwilioRecordingStatus {
  return (TWILIO_RECORDING_STATUSES as readonly string[]).includes(value);
}
