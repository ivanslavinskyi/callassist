import type { CallLocale } from "@callassist/contracts";

export type ConsentDecision = "affirmative" | "negative" | "unclear";

/** Opt-in policy: legacy callers keep classifyConsent's existing behavior. */
export const HYBRID_CONSENT_CLASSIFIER_VERSION = "consent-phrases-v1" as const;

type HybridPhrases = { affirmative: readonly string[]; negative: readonly string[]; negativePrefixes: readonly string[] };
const hybridGerman: HybridPhrases = {
  affirmative: [...germanPhrases().affirmative, "ja gern", "gerne", "gern", "klar", "ja klar", "ja sicher", "sicher",
    "natürlich", "natuerlich", "ja natürlich", "ja natuerlich", "kein Problem", "ja kein Problem", "ok", "ja okay",
    "ja das passt", "das passt", "sie dürfen aufnehmen"],
  negative: ["nein", "nein danke", "lieber nicht", "bitte nicht", "nicht aufnehmen", "bitte nicht aufnehmen",
    "nicht aufzeichnen", "bitte nicht aufzeichnen", "ohne Aufnahme", "keine Aufnahme", "ich bin nicht einverstanden",
    "nicht transkribieren", "bitte nicht transkribieren", "ohne Transkription"],
  negativePrefixes: ["nein", "ja aber", "ja", "okay aber"]
};
const hybridEnglish: HybridPhrases = {
  affirmative: [...englishPhrases().affirmative, "ok", "of course", "yes sure", "yes okay", "yes you can", "you can record",
    "that's okay", "that is fine", "yes that is fine", "no problem", "sure go ahead", "go ahead"],
  negative: ["no", "no thanks", "no thank you", "please don't", "don't record", "don't record me", "please don't record",
    "do not record", "please do not record", "do not record me", "no recording", "without recording", "i do not consent",
    "i don't consent", "i don't agree to recording", "don't transcribe", "do not transcribe", "no transcription",
    "not transcription", "without transcription", "stop"],
  negativePrefixes: ["no", "yes", "yes but", "sure but", "okay but", "recording but", "i agree to recording but"]
};
const hybridRawPhrases: Record<CallLocale, HybridPhrases> = {
  "de-DE": hybridGerman,
  "de-CH": {
    ...hybridGerman,
    affirmative: [...hybridGerman.affirmative, "jo", "jo klar", "jo gerne", "ja gärn", "jo gärn", "isch guet", "ja isch guet",
      "isch guet so", "chönd si mache", "ja chönd si mache"],
    negative: [...hybridGerman.negative, "nei", "nei danke", "nöd ufneh", "nid ufneh", "bitte nöd ufneh", "bitte nid ufneh"],
    negativePrefixes: [...hybridGerman.negativePrefixes, "jo aber", "nei"]
  },
  "fr-CH": {
    affirmative: ["oui", "bien sûr", "d'accord", "vous pouvez", "oui bien sûr", "oui d'accord", "oui vous pouvez",
      "vous pouvez enregistrer", "oui vous pouvez enregistrer", "pas de problème", "oui pas de problème", "tout à fait"],
    negative: ["non", "non merci", "je ne suis pas d'accord", "n'enregistrez pas", "ne pas enregistrer", "sans enregistrement",
      "pas d'enregistrement", "je refuse l'enregistrement", "ne transcrivez pas", "sans transcription", "pas de transcription"],
    negativePrefixes: ["non", "oui mais", "d'accord mais", "on peut parler mais"]
  },
  "it-CH": {
    affirmative: ["sì", "sì certo", "va bene", "certo", "può registrare", "sì va bene", "sì può registrare", "certamente",
      "d'accordo", "nessun problema", "sì nessun problema", "può farlo"],
    negative: ["no", "no grazie", "non voglio", "non registrare", "non registri", "non registrate", "senza registrare",
      "senza registrazione", "non trascrivere", "non trascriva", "senza trascrizione", "no alla registrazione"],
    negativePrefixes: ["no", "sì ma", "va bene ma", "sì alla conversazione"]
  },
  "en-GB": hybridEnglish,
  "en-US": hybridEnglish,
  "ru-RU": {
    affirmative: ["да", "да конечно", "хорошо", "конечно", "можете", "согласен", "согласна", "да согласен", "да согласна",
      "да можете", "да можете записывать", "можете записывать", "разрешаю", "да разрешаю", "записывайте", "да записывайте",
      "конечно можно", "да без проблем", "конечно без проблем", "не возражаю"],
    negative: ["нет", "нет спасибо", "не надо", "не записывайте", "не записывай", "пожалуйста не записывайте",
      "я не согласен", "я не согласна", "не согласен", "не согласна", "без записи", "запись запрещаю", "не разрешаю",
      "не расшифровывайте", "без расшифровки", "на запись я не согласна", "на запись я не согласен"],
    negativePrefixes: ["нет", "да но", "да", "можно поговорить но"]
  }
};

// Normalize both sides. NFKD alone changes Cyrillic й into и and previously
// made Russian negative phrases fail to match their unnormalized constants.
const hybridPhrases = Object.fromEntries(Object.entries(hybridRawPhrases).map(([locale, set]) => [locale, {
  affirmative: new Set(set.affirmative.map(normalizeHybrid)),
  negative: new Set([...set.negative, ...set.negativePrefixes.flatMap(prefix => set.negative.map(denial => `${prefix} ${denial}`))]
    .map(normalizeHybrid))
}])) as Record<CallLocale, { affirmative: Set<string>; negative: Set<string> }>;

/** Classifies a bounded whole candidate; the caller owns timing and freshness.
 * Live deltas have no finality signal: a settle timer cannot prove completeness.
 */
export function classifyHybridConsent(text: string, locale: CallLocale): ConsentDecision {
  if (text.length > 512 || /["“”„«»‹›…⋯]|\.(?:\s*\.)+|[,;:\-–—]\s*$/u.test(text) || /^\s*['‘’]|['‘’]\s*$/u.test(text)) return "unclear";
  const normalized = normalizeHybrid(text);
  if (!normalized || normalized.split(" ").length > 10) return "unclear";
  const set = hybridPhrases[locale];
  // Complete, explicit refusal patterns override an earlier affirmative clause.
  // Unknown sentences, quotations and conditionals are left to semantic consent.
  if (set.negative.has(normalized)) return "negative";
  if (/[?？]/u.test(text)) return "unclear";
  return set.affirmative.has(normalized) ? "affirmative" : "unclear";
}

function normalizeHybrid(value: string) {
  return value.normalize("NFC").toLowerCase()
    // Fold Latin accents only, preserving Cyrillic й (and normalizing ё).
    .replace(/\p{Script=Latin}/gu, letter => letter.normalize("NFKD").replace(/[\u0300-\u036f]/g, ""))
    .replace(/ё/g, "е").replace(/[’']/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim().replace(/\s+/g, " ");
}

const phrases: Record<
  CallLocale,
  { affirmative: readonly string[]; negative: readonly string[] }
> = {
  "de-CH": germanPhrases(),
  "de-DE": germanPhrases(),
  "fr-CH": {
    affirmative: ["oui", "d accord", "bien sur", "vous pouvez", "oui bien sur", "oui d accord", "oui vous pouvez"],
    negative: ["non", "je ne suis pas d accord", "n enregistrez pas"]
  },
  "it-CH": {
    affirmative: ["si", "si certo", "va bene", "certo", "puo registrare", "si va bene", "si puo registrare"],
    negative: ["no", "non voglio", "non registrare"]
  },
  "en-GB": englishPhrases(),
  "en-US": englishPhrases(),
  "ru-RU": {
    affirmative: ["да", "да конечно", "хорошо", "конечно", "можете", "согласен", "согласна", "да согласен", "да согласна", "да можете записывать"],
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
  // Questions and quoted answers are not an unambiguous grant. Do not discard
  // these markers during normalization and accidentally turn them into "yes".
  if (/[?？"“”„«»]/u.test(text) || /^\s*['‘’]|['‘’]\s*$/u.test(text)) return "unclear";

  if (matchesAny(normalized, localePhrases.affirmative)) return "affirmative";
  return "unclear";
}

function containsAny(value: string, candidates: readonly string[]) {
  const padded = ` ${value} `;
  return candidates.some((candidate) => padded.includes(` ${candidate} `));
}

function matchesAny(value: string, candidates: readonly string[]) {
  return candidates.includes(value);
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
      "ja naturlich",
      "ja das ist in ordnung",
      "das ist in ordnung",
      "einverstanden",
      "ja einverstanden",
      "ja sie durfen aufnehmen",
      "sie durfen aufnehmen",
      "ja sie konnen das gesprach aufzeichnen",
      "ja konnen sie machen",
      "ja durfen sie",
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
    affirmative: ["yes", "yes that s fine", "sure", "okay", "that s fine", "you can", "yes of course", "yes please", "yes you can record", "i consent"],
    negative: ["no", "do not record", "don t record", "i do not consent"]
  } as const;
}
