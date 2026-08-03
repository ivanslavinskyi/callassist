import "./config/load-env";
import { buildApp } from "./app";
import { CallService } from "./call-service";
import { createCallRepositoryFromEnv } from "./storage/create-call-repository";

const repository = createCallRepositoryFromEnv();
const service = new CallService(repository, (error) => {
  app.log.error(error, "Background call operation failed");
});
const app = buildApp({ service });
const recoveredCalls = await service.initialize();
const port = Number(process.env.PORT ?? 4000);
await app.listen({ host: "0.0.0.0", port });

if (recoveredCalls > 0) {
  app.log.warn({ recoveredCalls }, "Interrupted calls were marked as failed");
}
