import "./config/load-env";
import { buildApp, buildWebhookApp } from "./app";
import { AuthService } from "./auth/auth-service";
import { createAuthRepositoryFromEnv } from "./auth/create-auth-repository";
import { createVerificationProviderFromEnv } from "./auth/create-verification-provider";
import {
  DeterministicBriefCompiler,
  OpenAIBriefCompiler
} from "./brief-compiler/brief-compiler";
import { CallService } from "./call-service";
import { ContentService } from "./content/content-service";
import { createContentRepositoryFromEnv } from "./content/create-content-repository";
import { callAdmissionPolicyFromEnv } from "./config/call-admission-policy";
import { durableWorkerModeFromEnv } from "./config/durable-worker-mode";
import { endpointRateLimitPolicyFromEnv } from "./config/endpoint-rate-limit-policy";
import { operationalCostPolicyFromEnv } from "./config/operational-cost-policy";
import {
  CreditService,
  parsePromoCodeHashKey
} from "./credits/credit-service";
import {
  OpenAIRealtimeBridge,
  type RealtimeTranscriptionDelay
} from "./realtime/openai-realtime-bridge";
import {
  createCallRuntimeDependenciesFromEnv,
  requireEnvironmentVariable
} from "./runtime/call-runtime-dependencies";
import {
  createGracefulShutdown,
  registerProcessShutdown
} from "./runtime/graceful-shutdown";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

const {
  repository,
  telephonyProvider,
  realtimeApiKey,
  postCallTranscriber
} = createCallRuntimeDependenciesFromEnv();
const authRepository = createAuthRepositoryFromEnv();
const contentService = new ContentService(createContentRepositoryFromEnv());
await contentService.initialize();
const briefCompiler = createBriefCompiler();
const service = new CallService(
  repository,
  telephonyProvider,
  (error) => {
    app.log.error(error, "Background call operation failed");
  },
  postCallTranscriber,
  briefCompiler,
  callAdmissionPolicyFromEnv(),
  operationalCostPolicyFromEnv(),
  { durableWorkerMode: durableWorkerModeFromEnv() }
);
const authService = new AuthService({
  repository: authRepository,
  verificationProvider: createVerificationProviderFromEnv(),
  signupCreditGranter: service
});
const creditService = new CreditService({
  repository,
  authRepository,
  hashKey: parsePromoCodeHashKey(
    process.env.PROMO_CODE_HASH_KEY,
    process.env.DATA_ENCRYPTION_KEY
  )
});
const app = buildApp({
  service,
  authService,
  creditService,
  contentService,
  endpointRateLimitPolicy: endpointRateLimitPolicyFromEnv(),
  realtimeConfigured: telephonyProvider instanceof TwilioTelephonyProvider
});
const realtimeBridge =
  telephonyProvider instanceof TwilioTelephonyProvider
    ? new OpenAIRealtimeBridge({
        apiKey: realtimeApiKey!,
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

registerProcessShutdown(createGracefulShutdown(
  () => app.close(),
  (error) => app.log.error(error, "API shutdown failed")
));

if (recoveredCalls > 0) {
  app.log.warn({ recoveredCalls }, "Interrupted calls were marked as failed");
}

function createBriefCompiler() {
  const configuredKey = process.env.OPENAI_API_KEY?.trim();
  const driver =
    process.env.BRIEF_COMPILER_DRIVER?.trim() ||
    (configuredKey ? "openai" : "mock");
  if (driver === "mock") return new DeterministicBriefCompiler();
  if (driver === "openai") {
    return new OpenAIBriefCompiler({
      apiKey: requireEnvironmentVariable("OPENAI_API_KEY"),
      model: process.env.OPENAI_BRIEF_COMPILER_MODEL,
      timeoutMs: parsePositiveInteger(
        process.env.OPENAI_BRIEF_COMPILER_TIMEOUT_MS,
        "OPENAI_BRIEF_COMPILER_TIMEOUT_MS"
      ),
      requestTimeoutMs: parsePositiveInteger(
        process.env.OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS,
        "OPENAI_BRIEF_COMPILER_REQUEST_TIMEOUT_MS"
      )
    });
  }
  throw new Error(`Unsupported BRIEF_COMPILER_DRIVER: ${driver}`);
}

function parsePositiveInteger(value: string | undefined, name: string) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
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
