import * as pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

pdfMake.addVirtualFileSystem(pdfFonts);

export async function downloadTranscriptPdf(
  definition: TDocumentDefinitions,
  fileName: string
) {
  await pdfMake.createPdf(definition).download(fileName);
}
