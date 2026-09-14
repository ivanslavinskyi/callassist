import { createRequire } from "node:module";
import { realpathSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Rasterize the existing brand vector for mail clients; no redesign or remote asset.
const require = createRequire(realpathSync(new URL("../apps/web/node_modules/next/package.json", import.meta.url)));
const sharp = require("sharp");
const source = new URL("../apps/web/public/brand/logo-light.svg", import.meta.url);
const target = new URL("../apps/api/src/auth/email-logo.ts", import.meta.url);
const png = await sharp(fileURLToPath(source)).resize({ width: 552 }).png().toBuffer();
await writeFile(target, `// Generated from apps/web/public/brand/logo-light.svg by scripts/build-email-logo.mjs.
// PNG is inlined in the API bundle for CID delivery; no public asset host is required.
export const emailLogo = {
  content_id: "shprohli-logo",
  filename: "shprohli-logo.png",
  content: ${JSON.stringify(png.toString("base64"))}
} as const;
`);
console.log(`Email logo generated (${png.length} bytes).`);
