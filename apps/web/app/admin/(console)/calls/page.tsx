import type { Metadata } from "next";
import { AdminCallsConsole } from "@/components/admin-calls-console";

export const metadata: Metadata = {
  title: "SHPROHLI call operations",
  robots: { index: false, follow: false }
};

export default function AdminCallsPage() {
  return <AdminCallsConsole />;
}
