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
}
