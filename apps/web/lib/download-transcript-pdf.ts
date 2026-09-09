import * as pdfMake from "pdfmake/build/pdfmake";
import pdfFonts from "pdfmake/build/vfs_fonts";
import type { TDocumentDefinitions } from "pdfmake/interfaces";

pdfMake.addVirtualFileSystem(pdfFonts);

let logoRequest: Promise<string> | undefined;

/** Reuse the actual website wordmark, including when exporting from the dark UI. */
export function loadTranscriptLogo(): Promise<string> {
  logoRequest ??= fetch("/brand/logo-light.svg")
    .then(async response => {
      if (!response.ok) throw new Error("TRANSCRIPT_LOGO_UNAVAILABLE");
      const svg = await response.text();
      if (!svg.trimStart().startsWith("<svg")) throw new Error("TRANSCRIPT_LOGO_INVALID");
      return svg;
    })
    .catch(error => { logoRequest = undefined; throw error; });
  return logoRequest;
}

export async function downloadTranscriptPdf(
  definition: TDocumentDefinitions,
  fileName: string
) {
  await pdfMake.createPdf(definition).download(fileName);
}
