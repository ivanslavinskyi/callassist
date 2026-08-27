"use client";

import type {
  AdminContentLocalizedRevision,
  AdminContentPageSummary,
  AdminContentRevisionSummary,
  ContentLocale,
  ContentPageKey,
  ContentSection
} from "@callassist/contracts";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ConfirmDialog } from "@/components/confirm-dialog";
import {
  createAdminContentDraft,
  getAdminContentPage,
  listAdminContentPages,
  listAdminContentRevisions,
  publishAdminContentDraft,
  rollbackAdminContentRevision,
  updateAdminContentDraft
} from "@/lib/api";
import { contentAdminMessages } from "@/lib/i18n/content-admin-messages";

type PageDetail = {
  published: AdminContentLocalizedRevision | null;
  draft: AdminContentLocalizedRevision | null;
};
type Busy = "create" | "save" | "publish" | "rollback" | null;

export function AdminContentConsole() {
  const locale = "en" as const;
  const copy = contentAdminMessages[locale];
  const [pages, setPages] = useState<AdminContentPageSummary[]>([]);
  const [selectedKey, setSelectedKey] = useState<ContentPageKey | null>(null);
  const [contentLocale, setContentLocale] = useState<ContentLocale>(locale);
  const [detail, setDetail] = useState<PageDetail | null>(null);
  const [revisions, setRevisions] = useState<AdminContentRevisionSummary[]>([]);
  const [editor, setEditor] = useState<AdminContentLocalizedRevision | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Busy>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [publishReason, setPublishReason] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [confirmation, setConfirmation] = useState<
    { kind: "publish" } | { kind: "rollback"; revisionNumber: number } | null
  >(null);

  const loadSelection = useCallback(async (
    key: ContentPageKey,
    selectedLocale: ContentLocale
  ) => {
    setLoading(true);
    setError(null);
    try {
      const [{ pages: nextPages }, nextDetail, { revisions: nextRevisions }] =
        await Promise.all([
          listAdminContentPages(),
          getAdminContentPage(key, selectedLocale),
          listAdminContentRevisions(key)
        ]);
      setPages(nextPages);
      setDetail(nextDetail);
      setRevisions(nextRevisions);
      setEditor(nextDetail.draft ? cloneRevision(nextDetail.draft) : null);
      setDirty(false);
    } catch {
      setError(copy.loadError);
    } finally {
      setLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => {
    let active = true;
    void listAdminContentPages()
      .then(({ pages: nextPages }) => {
        if (!active) return;
        setPages(nextPages);
        setSelectedKey((current) => current ?? nextPages[0]?.key ?? null);
      })
      .catch(() => { if (active) setError(copy.loadError); });
    return () => { active = false; };
  }, [copy.loadError]);

  useEffect(() => {
    if (selectedKey) void loadSelection(selectedKey, contentLocale);
  }, [contentLocale, loadSelection, selectedKey]);

  function edit(change: (current: AdminContentLocalizedRevision) => AdminContentLocalizedRevision) {
    setEditor((current) => current ? change(current) : current);
    setDirty(true);
    setNotice(null);
  }

  async function createDraft() {
    if (!selectedKey) return;
    setBusy("create");
    setError(null);
    try {
      await createAdminContentDraft(selectedKey);
      await loadSelection(selectedKey, contentLocale);
      setNotice(copy.draftNotice);
    } catch {
      setError(copy.loadError);
    } finally {
      setBusy(null);
    }
  }

  async function saveDraft() {
    if (!selectedKey || !editor) return;
    setBusy("save");
    setError(null);
    try {
      const { draft } = await updateAdminContentDraft(selectedKey, {
        locale: contentLocale,
        title: editor.title,
        summary: editor.summary,
        sections: normaliseSections(editor.sections),
        seoTitle: editor.seoTitle,
        seoDescription: editor.seoDescription,
        sourceRevisionNumber: editor.revision.sourceRevisionNumber,
        requiresReacceptance: editor.revision.requiresReacceptance
      });
      setEditor(cloneRevision(draft));
      setDirty(false);
      setNotice(copy.saved);
      await refreshSummaries(selectedKey);
    } catch {
      setError(copy.loadError);
    } finally {
      setBusy(null);
    }
  }

  async function publishDraft() {
    if (!selectedKey || publishReason.trim().length < 3) return;
    if (dirty) {
      setError(copy.unsaved);
      return;
    }
    setBusy("publish");
    setError(null);
    try {
      await publishAdminContentDraft(selectedKey, publishReason.trim());
      setPublishReason("");
      await loadSelection(selectedKey, contentLocale);
      setNotice(copy.publishedNotice);
      setConfirmation(null);
    } catch {
      setError(copy.loadError);
    } finally {
      setBusy(null);
    }
  }

  async function rollback(revisionNumber: number) {
    if (!selectedKey || rollbackReason.trim().length < 3) return;
    setBusy("rollback");
    setError(null);
    try {
      await rollbackAdminContentRevision(
        selectedKey,
        revisionNumber,
        rollbackReason.trim()
      );
      setRollbackReason("");
      await loadSelection(selectedKey, contentLocale);
      setNotice(copy.rollbackNotice);
      setConfirmation(null);
    } catch {
      setError(copy.loadError);
    } finally {
      setBusy(null);
    }
  }

  async function refreshSummaries(key: ContentPageKey) {
    const [{ pages: nextPages }, { revisions: nextRevisions }] = await Promise.all([
      listAdminContentPages(),
      listAdminContentRevisions(key)
    ]);
    setPages(nextPages);
    setRevisions(nextRevisions);
  }

  const selectedPage = pages.find((page) => page.key === selectedKey) ?? null;
  const isLegal = selectedKey === "terms" || selectedKey === "acceptable_use";
  const isFaq = selectedKey === "faq";
  const currentRevision = revisions.find((revision) => revision.status === "published");

  return (
    <main className="admin-content-page" id="main-content">
        <header className="admin-content-heading">
          <div>
            <span className="eyebrow">{copy.eyebrow}</span>
            <h1>{copy.title}</h1>
            <p>{copy.intro}</p>
          </div>
          <div className="admin-content-heading-actions">
            <Link className="secondary-button" href="/admin/content/editorial">
              {copy.editorialModels}
            </Link>
          </div>
        </header>

        <section className="admin-content-toolbar" aria-label={copy.title}>
          <label className="field">
            <span>{copy.page}</span>
            <select
              disabled={dirty}
              onChange={(event) => setSelectedKey(event.target.value as ContentPageKey)}
              value={selectedKey ?? ""}
            >
              {pages.map((page) => <option key={page.key} value={page.key}>{copy.pageName[page.key]}</option>)}
            </select>
          </label>
          <label className="field">
            <span>{copy.language}</span>
            <select
              disabled={dirty}
              onChange={(event) => setContentLocale(event.target.value as ContentLocale)}
              value={contentLocale}
            >
              <option value="en">{copy.english}</option>
              <option value="de">{copy.german}</option>
            </select>
          </label>
          {selectedPage ? (
            <div className="admin-content-status">
              <StatusBadge label={copy.published} revision={selectedPage.publishedRevision} />
              <StatusBadge label={copy.draft} revision={selectedPage.draftRevision} />
            </div>
          ) : null}
        </section>

        {error ? <p className="form-error" role="alert">{error}</p> : null}
        {notice ? <p className="auth-success" role="status">{notice}</p> : null}

        {loading ? <p className="admin-content-loading" role="status">{copy.loading}</p> : (
          <div className="admin-content-grid">
            <section className="admin-content-editor">
              {!editor ? (
                <div className="admin-content-empty">
                  <h2>{detail?.published?.title ?? copy.pageName[selectedKey ?? "privacy"]}</h2>
                  <p>{copy.noDraft}</p>
                  <button className="primary-button" disabled={busy !== null} onClick={createDraft} type="button">
                    {busy === "create" ? copy.creatingDraft : copy.createDraft}
                  </button>
                </div>
              ) : (
                <>
                  <div className="admin-content-editor-heading">
                    <div>
                      <span className="eyebrow">{copy.draft} · {copy.revision(editor.revision.number)}</span>
                      <h2>{copy.pageName[editor.key]} · {contentLocale.toUpperCase()}</h2>
                      <small>/{editor.slug}</small>
                    </div>
                    <Link
                      className="secondary-button"
                      href={`/admin/content/${editor.key}/preview?contentLocale=${contentLocale}`}
                      target="_blank"
                    >
                      {copy.preview}
                    </Link>
                  </div>
                  <div className="admin-content-fields">
                    <TextInput label={copy.titleField} maxLength={180} value={editor.title} onChange={(title) => edit((current) => ({ ...current, title }))} />
                    <TextArea label={copy.summary} maxLength={1000} rows={4} value={editor.summary} onChange={(summary) => edit((current) => ({ ...current, summary }))} />
                    <TextInput label={copy.seoTitle} maxLength={180} value={editor.seoTitle} onChange={(seoTitle) => edit((current) => ({ ...current, seoTitle }))} />
                    <TextArea label={copy.seoDescription} maxLength={500} rows={3} value={editor.seoDescription} onChange={(seoDescription) => edit((current) => ({ ...current, seoDescription }))} />
                    <label className="field">
                      <span>{copy.sourceRevision}</span>
                      <input
                        disabled={contentLocale === editor.sourceLocale}
                        min={1}
                        onChange={(event) => edit((current) => ({
                          ...current,
                          revision: { ...current.revision, sourceRevisionNumber: Number(event.target.value) }
                        }))}
                        required
                        type="number"
                        value={editor.revision.sourceRevisionNumber}
                      />
                    </label>
                    {isLegal ? (
                      <label className="credit-checkbox admin-content-reacceptance">
                        <input
                          checked={editor.revision.requiresReacceptance}
                          onChange={(event) => edit((current) => ({
                            ...current,
                            revision: { ...current.revision, requiresReacceptance: event.target.checked }
                          }))}
                          type="checkbox"
                        />
                        <span>{copy.reacceptance}</span>
                      </label>
                    ) : null}
                  </div>
                  {isFaq ? (
                    <div className="admin-content-empty editorial-reference-note">
                      <p>{copy.faqItemsManaged}</p>
                      <Link className="secondary-button" href="/admin/content/editorial">
                        {copy.editorialModels}
                      </Link>
                    </div>
                  ) : <div className="admin-section-list">
                    <h3>{copy.sections}</h3>
                    {editor.sections.map((section, index) => (
                      <SectionEditor
                        copy={copy}
                        index={index}
                        key={index}
                        onChange={(next) => edit((current) => ({
                          ...current,
                          sections: current.sections.map((value, sectionIndex) => sectionIndex === index ? next : value)
                        }))}
                        onRemove={() => edit((current) => ({
                          ...current,
                          sections: current.sections.filter((_, sectionIndex) => sectionIndex !== index)
                        }))}
                        removable={editor.sections.length > 1}
                        section={section}
                      />
                    ))}
                    <button
                      className="secondary-button"
                      onClick={() => edit((current) => ({
                        ...current,
                        sections: [...current.sections, { heading: "", paragraphs: [""], bullets: [] }]
                      }))}
                      type="button"
                    >
                      {copy.addSection}
                    </button>
                  </div>}
                  <div className="admin-content-savebar">
                    <span>{dirty ? copy.unsaved : copy.saved}</span>
                    <button className="primary-button" disabled={busy !== null || !dirty} onClick={saveDraft} type="button">
                      {busy === "save" ? copy.saving : copy.save}
                    </button>
                  </div>
                </>
              )}
            </section>

            <aside className="admin-content-sidebar">
              <section>
                <h2>{copy.publishTitle}</h2>
                <p>{copy.publishHelp}</p>
                <TextArea label={copy.reason} maxLength={500} rows={3} value={publishReason} placeholder={copy.publishReason} onChange={setPublishReason} />
                <button
                  className="primary-button"
                  disabled={!detail?.draft || busy !== null || dirty || publishReason.trim().length < 3}
                  onClick={() => setConfirmation({ kind: "publish" })}
                  type="button"
                >
                  {busy === "publish" ? copy.publishing : copy.publish}
                </button>
              </section>
              <section>
                <h2>{copy.history}</h2>
                <p>{copy.rollbackHelp}</p>
                <TextArea label={copy.rollbackReason} maxLength={500} rows={3} value={rollbackReason} onChange={setRollbackReason} />
                <ol className="admin-revision-list">
                  {revisions.map((revision) => (
                    <li key={revision.id}>
                      <div>
                        <strong>{copy.revision(revision.number)}</strong>
                        {revision.id === currentRevision?.id ? <small>{copy.current}</small> : null}
                      </div>
                      <time dateTime={revision.publishedAt ?? revision.updatedAt}>
                        {formatDate(revision.publishedAt ?? revision.updatedAt, contentLocale)}
                      </time>
                      <span>{copy.locales(revision.locales)}</span>
                      {revision.status === "published" && revision.id !== currentRevision?.id ? (
                        <button
                          className="secondary-button"
                          disabled={Boolean(detail?.draft) || busy !== null || rollbackReason.trim().length < 3}
                          onClick={() => setConfirmation({
                            kind: "rollback",
                            revisionNumber: revision.number
                          })}
                          type="button"
                        >
                          {busy === "rollback" ? copy.rollingBack : copy.rollback}
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
            ? copy.publishConfirmDescription
            : copy.rollbackConfirmDescription}
          onCancel={() => setConfirmation(null)}
          onConfirm={() => {
            if (confirmation?.kind === "publish") void publishDraft();
            if (confirmation?.kind === "rollback") void rollback(confirmation.revisionNumber);
          }}
          open={confirmation !== null}
          title={confirmation?.kind === "publish"
            ? copy.publishConfirmTitle
            : copy.rollbackConfirmTitle}
        />
    </main>
  );
}

function StatusBadge({ label, revision }: {
  label: string;
  revision: AdminContentRevisionSummary | null;
}) {
  return (
    <span data-active={Boolean(revision)}>
      {label}: {revision ? `r${revision.number}` : "—"}
    </span>
  );
}

function TextInput({ label, onChange, value, maxLength }: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  maxLength: number;
}) {
  return <label className="field"><span>{label}</span><input maxLength={maxLength} onChange={(event) => onChange(event.target.value)} required value={value} /></label>;
}

function TextArea({ label, onChange, value, maxLength, rows, placeholder }: {
  label: string;
  onChange: (value: string) => void;
  value: string;
  maxLength: number;
  rows: number;
  placeholder?: string;
}) {
  return <label className="field"><span>{label}</span><textarea maxLength={maxLength} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required rows={rows} value={value} /></label>;
}

function SectionEditor({ copy, index, onChange, onRemove, removable, section }: {
  copy: (typeof contentAdminMessages)["en"];
  index: number;
  onChange: (section: ContentSection) => void;
  onRemove: () => void;
  removable: boolean;
  section: ContentSection;
}) {
  return (
    <fieldset className="admin-section-editor">
      <legend>{copy.sections} {index + 1}</legend>
      <TextInput label={copy.heading} maxLength={180} value={section.heading} onChange={(heading) => onChange({ ...section, heading })} />
      <TextArea label={copy.paragraphs} maxLength={4000} rows={6} value={section.paragraphs.join("\n")} onChange={(value) => onChange({ ...section, paragraphs: value.split("\n") })} />
      <TextArea label={copy.bullets} maxLength={1000} rows={5} value={section.bullets.join("\n")} onChange={(value) => onChange({ ...section, bullets: value.split("\n") })} />
      {removable ? <button className="danger-button" onClick={onRemove} type="button">{copy.removeSection}</button> : null}
    </fieldset>
  );
}

function cloneRevision(value: AdminContentLocalizedRevision) {
  return structuredClone(value);
}

function normaliseSections(sections: ContentSection[]) {
  return sections.map((section) => ({
    heading: section.heading.trim(),
    paragraphs: section.paragraphs.map((value) => value.trim()).filter(Boolean),
    bullets: section.bullets.map((value) => value.trim()).filter(Boolean)
  }));
}

function formatDate(value: string, locale: ContentLocale) {
  return new Intl.DateTimeFormat(locale === "de" ? "de-CH" : "en-CH", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(new Date(value));
}
