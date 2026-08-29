import type { CallLocale } from "@callassist/contracts";

export type ConsentDecision = "affirmative" | "negative" | "unclear";

const phrases: Record<
  CallLocale,
  { affirmative: readonly string[]; negative: readonly string[] }
> = {
  "de-CH": germanPhrases(),
  "de-DE": germanPhrases(),
  "fr-CH": {
    affirmative: ["oui", "d accord", "bien sur", "vous pouvez"],
    negative: ["non", "je ne suis pas d accord", "n enregistrez pas"]
  },
  "it-CH": {
    affirmative: ["si", "va bene", "certo", "puo registrare"],
    negative: ["no", "non voglio", "non registrare"]
  },
  "en-GB": englishPhrases(),
  "en-US": englishPhrases(),
  "ru-RU": {
    affirmative: ["да", "хорошо", "конечно", "можете", "согласен", "согласна"],
    negative: ["нет", "не записывайте", "не записывай", "я не согласен", "я не согласна"]
  }
};

export function classifyConsent(
  text: string,
  locale: CallLocale
): ConsentDecision {
  const normalized = normalize(text);
  if (!normalized || normalized.split(" ").length > 10) return "unclear";

  const localePhrases = phrases[locale];
  if (containsAny(normalized, localePhrases.negative)) return "negative";
  if (matchesAny(normalized, localePhrases.affirmative)) return "affirmative";
  return "unclear";
}

function containsAny(value: string, candidates: readonly string[]) {
  const padded = ` ${value} `;
  return candidates.some((candidate) => padded.includes(` ${candidate} `));
}

function matchesAny(value: string, candidates: readonly string[]) {
  return candidates.some(
    (candidate) => value === candidate || value.startsWith(`${candidate} `)
  );
}

function normalize(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[’']/g, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function germanPhrases() {
  return {
    affirmative: [
      "ja",
      "ja gerne",
      "in ordnung",
      "okay",
      "naturlich",
      "konnen sie",
      "das ist okay"
    ],
    negative: ["nein", "lieber nicht", "nicht aufzeichnen", "nicht aufnehmen"]
  } as const;
}

function englishPhrases() {
  return {
    affirmative: ["yes", "sure", "okay", "that s fine", "you can"],
    negative: ["no", "do not record", "don t record", "i do not consent"]
  } as const;
}
