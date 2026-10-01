"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { PlanReviewList } from "@callassist/contracts";
import { listPlanReviews } from "@/lib/api";

export function AdminPlanReviewSummary() {
  const [summary, setSummary] = useState<PlanReviewList["summary"] | null>(null);
  useEffect(() => { let active = true;
    void listPlanReviews({ limit: 1 }).then(result => { if (active && result.available) setSummary(result.summary); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  return <aside className="admin-system-panel" aria-label="Plan review queue"><h2>Plan review</h2>
    {summary && <p>{summary.new} new · {summary.inReview} in review · {summary.policySignals} open policy signals · {summary.emailFailed} failed alerts</p>}
    <Link href="/admin/safety">Open returned plans</Link>
  </aside>;
}
