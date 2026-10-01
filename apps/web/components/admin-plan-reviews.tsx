"use client";
import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { policyReasonCodeSchema, planReviewFiltersSchema, type PlanReviewFilters, type PlanReviewList } from "@callassist/contracts";
import { listPlanReviews, ApiError } from "@/lib/api";
import styles from "./admin-plan-reviews.module.css";

export const planReviewCategories = { policy_signal: "Policy signal", clarification: "Clarification", unsupported_task: "Unsupported task", technical_failure: "Technical preparation failure" };
export const planReviewStatuses = { new: "New", in_review: "In review", resolved: "Resolved" };
export function reviewTime(value: string) { return new Date(value).toLocaleString("en-GB", { timeZone: "Europe/Zurich", timeZoneName: "short" }); }
export function reviewError(error: unknown) {
  if (error instanceof ApiError && error.code === "PLAN_REVIEW_STALE") return "Another operator changed this case. Refresh and review the current values before saving.";
  if (error instanceof ApiError && error.status === 403) return "Your current role does not permit this action.";
  if (error instanceof ApiError && error.status === 404) return "This case is unavailable or its source data has been deleted.";
  return "The request could not be confirmed. Refresh to check the current state.";
}
export function AdminPlanReviews() {
  const params = useSearchParams();
  const initial = planReviewFiltersSchema.safeParse({ ...(params.get("userId") ? { userId: params.get("userId") } : {}), ...(params.get("callId") ? { callId: params.get("callId") } : {}) });
  const [filters, setFilters] = useState<PlanReviewFilters>(initial.success ? initial.data : { limit: 25 });
  const [result, setResult] = useState<PlanReviewList | null>(null), [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null), [refresh, setRefresh] = useState(0);
  useEffect(() => { let active = true; setBusy(true); setError(null);
    void listPlanReviews(filters).then(value => { if (active) setResult(value); })
      .catch(caught => { if (active) setError(reviewError(caught)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [filters, refresh]);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget), query: Record<string, unknown> = { limit: 25 };
    for (const key of ["status", "category", "decision", "reason", "userId", "callId"] as const) {
      const value = String(data.get(key) ?? "").trim(); if (value) query[key] = value;
    }
    for (const key of ["from", "to"] as const) {
      const value = String(data.get(key) ?? ""); if (value) query[key] = `${value}T${key === "from" ? "00:00:00.000" : "23:59:59.999"}Z`;
    }
    const parsed = planReviewFiltersSchema.safeParse(query);
    if (!parsed.success) { setError("Check the date range and user/call UUIDs."); return; }
    setFilters(parsed.data);
  }
  return <main id="main-content" className={styles.page} aria-busy={busy}>
    <header className={styles.heading}><div><span className="eyebrow">Safety</span><h1>Returned call plans</h1>
      <p>Review immutable decisions and repeated revisions. A policy signal is a reason to investigate, not a finding of abuse.</p></div>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    {result?.available && <div className={styles.counters}>
      <span><strong>{result.summary.new}</strong>New</span><span><strong>{result.summary.inReview}</strong>In review</span>
      <span><strong>{result.summary.policySignals}</strong>Open policy signals</span><span><strong>{result.summary.emailFailed}</strong>Failed alerts</span>
      <span><strong>{result.summary.emailPending}</strong>Pending alerts</span>
      {result.summary.oldestPendingAt && <span>Oldest pending<br/>{reviewTime(result.summary.oldestPendingAt)}</span>}
    </div>}
    {result && !result.available && <p role="status">Plan review requires PostgreSQL storage. This environment does not provide a persistent review queue.</p>}
    <form className={styles.filters} onSubmit={apply}>
      <label>Status<select name="status"><option value="">All</option>{Object.entries(planReviewStatuses).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Category<select name="category"><option value="">All</option>{Object.entries(planReviewCategories).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>Decision<select name="decision"><option value="">All</option><option value="blocked">Blocked</option><option value="needs_clarification">Clarification required</option></select></label>
      <label>Reason<select name="reason"><option value="">All</option>{policyReasonCodeSchema.options.map(reason => <option key={reason}>{reason}</option>)}</select></label>
      <label>From (UTC date)<input type="date" name="from"/></label><label>Through (UTC date)<input type="date" name="to"/></label>
      <label>User ID<input name="userId" defaultValue={filters.userId} placeholder="UUID"/></label>
      <label>Call ID<input name="callId" defaultValue={filters.callId} placeholder="UUID"/></label>
      <button type="submit" className="secondary-button" disabled={busy}>Apply filters</button>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {busy && <p role="status">Loading decisions…</p>}
    {result?.available && <>
      <p>{result.items.length} decisions on this page. Counters above cover all available cases.</p>
      <div className={styles.tableWrap}><table className={styles.table}><caption className="sr-only">Returned plan decisions</caption>
        <thead><tr><th>Time</th><th>User / plan</th><th>Decision / reason</th><th>Other revisions</th><th>Status</th><th>Email</th></tr></thead>
        <tbody>{result.items.map(item => <tr key={item.id}>
          <td><time dateTime={item.occurredAt}>{reviewTime(item.occurredAt)}</time>{item.historical && <small>Historical · no backfill email</small>}</td>
          <td><Link href={`/admin/safety/plan-reviews/${item.id}`}>Revision {item.planRevision} · {item.callLocale}</Link><small>{item.userId ?? "No account"}</small><small>{item.callId}</small></td>
          <td><span className={styles.badge} data-category={item.category}>{planReviewCategories[item.category]}</span><small>{item.decision}</small><small>{item.reasons.join(", ")}</small></td>
          <td>{item.repeats}</td><td>{planReviewStatuses[item.status]}{item.assigneeId && <small>Assigned: {item.assigneeId}</small>}</td>
          <td>{item.emailPending} pending<br/>{item.emailAccepted} accepted<br/>{item.emailFailed} failed</td>
        </tr>)}</tbody></table></div>
      {!result.items.length && !busy && <p>No returned plans match these filters.</p>}
      <div className={styles.actions}>{filters.cursor && <button type="button" className="secondary-button" disabled={busy} onClick={() => setFilters(({ cursor: _cursor, ...rest }) => rest)}>First page</button>}
        {result.nextCursor && <button type="button" className="secondary-button" disabled={busy} onClick={() => setFilters(value => ({ ...value, cursor: result.nextCursor! }))}>Next page</button>}
        <Link href="/admin/system#superadmin-notifications">Email settings and delivery health</Link></div>
    </>}
  </main>;
}
