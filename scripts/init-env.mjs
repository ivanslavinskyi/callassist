import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const encryptionKey = randomBytes(32).toString("base64");
const example = await readFile(examplePath, "utf8");
const contents = example.replace(
  /^DATA_ENCRYPTION_KEY=.*$/m,
  `DATA_ENCRYPTION_KEY=${encryptionKey}`
);

try {
  await writeFile(envPath, contents, { encoding: "utf8", flag: "wx" });
  console.info("Created .env with a fresh DATA_ENCRYPTION_KEY");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    console.info(".env already exists; left it unchanged");
  } else {
    throw error;
  }
}
