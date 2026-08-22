"use client";

import type {
  AdminEditorialRevision,
  EditorialCollectionKey,
  EditorialRevisionSummary,
  FaqItem,
  NavigationItem
} from "@callassist/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  createAdminEditorialDraft,
  getAdminEditorialCollection,
  listAdminEditorialRevisions,
  publishAdminEditorialDraft,
  rollbackAdminEditorialRevision,
  updateAdminEditorialDraft
} from "@/lib/api";
import { useUiLocale } from "./ui-locale-provider";

type Detail = {
  published: AdminEditorialRevision | null;
  draft: AdminEditorialRevision | null;
};
type Confirmation =
  | { kind: "publish" }
  | { kind: "rollback"; revisionNumber: number };

export function AdminEditorialConsole() {
  const { locale, localizeHref } = useUiLocale();
  const copy = messages[locale];
  const [key, setKey] = useState<EditorialCollectionKey>("faq");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [revisions, setRevisions] = useState<EditorialRevisionSummary[]>([]);
  const [editor, setEditor] = useState<AdminEditorialRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishReason, setPublishReason] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);

  const load = useCallback(async (collectionKey: EditorialCollectionKey) => {
    setLoading(true);
    setError(null);
    try {
      const [nextDetail, { revisions: nextRevisions }] = await Promise.all([
        getAdminEditorialCollection(collectionKey),
        listAdminEditorialRevisions(collectionKey)
      ]);
      setDetail(nextDetail);
      setRevisions(nextRevisions);
      setEditor(nextDetail.draft ? structuredClone(nextDetail.draft) : null);
      setDirty(false);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => { void load(key); }, [key, load]);

  async function createDraft() {
    setBusy("create");
    setError(null);
    try {
      await createAdminEditorialDraft(key);
      await load(key);
      setNotice(copy.draftCreated);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!editor) return;
    setBusy("save");
    setError(null);
    try {
      const input = editor.key === "faq"
        ? { key: "faq" as const, items: normaliseFaq(editor.items) }
        : { key: "navigation" as const, items: normaliseNavigation(editor.items) };
      const { draft } = await updateAdminEditorialDraft(key, input);
      setEditor(structuredClone(draft));
      setDirty(false);
      setNotice(copy.saved);
      const { revisions: nextRevisions } = await listAdminEditorialRevisions(key);
      setRevisions(nextRevisions);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusy(null);
    }
  }

  async function publishDraft() {
    if (dirty || publishReason.trim().length < 3) return;
    setBusy("publish");
    setError(null);
    try {
      await publishAdminEditorialDraft(key, publishReason.trim());
      setPublishReason("");
      setConfirmation(null);
      await load(key);
      setNotice(copy.published);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusy(null);
    }
  }

  async function rollback(revisionNumber: number) {
    if (rollbackReason.trim().length < 3) return;
    setBusy("rollback");
    setError(null);
    try {
      await rollbackAdminEditorialRevision(
        key,
        revisionNumber,
        rollbackReason.trim()
      );
      setRollbackReason("");
      setConfirmation(null);
      await load(key);
      setNotice(copy.rollbackCreated);
    } catch {
      setError(copy.actionError);
    } finally {
      setBusy(null);
    }
  }

  function updateFaq(items: FaqItem[]) {
    setEditor((current) => current?.key === "faq"
      ? { ...current, items }
      : current);
    setDirty(true);
    setNotice(null);
  }

  function updateNavigation(items: NavigationItem[]) {
    setEditor((current) => current?.key === "navigation"
      ? { ...current, items }
      : current);
    setDirty(true);
    setNotice(null);
  }

  const currentPublished = revisions.find(({ status }) => status === "published");

  return (
    <AppShell>
      <main className="admin-content-page" id="main-content">
        <header className="admin-content-heading">
          <div>
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.intro}</p>
          </div>
          <Link className="secondary-button" href={localizeHref("/admin/content")}>
            {copy.pages}
          </Link>
        </header>

        <section className="admin-content-toolbar editorial-toolbar">
          <label className="field">
            <span>{copy.collection}</span>
            <select
              disabled={dirty}
              onChange={(event) => setKey(event.target.value as EditorialCollectionKey)}
              value={key}
            >
              <option value="faq">FAQ</option>
              <option value="navigation">Navigation</option>
            </select>
          </label>
          <div className="admin-content-status">
            <span data-active={Boolean(detail?.published)}>
              {copy.publishedLabel}: {detail?.published ? `r${detail.published.number}` : "—"}
            </span>
            <span data-active={Boolean(detail?.draft)}>
              {copy.draftLabel}: {detail?.draft ? `r${detail.draft.number}` : "—"}
            </span>
          </div>
        </section>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-success" role="status">{notice}</p> : null}
        {loading ? <p className="admin-content-loading">{copy.loading}</p> : (
          <div className="admin-content-grid">
            <section className="admin-content-editor">
              {!editor ? (
                <div className="admin-content-empty">
                  <h2>{key === "faq" ? "FAQ" : "Navigation"}</h2>
                  <p>{copy.noDraft}</p>
                  <button
                    className="primary-button"
                    disabled={busy !== null}
                    onClick={() => void createDraft()}
                    type="button"
                  >
                    {busy === "create" ? copy.creating : copy.createDraft}
                  </button>
                </div>
              ) : <>
                <div className="admin-content-editor-heading">
                  <div>
                    <span className="eyebrow">{copy.draftLabel} · r{editor.number}</span>
                    <h2>{editor.key === "faq" ? "FAQ" : "Navigation"}</h2>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => editor.key === "faq"
                      ? updateFaq([...editor.items, newFaqItem(editor.items.length)])
                      : updateNavigation([
                          ...editor.items,
                          newNavigationItem(editor.items.length)
                        ])}
                    type="button"
                  >
                    {copy.addItem}
                  </button>
                </div>

                <div className="editorial-item-list">
                  {editor.key === "faq" ? editor.items.map((item, index) => (
                    <FaqEditor
                      copy={copy}
                      index={index}
                      item={item}
                      key={item.id}
                      onChange={(next) => updateFaq(replaceAt(editor.items, index, next))}
                      onMove={(offset) => updateFaq(move(editor.items, index, offset))}
                      onRemove={() => updateFaq(removeAt(editor.items, index))}
                    />
                  )) : editor.items.map((item, index) => (
                    <NavigationEditor
                      copy={copy}
                      index={index}
                      item={item}
                      key={item.id}
                      onChange={(next) => updateNavigation(replaceAt(editor.items, index, next))}
                      onMove={(offset) => updateNavigation(move(editor.items, index, offset))}
                      onRemove={() => updateNavigation(removeAt(editor.items, index))}
                    />
                  ))}
                </div>

                <div className="admin-content-savebar">
                  <span>{dirty ? copy.unsaved : copy.savedState}</span>
                  <button
                    className="primary-button"
                    disabled={!dirty || busy !== null}
                    onClick={() => void saveDraft()}
                    type="button"
                  >
                    {busy === "save" ? copy.saving : copy.save}
                  </button>
                </div>
              </>}
            </section>

            <aside className="admin-content-sidebar">
              <section>
                <h2>{copy.publishTitle}</h2>
                <p>{copy.publishHelp}</p>
                <TextArea
                  label={copy.reason}
                  maxLength={500}
                  onChange={setPublishReason}
                  rows={3}
                  value={publishReason}
                />
                <button
                  className="primary-button"
                  disabled={!detail?.draft || dirty || busy !== null || publishReason.trim().length < 3}
                  onClick={() => setConfirmation({ kind: "publish" })}
                  type="button"
                >
                  {copy.publish}
                </button>
              </section>
              <section>
                <h2>{copy.history}</h2>
                <p>{copy.rollbackHelp}</p>
                <TextArea
                  label={copy.rollbackReason}
                  maxLength={500}
                  onChange={setRollbackReason}
                  rows={3}
                  value={rollbackReason}
                />
                <ol className="admin-revision-list">
                  {revisions.map((revision) => (
                    <li key={revision.id}>
                      <div>
                        <strong>r{revision.number}</strong>
                        {revision.id === currentPublished?.id
                          ? <small>{copy.current}</small>
                          : null}
                      </div>
                      <time dateTime={revision.publishedAt ?? revision.updatedAt}>
                        {formatDate(revision.publishedAt ?? revision.updatedAt, locale)}
                      </time>
                      {revision.status === "published" &&
                      revision.id !== currentPublished?.id ? (
                        <button
                          className="secondary-button"
                          disabled={Boolean(detail?.draft) || busy !== null || rollbackReason.trim().length < 3}
                          onClick={() => setConfirmation({
                            kind: "rollback",
                            revisionNumber: revision.number
                          })}
                          type="button"
                        >
                          {copy.rollback}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ol>
              </section>
            </aside>
          </div>
        )}

        <ConfirmDialog
          busy={busy === "publish" || busy === "rollback"}
          confirmLabel={confirmation?.kind === "publish" ? copy.publish : copy.rollback}
          danger={confirmation?.kind === "rollback"}
          description={confirmation?.kind === "publish"
            ? copy.publishConfirm
            : copy.rollbackConfirm}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (confirmation?.kind === "publish") void publishDraft();
            if (confirmation?.kind === "rollback") {
              void rollback(confirmation.revisionNumber);
            }
          }}
          open={confirmation !== null}
          title={confirmation?.kind === "publish"
            ? copy.publishTitle
            : copy.rollback}
        />
      </main>
    </AppShell>
  );
}

function FaqEditor({ copy, index, item, onChange, onMove, onRemove }: {
  copy: EditorialMessages;
  index: number;
  item: FaqItem;
  onChange: (item: FaqItem) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="admin-section-editor editorial-item">
      <legend>{copy.item} {index + 1}</legend>
      <ItemControls copy={copy} enabled={item.enabled} index={index} onEnabled={(enabled) => onChange({ ...item, enabled })} onMove={onMove} onRemove={onRemove} />
      <TextInput label={`${copy.question} · EN`} maxLength={4000} value={item.question.en} onChange={(en) => onChange({ ...item, question: { ...item.question, en } })} />
      <TextArea label={`${copy.answer} · EN`} maxLength={4000} rows={5} value={item.answer.en} onChange={(en) => onChange({ ...item, answer: { ...item.answer, en } })} />
      <TextInput label={`${copy.question} · DE`} maxLength={4000} value={item.question.de} onChange={(de) => onChange({ ...item, question: { ...item.question, de } })} />
      <TextArea label={`${copy.answer} · DE`} maxLength={4000} rows={5} value={item.answer.de} onChange={(de) => onChange({ ...item, answer: { ...item.answer, de } })} />
    </fieldset>
  );
}

function NavigationEditor({ copy, index, item, onChange, onMove, onRemove }: {
  copy: EditorialMessages;
  index: number;
  item: NavigationItem;
  onChange: (item: NavigationItem) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <fieldset className="admin-section-editor editorial-item">
      <legend>{copy.item} {index + 1}</legend>
      <ItemControls copy={copy} enabled={item.enabled} index={index} onEnabled={(enabled) => onChange({ ...item, enabled })} onMove={onMove} onRemove={onRemove} />
      <div className="editorial-item-grid">
        <label className="field">
          <span>{copy.location}</span>
          <select onChange={(event) => onChange({ ...item, location: event.target.value as NavigationItem["location"] })} value={item.location}>
            <option value="header">Header</option>
            <option value="footer">Footer</option>
          </select>
        </label>
        <label className="field">
          <span>{copy.destination}</span>
          <select onChange={(event) => onChange({ ...item, destination: event.target.value as NavigationItem["destination"] })} value={item.destination}>
            {destinations.map((destination) => <option key={destination} value={destination}>{destination}</option>)}
          </select>
        </label>
      </div>
      <TextInput label={`${copy.label} · EN`} maxLength={80} value={item.label.en} onChange={(en) => onChange({ ...item, label: { ...item.label, en } })} />
      <TextInput label={`${copy.label} · DE`} maxLength={80} value={item.label.de} onChange={(de) => onChange({ ...item, label: { ...item.label, de } })} />
    </fieldset>
  );
}

function ItemControls({ copy, enabled, index, onEnabled, onMove, onRemove }: {
  copy: EditorialMessages;
  enabled: boolean;
  index: number;
  onEnabled: (enabled: boolean) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div className="editorial-item-controls">
      <label className="credit-checkbox">
        <input checked={enabled} onChange={(event) => onEnabled(event.target.checked)} type="checkbox" />
        <span>{copy.enabled}</span>
      </label>
      <button aria-label={copy.moveUp} className="secondary-button" disabled={index === 0} onClick={() => onMove(-1)} type="button">↑</button>
      <button aria-label={copy.moveDown} className="secondary-button" onClick={() => onMove(1)} type="button">↓</button>
      <button className="danger-button" onClick={onRemove} type="button">{copy.remove}</button>
    </div>
  );
}

function TextInput({ label, maxLength, onChange, value }: {
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  value: string;
}) {
  return <label className="field"><span>{label}</span><input maxLength={maxLength} onChange={(event) => onChange(event.target.value)} required value={value} /></label>;
}

function TextArea({ label, maxLength, onChange, rows, value }: {
  label: string;
  maxLength: number;
  onChange: (value: string) => void;
  rows: number;
  value: string;
}) {
  return <label className="field"><span>{label}</span><textarea maxLength={maxLength} onChange={(event) => onChange(event.target.value)} required rows={rows} value={value} /></label>;
}

function newFaqItem(sortOrder: number): FaqItem {
  return {
    id: crypto.randomUUID(),
    sortOrder,
    enabled: true,
    question: { en: "", de: "" },
    answer: { en: "", de: "" }
  };
}

function newNavigationItem(sortOrder: number): NavigationItem {
  return {
    id: crypto.randomUUID(),
    sortOrder,
    enabled: true,
    location: "footer",
    destination: "home",
    label: { en: "", de: "" }
  };
}

function normaliseFaq(items: FaqItem[]) {
  return items.map((item, sortOrder) => ({
    ...item,
    sortOrder,
    question: { en: item.question.en.trim(), de: item.question.de.trim() },
    answer: { en: item.answer.en.trim(), de: item.answer.de.trim() }
  }));
}

function normaliseNavigation(items: NavigationItem[]) {
  return items.map((item, sortOrder) => ({
    ...item,
    sortOrder,
    label: { en: item.label.en.trim(), de: item.label.de.trim() }
  }));
}

function replaceAt<T>(items: T[], index: number, value: T) {
  return items.map((item, itemIndex) => itemIndex === index ? value : item);
}

function removeAt<T>(items: T[], index: number) {
  return items.filter((_, itemIndex) => itemIndex !== index);
}

function move<T>(items: T[], index: number, offset: -1 | 1) {
  const nextIndex = index + offset;
  if (nextIndex < 0 || nextIndex >= items.length) return items;
  const next = [...items];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

function formatDate(value: string, locale: "en" | "de") {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-CH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}

const destinations: NavigationItem["destination"][] = [
  "home",
  "privacy",
  "terms",
  "acceptable_use",
  "support",
  "faq",
  "opt_out"
];

const en = {
  eyebrow: "Structured editorial content",
  title: "FAQ and navigation",
  intro: "Manage reusable bilingual FAQ items and internal-only navigation, then publish one reviewed immutable revision.",
  pages: "Pages",
  collection: "Collection",
  publishedLabel: "Published",
  draftLabel: "Draft",
  loading: "Loading editorial content…",
  loadError: "Editorial content could not be loaded.",
  actionError: "The editorial action could not be completed. Check all required fields and try again.",
  noDraft: "There is no draft. Start one from the current published revision.",
  createDraft: "Start draft",
  creating: "Starting…",
  draftCreated: "Draft created.",
  addItem: "Add item",
  item: "Item",
  enabled: "Enabled",
  moveUp: "Move up",
  moveDown: "Move down",
  remove: "Remove",
  question: "Question",
  answer: "Answer",
  location: "Location",
  destination: "Internal destination",
  label: "Label",
  unsaved: "Unsaved changes",
  savedState: "Draft is saved",
  save: "Save draft",
  saving: "Saving…",
  saved: "Draft saved.",
  publishTitle: "Publish draft",
  publishHelp: "Publishing replaces the public collection while preserving the complete revision history.",
  reason: "Reviewed change reason",
  publish: "Publish revision",
  published: "Revision published.",
  publishConfirm: "The bilingual collection will become public as an immutable revision.",
  history: "Revision history",
  rollbackHelp: "Rollback creates a new private draft from a prior snapshot.",
  rollbackReason: "Rollback reason",
  rollback: "Create rollback draft",
  rollbackCreated: "Rollback draft created.",
  rollbackConfirm: "A new draft will be copied from this published revision.",
  current: "Current"
};

type EditorialMessages = typeof en;

const de: EditorialMessages = {
  ...en,
  eyebrow: "Strukturierte redaktionelle Inhalte",
  title: "FAQ und Navigation",
  intro: "Verwalten Sie wiederverwendbare zweisprachige FAQ-Einträge und ausschliesslich interne Navigation und veröffentlichen Sie eine geprüfte unveränderliche Revision.",
  pages: "Seiten",
  collection: "Sammlung",
  publishedLabel: "Veröffentlicht",
  draftLabel: "Entwurf",
  loading: "Redaktionelle Inhalte werden geladen…",
  loadError: "Redaktionelle Inhalte konnten nicht geladen werden.",
  actionError: "Die redaktionelle Aktion konnte nicht abgeschlossen werden. Prüfen Sie alle Pflichtfelder.",
  noDraft: "Es gibt keinen Entwurf. Erstellen Sie einen aus der aktuellen veröffentlichten Revision.",
  createDraft: "Entwurf starten",
  creating: "Wird erstellt…",
  draftCreated: "Entwurf erstellt.",
  addItem: "Eintrag hinzufügen",
  item: "Eintrag",
  enabled: "Aktiv",
  moveUp: "Nach oben",
  moveDown: "Nach unten",
  remove: "Entfernen",
  question: "Frage",
  answer: "Antwort",
  location: "Bereich",
  destination: "Internes Ziel",
  label: "Beschriftung",
  unsaved: "Ungespeicherte Änderungen",
  savedState: "Entwurf ist gespeichert",
  save: "Entwurf speichern",
  saving: "Wird gespeichert…",
  saved: "Entwurf gespeichert.",
  publishTitle: "Entwurf veröffentlichen",
  publishHelp: "Die Veröffentlichung ersetzt die öffentliche Sammlung und erhält den vollständigen Revisionsverlauf.",
  reason: "Begründung der geprüften Änderung",
  publish: "Revision veröffentlichen",
  published: "Revision veröffentlicht.",
  publishConfirm: "Die zweisprachige Sammlung wird als unveränderliche Revision öffentlich.",
  history: "Revisionsverlauf",
  rollbackHelp: "Ein Rollback erstellt einen neuen privaten Entwurf aus einem früheren Snapshot.",
  rollbackReason: "Rollback-Begründung",
  rollback: "Rollback-Entwurf erstellen",
  rollbackCreated: "Rollback-Entwurf erstellt.",
  rollbackConfirm: "Aus dieser veröffentlichten Revision wird ein neuer Entwurf erstellt.",
  current: "Aktuell"
};

const messages = { en, de };
