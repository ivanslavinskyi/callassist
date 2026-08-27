import type { Metadata } from "next";
import { AdminCallsConsole } from "@/components/admin-calls-console";

export const metadata: Metadata = {
  title: "CallAssist call operations",
  robots: { index: false, follow: false }
};

export default function AdminCallsPage() {
  return <AdminCallsConsole />;
}
