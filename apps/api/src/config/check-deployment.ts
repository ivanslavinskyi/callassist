import "./load-env";
import { checkDeployment } from "./deployment-check";

// Read-only: reports field names, never credential values or provider payloads.
const report = checkDeployment(process.env);
console.log(JSON.stringify(report, null, 2));
if (!report.configurationValid) process.exitCode = 1;
