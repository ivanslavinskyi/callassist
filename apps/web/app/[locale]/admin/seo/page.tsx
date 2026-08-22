import type { Metadata } from "next";
import { AdminSeoConsole } from "@/components/admin-seo-console";

export const metadata: Metadata = {
  title: "CallAssist SEO audit",
  robots: { index: false, follow: false }
};

export default function AdminSeoPage() {
  return <AdminSeoConsole />;
}
