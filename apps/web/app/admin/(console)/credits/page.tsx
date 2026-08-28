import type { Metadata } from "next";
import { AdminCreditsForm } from "@/components/admin-credits-form";

export const metadata: Metadata = {
  title: "SHPROHLI credit operations",
  robots: { index: false, follow: false }
};

export default function AdminCreditsPage() {
  return <AdminCreditsForm />;
}
