import "./config/load-env";
import { CallService } from "./call-service";
import {
  createCallRuntimeDependenciesFromEnv
} from "./runtime/call-runtime-dependencies";
import {
  createGracefulShutdown,
  registerProcessShutdown
} from "./runtime/graceful-shutdown";
import { writePiiSafeOperationalError } from "./runtime/pii-safe-logger";

const {
  repository,
  telephonyProvider,
  postCallTranscriber
} = createCallRuntimeDependenciesFromEnv();
const service = new CallService(
  repository,
  telephonyProvider,
  () => writePiiSafeOperationalError("durable_worker_operation_failed"),
  postCallTranscriber,
  undefined,
  undefined,
  undefined,
  {
    durableWorkerMode: "external",
    durableWorkerEnabled: true,
    durableWorkerKeepAlive: true,
    reportDurableWorkerHeartbeat: true,
    liveEventMode: "publish"
  }
);
const initialization = service.initialize();
const shutdown = createGracefulShutdown(
  async () => {
    await initialization.catch(() => undefined);
    await service.close();
  },
  () => writePiiSafeOperationalError("durable_worker_shutdown_failed")
);
registerProcessShutdown(shutdown);

const recoveredCalls = await initialization.catch(async (error) => {
  await service.close();
  throw error;
});
process.stdout.write(`${JSON.stringify({
  event: "durable_worker_ready",
  recoveredCalls
})}\n`);
