import type { OgImageVersion, OgLocaleState, PublishedOgImage, UiLocale } from "@callassist/contracts";

export class OgError extends Error {
  constructor(readonly code: string, readonly status = 400) { super(code); }
}
export interface OgRepository {
  published(): Promise<PublishedOgImage[]>;
  state(locale: UiLocale): Promise<OgLocaleState>;
  saveDraft(version: OgImageVersion, png: Buffer, actorId: string, expectedRevision: number): Promise<void>;
  publish(locale: UiLocale, versionId: string, actorId: string, expectedRevision: number): Promise<void>;
  image(locale: UiLocale, hash: string, includeDrafts?: boolean): Promise<Buffer | null>;
  close(): Promise<void>;
}
export function emptyOgState(locale: UiLocale): OgLocaleState {
  return { locale, revision: 0, published: null, previous: null, draft: null, history: [] };
}
export class MemoryOgRepository implements OgRepository {
  private states = new Map<UiLocale, OgLocaleState>();
  private assets = new Map<string, Buffer>();
  private publishedHashes = new Set<string>();
  async published(): Promise<PublishedOgImage[]> {
    return [...this.states.values()].flatMap(state => state.published
      ? [{ locale: state.locale, hash: state.published.hash, alt: state.published.alt }] : []);
  }
  async state(locale: UiLocale) { return structuredClone(this.states.get(locale) ?? emptyOgState(locale)); }
  async saveDraft(version: OgImageVersion, png: Buffer, _actorId: string, expectedRevision: number) {
    const state = this.states.get(version.locale) ?? emptyOgState(version.locale);
    if (state.revision !== expectedRevision) throw new OgError("OG_REVISION_CONFLICT", 409);
    this.assets.set(version.hash, Buffer.from(png));
    state.draft = version;
    state.history.unshift(version);
    state.revision++;
    this.states.set(version.locale, state);
  }
  async publish(locale: UiLocale, versionId: string, _actorId: string, expectedRevision: number) {
    const state = this.states.get(locale) ?? emptyOgState(locale);
    if (state.revision !== expectedRevision) throw new OgError("OG_REVISION_CONFLICT", 409);
    const version = state.history.find(v => v.id === versionId);
    if (!version) throw new OgError("OG_VERSION_NOT_FOUND", 404);
    if (state.published?.id !== version.id) state.previous = state.published;
    state.published = version;
    if (state.draft?.id === version.id) state.draft = null;
    state.revision++;
    this.publishedHashes.add(`${locale}:${version.hash}`);
    this.states.set(locale, state);
  }
  async image(locale: UiLocale, hash: string, includeDrafts = false) {
    const exists = this.states.get(locale)?.history.some(v => v.hash === hash);
    if (!exists || (!includeDrafts && !this.publishedHashes.has(`${locale}:${hash}`))) return null;
    return this.assets.get(hash) ?? null;
  }
  async close() {}
}
