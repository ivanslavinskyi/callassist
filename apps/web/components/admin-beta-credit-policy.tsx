"use client";
import { useState, type FormEvent } from "react";
import type { BetaControlsView, BetaCreditPolicy, BetaCreditTransitionPreview } from "@callassist/contracts";
import { ApiError, applyBetaCreditTransition, previewBetaCreditTransition, updateBetaCreditPolicy } from "@/lib/api";

export function AdminBetaCreditPolicy({ view, editable, onSaved }: { view: BetaControlsView; editable: boolean; onSaved: () => Promise<void> }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null), [preview, setPreview] = useState<BetaCreditTransitionPreview | null>(null);
  async function run(action: () => Promise<void>) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); } catch (e) { setPreview(null); setError(e instanceof ApiError && e.code === "BETA_SETTINGS_STALE"
      ? "Settings or the eligible cohort changed. Refresh beta settings and preview again."
      : "The action could not be confirmed. Refresh settings before retrying."); } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    await run(async () => { await updateBetaCreditPolicy({ amount: Number(data.get("amount")), period: String(data.get("period")) as BetaCreditPolicy["period"] }, view.revision, String(data.get("reason")));
      setPreview(null); await onSaved(); setNotice("Default saved for new registrations. Existing accounts keep their policy."); });
  }
  return <section aria-busy={busy}>
    <h3>Call credits</h3>
    <p>New registrations receive this policy after phone verification. Periods use UTC: days, Monday-to-Sunday weeks and calendar months. Unused periodic credits expire. Manual and promo credits remain permanent.</p>
    <form onSubmit={save} key={view.revision}><fieldset disabled={!editable || busy}>
      <div className="admin-system-grid">
        <label className="field"><span>Credits</span><input name="amount" type="number" min={0} max={100} required defaultValue={view.settings.creditAllowance.amount} /></label>
        <label className="field"><span>Frequency</span><select name="period" defaultValue={view.settings.creditAllowance.period}>
          <option value="lifetime">Once per account</option><option value="day">Every UTC day</option><option value="week">Every UTC week</option><option value="month">Every UTC month</option>
        </select></label>
      </div>
      <label className="field"><span>Reason for this policy</span><textarea name="reason" required minLength={3} maxLength={500} rows={2} /></label>
      <button className="primary-button" type="submit">Save default for new accounts</button>
    </fieldset></form>
    {editable && <details><summary>Apply the saved policy to existing beta users</summary>
      <p>This separate action includes active, phone-verified customer accounts. Existing permanent credits are preserved. Current periodic allowances keep their current boundary; the saved policy begins at the next boundary. Existing accounts never receive a second lifetime signup grant.</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async () => setPreview(await previewBetaCreditTransition()))}>Preview affected accounts</button>
      {preview && <form onSubmit={event => { event.preventDefault(); const reason = String(new FormData(event.currentTarget).get("reason"));
        if (!window.confirm(`Apply this policy to ${preview.accounts} accounts, preserving current credits?`)) return;
        void run(async () => { const result = await applyBetaCreditTransition({ expectedRevision: preview.revision, policyId: preview.policyId, previewToken: preview.previewToken, reason });
          setPreview(null); await onSaved(); setNotice(`Policy scheduled for ${result.updated} accounts.`); }); }}>
        <p>{preview.accounts} accounts · {preview.immediate} immediately · {preview.atNextBoundary} at their next UTC boundary. {preview.persistentCredits} permanent credits preserved; {preview.activeReservations} pending reservations keep their funding source.</p>
        <label className="field"><span>Reason for applying to existing accounts</span><textarea name="reason" required minLength={3} maxLength={500} rows={2} /></label>
        <button type="submit" className="primary-button" disabled={busy || !preview.accounts}>Apply reviewed transition</button>
      </form>}
    </details>}
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </section>;
}
