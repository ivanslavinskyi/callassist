import type { Metadata } from "next";
import { LiveCall } from "@/components/live-call";
import { redirect } from "next/navigation";
import { getServerCurrentUser } from "@/lib/server-auth";

export const metadata: Metadata = {
  title: "SHPROHLI call detail"
};

export default async function CallPage({ params }: {
  params: Promise<{ id: string; locale: string }>;
}) {
  const { id, locale } = await params;
  const user = await getServerCurrentUser();
  if (!user) redirect(`/${locale}/login`);
  return <LiveCall key={`${user.id}:${id}`} callId={id} userId={user.id} />;
}
