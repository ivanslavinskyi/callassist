"use client";

import type {
  AdminEditorialRevision,
  EditorialCollectionKey,
  EditorialRevisionSummary,
  FaqItem,
  LandingBlock,
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
type LandingContentItem = Extract<
  LandingBlock,
  { blockType: "problem" }
>["items"][number];

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
        : editor.key === "navigation"
          ? { key: "navigation" as const, items: normaliseNavigation(editor.items) }
          : { key: "landing" as const, items: normaliseLanding(editor.items) };
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

  function updateLanding(items: LandingBlock[]) {
    setEditor((current) => current?.key === "landing"
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
              <option value="landing">Landing</option>
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
                  <h2>{collectionName(key)}</h2>
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
                    <h2>{collectionName(editor.key)}</h2>
                  </div>
                  <div className="admin-content-editor-actions">
                    {editor.key === "landing" && !dirty ? (
                      <Link
                        className="secondary-button"
                        href={localizeHref("/admin/content/editorial/landing/preview")}
                        target="_blank"
                      >
                        {copy.previewDraft}
                      </Link>
                    ) : null}
                    {editor.key !== "landing" ? <button
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
                    </button> : null}
                  </div>
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
                  )) : editor.key === "navigation" ? editor.items.map((item, index) => (
                    <NavigationEditor
                      copy={copy}
                      index={index}
                      item={item}
                      key={item.id}
                      onChange={(next) => updateNavigation(replaceAt(editor.items, index, next))}
                      onMove={(offset) => updateNavigation(move(editor.items, index, offset))}
                      onRemove={() => updateNavigation(removeAt(editor.items, index))}
                    />
                  )) : editor.items.map((item, index) => (
                    <LandingEditor
                      copy={copy}
                      index={index}
                      item={item}
                      key={item.id}
                      onChange={(next) => updateLanding(replaceAt(editor.items, index, next))}
                      onMove={(offset) => updateLanding(move(editor.items, index, offset))}
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

function LandingEditor({ copy, index, item, onChange, onMove }: {
  copy: EditorialMessages;
  index: number;
  item: LandingBlock;
  onChange: (item: LandingBlock) => void;
  onMove: (offset: -1 | 1) => void;
}) {
  return (
    <fieldset className="admin-section-editor editorial-item landing-block-editor">
      <legend>{copy.blockName[item.blockType]}</legend>
      <ItemControls
        copy={copy}
        enabled={item.enabled}
        index={index}
        onEnabled={(enabled) => onChange({ ...item, enabled })}
        onMove={onMove}
      />
      {item.blockType === "hero" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        {item.supportingTitle ? <LocalizedInput label={copy.supportingTitleField} maxLength={180} onChange={(supportingTitle) => onChange({ ...item, supportingTitle })} value={item.supportingTitle} /> : null}
        <LocalizedArea label={copy.textField} maxLength={1200} onChange={(lead) => onChange({ ...item, lead })} rows={4} value={item.lead} />
        {item.secondaryText ? <LocalizedArea label={copy.secondaryTextField} maxLength={1200} onChange={(secondaryText) => onChange({ ...item, secondaryText })} rows={3} value={item.secondaryText} /> : null}
        <LocalizedList label={copy.badgesField} onChange={(badges) => onChange({ ...item, badges })} value={item.badges} />
        <LocalizedInput label={copy.primaryCta} maxLength={180} onChange={(primaryCtaLabel) => onChange({ ...item, primaryCtaLabel })} value={item.primaryCtaLabel} />
        <LocalizedInput label={copy.secondaryCta} maxLength={180} onChange={(secondaryCtaLabel) => onChange({ ...item, secondaryCtaLabel })} value={item.secondaryCtaLabel} />
        <LocalizedInput label={copy.seoTitle} maxLength={180} onChange={(seoTitle) => onChange({ ...item, seoTitle })} value={item.seoTitle} />
        <LocalizedArea label={copy.seoDescription} maxLength={1200} onChange={(seoDescription) => onChange({ ...item, seoDescription })} rows={3} value={item.seoDescription} />
      </> : null}
      {item.blockType === "problem" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LandingContentItemsEditor copy={copy} items={item.items} onChange={(items) => onChange({ ...item, items })} />
      </> : null}
      {item.blockType === "how_it_works" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <div className="landing-step-list">
          {item.steps.map((step, stepIndex) => (
            <fieldset className="landing-step-editor" key={step.id}>
              <legend>{copy.step} {stepIndex + 1}</legend>
              <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({
                ...item,
                steps: replaceAt(item.steps, stepIndex, { ...step, title })
              })} value={step.title} />
              <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange({
                ...item,
                steps: replaceAt(item.steps, stepIndex, { ...step, text })
              })} rows={3} value={step.text} />
              {item.steps.length > 1 ? <button className="danger-button" onClick={() => onChange({
                ...item,
                steps: removeAt(item.steps, stepIndex)
              })} type="button">{copy.remove}</button> : null}
            </fieldset>
          ))}
          {item.steps.length < 8 ? <button className="secondary-button" onClick={() => onChange({
            ...item,
            steps: [...item.steps, {
              id: crypto.randomUUID(),
              title: { en: "", de: "" },
              text: { en: "", de: "" }
            }]
          })} type="button">{copy.addStep}</button> : null}
        </div>
      </> : null}
      {item.blockType === "use_cases" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange({ ...item, text })} rows={4} value={item.text} />
        {Array.isArray(item.items)
          ? <LandingContentItemsEditor copy={copy} items={item.items} onChange={(items) => onChange({ ...item, items })} />
          : <LocalizedList label={copy.itemsField} onChange={(items) => onChange({ ...item, items })} value={item.items} />}
      </> : null}
      {item.blockType === "example" ? <>
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LandingContentItemsEditor copy={copy} items={item.items} onChange={(items) => onChange({ ...item, items })} />
      </> : null}
      {item.blockType === "safety_privacy" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange({ ...item, text })} rows={4} value={item.text} />
        <LocalizedInput label={copy.limitsTitle} maxLength={180} onChange={(limitsTitle) => onChange({ ...item, limitsTitle })} value={item.limitsTitle} />
        <LocalizedList label={copy.limitsField} onChange={(limits) => onChange({ ...item, limits })} value={item.limits} />
      </> : null}
      {item.blockType === "languages" ? <>
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange({ ...item, text })} rows={4} value={item.text} />
      </> : null}
      {item.blockType === "faq" ? <>
        <LocalizedInput label={copy.eyebrowField} maxLength={180} onChange={(eyebrow) => onChange({ ...item, eyebrow })} value={item.eyebrow} />
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <label className="field">
          <span>{copy.faqLimit}</span>
          <input max={12} min={1} onChange={(event) => onChange({ ...item, itemLimit: Number(event.target.value) })} type="number" value={item.itemLimit} />
        </label>
      </> : null}
      {item.blockType === "cta" ? <>
        <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange({ ...item, title })} value={item.title} />
        <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange({ ...item, text })} rows={4} value={item.text} />
        <LocalizedInput label={copy.primaryCta} maxLength={180} onChange={(primaryCtaLabel) => onChange({ ...item, primaryCtaLabel })} value={item.primaryCtaLabel} />
      </> : null}
    </fieldset>
  );
}

function LandingContentItemsEditor({ copy, items, onChange }: {
  copy: EditorialMessages;
  items: LandingContentItem[];
  onChange: (items: LandingContentItem[]) => void;
}) {
  return (
    <div className="landing-step-list">
      {items.map((item, itemIndex) => (
        <fieldset className="landing-step-editor" key={item.id}>
          <legend>{copy.contentItem} {itemIndex + 1}</legend>
          <LocalizedInput label={copy.titleField} maxLength={180} onChange={(title) => onChange(
            replaceAt(items, itemIndex, { ...item, title })
          )} value={item.title} />
          <LocalizedArea label={copy.textField} maxLength={1200} onChange={(text) => onChange(
            replaceAt(items, itemIndex, { ...item, text })
          )} rows={3} value={item.text} />
          {items.length > 1 ? <button className="danger-button" onClick={() => onChange(
            removeAt(items, itemIndex)
          )} type="button">{copy.remove}</button> : null}
        </fieldset>
      ))}
      {items.length < 12 ? <button className="secondary-button" onClick={() => onChange([
        ...items,
        {
          id: crypto.randomUUID(),
          title: { en: "", de: "" },
          text: { en: "", de: "" }
        }
      ])} type="button">{copy.addContentItem}</button> : null}
    </div>
  );
}

function LocalizedInput({ label, maxLength, onChange, value }: {
  label: string;
  maxLength: number;
  onChange: (value: { en: string; de: string }) => void;
  value: { en: string; de: string };
}) {
  return <div className="editorial-localized-fields"><TextInput label={`${label} · EN`} maxLength={maxLength} onChange={(en) => onChange({ ...value, en })} value={value.en} /><TextInput label={`${label} · DE`} maxLength={maxLength} onChange={(de) => onChange({ ...value, de })} value={value.de} /></div>;
}

function LocalizedArea({ label, maxLength, onChange, rows, value }: {
  label: string;
  maxLength: number;
  onChange: (value: { en: string; de: string }) => void;
  rows: number;
  value: { en: string; de: string };
}) {
  return <div className="editorial-localized-fields"><TextArea label={`${label} · EN`} maxLength={maxLength} onChange={(en) => onChange({ ...value, en })} rows={rows} value={value.en} /><TextArea label={`${label} · DE`} maxLength={maxLength} onChange={(de) => onChange({ ...value, de })} rows={rows} value={value.de} /></div>;
}

function LocalizedList({ label, onChange, value }: {
  label: string;
  onChange: (value: { en: string[]; de: string[] }) => void;
  value: { en: string[]; de: string[] };
}) {
  return <div className="editorial-localized-fields"><TextArea label={`${label} · EN`} maxLength={2400} onChange={(en) => onChange({ ...value, en: en.split("\n") })} rows={5} value={value.en.join("\n")} /><TextArea label={`${label} · DE`} maxLength={2400} onChange={(de) => onChange({ ...value, de: de.split("\n") })} rows={5} value={value.de.join("\n")} /></div>;
}

function ItemControls({ copy, enabled, index, onEnabled, onMove, onRemove }: {
  copy: EditorialMessages;
  enabled: boolean;
  index: number;
  onEnabled: (enabled: boolean) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove?: () => void;
}) {
  return (
    <div className="editorial-item-controls">
      <label className="credit-checkbox">
        <input checked={enabled} onChange={(event) => onEnabled(event.target.checked)} type="checkbox" />
        <span>{copy.enabled}</span>
      </label>
      <button aria-label={copy.moveUp} className="secondary-button" disabled={index === 0} onClick={() => onMove(-1)} type="button">↑</button>
      <button aria-label={copy.moveDown} className="secondary-button" onClick={() => onMove(1)} type="button">↓</button>
      {onRemove ? <button className="danger-button" onClick={onRemove} type="button">{copy.remove}</button> : null}
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

function normaliseLanding(items: LandingBlock[]): LandingBlock[] {
  return items.map((item, sortOrder) => {
    if (item.blockType === "hero") {
      return {
        ...item,
        sortOrder,
        badges: normaliseLocalizedList(item.badges)
      };
    }
    if (item.blockType === "use_cases") {
      return {
        ...item,
        sortOrder,
        items: Array.isArray(item.items)
          ? normaliseLandingContentItems(item.items)
          : normaliseLocalizedList(item.items)
      };
    }
    if (item.blockType === "problem" || item.blockType === "example") {
      return {
        ...item,
        sortOrder,
        items: normaliseLandingContentItems(item.items)
      };
    }
    if (item.blockType === "safety_privacy") {
      return {
        ...item,
        sortOrder,
        limits: normaliseLocalizedList(item.limits)
      };
    }
    return { ...item, sortOrder };
  });
}

function normaliseLocalizedList(value: { en: string[]; de: string[] }) {
  return {
    en: value.en.map((item) => item.trim()).filter(Boolean),
    de: value.de.map((item) => item.trim()).filter(Boolean)
  };
}

function normaliseLandingContentItems(items: LandingContentItem[]) {
  return items.map((item) => ({
    ...item,
    title: { en: item.title.en.trim(), de: item.title.de.trim() },
    text: { en: item.text.en.trim(), de: item.text.de.trim() }
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

function collectionName(key: EditorialCollectionKey) {
  if (key === "faq") return "FAQ";
  if (key === "navigation") return "Navigation";
  return "Landing";
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
  title: "Landing, FAQ and navigation",
  intro: "Manage bounded bilingual Landing blocks, reusable FAQ items, and internal-only navigation, then publish one reviewed immutable revision.",
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
  previewDraft: "Preview saved draft",
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
  current: "Current",
  eyebrowField: "Eyebrow",
  titleField: "Title",
  supportingTitleField: "Supporting headline",
  textField: "Text",
  secondaryTextField: "Secondary sentence",
  badgesField: "Badges (one per line)",
  itemsField: "Items (one per line)",
  limitsTitle: "Limitations title",
  limitsField: "Limitations (one per line)",
  primaryCta: "Primary CTA label",
  secondaryCta: "Secondary CTA label",
  seoTitle: "SEO title",
  seoDescription: "SEO description",
  faqLimit: "Published FAQ items",
  step: "Step",
  addStep: "Add step",
  contentItem: "Card",
  addContentItem: "Add card",
  blockName: {
    hero: "Hero",
    problem: "Problem",
    how_it_works: "How it works",
    use_cases: "Use cases",
    example: "Concrete example",
    safety_privacy: "Safety & Privacy",
    languages: "Languages",
    faq: "Reusable FAQ",
    cta: "CTA"
  } satisfies Record<LandingBlock["blockType"], string>
};

type EditorialMessages = typeof en;

const de: EditorialMessages = {
  ...en,
  eyebrow: "Strukturierte redaktionelle Inhalte",
  title: "Landing, FAQ und Navigation",
  intro: "Verwalten Sie begrenzte zweisprachige Landing-Blöcke, wiederverwendbare FAQ-Einträge und ausschliesslich interne Navigation und veröffentlichen Sie eine geprüfte unveränderliche Revision.",
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
  previewDraft: "Gespeicherten Entwurf ansehen",
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
  current: "Aktuell",
  eyebrowField: "Übertitel",
  titleField: "Titel",
  supportingTitleField: "Unterstützende Überschrift",
  textField: "Text",
  secondaryTextField: "Zusätzlicher Satz",
  badgesField: "Badges (einer pro Zeile)",
  itemsField: "Einträge (einer pro Zeile)",
  limitsTitle: "Titel der Einschränkungen",
  limitsField: "Einschränkungen (eine pro Zeile)",
  primaryCta: "Primäre CTA-Beschriftung",
  secondaryCta: "Sekundäre CTA-Beschriftung",
  seoTitle: "SEO-Titel",
  seoDescription: "SEO-Beschreibung",
  faqLimit: "Veröffentlichte FAQ-Einträge",
  step: "Schritt",
  addStep: "Schritt hinzufügen",
  contentItem: "Karte",
  addContentItem: "Karte hinzufügen",
  blockName: {
    hero: "Hero",
    problem: "Problem",
    how_it_works: "So funktioniert es",
    use_cases: "Anwendungsfälle",
    example: "Konkretes Beispiel",
    safety_privacy: "Sicherheit & Datenschutz",
    languages: "Sprachen",
    faq: "Wiederverwendbare FAQ",
    cta: "CTA"
  }
};

const messages = { en, de };
