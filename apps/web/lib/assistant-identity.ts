import { ASSISTANT_NAME } from "@callassist/contracts";

export { ASSISTANT_NAME as ASSISTANT_DISPLAY_NAME } from "@callassist/contracts";

/** Display-only spelling for the German pronunciation example. Keep source
 * evidence intact, and leave other speakers and mentions of other people alone. */
export function transcriptDisplayText(segment: { role: string; text: string }): string {
  if (segment.role !== "assistant") return segment.text;
  return segment.text.replace(
    /\b((?:ich\s+bin|mein\s+name\s+ist|hier\s+spricht)\s+)Schprochli(?![\p{L}\p{N}_])/giu,
    (_match, introduction: string) => `${introduction}${ASSISTANT_NAME}`
  );
}
