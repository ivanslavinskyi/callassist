import "./config/load-env";
import { createBriefCompilerFromEnv } from "./brief-compiler/create-brief-compiler";
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

const {
  repository,
  telephonyProvider,
  postCallTranscriber
} = createCallRuntimeDependenciesFromEnv();
const authRepository = createAuthRepositoryFromEnv();
const textProcessor = createTextProcessorFromEnv();
const service = new CallService(
  repository,
  telephonyProvider,
  () => writePiiSafeOperationalError("durable_worker_operation_failed"),
  postCallTranscriber,
  createBriefCompilerFromEnv(),
  undefined,
  undefined,
  {
    durableWorkerMode: "external",
    durableWorkerEnabled: true,
    durableWorkerKeepAlive: true,
    reportDurableWorkerHeartbeat: true,
    liveEventMode: "publish",
    textProcessor, textCapabilities: textCapabilitiesFromEnv(textProcessor)
  }
);
const accountDeletionService = new AccountDeletionService({
  authRepository,
  callService: service,
  workerEnabled: true,
  keepAlive: true
});
const initialization = service.initialize();
const shutdown = createGracefulShutdown(
  async () => {
    await initialization.catch(() => undefined);
    await accountDeletionService.close();
    await service.close();
    await authRepository.close();
  },
  () => writePiiSafeOperationalError("durable_worker_shutdown_failed")
);
registerProcessShutdown(shutdown);

const recoveredCalls = await initialization.catch(async (error) => {
  await accountDeletionService.close();
  await service.close();
  await authRepository.close();
  throw error;
});
accountDeletionService.start();
process.stdout.write(`${JSON.stringify({
  event: "durable_worker_ready",
  recoveredCalls
})}\n`);
