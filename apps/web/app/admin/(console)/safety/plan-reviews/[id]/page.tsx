import { AdminPlanReviewDetail } from "@/components/admin-plan-review-detail";
export default async function PlanReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminPlanReviewDetail caseId={id}/>;
}
