import type { Metadata } from "next";
import { AdminEditorialConsole } from "@/components/admin-editorial-console";

export const metadata: Metadata = {
  title: "CallAssist Landing, FAQ and navigation administration",
  robots: { index: false, follow: false }
};

export default function AdminEditorialPage() {
  return <AdminEditorialConsole />;
}
