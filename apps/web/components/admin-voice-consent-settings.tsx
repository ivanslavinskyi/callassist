"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { formatDateTime, voiceConsentSettingsUpdateSchema, type UserRole, type VoiceConsentSettingsView } from "@callassist/contracts";
import { ApiError, getVoiceConsentSettings, updateVoiceConsentSettings } from "@/lib/api";
import { voiceConsentMessages, type VoiceConsentCopy } from "@/lib/i18n/voice-consent-messages";
import { useUiLocale } from "./ui-locale-provider";

export function AdminVoiceConsentSettings({ role }: { role: UserRole }) {
  const { locale } = useUiLocale();
  const copy = voiceConsentMessages[locale];
  const [view, setView] = useState<VoiceConsentSettingsView | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<"error" | "stale" | "invalid" | null>(null);
  const [saved, setSaved] = useState(false);
  const requestVersion = useRef(0);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setBusy(true); setError(null); setSaved(false);
    try { const next = await getVoiceConsentSettings(); if (version === requestVersion.current) setView(next); }
    catch { if (version === requestVersion.current) { setView(null); setError("error"); } }
    finally { if (version === requestVersion.current) setBusy(false); }
  }, []);
  const invalidatePendingRequests = useCallback(() => { requestVersion.current++; }, []);
  useEffect(() => { void refresh(); return invalidatePendingRequests; }, [refresh, invalidatePendingRequests]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view || busy || role !== "superadmin") return;
    const data = new FormData(event.currentTarget);
    const input = voiceConsentSettingsUpdateSchema.safeParse({ mode: data.get("mode"), expectedRevision: view.policy.revision, reason: data.get("reason") });
    if (!input.success) { setError("invalid"); return; }
    const version = ++requestVersion.current;
    setBusy(true); setError(null); setSaved(false);
    try {
      const next = await updateVoiceConsentSettings(input.data);
      if (version === requestVersion.current) { setView(next); setSaved(true); }
    } catch (cause) {
      if (version === requestVersion.current) {
        // A lost response may follow a successful update. Require a fresh read.
        setView(null);
        setError(cause instanceof ApiError && cause.code === "VOICE_CONSENT_REVISION_CONFLICT" ? "stale" : "error");
      }
    } finally { if (version === requestVersion.current) setBusy(false); }
  }

  return <section className="admin-system-panel" id="voice-consent" aria-busy={busy}>
    <h2>{copy.title}</h2><p>{copy.scope}</p><p>{copy.hybridHelp}</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>{copy.refresh}</button>
    {error && <p className="form-error" role="alert">{copy[error]}</p>}
    {saved && <p role="status">{copy.saved}</p>}
    {busy && !view && <p role="status">{copy.loading}</p>}
    {view && <>
      <dl className="admin-operations-list">
        <div><dt>{copy.mode}</dt><dd>{view.policy.mode === "semantic_native" ? copy.native : copy.hybrid}</dd></div>
        <div><dt>{copy.revision}</dt><dd>{view.policy.revision}</dd></div>
        <div><dt>{copy.updated}</dt><dd>{view.updatedAt ? formatDateTime(view.updatedAt, locale) : copy.initial}</dd></div>
        {view.reason && <div><dt>{copy.reason}</dt><dd>{view.reason}</dd></div>}
      </dl>
      <VoiceConsentSettingsForm key={view.policy.revision} role={role} view={view} busy={busy} copy={copy} onSubmit={save} />
    </>}
    {role !== "superadmin" && <p>{copy.restricted}</p>}
  </section>;
}

export function VoiceConsentSettingsForm({ role, view, busy, copy, onSubmit }: {
  role: UserRole; view: VoiceConsentSettingsView; busy: boolean; copy: VoiceConsentCopy;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <form onSubmit={onSubmit}><fieldset disabled={busy || role !== "superadmin"}>
    <label className="field"><span>{copy.mode}</span><select name="mode" defaultValue={view.policy.mode}>
      <option value="semantic_native">{copy.native}</option><option value="hybrid_deterministic_v1">{copy.hybrid}</option>
    </select></label>
    <label className="field"><span>{copy.reason}</span><textarea name="reason" minLength={3} maxLength={500} required rows={2} /></label>
    <button type="submit" className="primary-button">{busy ? copy.saving : copy.save}</button>
  </fieldset></form>;
}
