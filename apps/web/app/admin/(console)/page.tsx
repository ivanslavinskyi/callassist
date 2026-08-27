import type { Metadata } from "next";
import { AdminOperationsDashboard } from "@/components/admin-operations-dashboard";
import { AdminRouteBoundary } from "@/components/admin-route-boundary";

export const metadata: Metadata = {
  title: "CallAssist operations overview",
  robots: { index: false, follow: false }
};

export default function AdminOverviewPage() {
  return (
    <AdminRouteBoundary scope="operations">
      <AdminOperationsDashboard />
    </AdminRouteBoundary>
  );
}
