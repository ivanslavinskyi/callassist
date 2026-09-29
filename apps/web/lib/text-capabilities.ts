import { supportedTextLanguage, type TextArtifactKind, type TextLanguage } from "@callassist/contracts";
import type { LanguageCapabilities } from "./api";

export function canGenerateText(capabilities: LanguageCapabilities | null, kind: TextArtifactKind, sourceLanguage: string, targetLanguage: TextLanguage) {
  if (!capabilities?.textGenerationEnabled) return false;
  const source = supportedTextLanguage(sourceLanguage) ?? sourceLanguage;
  return capabilities.operations.some((operation) => operation.kind === kind && (operation.targetLanguage === "*" || operation.targetLanguage === targetLanguage) &&
    (operation.sourceLanguage === "*" || operation.sourceLanguage === source));
}

/** Translation is a task-language aid, not a generic duplicate of the call transcript. */
export function needsTranscriptTranslation(detectedInputLanguage: string | null | undefined, callLanguage: string) {
  const source = supportedTextLanguage(detectedInputLanguage);
  const call = supportedTextLanguage(callLanguage);
  return source !== null && call !== null && source !== call;
}
