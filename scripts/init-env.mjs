import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const examplePath = resolve(root, ".env.example");
const envPath = resolve(root, ".env");
const encryptionKey = randomBytes(32).toString("base64");
const promoCodeHashKey = randomBytes(32).toString("base64");
const rateLimitHashKey = randomBytes(32).toString("base64");
const example = await readFile(examplePath, "utf8");
const contents = example
  .replace(
    /^DATA_ENCRYPTION_KEY=.*$/m,
    `DATA_ENCRYPTION_KEY=${encryptionKey}`
  )
  .replace(
    /^PROMO_CODE_HASH_KEY=.*$/m,
    `PROMO_CODE_HASH_KEY=${promoCodeHashKey}`
  )
  .replace(
    /^RATE_LIMIT_HASH_KEY=.*$/m,
    `RATE_LIMIT_HASH_KEY=${rateLimitHashKey}`
  );

try {
  await writeFile(envPath, contents, { encoding: "utf8", flag: "wx" });
  console.info(
    "Created .env with fresh encryption, promo-code, and rate-limit hash keys"
  );
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    console.info(".env already exists; left it unchanged");
  } else {
    throw error;
  }
}
