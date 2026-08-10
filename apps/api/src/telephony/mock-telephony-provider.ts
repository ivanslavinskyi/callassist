import { randomUUID } from "node:crypto";
import type { TelephonyProvider } from "./telephony-provider";

export class MockTelephonyProvider implements TelephonyProvider {
  readonly mode = "mock" as const;

  async startCall() {
    return {
      providerCallId: `mock-${randomUUID()}`,
      providerStatus: "dialing"
    };
  }

  async stopCall() {}

  async startRecording() {
    return {
      providerRecordingId: `mock-recording-${randomUUID()}`,
      providerStatus: "in-progress"
    };
  }

  async getRecordingMedia() {
    return {
      bytes: new Uint8Array(),
      contentType: "audio/mpeg",
      fileName: "mock-recording.mp3"
    };
  }

  async deleteRecording() {}
}
