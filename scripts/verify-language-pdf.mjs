import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Uses the same shipped browser pdfmake/Roboto assets as the transcript export.
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const pdfMake = require("pdfmake/build/pdfmake");
pdfMake.addVirtualFileSystem(require("pdfmake/build/vfs_fonts"));
const output = new URL("../.tools/verification-language/language-export-cyrillic.pdf", import.meta.url);
const definition = {
  language: "ru", defaultStyle: { font: "Roboto", fontSize: 12 },
  content: [
    { text: "SHPROHLI — Перевод расшифровки", fontSize: 20, bold: true },
    { text: "Язык: русский · Quellversion: 2", margin: [0, 14, 0, 14] },
    { text: "[~00:12] Иван Müller: Документ ещё не получен. Не отправляйте оригинал.", margin: [0, 10, 0, 10] },
    { text: "Українська: Потрібна копія паспорта. Надішліть її електронною поштою.", margin: [0, 10, 0, 10] },
    { text: "Français : pièce d’identité · Deutsch: Grüsse · Italiano: disponibilità", margin: [0, 10, 0, 10] },
    { text: "Fictional export fixture. No call or provider request was made.", italics: true, fontSize: 9 }
  ]
};
await mkdir(dirname(fileURLToPath(output)), { recursive: true });
await writeFile(output, await pdfMake.createPdf(definition).getBuffer());
process.stdout.write("Created Unicode PDF verification fixture.\n");
