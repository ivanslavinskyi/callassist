import "./config/load-env";
import { CallService } from "./call-service";
import {
  createCallRuntimeDependenciesFromEnv
} from "./runtime/call-runtime-dependencies";
import {
  createGracefulShutdown,
  registerProcessShutdown
} from "./runtime/graceful-shutdown";

const {
  repository,
  telephonyProvider,
  postCallTranscriber
} = createCallRuntimeDependenciesFromEnv();
const service = new CallService(
  repository,
  telephonyProvider,
  (error) => console.error("Durable worker operation failed", error),
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
  (error) => console.error("Durable worker shutdown failed", error)
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
