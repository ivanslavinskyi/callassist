import { z } from "zod";

/** Pronunciation spelling only. Never use it as a legal/booking identity. */
export const spokenIdentitiesSchema = z.object({
  version: z.literal(1),
  recipient: z.object({ original: z.string(), spoken: z.string() }),
  representedPerson: z.object({ original: z.string(), spoken: z.string() })
});
export type SpokenIdentities = z.infer<typeof spokenIdentitiesSchema>;

const latin: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "yo", ж: "zh", з: "z", и: "i", й: "y",
  к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f",
  х: "kh", ц: "ts", ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
  і: "i", ї: "yi", є: "ye", ґ: "g"
};

export function spokenIdentityName(original: string, callLocale: string) {
  if (!/^(de|en|fr|it|rm)(-|$)/.test(callLocale)) return original;
  return Array.from(original, char => {
    const lower = char.toLowerCase(), replacement = latin[lower];
    if (replacement === undefined) return char;
    return char === lower ? replacement : replacement.charAt(0).toUpperCase() + replacement.slice(1);
  }).join("");
}

export function createSpokenIdentities(callLocale: string, recipient: string, representedPerson: string): SpokenIdentities {
  const identity = (original: string) => ({ original, spoken: spokenIdentityName(original, callLocale) });
  return { version: 1, recipient: identity(recipient), representedPerson: identity(representedPerson) };
}

/** Only known identity occurrences in human-language text, never arbitrary Russian prose.
 * IDs, URLs and addresses must not be passed through this speech-only projection. */
export function projectSpokenIdentityText(text: string, identities: SpokenIdentities) {
  const pairs = [identities.recipient, identities.representedPerson]
    .filter(pair => pair.original && pair.original !== pair.spoken).sort((a, b) => b.original.length - a.original.length);
  if (!pairs.length) return text;
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}_@/])(?:${pairs.map(pair => escape(pair.original)).join("|")})(?![\\p{L}\\p{N}_@/])`, "gu");
  return text.replace(pattern, match => pairs.find(pair => pair.original === match)!.spoken);
}
