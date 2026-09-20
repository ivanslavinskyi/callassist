"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { analyticsSettingsSchema, type AnalyticsSettingsView } from "@callassist/contracts";
import { ApiError, getAnalyticsSettings, saveAnalyticsSettings } from "@/lib/api";
import { analyticsAdminMessages as copy } from "@/lib/i18n/analytics-messages";

export function AdminAnalyticsSettings() {
  const [view, setView] = useState<AnalyticsSettingsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setBusy(true); setError("");
    try { setView(await getAnalyticsSettings()); } catch { setView(null); setError(copy.error); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view || busy) return;
    const data = new FormData(event.currentTarget);
    const settings = analyticsSettingsSchema.safeParse({ enabled: data.has("enabled"), measurementId: String(data.get("measurementId") ?? "").trim() });
    if (!settings.success) { setError(copy.invalid); return; }
    setBusy(true); setError(""); setNotice("");
    try { await saveAnalyticsSettings({ settings: settings.data, expectedRevision: view.revision }); await refresh(); setNotice(copy.saved); }
    catch (e) { setError(e instanceof ApiError && e.code === "BETA_SETTINGS_STALE" ? copy.stale : copy.error); }
    finally { setBusy(false); }
  }
  return <section className="admin-system-panel" id="analytics" aria-busy={busy}>
    <h2>{copy.title}</h2><p>{copy.setup}</p><p>{copy.privacy}</p>
    <button className="secondary-button" type="button" disabled={busy} onClick={() => void refresh()}>{copy.refresh}</button>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {view ? <form key={view.revision} onSubmit={save}><fieldset disabled={busy}>
      <label><input type="checkbox" name="enabled" defaultChecked={view.settings.enabled} /> {copy.enabled}</label>
      <label className="field"><span>{copy.measurementId}</span><input name="measurementId" defaultValue={view.settings.measurementId} placeholder={copy.example} maxLength={22} pattern="G-[A-Z0-9]{4,20}" autoCapitalize="characters" spellCheck={false} /></label>
      <button type="submit" className="primary-button compact-button">{busy ? copy.saving : copy.save}</button>
    </fieldset></form> : busy ? <p role="status">{copy.loading}</p> : null}
  </section>;
}
