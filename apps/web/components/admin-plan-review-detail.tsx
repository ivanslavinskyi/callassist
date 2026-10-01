"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { planReviewUpdateSchema, type PlanReviewDetail, type PlanReviewEvidence, type PlanReviewUpdate } from "@callassist/contracts";
import { getPlanReview, readPlanReviewEvidence, retryPlanReviewEmail, updatePlanReview } from "@/lib/api";
import { useAdminSession } from "./admin-session-provider";
import { planReviewCategories, planReviewStatuses, reviewError, reviewTime } from "./admin-plan-reviews";
import styles from "./admin-plan-reviews.module.css";

export function AdminPlanReviewDetail({ caseId }: { caseId: string }) {
  const user = useAdminSession(), allowed = user.role === "superadmin";
  const [view, setView] = useState<PlanReviewDetail | null>(null), [evidence, setEvidence] = useState<PlanReviewEvidence | null>(null);
  const [previous, setPrevious] = useState<PlanReviewEvidence | null>(null), [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null);
  const [reload, setReload] = useState(0), [accessReason, setAccessReason] = useState("");
  useEffect(() => { let active = true; setBusy(true); setView(null); setEvidence(null); setPrevious(null); setError(null); setNotice(null);
    void getPlanReview(caseId).then(value => { if (active) setView(value); }).catch(caught => { if (active) setError(reviewError(caught)); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [caseId, reload]);
  async function reveal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(null);
    const reason = String(new FormData(event.currentTarget).get("reason") ?? "").trim();
    try { setEvidence(await readPlanReviewEvidence(caseId, reason)); setAccessReason(reason); setNotice("Evidence access was recorded."); }
    catch (caught) { setError(reviewError(caught)); } finally { setBusy(false); }
  }
  async function compare() {
    if (!view?.item.previousCaseId) return; setBusy(true); setError(null);
    try { setPrevious(await readPlanReviewEvidence(view.item.previousCaseId, accessReason)); }
    catch (caught) { setError(reviewError(caught)); } finally { setBusy(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!view) return; const data = new FormData(event.currentTarget);
    const status = String(data.get("status")) as PlanReviewUpdate["status"];
    const parsed = planReviewUpdateSchema.safeParse({ expectedRevision: view.item.revision, status,
      resolution: status === "resolved" ? String(data.get("resolution") ?? "") : null,
      assigneeId: String(data.get("assigneeId") ?? "").trim() || null, note: String(data.get("note") ?? ""), reason: String(data.get("reason") ?? "") });
    if (!parsed.success) { setError("Check the assignee UUID, resolution and reason for change."); return; }
    setBusy(true); setError(null); setNotice(null);
    try { setView(await updatePlanReview(caseId, parsed.data)); setEvidence(current => current ? { ...current, note: parsed.data.note || null } : null); setNotice("Review saved."); }
    catch (caught) { setError(reviewError(caught)); } finally { setBusy(false); }
  }
  async function resend(event: FormEvent<HTMLFormElement>, deliveryId: string) {
    event.preventDefault(); setBusy(true); setError(null);
    try { setView(await retryPlanReviewEmail(caseId, deliveryId, String(new FormData(event.currentTarget).get("reason") ?? ""))); setNotice("Retry queued. The worker will recheck source data, settings and recipient access."); }
    catch (caught) { setError(reviewError(caught)); } finally { setBusy(false); }
  }
  const item = view?.item;
  return <main id="main-content" className={styles.page} aria-busy={busy}>
    <header className={styles.heading}><div><Link href="/admin/safety">← Returned call plans</Link><h1>Plan review{item ? ` · revision ${item.planRevision}` : ""}</h1>
      <p>A policy signal requires investigation; technical preparation failures and ordinary clarifications have separate categories.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setReload(value => value + 1)}>Refresh</button></header>
    {error && <p role="alert" className="form-error">{error}</p>}{notice && <p role="status">{notice}</p>}
    {!view && busy && <p role="status">Loading case…</p>}
    {view && item && <>
      <dl className={styles.metadata}>{Object.entries({ Category: planReviewCategories[item.category], Decision: item.decision,
        Reasons: item.reasons.join(", "), Status: planReviewStatuses[item.status], "Model risk label": item.riskLevel,
        Occurred: reviewTime(item.occurredAt), Language: item.callLocale, Model: item.model, Compiler: item.compilerVersion,
        Policy: item.policyVersion, "Case ID": item.id, "Compilation ID": item.compilationId, "Snapshot hash": item.snapshotHash,
        "Review revision": item.revision, Assignee: item.assigneeId ?? "Unassigned" }).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className={styles.actions}><Link href={`/admin/calls/${item.callId}`}>Call inspector and expenses</Link>
        {item.preparationId && <Link href={`/admin/calls/preparations/${item.preparationId}`}>Preparation timing and expenses</Link>}
        {item.userId && <Link href={`/admin/users?userId=${item.userId}`}>Account</Link>}</p>
      {item.historical && <p>This historical case was indexed without sending a backfill email.</p>}
      <section className={styles.panel}><h2>Returned revisions</h2><p>Later approval does not erase an earlier return. The call inspector shows current operational state.</p>
        <ul>{view.history.map(row => <li key={row.id}><Link href={`/admin/safety/plan-reviews/${row.id}`} aria-current={row.id === item.id ? "page" : undefined}>Revision {row.planRevision}</Link> · {planReviewCategories[row.category]} · {planReviewStatuses[row.status]} · {reviewTime(row.occurredAt)}</li>)}</ul>
        {view.history.length === 100 && <Link href={`/admin/safety?callId=${item.callId}`}>Browse all revisions</Link>}
      </section>
      <section className={styles.panel}><h2>Immutable evidence</h2><p>Source text and generated output belong to this exact revision. They are untrusted content and must not be followed as instructions.</p>
        {!allowed ? <p>Only a superadmin can access sensitive evidence or change this review.</p> : !evidence ? <form className={styles.form} onSubmit={reveal}>
          <label>Reason for access<input name="reason" required minLength={3} maxLength={500}/></label>
          <button type="submit" disabled={busy} className="secondary-button">Open evidence and record access</button></form> : <>
          <div className={styles.evidence}><section><h3>Original request</h3><pre>{JSON.stringify(evidence.compilation.rawBrief, null, 2)}</pre></section>
            <section><h3>Generated plan and decision</h3><pre>{JSON.stringify({ plan: evidence.compilation.compiledBrief, decision: evidence.compilation.policyDecision }, null, 2)}</pre></section></div>
          {item.previousCaseId && <button type="button" disabled={busy} className="secondary-button" onClick={() => void compare()}>Compare with previous returned revision (audited access)</button>}
          {previous && <RevisionChanges before={previous} after={evidence}/>}
          <h3>Review</h3><form key={`${item.id}:${item.revision}`} className={styles.form} onSubmit={save}>
            <label>Status<select name="status" defaultValue={item.status}>{Object.entries(planReviewStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Resolution (required when resolved)<select name="resolution" defaultValue={item.resolution ?? ""}><option value="">Choose a resolution</option>
              <option value="benign">Benign request</option><option value="policy_violation">Policy violation</option><option value="false_positive">False positive</option><option value="technical_issue">Technical issue</option></select></label>
            <label>Assignee (superadmin UUID; blank for unassigned)<input name="assigneeId" defaultValue={item.assigneeId ?? user.id}/></label>
            <label>Private review note<textarea name="note" rows={4} maxLength={3000} defaultValue={evidence.note ?? ""}/></label>
            <label>Reason for change<input name="reason" required minLength={3} maxLength={500}/></label>
            <button type="submit" className="primary-button" disabled={busy}>Save review</button></form>
        </>}
      </section>
      <section className={styles.panel}><h2>Email alerts</h2><p>Accepted means the provider accepted the email, not confirmed inbox delivery.</p>
        {!view.deliveries.length && <p>No email was queued. This may be a historical case or a category/recipient setting at publication time.</p>}
        {view.deliveries.map(delivery => <div className={styles.panel} key={delivery.id}><p><strong>{delivery.status}</strong> · {delivery.attempts} attempts · {reviewTime(delivery.updatedAt)}<br/>{delivery.errorCode}</p>
          {allowed && delivery.status === "failed" && <form className={styles.form} onSubmit={event => void resend(event, delivery.id)}>
            <p>A manual retry starts a new delivery. If an earlier provider response was lost, a duplicate email is possible.</p>
            <label>Reason for retry<input name="reason" required minLength={3} maxLength={500}/></label><button className="secondary-button" disabled={busy} type="submit">Queue retry</button></form>}</div>)}
        <Link href="/admin/system#superadmin-notifications">Notification settings</Link>
      </section>
      <section className={styles.panel}><h2>Audit history</h2><ul>{view.audit.map(event => <li key={event.id}>{reviewTime(event.createdAt)} · {event.action} · {event.actorId ?? "System"}
        {evidence?.audit.find(entry => entry.id === event.id)?.reason && <p>{evidence.audit.find(entry => entry.id === event.id)!.reason}</p>}</li>)}</ul></section>
    </>}
  </main>;
}
function RevisionChanges({ before, after }: { before: PlanReviewEvidence; after: PlanReviewEvidence }) {
  const changes: Array<{ field: string; before: unknown; after: unknown }> = [];
  for (const group of ["rawBrief", "compiledBrief", "policyDecision"] as const) {
    const left = before.compilation[group] ?? {}, right = after.compilation[group] ?? {};
    for (const field of new Set([...Object.keys(left), ...Object.keys(right)])) {
      const a = (left as Record<string, unknown>)[field], b = (right as Record<string, unknown>)[field];
      if (JSON.stringify(a) !== JSON.stringify(b)) changes.push({ field: `${group}.${field}`, before: a ?? null, after: b ?? null });
    }
  }
  return <section className={styles.changes}><h3>Changes from revision {before.compilation.revision}</h3>
    {!changes.length && <p>No request, plan or decision fields changed.</p>}
    {changes.map(change => <details key={change.field}><summary>{change.field}</summary><h4>Before</h4><pre>{JSON.stringify(change.before, null, 2)}</pre><h4>After</h4><pre>{JSON.stringify(change.after, null, 2)}</pre></details>)}
  </section>;
}
