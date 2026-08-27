import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Dashboard } from "@/components/dashboard";
import { getServerCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "CallAssist call console"
};

export default async function AppPage({
  params
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const user = await getServerCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return <Dashboard userId={user.id} />;
}
