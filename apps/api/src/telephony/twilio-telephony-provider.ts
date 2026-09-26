import { createHmac, timingSafeEqual } from "node:crypto";
import {
  isSwissDestinationPhone,
  answeringMode,
  type CallLocale,
  type CallBrief
} from "@callassist/contracts";
import twilio from "twilio";
import type {
  MediaStreamBinding,
  StartTelephonyCallOptions,
  StartCallRecordingInput,
  TelephonyProvider
} from "./telephony-provider";
import {
  isTwilioCallResourceStatus,
  isTwilioRecordingStatus
} from "./telephony-provider";

type TwilioClient = ReturnType<typeof twilio>;

type TwilioTelephonyOptions = {
  accountSid: string;
  authToken: string;
  fromNumber: string;
  publicBaseUrl: string;
  client?: TwilioClient;
};

export class TwilioTelephonyProvider implements TelephonyProvider {
  readonly #accountSid: string;
  readonly mode = "twilio" as const;
  readonly #authToken: string;
  readonly #client: TwilioClient;
  readonly #fromNumber: string;
  readonly #publicBaseUrl: URL;

  constructor(options: TwilioTelephonyOptions) {
    this.#accountSid = options.accountSid;
    this.#authToken = options.authToken;
    this.#fromNumber = options.fromNumber;
    this.#publicBaseUrl = new URL(options.publicBaseUrl);
    if (this.#publicBaseUrl.protocol !== "https:") {
      throw new Error("PUBLIC_BASE_URL must use HTTPS for Twilio webhooks");
    }
    this.#client =
      options.client ?? twilio(options.accountSid, options.authToken, { timeout: 10_000 });
  }

  async startCall(brief: CallBrief, options?: StartTelephonyCallOptions) {
    if (!isSwissDestinationPhone(brief.phoneNumber)) {
      throw new Error("SWISS_DESTINATION_REQUIRED");
    }
    const binding = options?.binding;
    const snapshot = options?.executionSnapshot;
    if (!binding || snapshot?.version !== 3 || binding.callBriefId !== brief.id ||
        binding.compilationSnapshotHash !== snapshot.compilationSnapshotHash) {
      throw new Error("ANSWERING_APPROVAL_REQUIRED");
    }
    const query = new URLSearchParams(binding).toString();
    const call = await this.#client.calls.create({
      machineDetection: answeringMode(snapshot.answering.action),
      machineDetectionTimeout: 30,
      asyncAmd: "false",
      from: this.#fromNumber,
      method: "POST",
      record: false,
      statusCallback: this.webhookUrl(
        `/webhooks/twilio/status?${query}`
      ),
      statusCallbackEvent: ["initiated", "ringing", "answered", "completed"],
      statusCallbackMethod: "POST",
      timeout: 30,
      timeLimit: options?.maxDurationSeconds ?? 900,
      to: brief.phoneNumber,
      url: this.webhookUrl(
        `/webhooks/twilio/voice?${query}`
      )
    });

    return {
      providerCallId: call.sid,
      providerStatus: call.status
    };
  }

  async stopCall(providerCallId: string) {
    await this.#client.calls(providerCallId).update({ status: "completed" });
  }

  async getCallStatus(providerCallId: string) {
    try {
      const call = await this.#client.calls(providerCallId).fetch();
      if (!isTwilioCallResourceStatus(call.status)) {
        throw new Error("TWILIO_CALL_STATUS_UNSUPPORTED");
      }
      const durationSeconds = optionalNonNegativeInteger(call.duration);
      const providerReportedCost = parseTwilioProviderReportedCost(
        call.price,
        call.priceUnit
      );
      return {
        providerCallId,
        status: call.status,
        ...(durationSeconds === undefined ? {} : { durationSeconds }),
        ...(providerReportedCost === undefined ? {} : { providerReportedCost })
      };
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("TWILIO_")) {
        throw error;
      }
      throw new Error(
        `TWILIO_CALL_FETCH_${twilioErrorStatus(error) ?? "FAILED"}`,
        { cause: error }
      );
    }
  }

  async startRecording(
    providerCallId: string,
    input: StartCallRecordingInput
  ) {
    const recording = await this.#client
      .calls(providerCallId)
      .recordings.create({
        recordingChannels: "dual",
        recordingTrack: "both",
        recordingStatusCallback: this.webhookUrl(
          `/webhooks/twilio/recording?callBriefId=${encodeURIComponent(
            input.callBriefId
          )}&recordingId=${encodeURIComponent(input.recordingId)}`
        ),
        recordingStatusCallbackEvent: ["in-progress", "completed", "absent"],
        recordingStatusCallbackMethod: "POST"
      });

    return {
      providerRecordingId: recording.sid,
      providerStatus: recording.status
    };
  }

  async getRecordingMedia(providerRecordingId: string) {
    // Bound headers and body together, including the legacy mono fallback.
    const signal = AbortSignal.timeout(30_000);
    let channels: 1 | 2 = 2;
    let response = await this.#downloadRecording(providerRecordingId, channels, signal);
    if (response.status === 400) {
      await response.body?.cancel();
      channels = 1;
      response = await this.#downloadRecording(providerRecordingId, channels, signal);
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`TWILIO_RECORDING_DOWNLOAD_${response.status}`);
    }
    return {
      bytes: new Uint8Array(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") ?? "audio/wav",
      fileName: `${providerRecordingId}.wav`,
      channels
    };
  }

  #downloadRecording(providerRecordingId: string, channels: 1 | 2, signal: AbortSignal) {
    const url = new URL(
      `/2010-04-01/Accounts/${encodeURIComponent(
        this.#accountSid
      )}/Recordings/${encodeURIComponent(providerRecordingId)}.wav`,
      "https://api.twilio.com"
    );
    url.searchParams.set("RequestedChannels", String(channels));
    return fetch(url, {
      signal,
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${this.#accountSid}:${this.#authToken}`
        ).toString("base64")}`
      }
    });
  }

  async deleteRecording(providerRecordingId: string) {
    try {
      const removed = await this.#client.recordings(providerRecordingId).remove();
      if (!removed) throw new Error("TWILIO_RECORDING_DELETE_FAILED");
    } catch (error) {
      if (twilioErrorStatus(error) !== 404) throw error;
    }
  }

  async getRecordingStatus(providerRecordingId: string) {
    try {
      const recording = await this.#client
        .recordings(providerRecordingId)
        .fetch();
      const status = isTwilioRecordingStatus(recording.status)
        ? recording.status
        : "pending" as const;
      return {
        providerRecordingId,
        status,
        durationSeconds: optionalNonNegativeInteger(recording.duration),
        channels: optionalPositiveInteger(recording.channels),
        startedAt: recording.startTime?.toISOString()
      };
    } catch (error) {
      if (twilioErrorStatus(error) === 404) {
        return {
          providerRecordingId,
          status: "absent" as const,
          failureReason: "provider_recording_not_found"
        };
      }
      throw new Error(
        `TWILIO_RECORDING_FETCH_${twilioErrorStatus(error) ?? "FAILED"}`,
        { cause: error }
      );
    }
  }

  validateWebhook(
    signature: string,
    rawRequestUrl: string,
    parameters: Record<string, string>
  ) {
    if (parameters.AccountSid && parameters.AccountSid !== this.#accountSid) return false;
    const requestUrl = this.webhookUrl(rawRequestUrl);
    return twilio.validateRequest(
      this.#authToken,
      signature,
      requestUrl,
      parameters
    );
  }

  validateMediaStreamWebhook(signature: string, rawRequestUrl: string) {
    const requestUrl = new URL(rawRequestUrl, this.#publicBaseUrl);
    requestUrl.protocol = "wss:";
    return twilio.validateRequest(
      this.#authToken,
      signature,
      requestUrl.toString(),
      {}
    );
  }

  createVoiceTwiml(brief: CallBrief, binding: MediaStreamBinding) {
    if (binding.callBriefId !== brief.id) {
      throw new Error("MEDIA_STREAM_BINDING_CALL_MISMATCH");
    }
    const response = new twilio.twiml.VoiceResponse();
    const connect = response.connect();
    const stream = connect.stream({ url: this.mediaStreamUrl() });
    stream.parameter({ name: "callBriefId", value: brief.id });
    stream.parameter({ name: "callAttemptId", value: binding.callAttemptId });
    stream.parameter({
      name: "compilationSnapshotHash",
      value: binding.compilationSnapshotHash
    });
    stream.parameter({
      name: "streamToken",
      value: this.createMediaStreamToken(binding)
    });
    response.hangup();
    return response.toString();
  }

  createHangupTwiml() {
    const response = new twilio.twiml.VoiceResponse();
    response.hangup();
    return response.toString();
  }

  createVoicemailTwiml(text: string, locale: CallLocale, binding: MediaStreamBinding) {
    const voices = {
      "de-CH": ["de-DE", "Polly.Marlene"], "de-DE": ["de-DE", "Polly.Marlene"],
      "fr-CH": ["fr-FR", "Polly.Celine"], "it-CH": ["it-IT", "Polly.Carla"],
      "en-GB": ["en-GB", "Polly.Amy"], "en-US": ["en-US", "Polly.Joanna"],
      "ru-RU": ["ru-RU", "Polly.Tatyana"]
    } as const;
    const [language, voice] = voices[locale];
    const response = new twilio.twiml.VoiceResponse();
    response.say({ language, voice, loop: 1 }, text);
    response.redirect({ method: "POST" }, this.webhookUrl(
      `/webhooks/twilio/voicemail-complete?${new URLSearchParams(binding)}`
    ));
    response.hangup();
    return response.toString();
  }

  createMediaStreamToken(binding: MediaStreamBinding) {
    return createHmac("sha256", this.#authToken)
      .update([
        "callassist-media-v2",
        binding.callBriefId,
        binding.callAttemptId,
        binding.compilationSnapshotHash
      ].join(":"))
      .digest("base64url");
  }

  validateMediaStreamToken(binding: MediaStreamBinding, token: string) {
    const expected = Buffer.from(this.createMediaStreamToken(binding));
    const received = Buffer.from(token);
    return (
      expected.length === received.length && timingSafeEqual(expected, received)
    );
  }

  mediaStreamUrl() {
    const url = new URL("/webhooks/twilio/media", this.#publicBaseUrl);
    url.protocol = "wss:";
    return url.toString();
  }

  webhookUrl(path: string) {
    return new URL(path, this.#publicBaseUrl).toString();
  }
}

function twilioErrorStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : null;
}

function optionalNonNegativeInteger(value: unknown) {
  if (value == null || (typeof value === "string" && value.trim() === "")) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function optionalPositiveInteger(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseTwilioProviderReportedCost(
  rawAmount: unknown,
  rawCurrency: unknown
) {
  if (rawAmount === null || rawAmount === undefined || rawAmount === "") {
    return undefined;
  }
  if (typeof rawAmount !== "string" ||
      typeof rawCurrency !== "string" ||
      !/^[A-Z]{3}$/.test(rawCurrency)) {
    throw new Error("TWILIO_CALL_COST_INVALID");
  }
  const match = /^-?(\d+)(?:\.(\d{1,6}))?$/.exec(rawAmount);
  if (!match) throw new Error("TWILIO_CALL_COST_INVALID");
  const whole = BigInt(match[1]!);
  const fractional = BigInt((match[2] ?? "").padEnd(6, "0"));
  const amountMicros = whole * 1_000_000n + fractional;
  if (amountMicros > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("TWILIO_CALL_COST_INVALID");
  }
  return {
    amountMicros: Number(amountMicros),
    currency: rawCurrency,
    rawAmount
  };
}
