import type { Metadata } from "next";
import { Suspense } from "react";
import { AdminPlanReviews } from "@/components/admin-plan-reviews";

export const metadata: Metadata = {
  title: "SHPROHLI safety operations",
  robots: { index: false, follow: false }
};

export default function AdminSafetyPage() {
  return <Suspense fallback={<p role="status">Loading plan review…</p>}><AdminPlanReviews /></Suspense>;
}
