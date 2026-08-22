import { createCallRepositoryFromEnv } from "../storage/create-call-repository";
import { createTelephonyProviderFromEnv } from "../telephony/create-telephony-provider";
import { TwilioTelephonyProvider } from "../telephony/twilio-telephony-provider";
import { OpenAIPostCallTranscriber } from "../transcription/openai-post-call-transcriber";

export function createCallRuntimeDependenciesFromEnv() {
  const repository = createCallRepositoryFromEnv();
  const telephonyProvider = createTelephonyProviderFromEnv();
  const realtimeApiKey = telephonyProvider instanceof TwilioTelephonyProvider
    ? requireEnvironmentVariable("OPENAI_API_KEY")
    : null;
  const postCallTranscriber = realtimeApiKey
    ? new OpenAIPostCallTranscriber({
        apiKey: realtimeApiKey,
        model: process.env.OPENAI_POST_CALL_TRANSCRIPTION_MODEL,
        utteranceModel:
          process.env.OPENAI_POST_CALL_UTTERANCE_TRANSCRIPTION_MODEL ??
          "gpt-4o-transcribe"
      })
    : undefined;
  return {
    repository,
    telephonyProvider,
    realtimeApiKey,
    postCallTranscriber
  };
}

export function requireEnvironmentVariable(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required when TELEPHONY_DRIVER=twilio`);
  }
  return value;
}
