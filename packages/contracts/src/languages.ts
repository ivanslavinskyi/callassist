import { z } from "zod";

/** Syntax is separate from the capabilities of UI, text and voice providers. */
export function normalizeLanguageTag(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 35 || !/^[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]{2,8})*$/.test(trimmed)) return null;
  try { return Intl.getCanonicalLocales(trimmed)[0] ?? null; } catch { return null; }
}

export const languageTagSchema = z.string().transform((value, context) => {
  const language = normalizeLanguageTag(value);
  if (!language) {
    context.addIssue({ code: "custom", message: "Invalid language tag" });
    return z.NEVER;
  }
  return language;
});
export type LanguageTag = z.infer<typeof languageTagSchema>;
export const SUPPORTED_UI_LOCALES = ["en", "de"] as const;
export const supportedUiLocaleSchema = z.enum(SUPPORTED_UI_LOCALES);
export const TEXT_LANGUAGES = ["en", "de", "fr", "it", "ru", "uk"] as const;
export const textLanguageSchema = z.enum(TEXT_LANGUAGES);
export type TextLanguage = z.infer<typeof textLanguageSchema>;
export const preferredContentLanguageSchema = textLanguageSchema.nullable();

// Explicit written-language aliases; do not discard arbitrary script/region subtags.
const writtenAliases: Readonly<Record<string, TextLanguage>> = {
  "en-GB": "en", "en-US": "en", "de-DE": "de", "de-CH": "de",
  "fr-FR": "fr", "fr-CH": "fr", "it-IT": "it", "it-CH": "it",
  "ru-RU": "ru", "uk-UA": "uk"
};
export function supportedTextLanguage(value: string | null | undefined): TextLanguage | null {
  if (!value) return null;
  const tag = normalizeLanguageTag(value);
  if (!tag) return null;
  const parsed = textLanguageSchema.safeParse(tag);
  return parsed.success ? parsed.data : writtenAliases[tag] ?? null;
}

export const taskLanguagePreferencesSchema = z.strictObject({
  mode: z.enum(["auto", "manual"]),
  targetLanguage: textLanguageSchema.optional(),
  uiLocaleHint: languageTagSchema.optional()
}).superRefine((value, context) => {
  if ((value.mode === "manual") !== (value.targetLanguage !== undefined)) {
    context.addIssue({ code: "custom", path: ["targetLanguage"], message: "Choose a target language only in manual mode" });
  }
});
export type TaskLanguagePreferences = z.infer<typeof taskLanguagePreferencesSchema>;

export const languageSelectionSourceSchema = z.enum(["task", "account", "detection", "ui_fallback", "default"]);
export const callLanguageContextSchema = z.object({
  taskContentLanguage: textLanguageSchema,
  selectionSource: languageSelectionSourceSchema,
  selectionRevision: z.number().int().positive(),
  detectedInputLanguage: languageTagSchema.nullable(),
  detectionStatus: z.enum(["detected", "mixed", "undetermined"]),
  compilationRevision: z.number().int().positive()
});
export type CallLanguageContext = z.infer<typeof callLanguageContextSchema>;

export function resolveTaskLanguage(input: {
  preferences?: TaskLanguagePreferences;
  accountPreference?: TextLanguage | null;
  detectedLanguage?: string | null;
  compilationRevision: number;
  previous?: CallLanguageContext | null;
}): CallLanguageContext {
  const detectedTag = input.detectedLanguage ? normalizeLanguageTag(input.detectedLanguage) : null;
  const detection = {
    detectedInputLanguage: detectedTag && !["und", "mul"].includes(detectedTag) ? detectedTag : null,
    detectionStatus: detectedTag === "mul" ? "mixed" as const : detectedTag && detectedTag !== "und" ? "detected" as const : "undetermined" as const,
    compilationRevision: input.compilationRevision
  };
  if (input.preferences?.mode === "manual" && input.preferences.targetLanguage) {
    return { ...detection, taskContentLanguage: input.preferences.targetLanguage, selectionSource: "task", selectionRevision: (input.previous?.selectionRevision ?? 0) + 1 };
  }
  if (input.previous) return { ...input.previous, ...detection };
  const detected = supportedTextLanguage(detectedTag);
  const fallback = supportedTextLanguage(input.preferences?.uiLocaleHint);
  return {
    ...detection,
    taskContentLanguage: detected ?? input.accountPreference ?? fallback ?? "en",
    selectionSource: detected ? "detection" : input.accountPreference ? "account" : fallback ? "ui_fallback" : "default",
    selectionRevision: 1
  };
}

export const contentLanguageUpdateSchema = z.strictObject({
  targetLanguage: textLanguageSchema,
  expectedSelectionRevision: z.number().int().positive()
});
