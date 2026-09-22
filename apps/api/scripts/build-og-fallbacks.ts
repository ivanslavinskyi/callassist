import { mkdir, writeFile } from "node:fs/promises";
import { uiLocales, uiLocaleRegistry } from "@callassist/contracts";
import { renderOgImage } from "../src/og-renderer";

const directory = new URL("../../web/public/og/home/", import.meta.url);
await mkdir(directory, { recursive: true });
for (const locale of uiLocales) {
  const { png } = await renderOgImage(uiLocaleRegistry[locale].slogan);
  await writeFile(new URL(`${locale}.png`, directory), png);
  console.log(`${locale}: ${png.length} bytes`);
}
