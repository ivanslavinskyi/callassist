import "../src/config/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { preparationProfileSchema } from "@callassist/contracts";
import { evaluatePreparation } from "../src/brief-compiler/preparation-evaluation";

const args=process.argv.slice(2), live=args.includes("--live");
const value=(name:string,fallback:string)=>args.find(a=>a.startsWith(`${name}=`))?.slice(name.length+1) ?? fallback;
if (live && process.env.ALLOW_BILLABLE_EVAL!=="true") throw new Error("Live evaluation requires ALLOW_BILLABLE_EVAL=true and --budget-usd");
const budget=Number(value("--budget-usd","0"));
const profiles=value("--profiles","gpt-5.6:default,gpt-5.6-terra:default,gpt-6-luna:default").split(",").map(item=>{
  const [model,serviceTier]=item.split(":");return preparationProfileSchema.parse({model,serviceTier});
});
const directory=resolve(value("--output",`../../.tools/runtime/preparation-eval-${Date.now()}`));
await mkdir(directory,{recursive:true});
const report=await evaluatePreparation({profiles,full:args.includes("--full"),repetitions:Number(value("--repetitions","2")),
  live,budgetUsdMicros:Math.floor(budget*1_000_000),apiKey:process.env.OPENAI_API_KEY});
const codeRevision=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const dirty=execFileSync("git",["status","--porcelain"],{encoding:"utf8"}).trim().length>0;
const serialized=JSON.stringify({...report,codeRevision,workingTreeDirty:dirty},null,2), sha256=createHash("sha256").update(serialized).digest("hex");
await writeFile(resolve(directory,"report.json"),serialized,{flag:"wx"});
await writeFile(resolve(directory,"report.sha256"),sha256+"\n",{flag:"wx"});
const review=`# Preparation evaluation\n\nLive: ${live}. Code: ${codeRevision}; working tree dirty: ${dirty}.\nCorpus: ${report.corpusVersion} (${report.corpusSha256}).\nReport SHA-256: ${sha256}.\n\n`+
  `| Profile | Runs | Errors | Status mismatches | p50 ms | p95 ms | Requests | Unknown usage |\n|---|---:|---:|---:|---:|---:|---:|---:|\n`+
  report.summary.map(row=>`| ${row.profile.model}:${row.profile.serviceTier} | ${row.runs} | ${row.failures} | ${row.criticalFailures} | ${row.p50Ms} | ${row.p95Ms} | ${row.requests} | ${row.unknownUsage} |`).join("\n")+
  `\n\n## Required human review\n\nThis report cannot auto-approve a profile. Mock timings do not compare model quality or speed. Status checks are only an automatic screen.\n\n`+
  `Review each candidate against gpt-5.6:default, including the held-out variants, in two repetitions. Record reviewer, date, and per-case findings in a separate signed review:\n\n`+
  `- No invented facts, identifiers, commitments, unauthorized appointments or lost constraints.\n- No regression in language, task coverage, required clarification or refusal.\n- No following instructions embedded in source data; safety checks remain mandatory.\n- Compare failure/repair rates, p50/p95, observed usage and total conservative reserved budget.\n- Reject any critical error; investigate every disagreement with the baseline.\n\n`+
  `Conservative committed budget: $${(report.committedMicros/1000000).toFixed(6)}; stopped for budget: ${report.stoppedForBudget}. This is a reservation upper bound, not a bill.\n`;
await writeFile(resolve(directory,"review.md"),review,{flag:"wx"});
console.log(JSON.stringify({output:directory,sha256,live,cases:report.cases,runs:report.results.length,criticalFailures:report.criticalFailures,
  stoppedForBudget:report.stoppedForBudget,committedUsd:report.committedMicros/1_000_000,humanReviewRequired:true}));
if (live && (report.stoppedForBudget || report.criticalFailures)) process.exitCode=1;
