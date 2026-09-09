import "../src/config/load-env";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { ContentService } from "../src/content/content-service";
import { PostgresContentRepository } from "../src/content/postgres-content-repository";
import { buildPublicContentReleaseCandidate } from "../src/content/public-content-release";

// Read-only database operation. Do not call initialize(): live revisions are the source.
const databaseUrl = process.env.DATABASE_URL;
const output = process.argv[2];
if (!databaseUrl || !output) throw new Error("DATABASE_URL and an output JSON path are required.");
const repository = new PostgresContentRepository(databaseUrl);
try {
  const candidate = await buildPublicContentReleaseCandidate(new ContentService(repository));
  await mkdir(dirname(resolve(output)), { recursive: true });
  await writeFile(resolve(output), JSON.stringify(candidate, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
  console.log("Prepared a CMS release candidate. No draft or published content was changed.");
} finally {
  await repository.close();
}
