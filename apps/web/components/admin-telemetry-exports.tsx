"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type { TelemetryExportInput, TelemetryExportView } from "@callassist/contracts";
import { ApiError, changeTelemetryExport, createTelemetryExport, previewTelemetryExport, listTelemetryExports, telemetryExportDownloadUrl } from "@/lib/api";
import { useAdminSession } from "./admin-session-provider";
import styles from "./admin-telemetry-exports.module.css";

const presets: Array<[TelemetryExportInput["preset"], string]> = [["today", "Today"], ["yesterday", "Yesterday"], ["last7", "Last 7 days"], ["last30", "Last 30 days"], ["previousMonth", "Previous month"], ["custom", "Custom dates"]];
const errors: Record<string, string> = {
  EXPORT_INVALID_PERIOD: "Choose a period of up to 31 calendar days.",
  EXPORT_INVALID_INPUT: "Check the dates and enter a reason of 3–500 characters.",
  EXPORT_ALREADY_ACTIVE: "An export is already queued or running. Wait for it or cancel it below.",
  EXPORT_CAPACITY_REACHED: "Export capacity is currently full. Remove an unneeded file or try again later.",
  EXPORT_AUDIO_LIMIT_EXCEEDED: "Audio exceeds 250 MiB total or 64 MiB per recording. Choose a shorter period or export metadata only.",
  EXPORT_AUDIO_STREAM_FAILED: "An audio download was interrupted. No incomplete audio archive was published; retry the export.",
  EXPORT_BUILD_TIMEOUT: "The archive exceeded the 30-minute build limit. Choose a shorter period.",
  EXPORT_LIMIT_EXCEEDED: "This export exceeds the size or record limit. Choose a shorter period.",
  EXPORT_SNAPSHOT_TIMEOUT: "The export took too long. Choose a shorter period.",
  EXPORT_PRIVACY_CHANGED: "Access was revoked because source data or account permissions changed. Create a new export.",
  EXPORT_REVOKED: "Access was revoked. Create a new export if you still need these records.",
  EXPORT_SOURCE_DECRYPTION_FAILED: "A source record could not be read. The export was stopped to avoid missing data.",
  EXPORT_WORKER_FAILED: "The worker could not finish the export.",
  EXPORT_LEASE_EXPIRED: "The worker stopped before finishing the export.",
  EXPORT_UNAVAILABLE: "Telemetry exports require PostgreSQL storage and an enabled export worker."
};
function errorMessage(error: unknown) {
  return error instanceof ApiError ? errors[error.code] ?? "The export request failed. Refresh and try again." : "Could not reach the server. Your request may have been received; retrying will use the same request ID.";
}
const dateTime = (value: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Zurich" }).format(new Date(value));

export function AdminTelemetryExports() {
  const user = useAdminSession();
  return user.role === "superadmin" ? <ExportPanel /> : <p role="note">Telemetry exports are available to superadmins in Admin → Calls.</p>;
}
function ExportPanel() {
  const [open, setOpen] = useState(true);
  const [preset, setPreset] = useState<TelemetryExportInput["preset"]>("yesterday");
  const [items, setItems] = useState<TelemetryExportView[]>([]);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [workerSeen, setWorkerSeen] = useState<string | null>(null);
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewTelemetryExport>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [older, setOlder] = useState<TelemetryExportView[]>([]);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const mounted = useRef(true);
  const olderPageLoaded = useRef(false);
  const refresh = useCallback(async () => {
    const result = await listTelemetryExports();
    if (mounted.current) { setItems(result.items); setAvailable(result.available); setWorkerSeen(result.workerLastSeenAt); if (!olderPageLoaded.current) setCursor(result.nextCursor); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!open) return;
    let stopped = false, timeout: ReturnType<typeof setTimeout>;
    async function poll() {
      try { await refresh(); } catch (e) { if (!stopped) setError(errorMessage(e)); }
      if (!stopped) timeout = setTimeout(poll, 4000);
    }
    void poll();
    return () => { stopped = true; clearTimeout(timeout); };
  }, [open, refresh]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const data = new FormData(event.currentTarget);
    const fields = { preset, timezone: "Europe/Zurich" as const, reason: String(data.get("reason") ?? "").trim(), includeAudio: data.get("includeAudio") === "on",
      ...(preset === "custom" ? { dateFrom: String(data.get("from")), dateTo: String(data.get("to")) } : {}) };
    const signature = JSON.stringify(fields);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      const result = await createTelemetryExport({ ...fields, requestId: request.current.id });
      request.current = null;
      setItems(current => [result, ...current.filter(item => item.id !== result.id)]);
      await refresh();
    } catch (e) { setError(errorMessage(e)); }
    finally { setBusy(false); }
  }
  async function change(id: string, action: "cancel" | "retry") {
    setBusy(true); setError(null);
    try {
      const result = await changeTelemetryExport(id, action);
      setOlder(current => current.map(item => item.id === id ? result : item)); await refresh();
    } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  async function more() {
    if (!cursor) return; setBusy(true);
    try { const result = await listTelemetryExports(cursor); olderPageLoaded.current = true; setOlder(current => [...current, ...result.items.filter(row => !current.some(item => item.id === row.id))]); setCursor(result.nextCursor); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }
  const rows = [...items, ...older.filter(row => !items.some(item => item.id === row.id))];
  const active = rows.some(row => row.status === "queued" || row.status === "running");
  return <details id="telemetry-export" open={open} className={styles.panel} onToggle={e => setOpen(e.currentTarget.open)}>
    <summary className={styles.toggle}>Export telemetry <span>Transcripts, call history and diagnostics</span></summary>
    <div className={styles.content}>
      <p>Download all calls in a period as a ZIP with JSON Lines, a summary and a data guide. Includes original transcripts, approved plans, provider usage and processing history. Retained recordings can be included; each recording has a separate availability entry in the audio manifest.</p>
      <p className={styles.note}>Dates use Europe/Zurich. Includes calls started and preparation requests created in the period, including failed preparations. Associated history is included. Table filters do not restrict the export.</p>
      {available === false ? <div role="status"><p>Telemetry export is disabled on this server.</p><p>{errors.EXPORT_UNAVAILABLE} Contact the server administrator to enable exports for the API and worker.</p><button className="primary-button" disabled>Create export</button></div> : <form onSubmit={create} className={styles.form}>
        <label className="field"><span>Period</span><select value={preset} onChange={e => setPreset(e.target.value as TelemetryExportInput["preset"])}>{presets.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {preset === "custom" && <div className={styles.dates}>
          <label className="field"><span>From (inclusive)</span><input type="date" name="from" required /></label>
          <label className="field"><span>Through (inclusive)</span><input type="date" name="to" required /></label>
        </div>}
        <label><input type="checkbox" name="includeAudio" defaultChecked onChange={() => setPreview(null)} /> Include retained recordings from all associated attempts</label>
        <button type="button" className="secondary-button" disabled={busy} onClick={async e => {
          const form = e.currentTarget.form; if (!form) return;
          const data = new FormData(form); setBusy(true); setError(null);
          try { setPreview(await previewTelemetryExport({ requestId: crypto.randomUUID(), preset, timezone: "Europe/Zurich",
            reason: "Preview recording export", ...(preset === "custom" ? { dateFrom: String(data.get("from")), dateTo: String(data.get("to")) } : {}) })); }
          catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
        }}>Preview coverage and recordings</button>
        {preview && <p role="status">{preview.recordings} retained recordings · approximately {(preview.estimatedBytes / 1048576).toFixed(1)} MiB uncompressed WAV
          {preview.unknownSizes ? ` · ${preview.unknownSizes} sizes unknown` : ""}{preview.earliestDeadline ? ` · earliest retention deadline ${dateTime(preview.earliestDeadline)}` : ""}. Availability is checked again during export.
          <br />Coverage: {preview.coverage.incomplete_native_captures ?? 0} incomplete transcript captures;
          {" "}{preview.coverage.missing_paid_usage ?? 0} possibly charged operations with unknown usage;
          {" "}{preview.coverage.stale_provider_operations ?? 0} operations without a result after 5 minutes;
          {" "}{preview.coverage.pending_text_artifacts ?? 0} pending text artifacts.</p>}
        <label className="field"><span>Reason for accessing call content</span><input name="reason" required minLength={3} maxLength={500} defaultValue="Call quality analysis and application improvements" /></label>
        <p className={styles.note}>Full transcripts contain personal information. Files remain available for up to 24 hours, limited by the earliest included recording retention deadline; deleting source data or changing account permissions revokes existing exports. Access is audited.</p>
        <button className="primary-button" type="submit" disabled={busy || active || available === null}>{busy ? "Working…" : active ? "Export in progress" : "Create export"}</button>
      </form>}
      {error && <p role="alert" className={styles.error}>{error} <button className="secondary-button" onClick={() => { setError(null); void refresh().catch(e => setError(errorMessage(e))); }}>Refresh</button></p>}
      <h2 className={styles.heading}>Your recent exports</h2>
      {available && (!workerSeen || Date.now() - Date.parse(workerSeen) > 150000) && <p role="status">The export worker has not reported recently. Queued exports will start when it is running.</p>}
      {available === null && <p role="status">Loading exports…</p>}
      {available && !rows.length && <p>No exports yet.</p>}
      <ul className={styles.list}>{rows.map(row => <li key={row.id} className={styles.item}>
        <div><strong>{dateTime(row.from)} — {dateTime(row.to)}</strong><p className={styles.note}>End time excluded · Europe/Zurich · Requested {dateTime(row.createdAt)}</p></div>
        <div className={styles.status} role={row.status === "running" || row.status === "queued" ? "status" : undefined}>
          <strong>{row.status.charAt(0).toUpperCase() + row.status.slice(1)}</strong>
          {row.status === "running" ? " · Building archive" : ""}
          {row.records > 0 ? ` · ${row.records.toLocaleString("en-GB")} records` : ""}
          {row.status === "ready" ? ` · ${(row.bytes / 1048576).toFixed(2)} MB · ${row.counts.selected_attempts ?? 0} selected ${row.counts.selected_attempts === 1 ? "call" : "calls"}` : ""}
        </div>
        {row.includeAudio && row.status === "ready" && <p role={(row.counts.audio_fetch_failed ?? 0) + (row.counts.audio_unavailable ?? 0) ? "alert" : "status"}>
          Audio: {row.counts.audio_included ?? 0} included, {row.counts.audio_deleted ?? 0} deleted, {row.counts.audio_expired ?? 0} expired,
          {" "}{row.counts.audio_unavailable ?? 0} unavailable, {row.counts.audio_fetch_failed ?? 0} failed. Check audio-manifest.json for every recording.
        </p>}
        {row.status === "queued" && <p className={styles.note}>Waiting for the export worker. You can close this page and return later.</p>}
        {row.snapshotAt && <p className={styles.note}>Data as of {dateTime(row.snapshotAt)}{row.status === "ready" && row.expiresAt ? ` · Available until ${dateTime(row.expiresAt)}` : ""}</p>}
        {row.failureCode && ["failed", "revoked"].includes(row.status) && <p>{errors[row.failureCode] ?? "The export could not be completed. Create a new export or contact the administrator."}</p>}
        <div className={styles.actions}>
          {row.status === "ready" && <a className="primary-button" href={telemetryExportDownloadUrl(row.id)} target="_blank" rel="noreferrer">Download ZIP</a>}
          {row.retryable && <button className="secondary-button" disabled={busy || active} onClick={() => void change(row.id, "retry")}>Retry</button>}
          {["queued", "running", "ready"].includes(row.status) && <button className="secondary-button" disabled={busy} onClick={() => void change(row.id, "cancel")}>{row.status === "ready" ? "Remove file" : "Cancel"}</button>}
        </div>
      </li>)}</ul>
      {cursor && <button className="secondary-button" disabled={busy} onClick={() => void more()}>Older exports</button>}
    </div>
  </details>;
}
