import { TEXT_LANGUAGES, supportedTextLanguage, textArtifactKindSchema, type TextArtifactKind, type TextLanguage } from "@callassist/contracts";
import type { TextProcessor } from "./text-processor";

export type TextDirection = { kind: TextArtifactKind; sourceLanguage: TextLanguage | "*"; targetLanguage: TextLanguage };
export type TextCapabilities = { enabled: boolean; directions: TextDirection[] };

export function allTextDirections(): TextDirection[] {
  return textArtifactKindSchema.options.flatMap((kind) => TEXT_LANGUAGES.map((targetLanguage) => ({ kind, sourceLanguage: "*" as const, targetLanguage })));
}

/** Real directions are enabled independently after language-quality checks. Reads never depend on this switch. */
export function textCapabilitiesFromEnv(processor: TextProcessor, environment: NodeJS.ProcessEnv = process.env): TextCapabilities {
  const raw = environment.TEXT_ARTIFACT_GENERATION_ENABLED?.trim();
  if (raw && raw !== "true" && raw !== "false") throw new Error("TEXT_ARTIFACT_GENERATION_ENABLED must be true or false");
  const enabled = raw ? raw === "true" : processor.driver === "mock";
  const configured = environment.TEXT_ARTIFACT_DIRECTIONS?.trim();
  if (!configured) return { enabled, directions: processor.driver === "mock" ? allTextDirections() : [] };
  // Example: plan_review:de:ru,transcript_translation:*:ru,call_summary:*:ru
  const directions = configured.split(",").map((entry): TextDirection => {
    const [kind, source, target, extra] = entry.trim().split(":");
    const parsedKind = textArtifactKindSchema.safeParse(kind);
    const sourceLanguage = source === "*" ? "*" : supportedTextLanguage(source);
    const targetLanguage = supportedTextLanguage(target);
    if (extra || !parsedKind.success || !sourceLanguage || !targetLanguage) throw new Error("Invalid TEXT_ARTIFACT_DIRECTIONS entry");
    return { kind: parsedKind.data, sourceLanguage, targetLanguage };
  });
  return { enabled, directions };
}

export function textDirectionEnabled(capabilities: TextCapabilities, kind: TextArtifactKind, sourceLanguage: string | null, targetLanguage: TextLanguage) {
  const source = supportedTextLanguage(sourceLanguage);
  return capabilities.enabled && capabilities.directions.some((direction) => direction.kind === kind && direction.targetLanguage === targetLanguage &&
    (direction.sourceLanguage === "*" || direction.sourceLanguage === source));
}
