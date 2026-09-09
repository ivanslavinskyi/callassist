import type { CreateCallBriefInput, TaskLanguagePreferences } from "@callassist/contracts";
import type { CallPreparationAttempt } from "./call-preparation-attempt";

export type CallDraft = {
  form: CreateCallBriefInput;
  factsText: string;
  languagePreferences: TaskLanguagePreferences;
  preparationAttempt: CallPreparationAttempt | null;
};

/** Sensitive draft content lives only in this root-layout instance, never browser storage. */
export class CallDraftStore {
  private owner: string | null = null;
  private drafts = new Map<string, CallDraft>();
  private views = new Map<string, string>();

  forOwner(owner: string) {
    if (owner !== this.owner) {
      this.clearAll();
      this.owner = owner;
    }
    return this;
  }

  get(owner: string, key: string) {
    return this.owner === owner ? this.drafts.get(key) : undefined;
  }

  set(owner: string, key: string, draft: CallDraft) {
    // A late preparation response from the previous account must not restore its draft.
    if (this.owner === owner) this.drafts.set(key, draft);
  }

  clear(owner: string, key: string) {
    if (this.owner === owner) this.drafts.delete(key);
  }

  getView(owner: string, key: string) { return this.owner === owner ? this.views.get(key) : undefined; }
  setView(owner: string, key: string, value: string) { if (this.owner === owner) this.views.set(key, value); }

  clearAll() {
    this.drafts.clear();
    this.views.clear();
    this.owner = null;
  }
}
