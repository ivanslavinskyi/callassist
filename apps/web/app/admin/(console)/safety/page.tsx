import type { Metadata } from "next";
import { AdminSafetyForm } from "@/components/admin-safety-form";

export const metadata: Metadata = {
  title: "SHPROHLI safety operations",
  robots: { index: false, follow: false }
};

export default function AdminSafetyPage() {
  return <AdminSafetyForm />;
}
