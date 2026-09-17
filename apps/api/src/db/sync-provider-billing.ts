import "../config/load-env";
import { syncProviderBilling } from "../billing/sync-provider-billing";

const results = await syncProviderBilling(process.env, new Date(), process.argv.includes("--force"));
process.stdout.write(`${JSON.stringify(results)}\n`);
if (results.some(result => result.status === "sync_failed")) process.exitCode = 1;
