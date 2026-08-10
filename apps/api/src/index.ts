import "./config/load-env";
import { buildApp, buildWebhookApp } from "./app";
import { CallService } from "./call-service";
import {
  OpenAIRealtimeBridge,
  type RealtimeTranscriptionDelay
} from "./realtime/openai-realtime-bridge";
import { createCallRepositoryFromEnv } from "./storage/create-call-repository";
import { createTelephonyProviderFromEnv } from "./telephony/create-telephony-provider";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";
import { OpenAIPostCallTranscriber } from "./transcription/openai-post-call-transcriber";

const repository = createCallRepositoryFromEnv();
const telephonyProvider = createTelephonyProviderFromEnv();
const openAIApiKey =
  telephonyProvider instanceof TwilioTelephonyProvider
    ? requireEnvironmentVariable("OPENAI_API_KEY")
    : null;
const postCallTranscriber = openAIApiKey
  ? new OpenAIPostCallTranscriber({
      apiKey: openAIApiKey,
      model: process.env.OPENAI_POST_CALL_TRANSCRIPTION_MODEL
    })
  : undefined;
const service = new CallService(repository, telephonyProvider, (error) => {
  app.log.error(error, "Background call operation failed");
}, postCallTranscriber);
const app = buildApp({ service });
const realtimeBridge =
  telephonyProvider instanceof TwilioTelephonyProvider
    ? new OpenAIRealtimeBridge({
        apiKey: openAIApiKey!,
        service,
        validateStreamToken: (callBriefId, token) =>
          telephonyProvider.validateMediaStreamToken(callBriefId, token),
        model: process.env.OPENAI_REALTIME_MODEL,
        transcriptionModel: process.env.OPENAI_TRANSCRIPTION_MODEL,
        transcriptionDelay: parseTranscriptionDelay(
          process.env.OPENAI_TRANSCRIPTION_DELAY
        ),
        maleVoice: process.env.OPENAI_REALTIME_MALE_VOICE,
        femaleVoice: process.env.OPENAI_REALTIME_FEMALE_VOICE,
        logger: app.log
      })
    : null;
const webhookApp =
  telephonyProvider instanceof TwilioTelephonyProvider && realtimeBridge
    ? buildWebhookApp({
        service,
        twilioProvider: telephonyProvider,
        realtimeBridge
      })
    : null;
if (webhookApp) {
  app.addHook("onClose", async () => {
    await webhookApp.close();
  });
}
const recoveredCalls = await service.initialize();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });

if (webhookApp) {
  const webhookPort = Number(process.env.TWILIO_WEBHOOK_PORT ?? 4001);
  await webhookApp.listen({ host: "127.0.0.1", port: webhookPort });
  app.log.info(
    { webhookHost: "127.0.0.1", webhookPort },
    "Twilio webhook gateway listening"
  );
}

if (recoveredCalls > 0) {
  app.log.warn({ recoveredCalls }, "Interrupted calls were marked as failed");
}

function requireEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when TELEPHONY_DRIVER=twilio`);
  return value;
}

function parseTranscriptionDelay(
  value: string | undefined
): RealtimeTranscriptionDelay | undefined {
  if (!value) return undefined;
  if (["minimal", "low", "medium", "high", "xhigh"].includes(value)) {
    return value as RealtimeTranscriptionDelay;
  }
  throw new Error(
    "OPENAI_TRANSCRIPTION_DELAY must be minimal, low, medium, high, or xhigh"
  );
}
