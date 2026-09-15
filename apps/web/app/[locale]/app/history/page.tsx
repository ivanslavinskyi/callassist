import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CallHistoryPage } from "@/components/call-history";
import { getServerCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = { title: "Call history · SHPROHLI" };
export default async function HistoryPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!await getServerCurrentUser()) redirect(`/${locale}/login`);
  return <CallHistoryPage />;
}
