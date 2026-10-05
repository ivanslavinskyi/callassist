import { spokenIdentityName } from "@callassist/contracts";

// Identity-only comparison. Never use for addresses, dates, references or booking data.
// No edit distance, substring matching, abbreviation expansion or guessed translations.
export function normalizeIdentityLabel(value: string) {
  return spokenIdentityName(value.normalize("NFC"), "en")
    .normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().replace(/ß/g, "ss")
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

function containsLabel(text: string, label: string) {
  return Boolean(label) && ` ${text} `.includes(` ${label} `);
}

export function equivalentIdentityLabel(original: string, candidate: string, source = "") {
  return normalizeIdentityLabel(original).split(" ").length === normalizeIdentityLabel(candidate).split(" ").length &&
    preservesIdentityLabel(original, candidate, source);
}

export function preservesIdentityLabel(original: string, execution: string, source = "") {
  const canonical = normalizeIdentityLabel(original);
  if (containsLabel(normalizeIdentityLabel(execution), canonical)) return true;
  // Accept inflected Cyrillic forms only when the user supplied that exact form.
  // Keep every token, including an organisation's branch/location. Never shorten a label.
  const tokens = canonical.split(" ");
  const words = execution.match(/[\p{L}\p{M}\p{N}]+/gu) ?? [];
  for (let index = 0; index <= words.length - tokens.length; index++) {
    const phrase = words.slice(index, index + tokens.length);
    const supplied = phrase.join(" ");
    if (!containsLabel(normalizeIdentityLabel(source), normalizeIdentityLabel(supplied))) continue;
    if (phrase.every((word, offset) => {
      const normalized = normalizeIdentityLabel(word), expected = tokens[offset]!;
      if (normalized === expected) return true;
      if (!/\p{Script=Cyrillic}/u.test(word) || expected.length < 3) return false;
      // Russian/Ukrainian noun declensions attested in the source, not arbitrary spelling edits.
      const bases = new Set<string>();
      for (const suffix of ["а", "я", "у", "ю", "ом", "ем", "е", "і", "ові", "еві"]) {
        if (word.toLowerCase().endsWith(suffix)) bases.add(normalizeIdentityLabel(word.slice(0, -suffix.length)));
      }
      for (const suffix of ["е", "у", "ы", "ой", "ою", "і"]) {
        if (word.toLowerCase().endsWith(suffix)) bases.add(normalizeIdentityLabel(word.slice(0, -suffix.length) + "а"));
      }
      for (const suffix of ["ю", "е", "и", "ей", "ею", "ї", "єю"]) {
        if (word.toLowerCase().endsWith(suffix)) bases.add(normalizeIdentityLabel(word.slice(0, -suffix.length) + "я"));
      }
      return bases.has(expected);
    })) return true;
  }
  return false;
}
