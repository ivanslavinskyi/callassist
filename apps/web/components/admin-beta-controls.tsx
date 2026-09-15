"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import type { BetaControlsView, BetaSettings, UserRole } from "@callassist/contracts";
import { ApiError, getBetaControls, updateBetaControls, createBetaInvitation, revokeBetaInvitation } from "@/lib/api";

export function AdminBetaControls({ role }: { role: UserRole }) {
  const [view, setView] = useState<BetaControlsView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [invitation, setInvitation] = useState<{ code: string; expiresAt: string } | null>(null);
  const refresh = useCallback(async () => {
    setBusy(true);
    try { setView(await getBetaControls()); setError(null); }
    catch { setView(null); setError("Beta settings could not be loaded. Refresh before making changes."); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const editable = role === "superadmin";
  async function mutate(action: () => Promise<unknown>, success: string) {
    if (busy || !editable) return;
    setBusy(true); setError(null); setNotice(null);
    try { await action(); await refresh(); setNotice(success); }
    catch (e) {
      setView(null);
      setError(e instanceof ApiError && e.code === "BETA_SETTINGS_STALE" ? "Another operator changed the settings. Refresh and review the current values." :
          "The change could not be confirmed. Refresh to check its result before trying again.");
    } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view || busy) return;
    const data = new FormData(event.currentTarget);
    const number = (name: string) => Number(data.get(name));
    const settings: BetaSettings = { ...view.settings,
      publicAccountLimit: number("publicAccountLimit"), maxDurationSeconds: number("minutes") * 60,
      maxConcurrentCalls: number("maxConcurrentCalls"), maxStartsPerHour: number("maxStartsPerHour"),
      maxStartsPerDay: number("maxStartsPerDay"), maxStartsPerRecipientPerDay: number("maxStartsPerRecipientPerDay"),
      spendingEnabled: data.has("spendingEnabled"),
      rollingDayBudgetMicros: String(data.get("budget")).trim() ? Math.round(number("budget") * 1e6) : null,
      ...Object.fromEntries(reserves.map(([key]) => [key, Math.round(number(key) * 1e6)]))
    };
    if (!window.confirm("Apply these beta limits to new registrations and provider requests? Active calls keep their admitted duration.")) return;
    await mutate(() => updateBetaControls(settings, view.revision, String(data.get("reason")).trim()), "Beta settings saved.");
  }
  const field = (label: string, name: string, value: number, min: number, max: number, step = 1) =>
    <label className="field" key={name}><span>{label}</span><input type="number" name={name} defaultValue={value} min={min} max={max} step={step} required /></label>;
  return <section className="admin-system-panel" id="beta-controls" aria-busy={busy}>
    <h2>Beta access and spending</h2>
    <p>Open registration has a lifetime intake cap. One-use invitations are additional places. Every verified account receives 3 starting credits; one call per account can run at a time.</p>
    <button type="button" className="secondary-button" disabled={busy} onClick={() => void refresh()}>Refresh beta settings</button>
    {error && <p role="alert" className="form-error">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {view && <>
      <dl className="admin-operations-list">
        <div><dt>Public intake</dt><dd>{view.publicAccounts} / {view.settings.publicAccountLimit}</dd></div>
        <div><dt>Invited accounts</dt><dd>{view.invitedAccounts} (additional)</dd></div>
        <div><dt>Active calls</dt><dd>{view.activeCalls} / {view.settings.maxConcurrentCalls}</dd></div>
        <div><dt>Provider-reported costs / 24 hours</dt><dd>{(view.reportedCostMicros / 1e6).toFixed(3)} USD</dd></div>
        <div><dt>Cost calculated from usage / 24 hours</dt><dd>{(view.usageCostMicros / 1e6).toFixed(3)} USD</dd></div>
        <div><dt>Pending reserves and allowances</dt><dd>{(view.pendingReserveMicros / 1e6).toFixed(3)} USD ({view.unresolvedReservations} requests)</dd></div>
        <div><dt>Total budget occupied / 24 hours</dt><dd>{(view.reservedMicros / 1e6).toFixed(3)} USD</dd></div>
        <div><dt>Available for new requests</dt><dd>{view.settings.rollingDayBudgetMicros === null ? "Set a budget" : `${(Math.max(0, view.settings.rollingDayBudgetMicros - view.reservedMicros) / 1e6).toFixed(3)} USD`}</dd></div>
        <div><dt>Reserve for the next maximum-duration call</dt><dd>{(Math.ceil(view.settings.maxDurationSeconds / 60) * view.settings.callMinuteReserveMicros / 1e6).toFixed(2)} USD</dd></div>
        <div><dt>Budget state</dt><dd role="status">{view.budgetState}</dd></div>
      </dl>
      {["unconfigured", "exhausted", "warning", "paused"].includes(view.budgetState) && <p role="alert">{view.budgetState === "unconfigured" ? "Set a budget before sending real messages or making paid requests." :
        view.budgetState === "warning" ? "Costs and pending reserves occupy at least 80% of the budget. Review spending before increasing it." :
          "New paid requests are stopped when their reservation cannot fit or spending is paused. Existing calls can still be stopped."}</p>}
      <form onSubmit={save} key={view.revision}>
        <fieldset disabled={busy || !editable}>
          <legend>Admission limits</legend>
          <div className="admin-system-grid">
            {field("Open registration cap", "publicAccountLimit", view.settings.publicAccountLimit, 0, 10000)}
            {field("Maximum call duration (minutes)", "minutes", view.settings.maxDurationSeconds / 60, 1, 15)}
            {field("Concurrent calls across the service", "maxConcurrentCalls", view.settings.maxConcurrentCalls, 1, 20)}
            {field("Starts per account / hour", "maxStartsPerHour", view.settings.maxStartsPerHour, 1, 100)}
            {field("Starts per account / UTC day", "maxStartsPerDay", view.settings.maxStartsPerDay, 1, 500)}
            {field("Starts to one recipient / 24 hours (all accounts)", "maxStartsPerRecipientPerDay", view.settings.maxStartsPerRecipientPerDay, 1, 10)}
          </div>
          <p>Failed and refunded calls still count toward attempt limits. Lowering a cap does not delete accounts or interrupt existing calls.</p>
          <p>Budget currency: USD</p>
          <label className="field"><span>Budget for the last 24 hours</span><input type="number" name="budget" min="0.01" max="1000" step="0.01" defaultValue={view.settings.rollingDayBudgetMicros === null ? "" : view.settings.rollingDayBudgetMicros / 1e6} /></label>
          <label><input type="checkbox" name="spendingEnabled" defaultChecked={view.settings.spendingEnabled} /> Allow new paid requests</label>
          <details><summary>Conservative provider reservations</summary>
            <p>Calls reserve their maximum duration up front. As provider data arrives, measured costs replace reservations. OpenAI usage is priced from the published rate card; Twilio connectivity uses its reported USD cost. Free moderation costs zero. Text, final transcription, SMS and email reserve separately. Missing usage, uncertain delivery or an incomplete call keeps its allowance; a failure alone does not mean the request was free.</p>
            <p>Completed calls retain a small allowance of 0.01 USD per billed minute for Media Streams, recording and storage. Usage calculations and allowances may differ from invoices. Accounting: {view.accountingVersion}.</p>
            {reserves.map(([key, label]) => field(label, key, view.settings[key] / 1e6, .000001, 1000, .000001))}
          </details>
          <label className="field"><span>Reason for this change</span><textarea name="reason" minLength={3} maxLength={500} required rows={2} /></label>
          <button className="primary-button" type="submit">Save beta limits</button>
        </fieldset>
      </form>
      {!editable && <p>Only a superadmin can change these limits or issue invitations.</p>}
      <h3>Additional invitations</h3>
      <p>Each invitation is valid for 7 days and one account. Share its code directly with the participant; no email is sent automatically.</p>
      <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget);
        void mutate(async () => setInvitation(await createBetaInvitation(String(data.get("reason")).trim())), "Invitation created. Save its code now; it is shown only once."); }}>
        <fieldset disabled={busy || !editable}><label className="field"><span>Invitation reason</span><input name="reason" minLength={3} maxLength={500} required /></label>
          <button className="secondary-button" type="submit">Create one-use invitation</button></fieldset>
      </form>
      {invitation && <label className="field"><span>Invitation code — expires {new Date(invitation.expiresAt).toLocaleDateString("en-GB")}</span><input readOnly value={invitation.code} onFocus={e => e.target.select()} /></label>}
      <ul>{view.invitations.map(i => <li key={i.id}>{new Date(i.createdAt).toLocaleString("en-GB")} — {i.status}
        {i.status === "available" && editable && <button className="secondary-button" type="button" disabled={busy} onClick={() => {
          const reason = window.prompt("Reason for revoking this invitation (at least 3 characters)");
          if (reason && reason.trim().length >= 3) void mutate(() => revokeBetaInvitation(i.id, reason.trim()), "Invitation revoked.");
        }}>Revoke</button>}</li>)}</ul>
    </>}
  </section>;
}
const reserves = [
  ["callMinuteReserveMicros", "Voice + Realtime + recording / minute"], ["textRequestReserveMicros", "One text provider request"],
  ["transcriptionRequestReserveMicros", "One final transcription request"], ["smsReserveMicros", "One SMS verification send"], ["emailReserveMicros", "One transactional email"]
] as const;
