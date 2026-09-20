import type { UiLocale } from "@callassist/contracts";
import { callPresentation, type CallBrief, type CallFeedbackSummary } from "@callassist/contracts";
import { callPresentationCopy } from "@/lib/i18n/call-presentation";

export function CallAssessments({ brief, feedback, locale, feedbackState = "ready", admin = false }: {
  brief: Pick<CallBrief, "status" | "lifecycle">;
  feedback?: CallFeedbackSummary | null;
  locale: UiLocale;
  feedbackState?: "ready" | "loading" | "error";
  admin?: boolean;
}) {
  const view = callPresentation(brief, feedback);
  if (view.stage !== "ended") return null;
  const copy = callPresentationCopy[locale];
  return <span className="call-assessments">
    <span className="assessment-heading">{copy.goal}</span>
    <span className={`assessment-value goal-${view.aiGoal ?? view.aiState}`}><strong>{copy.ai}:</strong> {view.aiGoal ? copy.goals[view.aiGoal] : copy.aiStates[view.aiState]}</span>
    <span className={`assessment-value goal-${view.userGoal ?? "missing"}`}><strong>{admin ? copy.adminUser : copy.user}:</strong> {feedbackState === "loading" ? copy.loading : feedbackState === "error" ? copy.unavailable : view.userGoal ? copy.goals[view.userGoal] : copy.notRated}</span>
    {feedback?.scope === "call" ? <span className="assessment-note">{copy.callScope}</span> : null}
    {view.comparison === "mismatch" && feedbackState === "ready" ? <span className="assessment-difference">{copy.mismatch}</span> : null}
  </span>;
}
