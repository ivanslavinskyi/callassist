import "../src/config/load-env";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stagePublicContentRelease } from "../src/content/public-content-staging";

const args = process.argv.slice(2);
const candidatePath = args[0];
const apply = args.includes("--apply");
const actorIndex = args.indexOf("--actor-user-id"), outputIndex = args.indexOf("--output");
const actorUserId = actorIndex >= 0 ? args[actorIndex + 1] : undefined;
const output = outputIndex >= 0 ? args[outputIndex + 1] : undefined;
if (!process.env.DATABASE_URL || !candidatePath) throw new Error("DATABASE_URL and candidate JSON path are required; default mode is dry-run.");
if ((await stat(resolve(candidatePath))).size > 2_000_000) throw new Error("Candidate exceeds 2 MB.");
const candidate: unknown = JSON.parse(await readFile(resolve(candidatePath), "utf8"));
const report = await stagePublicContentRelease(process.env.DATABASE_URL, candidate, { apply, actorUserId });
const encoded = JSON.stringify(report, null, 2) + "\n";
if (output) {
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), encoded, { encoding: "utf8", flag: "wx" });
}
console.log(encoded);
