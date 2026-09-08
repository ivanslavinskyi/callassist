// Run: node scripts/generate-favicons.mjs. Uses the sharp already bundled with Next.
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const nextRequire = createRequire(require.resolve("next/package.json"));
const sharp = nextRequire("sharp");
const root = new URL("../", import.meta.url);
const source = await readFile(new URL("Design/shprohli-icon.svg", root), "utf8");
const brand = source.replaceAll("#0048C0", "#222B25").replaceAll("#06D2CA", "#138553");
await writeFile(new URL("apps/web/public/brand/icon.svg", root), brand);
// A light tile keeps the requested dark outline visible in dark browser chrome.
const icon = brand.replace("  <path", '  <rect width="156" height="156" rx="24" fill="#f5f8f6"/>\n  <path');
await writeFile(new URL("apps/web/app/icon.svg", root), icon);
await sharp(Buffer.from(icon)).resize(180, 180).png().toFile(fileURLToPath(new URL("apps/web/app/apple-icon.png", root)));
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map(size => sharp(Buffer.from(icon)).resize(size, size).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((size, index) => {
  const entry = 6 + index * 16;
  header[entry] = header[entry + 1] = size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(pngs[index].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += pngs[index].length;
});
await writeFile(new URL("apps/web/app/favicon.ico", root), Buffer.concat([header, ...pngs]));
