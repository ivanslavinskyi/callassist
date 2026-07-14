import "./config/load-env";
import { buildApp } from "./app";
import { CallService } from "./call-service";
import { createCallRepositoryFromEnv } from "./storage/create-call-repository";
import { createTelephonyProviderFromEnv } from "./telephony/create-telephony-provider";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

const repository = createCallRepositoryFromEnv();
const telephonyProvider = createTelephonyProviderFromEnv();
const service = new CallService(repository, telephonyProvider, (error) => {
  app.log.error(error, "Background call operation failed");
});
const app = buildApp({
  service,
  twilioProvider:
    telephonyProvider instanceof TwilioTelephonyProvider
      ? telephonyProvider
      : undefined
});
const recoveredCalls = await service.initialize();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });

if (recoveredCalls > 0) {
  app.log.warn({ recoveredCalls }, "Interrupted calls were marked as failed");
}
