import type { Metadata } from "next";
import { AdminSystemConsole } from "@/components/admin-system-console";

export const metadata: Metadata = {
  title: "CallAssist system status",
  robots: { index: false, follow: false }
};

export default function AdminSystemPage() {
  return <AdminSystemConsole />;
}
