import "../config/load-env";
import { pathToFileURL } from "node:url";
import { createCallRepositoryFromEnv } from "../storage/create-call-repository";

export async function setOutboundCallsFromCli(args = process.argv.slice(2)) {
  const [action, ...reasonParts] = args;
  if (action !== "enable" && action !== "disable") {
    throw new Error("Usage: set-outbound-calls <enable|disable> <reason>");
  }
  const reason = reasonParts.join(" ").trim();
  if (!reason) {
    throw new Error("A non-empty audit reason is required");
  }
  if (process.env.STORAGE_DRIVER?.trim() !== "postgres") {
    throw new Error("The outbound-call control requires STORAGE_DRIVER=postgres");
  }

  const repository = createCallRepositoryFromEnv();
  const enabled = action === "enable";
  try {
    await repository.setOutboundCallsEnabled(enabled, { reason });
  } finally {
    await repository.close();
  }
  console.info(`Outbound calls ${enabled ? "enabled" : "disabled"}: ${reason}`);
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isEntrypoint) {
  await setOutboundCallsFromCli();
}
