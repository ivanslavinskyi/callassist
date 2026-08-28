import type { Metadata } from "next";
import { AdminContentConsole } from "@/components/admin-content-console";

export const metadata: Metadata = {
  title: "SHPROHLI content administration",
  robots: { index: false, follow: false }
};

export default function AdminContentPage() {
  return <AdminContentConsole />;
}
