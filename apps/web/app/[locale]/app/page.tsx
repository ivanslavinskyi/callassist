import type { Metadata } from "next";
import { Dashboard } from "@/components/dashboard";

export const metadata: Metadata = {
  title: "CallAssist call console"
};

export default function AppPage() {
  return <Dashboard />;
}
