import "../src/config/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { completeCmsLocales } from "../src/content/cms-localization-completion";

const args = process.argv.slice(2);
const argument = (name: string) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const output = argument("--output");
if (!output) throw new Error("--output is required; keep the plan under ignored .tools/public-content");
const outputPath = resolve(output);
await mkdir(dirname(outputPath), { recursive: true });
// Reserve the report before mutations; never overwrite an earlier repair record.
await writeFile(outputPath, "", { flag: "wx" });
const result = await completeCmsLocales(process.env.DATABASE_URL, {
  apply: args.includes("--apply"), actorEmail: argument("--actor-email")
});
await writeFile(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify({ mode: result.mode, ...result.summary }, null, 2));
