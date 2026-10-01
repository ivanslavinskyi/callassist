import type postgres from "postgres";
import type { CallCompilation, PlanReviewCase } from "@callassist/contracts";

/** A policy signal warrants review; it is not a finding that the owner attacked the service. */
export function planReviewCategory(decision: CallCompilation["policyDecision"]): PlanReviewCase["category"] {
  if (decision.reasonCodes.some(reason => ["input_moderation_flagged", "model_refusal", "prohibited_content"].includes(reason))) return "policy_signal";
  if (decision.reasonCodes.includes("unsupported_task")) return "unsupported_task";
  if (decision.status === "blocked" && decision.reasonCodes.some(reason => ["fact_integrity_failure", "plan_constraint_failure"].includes(reason))) return "technical_failure";
  return "clarification";
}

/** Must run in the compilation publication transaction, after the immutable row exists. */
export async function recordPlanReview(sql: postgres.TransactionSql, callId: string, compilation: CallCompilation,
  options: { preparationId?: string; historical?: boolean } = {}) {
  if (compilation.policyDecision.status === "ready_for_review") return null;
  const decision = compilation.policyDecision;
  const [created] = await sql<{ id: string; user_id: string | null }[]>`
    INSERT INTO plan_review_cases(compilation_id,call_brief_id,preparation_id,user_id,plan_revision,snapshot_hash,
      previous_case_id,decision,category,reasons,risk_level,call_locale,compiler_version,policy_version,model,historical,occurred_at)
    SELECT c.id,b.id,${options.preparationId ?? null},b.user_id,c.revision,c.snapshot_hash,
      (SELECT p.id FROM plan_review_cases p WHERE p.call_brief_id=b.id AND p.plan_revision<c.revision ORDER BY p.plan_revision DESC LIMIT 1),
      ${decision.status},${planReviewCategory(decision)},${decision.reasonCodes},${decision.riskLevel},${compilation.rawBrief.locale},
      ${compilation.compilerVersion},${decision.policyVersion},${compilation.compilerModel},${options.historical ?? false},${compilation.compiledAt}::timestamptz
    FROM call_compilations c JOIN call_briefs b ON b.id=c.call_brief_id
    WHERE b.id=${callId} AND c.revision=${compilation.revision} AND c.snapshot_hash=${compilation.snapshotHash}
      AND b.data_deleted_at IS NULL AND c.compilation_ciphertext IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=b.user_id AND u.status='deleted')
      AND NOT EXISTS(SELECT 1 FROM account_deletion_requests d WHERE d.user_id=b.user_id AND d.status<>'completed')
    ON CONFLICT (compilation_id) DO NOTHING RETURNING id,user_id`;
  if (!created) return null;
  await sql`INSERT INTO plan_review_audit(case_id,action) VALUES(${created.id},${options.historical ? "case.backfilled" : "case.created"})`;
  if (!options.historical) await sql`SELECT enqueue_superadmin_notification('plan_review',${created.id},${created.user_id},${callId},NULL,${compilation.compiledAt}::timestamptz)`;
  return created.id;
}
