import "./config/load-env";
import { buildApp, buildWebhookApp } from "./app";
import { CallService } from "./call-service";
import { createCallRepositoryFromEnv } from "./storage/create-call-repository";
import { createTelephonyProviderFromEnv } from "./telephony/create-telephony-provider";
import { TwilioTelephonyProvider } from "./telephony/twilio-telephony-provider";

const repository = createCallRepositoryFromEnv();
const telephonyProvider = createTelephonyProviderFromEnv();
const service = new CallService(repository, telephonyProvider, (error) => {
  app.log.error(error, "Background call operation failed");
});
const app = buildApp({ service });
const webhookApp =
  telephonyProvider instanceof TwilioTelephonyProvider
    ? buildWebhookApp({ service, twilioProvider: telephonyProvider })
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
