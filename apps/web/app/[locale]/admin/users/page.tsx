import type { Metadata } from "next";
import { AdminUsersConsole } from "@/components/admin-users-console";

export const metadata: Metadata = {
  title: "CallAssist user operations",
  robots: { index: false, follow: false }
};

export default function AdminUsersPage() {
  return <AdminUsersConsole />;
}
