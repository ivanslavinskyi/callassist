import { supportedTextLanguage, type TextArtifactKind, type TextLanguage } from "@callassist/contracts";
import type { LanguageCapabilities } from "./api";

export function canGenerateText(capabilities: LanguageCapabilities | null, kind: TextArtifactKind, sourceLanguage: string, targetLanguage: TextLanguage) {
  if (!capabilities?.textGenerationEnabled) return false;
  const source = supportedTextLanguage(sourceLanguage) ?? sourceLanguage;
  return capabilities.operations.some((operation) => operation.kind === kind && operation.targetLanguage === targetLanguage &&
    (operation.sourceLanguage === "*" || operation.sourceLanguage === source));
}
