import { cp, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(packageRoot, "src/db/migrations");
const destination = resolve(packageRoot, "dist/db/migrations");

await mkdir(dirname(destination), { recursive: true });
await cp(source, destination, { recursive: true });
