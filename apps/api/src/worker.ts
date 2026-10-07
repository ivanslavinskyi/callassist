import { workerCapacity } from "./config/worker-capacity";
import { createCallRepositoryFromEnv } from "./storage/create-call-repository";
import { MockTelephonyProvider } from "./telephony/mock-telephony-provider";
// SPDX-License-Identifier: LicenseRef-Proprietary
// Copyright (c) 2026 Ivan Slavinskyi. All rights reserved.
import { startProviderBillingSync } from "./billing/sync-provider-billing";
import { createNotificationsFromEnv, createUserCallNotificationsFromEnv } from "./notifications/create-notifications";
import "./config/load-env";
import { createTelemetryExportsFromEnv } from "./telemetry-export/service";
import { createBriefCompilerFromEnv, preparationTimeoutMsFromEnv } from "./brief-compiler/create-brief-compiler";
import { CallService } from "./call-service";
import { createTextProcessorFromEnv } from "./text-processing/text-processor";
import { textCapabilitiesFromEnv } from "./text-processing/text-capabilities";
import { AccountDeletionService } from "./auth/account-deletion-service";
import { createAuthRepositoryFromEnv } from "./auth/create-auth-repository";
import { validateRuntimeEnvironment } from "./config/runtime-environment";
import {
  createCallRuntimeDependenciesFromEnv
} from "./runtime/call-runtime-dependencies";
import {
  createGracefulShutdown,
  registerProcessShutdown
} from "./runtime/graceful-shutdown";
import { writePiiSafeOperationalError } from "./runtime/pii-safe-logger";

validateRuntimeEnvironment(process.env, "worker");
const capacity = workerCapacity();
const background = ["all", "background"].includes(capacity.role);

const {
  repository,
  telephonyProvider,
  postCallTranscriber
} = capacity.role === "preparation" ? { repository: createCallRepositoryFromEnv(), telephonyProvider: new MockTelephonyProvider(), postCallTranscriber: undefined } : createCallRuntimeDependenciesFromEnv();
const authRepository = background ? createAuthRepositoryFromEnv() : undefined;
const telemetryExports = background ? createTelemetryExportsFromEnv() : undefined;
const notifications = background ? createNotificationsFromEnv(repository, true) : undefined;
const userCallNotifications = background ? createUserCallNotificationsFromEnv(repository, true) : undefined;
const textProcessor = createTextProcessorFromEnv();
const service = new CallService(
  repository,
  telephonyProvider,
  error => writePiiSafeOperationalError("durable_worker_operation_failed", error),
  postCallTranscriber,
  createBriefCompilerFromEnv(),
  undefined,
  undefined,
  {
    workerRole: capacity.role, preparationSlots: capacity.preparationSlots, reviewSlots: capacity.reviewSlots,
    durableWorkerMode: "external",
    preparationTimeoutMs: preparationTimeoutMsFromEnv(),
    durableWorkerEnabled: true,
    durableWorkerKeepAlive: true,
    reportDurableWorkerHeartbeat: true,
    liveEventMode: "publish",
    textProcessor, textCapabilities: textCapabilitiesFromEnv(textProcessor)
  }
);
const accountDeletionService = authRepository ? new AccountDeletionService({
  authRepository,
  callService: service,
  workerEnabled: true,
  keepAlive: true
}) : undefined;
const stopBillingSync = background ? startProviderBillingSync(result => process.stdout.write(`${JSON.stringify({ event: "provider_billing_sync", result })}\n`)) : async () => {};
let maintenance: Promise<void> | null = null;
const maintain = () => { if (!maintenance) maintenance = repository.maintainPreparationTelemetry()
  .catch(error => writePiiSafeOperationalError("preparation_telemetry_retention_failed",error)).finally(() => { maintenance = null; }); };
const retentionTimer = background ? setInterval(maintain, 3600000) : undefined;
const initialization = service.initialize().then(result => { if (background) maintain(); return result; });
const shutdown = createGracefulShutdown(
  async () => {
    if (retentionTimer) clearInterval(retentionTimer);
    await initialization.catch(() => undefined);
    await maintenance;
    await notifications?.close();
    await userCallNotifications?.close();
    await telemetryExports?.close();
    await accountDeletionService?.close();
    await stopBillingSync();
    await service.close();
    await authRepository?.close();
  },
  () => writePiiSafeOperationalError("durable_worker_shutdown_failed")
);
registerProcessShutdown(async () => {
  const forceExit=setTimeout(() => process.exit(1),45000);
  await shutdown(); clearTimeout(forceExit);
});

const recoveredCalls = await initialization.catch(async (error) => {
  if (retentionTimer) clearInterval(retentionTimer);
  await maintenance;
  await stopBillingSync();
  await notifications?.close();
  await userCallNotifications?.close();
  await telemetryExports?.close();
  await accountDeletionService?.close();
  await service.close();
  await authRepository?.close();
  throw error;
});
accountDeletionService?.start();
telemetryExports?.start(true);
notifications?.start();
userCallNotifications?.start();
process.stdout.write(`${JSON.stringify({
  event: "durable_worker_ready",
  role: capacity.role, preparationSlots: capacity.preparationSlots, reviewSlots: capacity.reviewSlots, poolMax: capacity.poolMax, recoveredCalls
})}\n`);
