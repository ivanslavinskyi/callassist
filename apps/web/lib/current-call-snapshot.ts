import type { CallSnapshot } from "@callassist/contracts";

/** An earlier read must not replace a newer compilation or language-selection receipt. */
export function currentCallSnapshot(current: CallSnapshot | null, incoming: CallSnapshot): CallSnapshot {
  if (!current || current.brief.id !== incoming.brief.id) return incoming;
  if (incoming.brief.updatedAt < current.brief.updatedAt ||
      (incoming.compilation && current.compilation && incoming.compilation.revision < current.compilation.revision)) return current;
  if (incoming.compilation?.revision === current.compilation?.revision && current.languageContext &&
      (incoming.languageContext?.selectionRevision ?? 0) < current.languageContext.selectionRevision) {
    return { ...incoming, languageContext: current.languageContext };
  }
  return incoming;
}
